import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  type TokenBalance,
} from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { encodeURL, findReference, FindReferenceError, validateTransfer } from "@solana/pay";
import { createTransfer } from "@solana/pay";
import BigNumber from "bignumber.js";
import bs58 from "bs58";
import { getAccount, getAssociatedTokenAddress, getMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { classifyInvoiceObservation, type PaymentCheckResult, type PaymentProvider } from "@181hacks/paylink-core";
import { explorerTx, serverRpcUrl, SOLANA_DEVNET_CAIP2, usdcMint } from "./env";
import { createCachedRpcFetch } from "./rpc-fetch";
import { DEVNET_BUSY, NO_USDC, isTransientRpcError, warnRpcFailure } from "./rpc-errors";
import { createAsyncCache } from "./async-cache";
import { transactionFeePayer } from "./transaction-payer";

export interface StoredKey {
  name: string;
  publicKey: string;
  secret: number[];
}

const keyDir = path.join(process.cwd(), "data", "keys");

function keyPath(name: string): string {
  return path.join(keyDir, `${name}.json`);
}

export function loadOrCreateKey(name: string): StoredKey {
  const fromEnv = process.env[`${name.toUpperCase()}_SECRET_KEY`]?.trim();
  if (fromEnv) {
    const secret = bs58.decode(fromEnv);
    const keypair = Keypair.fromSecretKey(secret);
    return { name, publicKey: keypair.publicKey.toBase58(), secret: Array.from(secret) };
  }
  try {
    const parsed = JSON.parse(readFileSync(keyPath(name), "utf8")) as StoredKey;
    if (parsed.publicKey && Array.isArray(parsed.secret)) return parsed;
  } catch {
    // generate below
  }
  const keypair = Keypair.generate();
  const stored: StoredKey = {
    name,
    publicKey: keypair.publicKey.toBase58(),
    secret: Array.from(keypair.secretKey),
  };
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(keyPath(name), JSON.stringify(stored, null, 2));
  return stored;
}

export function keypairFrom(stored: StoredKey): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(stored.secret));
}

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(serverRpcUrl(), {
      commitment: "confirmed", disableRetryOnRateLimit: true,
      fetch: createCachedRpcFetch({ mint: usdcMint() }),
    });
  }
  return connection;
}

export function resetConnection(): void {
  connection = null;
}

export function solanaPayUrl(input: {
  recipient: string;
  amount: string;
  splToken: string;
  reference: string;
  label: string;
  message: string;
  memo: string;
}): string {
  const url = encodeURL({
    recipient: new PublicKey(input.recipient),
    amount: new BigNumber(input.amount),
    splToken: new PublicKey(input.splToken),
    reference: new PublicKey(input.reference),
    label: input.label,
    message: input.message,
    memo: input.memo,
  });
  return url.toString();
}

export function attachSamplePayments(db: { invoices: import("@181hacks/paylink-core").Invoice[] }): void {
  const merchant = loadOrCreateKey("merchant");
  const asset = usdcMint();
  for (const invoice of db.invoices) {
    if (!invoice.sample || invoice.payment || invoice.status === "paid" || invoice.status === "draft") continue;
    const reference = Keypair.generate().publicKey.toBase58();
    invoice.payment = {
      provider: "solana",
      reference,
      recipient: merchant.publicKey,
      asset,
      network: SOLANA_DEVNET_CAIP2,
      url: solanaPayUrl({
        recipient: merchant.publicKey,
        amount: invoice.amount,
        splToken: asset,
        reference,
        label: "Morrow Quay Studio",
        message: invoice.description,
        memo: invoice.id,
      }),
    };
  }
}

const readyTokenAccounts = new Set<string>();

/**
 * A fresh merchant wallet has no USDC token account, and Solana Pay transfers
 * (and x402 settlements) to it fail with TokenAccountNotFoundError. Create it
 * once, paid by the merchant. Best effort: offline runs keep working.
 */
