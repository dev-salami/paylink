import { Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { createCachedRpcFetch } from "../rpc-fetch";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, type LiveSettlement, type SettlementClaim, type SettlementEvidence } from "./types";

export type Verification = { state: "verified" | "settlement_verifying" | "needs_review"; evidence: SettlementEvidence };
/** Independent of Aurora. Atomic raw balances only; no formatted UI amounts. */
export async function verifySolanaSettlement(settlement: LiveSettlement, signatures: string[], invoiceId: string, claims: SettlementClaim[],
  read: (signature: string) => Promise<VersionedTransactionResponse | null>): Promise<Verification> {
  const unique = [...new Set(signatures)];
  const evidence: SettlementEvidence = { signatures: unique, totalAtomic: "0", checkedAt: new Date().toISOString() };
  const result = (state: Verification["state"], reason: string): Verification => ({ state, evidence: { ...evidence, reason } });
  if (settlement.network !== "solana-mainnet" || settlement.chain !== "sol" || settlement.mint !== MAINNET_USDC_MINT || settlement.assetId !== MAINNET_USDC_ASSET || settlement.decimals !== 6) return result("needs_review", "Unsupported destination.");
  if (typeof settlement.amountAtomic !== "string" || !/^\d{1,20}$/.test(settlement.amountAtomic) || BigInt(settlement.amountAtomic) <= 0n || BigInt(settlement.amountAtomic) > 18_446_744_073_709_551_615n) return result("needs_review", "Invalid destination amount.");
  if (!unique.length) return result("settlement_verifying", "Waiting for destination transaction hashes.");
  if (unique.length > 20 || unique.some((sig) => !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(sig))) return result("needs_review", "Invalid destination transaction hashes.");
  if (unique.some((sig) => claims.some((claim) => claim.chain === "sol" && claim.signature === sig && claim.invoiceId !== invoiceId))) return result("needs_review", "Destination transaction is already claimed by another invoice.");
  let total = 0n;
  for (const signature of unique) {
    let tx: VersionedTransactionResponse | null;
    try { tx = await read(signature); } catch { return result("settlement_verifying", "Mainnet confirmation is temporarily unavailable."); }
    if (!tx?.meta) return result("settlement_verifying", "Destination transaction is not finalized yet.");
    if (tx.meta.err !== null) return result("needs_review", "Destination transaction failed or its result is incomplete.");
    try {
      if (!Array.isArray(tx.meta.preTokenBalances) || !Array.isArray(tx.meta.postTokenBalances)) throw new Error("Missing token balance metadata");
      type Balance = NonNullable<NonNullable<VersionedTransactionResponse["meta"]>["postTokenBalances"]>[number];
      const balances = (rows: Balance[]) => {
        const indexed = new Map<number, Balance>();
        for (const row of rows) {
          if (row.mint !== MAINNET_USDC_MINT) continue;
          if (!Number.isInteger(row.accountIndex) || row.accountIndex < 0 || indexed.has(row.accountIndex) || row.uiTokenAmount.decimals !== 6 || typeof row.uiTokenAmount.amount !== "string" || !/^\d{1,20}$/.test(row.uiTokenAmount.amount) || BigInt(row.uiTokenAmount.amount) > 18_446_744_073_709_551_615n) throw new Error("Invalid token balance metadata");
          indexed.set(row.accountIndex, row);
        }
        return indexed;
      };
      const pre = balances(tx.meta.preTokenBalances);
      const post = balances(tx.meta.postTokenBalances);
      let before = 0n;
      let after = 0n;
      for (const row of post.values()) if (row.owner === settlement.recipient) after += BigInt(row.uiTokenAmount.amount);
      for (const row of pre.values()) {
        // Older RPC metadata can omit a pre-balance owner. An existing account's
        // whole balance must not be mistaken for fresh credit (ATA creation has
        // NO pre row). Subtract that baseline conservatively by account index.
        if (row.owner === settlement.recipient || (!row.owner && post.get(row.accountIndex)?.owner === settlement.recipient)) before += BigInt(row.uiTokenAmount.amount);
      }
      const delta = after - before;
      if (delta < 0n) return result("needs_review", "Recipient balance decreased.");
      total += delta;
    } catch { return result("needs_review", "Destination token balances could not be verified."); }
  }
  evidence.totalAtomic = total.toString();
  return total >= BigInt(settlement.amountAtomic) ? result("verified", "Finalized mainnet USDC credit verified.") : result("needs_review", "Verified output is below the invoice net amount.");
}

let connection: Connection | undefined;
let genesis: Promise<boolean> | undefined;
export async function readMainnetTransaction(signature: string): Promise<VersionedTransactionResponse | null> {
  const endpoint = process.env.SOLANA_MAINNET_RPC_URL?.trim();
  if (!endpoint) throw new Error("Mainnet verification is not configured.");
  connection ??= new Connection(endpoint, { commitment: "finalized", disableRetryOnRateLimit: true, fetch: createCachedRpcFetch({ mint: MAINNET_USDC_MINT }) });
  genesis ??= connection.getGenesisHash().then((hash) => hash.startsWith("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).catch(() => { genesis = undefined; return false; });
  if (!await genesis) throw new Error("Mainnet verification is unavailable.");
  return connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
}