export async function ensureMerchantTokenAccount(mint: string): Promise<boolean> {
  if (readyTokenAccounts.has(mint)) return true;
  try {
    const merchant = keypairFrom(loadOrCreateKey("merchant"));
    await getOrCreateAssociatedTokenAccount(getConnection(), merchant, new PublicKey(mint), merchant.publicKey);
    readyTokenAccounts.add(mint);
    return true;
  } catch (error) {
    warnRpcFailure("merchant token account", error);
    return false;
  }
}

export function createSolanaProvider(): PaymentProvider {
  return {
    id: "solana",
    async createRequest(input) {
      const merchant = loadOrCreateKey("merchant");
      const reference = Keypair.generate().publicKey.toBase58();
      const asset = usdcMint();
      await ensureMerchantTokenAccount(asset);
      const url = solanaPayUrl({
        recipient: merchant.publicKey,
        amount: input.amount,
        splToken: asset,
        reference,
        label: input.label,
        message: input.message,
        memo: input.memo,
      });
      return {
        reference,
        url,
        recipient: merchant.publicKey,
        asset,
        network: SOLANA_DEVNET_CAIP2,
      };
    },
    async check(input) {
      return checkSolanaInvoice(input);
    },
  };
}

export async function checkSolanaInvoice(input: {
  reference: string;
  amount: string;
  asset: string;
  recipient: string;
  dueDate: string;
}): Promise<PaymentCheckResult & { payerWallet?: string }> {
  const now = new Date();
  try {
    const signatureInfo = await findReference(getConnection(), new PublicKey(input.reference), {
      finality: "confirmed",
    });
    const signature = signatureInfo.signature;
    let validated = false;
    let validateMessage = "";
    try {
      await validateTransfer(
        getConnection(),
        signature,
        {
          recipient: new PublicKey(input.recipient),
          amount: new BigNumber(input.amount),
          splToken: new PublicKey(input.asset),
          reference: new PublicKey(input.reference),
        },
        { commitment: "confirmed" },
      );
      validated = true;
    } catch (error) {
      if (isTransientRpcError(error)) throw error;
      validateMessage = error instanceof Error ? error.message : "validateTransfer failed";
    }

    // Only meta token balances are needed here. Use the raw getTransaction form
    // also used by validateTransfer, so identical reads share the transport cache.
    const parsed = await getConnection().getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const observed = readTokenDelta(parsed, input.recipient, input.asset, input.amount);
    if (validated || (observed.amountOk && observed.mintOk)) {
      const result = classifyInvoiceObservation(
        {
          found: true,
          amountOk: true,
          mintOk: true,
          signature,
          amountReceived: observed.amountReceived ?? input.amount,
        },
        input.dueDate,
        now,
      );
      result.explorerUrl = explorerTx(signature);
      result.message = validated
        ? "findReference and validateTransfer matched the amount and mint."
        : "Balance delta matches the invoice.";
      return { ...result, payerWallet: transactionFeePayer(parsed) };
    }
    if (observed.mintOk === false) {
      const result = classifyInvoiceObservation(
        {
          found: true,
          amountOk: false,
          mintOk: false,
          signature,
          amountReceived: observed.amountReceived,
          message: "The transfer used the wrong token. This invoice needs devnet USDC.",
        },
        input.dueDate,
        now,
      );
      result.explorerUrl = explorerTx(signature);
      return result;
    }
    if (observed.amountOk === false || validateMessage.includes("amount not transferred")) {
      const result = classifyInvoiceObservation(
        {
          found: true,
          amountOk: false,
          mintOk: true,
          signature,
          amountReceived: observed.amountReceived,
          message: "The transfer is smaller than the invoice.",
        },
        input.dueDate,
        now,
      );
      result.explorerUrl = explorerTx(signature);
      return result;
    }
    return {
      status: "pending",
      signature,
      explorerUrl: explorerTx(signature),
      issue: null,
      message: "Transaction found, but the token balance is not visible yet.",
    };
  } catch (error) {
    if (error instanceof FindReferenceError || (error instanceof Error && /not found|unable to find/i.test(error.message))) {
      return classifyInvoiceObservation({ found: false }, input.dueDate, now);
    }
    warnRpcFailure("invoice check", error);
    return classifyInvoiceObservation({ found: false, rpcDown: true, message: DEVNET_BUSY }, input.dueDate, now);
  }
}

const payerWalletCached = createAsyncCache<string | undefined>(10 * 60_000);

/** Best effort for historical receipts, using the resilient server-only RPC. */
export function getConfirmedPayerWallet(signature: string): Promise<string | undefined> {
  return payerWalletCached(signature, async () => {
    try {
      return transactionFeePayer(await getConnection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
    } catch (error) {
      warnRpcFailure("receipt payer lookup", error);
      return undefined;
    }
  });
}

function readTokenDelta(
  tx: { meta: { err?: unknown; preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null } | null } | null,
  recipient: string,
  mint: string,
  expected: string,
): { amountOk?: boolean; mintOk?: boolean; amountReceived?: string } {
  if (!tx?.meta || tx.meta.err) return {};
  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];
  const delta = (tokenMint: string) => {
    const before = pre.find((row) => row.mint === tokenMint && row.owner === recipient);
    const after = post.find((row) => row.mint === tokenMint && row.owner === recipient);
    const beforeAmount = Number(before?.uiTokenAmount.uiAmountString ?? "0");
    const afterAmount = Number(after?.uiTokenAmount.uiAmountString ?? "0");
    return afterAmount - beforeAmount;
  };
  const received = delta(mint);
  if (received > 0) {
    const amountReceived = trimAmount(received);
    return {
      mintOk: true,
      amountReceived,
      amountOk: new BigNumber(amountReceived).gte(new BigNumber(expected)),
    };
  }
  const other = post.find((row) => row.owner === recipient && row.mint !== mint);
  if (other) {
    const otherDelta = delta(other.mint);
    if (otherDelta > 0) {
      return { mintOk: false, amountReceived: trimAmount(otherDelta) };
    }
  }
  return {};
}

function trimAmount(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export async function buildPayTransaction(input: {
  sender: string;
  recipient: string;
  amount: string;
  splToken: string;
  reference: string;
  memo: string;
}): Promise<string> {
  const rpc = getConnection();
  const mint = new PublicKey(input.splToken);
  // Preflight outside createTransfer: its sender-not-found catch can mask RPC
  // failures as a missing ATA. Transport retries/cache also serve its re-read.
  const address = await getAssociatedTokenAddress(mint, new PublicKey(input.sender));
  const account = await getAccount(rpc, address);
  const token = await getMint(rpc, mint);
  if (account.amount === 0n) throw new Error(NO_USDC);
  if (new BigNumber(account.amount.toString()).lt(new BigNumber(input.amount).shiftedBy(token.decimals))) {
    throw new Error("Insufficient devnet USDC for this invoice.");
  }
  let tx: Awaited<ReturnType<typeof createTransfer>>;
  try {
    tx = await createTransfer(
      rpc,
      new PublicKey(input.sender),
      {
        recipient: new PublicKey(input.recipient),
        amount: new BigNumber(input.amount),
        splToken: mint,
        reference: new PublicKey(input.reference),
        memo: input.memo,
      },
    );
  } catch (error) {
    // The payer ATA was verified above. A later masked lookup failure is not
    // evidence that the payer lacks USDC and can safely retry construction.
    if (/sender not found/i.test(error instanceof Error ? error.message : "")) throw new Error(DEVNET_BUSY);
    throw error;
  }
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(bytes).toString("base64");
}

export function amountCovers(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  return new BigNumber(received).gte(new BigNumber(expected));
}
