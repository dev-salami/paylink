import { createId, issueReceipt } from "@181hacks/paylink-core";
import { getDb, updateDb } from "../store";
import { decimalToAtomic, formatAtomic, isLiveInvoice, type CrossChainAttempt } from "../settlement/types";
import { readMainnetTransaction, verifySolanaSettlement } from "../settlement/solana-mainnet";
import { auroraAvailable, auroraClient } from "./client";
import { SOURCES, originExplorer, type SourceAsset } from "./assets";
import { buildQuoteRequest, validateQuote } from "./quote";
import { reduceProviderStatus, terminalAttempt } from "./lifecycle";
import { withReceiptAmounts, resolveReceiptAmounts } from "../receipt-amounts";

const locks = new Set<string>();
const refreshing = new Map<string, Promise<void>>();
const limits = new Map<string, number[]>();
const potentiallyFunded = (attempt: CrossChainAttempt) => Boolean(attempt.depositAddress) && ["deposit_seen", "incomplete", "processing", "settlement_verifying", "refund_pending", "failed_needs_review", "needs_review"].includes(attempt.lifecycle);
export function publicRate(request: Request, kind: "quote" | "read" = "read") {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const windowMs = kind === "quote" ? 3_600_000 : 60_000;
  const entries = (limits.get(key) || []).filter((at) => at > now - windowMs);
  if (entries.length >= (kind === "quote" ? 60 : 120) || (kind === "quote" && entries.some((at) => now - at < 2_000))) throw new Error("Too many requests. Please wait before retrying.");
  if (limits.size > 2000) limits.delete(limits.keys().next().value!);
  limits.set(key, [...entries, now]);
}
export function liveInvoice(id: string) {
  const invoice = getDb().invoices.find((row) => row.id === id);
  if (!invoice || !isLiveInvoice(invoice) || invoice.sample || invoice.status === "draft") throw new Error("This invoice is not available for mainnet payment.");
  return invoice;
}
export async function paymentOptions(id: string) {
  const invoice = liveInvoice(id);
  startReconciler();
  // Existing due attempts only: provider status / independent verification reads,
  // never quote or deposit creation. Concurrent readers share refreshAttempt's
  // refreshing promise; settlement still uses the same synchronous paid/claim CAS.
  const stored = getDb().crossChainAttempts.filter((row) => row.invoiceId === id);
  if (invoice.status !== "paid") {
    for (const row of stored.filter((row) => !terminalAttempt(row.lifecycle) && Date.parse(row.nextPollAt) <= Date.now())
      .sort((a, b) => Date.parse(a.nextPollAt) - Date.parse(b.nextPollAt)).slice(0, 4)) await refreshAttempt(row.id);
  }
  const available = auroraAvailable() && Boolean(process.env.SOLANA_MAINNET_RPC_URL?.trim());
  let sources: SourceAsset[] = [];
  try { sources = available && invoice.status !== "paid" ? await auroraClient().sources() : []; } catch { /* Resume stored attempts even while the catalogue/provider is unavailable. */ }
  const attempts = getDb().crossChainAttempts.filter((row) => row.invoiceId === id);
  const latest = (invoice.status === "paid" ? attempts.find((row) => row.lifecycle === "settled" && row.destinationTxHashes.includes(invoice.txSignature || "")) : undefined)
    || attempts.find(potentiallyFunded) || attempts.find((row) => row.lifecycle === "quoted" || row.lifecycle === "awaiting_deposit") || attempts.at(-1);
  return { available, sources, invoice: { id: invoice.id, status: invoice.status, receiptId: invoice.receiptId, explorerUrl: invoice.explorerUrl,
    crossChain: resolveReceiptAmounts(invoice.id, invoice.crossChain, attempts) },
    target: { amount: invoice.amount, amountAtomic: invoice.settlement.amountAtomic, asset: "USDC", assetId: invoice.settlement.assetId, decimals: 6, network: "Solana mainnet", feePolicy: invoice.settlement.feePolicy }, attempt: latest ? publicAttempt(latest) : undefined };
}
export function publicAttempt(attempt: CrossChainAttempt) {
  const source = SOURCES.find((row) => row.assetId === attempt.sourceAssetId);
  const invoice = getDb().invoices.find((row) => row.id === attempt.invoiceId);
  const blockedByOther = getDb().crossChainAttempts.some((row) => row.invoiceId === attempt.invoiceId && row.id !== attempt.id && potentiallyFunded(row));
  return {
    id: attempt.id, invoiceId: attempt.invoiceId, lifecycle: attempt.lifecycle, providerStatus: attempt.providerStatus,
    source, refundTo: `${attempt.refundTo.slice(0, 6)}…${attempt.refundTo.slice(-4)}`,
    depositAddress: attempt.depositAddress, depositMemo: attempt.depositMemo, userDeadline: attempt.userDeadline,
    quote: attempt.realQuote?.quote, correlationId: attempt.correlationId,
    originTxHashes: attempt.originTxHashes, destinationTxHashes: attempt.destinationTxHashes,
    amountInFormatted: attempt.amountInFormatted, depositedAmount: attempt.depositedAmount, refundedAmount: attempt.refundedAmount, refundReason: attempt.refundReason,
    nextPollAt: attempt.nextPollAt,
    canDeposit: Boolean(invoice && isLiveInvoice(invoice) && !invoice.sample && invoice.status !== "paid" && invoice.status !== "draft" && attempt.lifecycle === "awaiting_deposit" && Date.parse(attempt.userDeadline) > Date.now() && !blockedByOther),
  };
}
export async function createPaymentQuote(id: string, input: { sourceAssetId?: unknown; refundTo?: unknown; dry?: unknown; acknowledged?: unknown }) {
  const invoice = liveInvoice(id);
  if (invoice.status === "paid") throw new Error("This invoice is already paid.");
  if (!auroraAvailable() || !process.env.SOLANA_MAINNET_RPC_URL?.trim()) throw new Error("Pay from any chain is not available.");
  if (typeof input.sourceAssetId !== "string" || typeof input.refundTo !== "string" || typeof input.dry !== "boolean") throw new Error("Choose the token and network to pay from, then enter your refund wallet.");
  if (!input.dry && input.acknowledged !== true) throw new Error("Confirm that you understand this payment uses real funds on mainnet.");
  if (locks.has(id)) throw new Error("An invoice quote is already being prepared.");
  locks.add(id);
  try {
    const client = auroraClient();
    const source = (await client.sources()).find((row) => row.assetId === input.sourceAssetId);
    if (!source) throw new Error("This payment option is temporarily unavailable.");
    const request = buildQuoteRequest(invoice.settlement, source.assetId, input.refundTo, input.dry, createId("swap"));
    if (input.dry) return { preview: { quote: (await client.quote(request)).quote, source } };
    const previous = getDb().crossChainAttempts.filter((row) => row.invoiceId === id);
    // An attempt that never received a deposit address can never be funded; it must not block a fresh quote.
    const active = previous.find((row) => Boolean(row.depositAddress) && !["expired_unfunded", "refunded", "settled"].includes(row.lifecycle));
    if (active) {
      if (active.lifecycle === "awaiting_deposit") await refreshAttempt(active.id);
      if (active.lifecycle === "awaiting_deposit" && Date.parse(active.userDeadline) > Date.now() && active.sourceAssetId === source.assetId && active.refundTo.toLowerCase() === input.refundTo.toLowerCase()) {
        // Resume is NOT a new quote. Requiring the full, matching refund address
        // prevents another payer from unknowingly funding someone else's route.
        return { attempt: publicAttempt(active), resumed: true };
      }
      if (active.lifecycle === "expired_unfunded") throw new Error("The old quote is now confirmed expired. Get a fresh preview before creating another address.");
      throw new Error("A payment may already be in progress. Resume the existing payment instead of creating another address.");
    }
    const recent = previous.filter((row) => Date.now() - Date.parse(row.createdAt) < 3_600_000);
    if (recent.length >= 20 || recent.some((row) => Date.now() - Date.parse(row.createdAt) < 30_000)) throw new Error("Please wait before creating another quote for this invoice.");
    const dryQuote = await client.quote({ ...request, dry: true });
    // Persist the reservation BEFORE the external call. An ambiguous response is
    // held for review, never replaced with an untracked second deposit address.
    const stamp = new Date().toISOString();
    if (getDb().invoices.find((row) => row.id === id)?.status === "paid") throw new Error("This invoice is already paid.");
    const attempt: CrossChainAttempt = { id: request.sessionId, invoiceId: id, sourceAssetId: source.assetId, sourceChain: source.chain, sourceSymbol: source.symbol,
      refundTo: input.refundTo, dryQuote, userDeadline: request.deadline, lifecycle: "quoted", originTxHashes: [], destinationTxHashes: [], createdAt: stamp, updatedAt: stamp, nextPollAt: stamp };
    updateDb((db) => { db.crossChainAttempts.push(attempt); });
    try {
      const real = await client.quote(request);
      // Retain a returned address and snapshot even if a late concurrent payment
      // wins the invoice or the provider returned an already-expired quote.
      updateDb(() => { Object.assign(attempt, { realQuote: real, depositAddress: real.quote.depositAddress, depositMemo: real.quote.depositMemo, correlationId: real.correlationId }); });
      if (getDb().crossChainAttempts.some((row) => row.id !== attempt.id && row.depositAddress?.toLowerCase() === real.quote.depositAddress?.toLowerCase() && (row.depositMemo || "") === (real.quote.depositMemo || ""))) throw new Error("This address is already linked to another payment. Contact support before sending funds.");
      if (getDb().invoices.find((row) => row.id === id)?.status === "paid") throw new Error("This invoice is already paid.");
      const deadlines = [request.deadline, real.quote.deadline, real.quote.timeWhenInactive].filter((value): value is string => Boolean(value));
      const deadline = new Date(Math.min(...deadlines.map((value) => Date.parse(value)))).toISOString();
      if (Date.parse(deadline) <= Date.now()) throw new Error("The quote expired before it could be displayed.");
      updateDb(() => { Object.assign(attempt, { dryQuote, realQuote: real, depositAddress: real.quote.depositAddress, depositMemo: real.quote.depositMemo,
        userDeadline: deadline, providerDeadline: real.quote.deadline || real.quote.timeWhenInactive, correlationId: real.correlationId, lifecycle: "awaiting_deposit", updatedAt: new Date().toISOString() }); });
      startReconciler();
      return { attempt: publicAttempt(attempt) };
    } catch {
      updateDb(() => { attempt.lifecycle = "needs_review"; attempt.updatedAt = new Date().toISOString(); });
      return { attempt: publicAttempt(attempt), warning: "We couldn’t confirm the payment instructions. Do not send funds. Contact support before starting another payment." };
    }
  } finally { locks.delete(id); }
}

const atomic = (value: unknown) => typeof value === "string" && /^\d{1,100}$/.test(value) ? value : undefined;
function hashes(value: unknown, pattern: RegExp): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 20).map((row) => row?.hash).filter((hash): hash is string => typeof hash === "string" && pattern.test(hash)))];
}
function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = process.env.AURORA_INTENTS_API_KEY?.trim();
  return (key ? value.split(key).join("[redacted]") : value).replace(/https?:\/\/\S+/g, "[redacted URL]")
    .replace(/0x[a-fA-F0-9]{40}\b/g, (address) => `${address.slice(0, 6)}…${address.slice(-4)}`).replace(/[\x00-\x1f]/g, " ").slice(0, 200);
}
export function refreshAttempt(id: string): Promise<void> {
  const running = refreshing.get(id);
  if (running) return running;
  const job = reconcile(id).finally(() => { refreshing.delete(id); });
  refreshing.set(id, job);
  return job;
}
async function reconcile(id: string) {
  const attempt = getDb().crossChainAttempts.find((row) => row.id === id);
  if (!attempt || terminalAttempt(attempt.lifecycle) || Date.parse(attempt.nextPollAt) > Date.now()) return;
  if (locks.has(attempt.invoiceId) && attempt.lifecycle === "quoted") return;
  if (attempt.lifecycle === "expired_unfunded" && Date.now() - Date.parse(attempt.createdAt) > 86_400_000) return;
  if (!attempt.depositAddress) {
    updateDb(() => { attempt.lifecycle = "needs_review"; }); return;
  }
  if (!SOURCES.some((row) => row.assetId === attempt.sourceAssetId)) {
    updateDb(() => { attempt.lifecycle = "needs_review"; }); return;
  }
  try {
    if (attempt.lifecycle === "settlement_verifying" && attempt.destinationTxHashes.length) {
      // A known SUCCESS must not need more Aurora quota to retry finalized RPC
      // evidence. All reads still use the provider-supplied, persisted hashes.
      await verifyAndSettle(attempt);
      return;
    }
    const raw = await auroraClient().status(attempt.depositAddress, attempt.depositMemo) as { status?: unknown; correlationId?: string; quoteResponse?: unknown; swapDetails?: Record<string, unknown> };
    if (raw?.quoteResponse != null && attempt.realQuote) {
      try {
        const echoed = validateQuote(attempt.realQuote.request, raw.quoteResponse);
        if (echoed.quote.depositAddress?.toLowerCase() !== attempt.depositAddress.toLowerCase() || (echoed.quote.depositMemo || "") !== (attempt.depositMemo || "")) throw new Error("Mismatched deposit");
      } catch {
        updateDb(() => { attempt.lifecycle = "needs_review"; attempt.updatedAt = new Date().toISOString(); });
        return;
      }
    }
    const providerStatus = typeof raw?.status === "string" && ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"].includes(raw.status) ? raw.status : "UNKNOWN";
    const details = raw?.swapDetails || {};
    const destination = hashes(details.destinationChainTxHashes, /^[1-9A-HJ-NP-Za-km-z]{64,100}$/);
    updateDb(() => {
      attempt.providerStatus = providerStatus;
      if (!attempt.correlationId && typeof raw?.correlationId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw.correlationId)) attempt.correlationId = raw.correlationId;
      attempt.lifecycle = reduceProviderStatus(attempt.lifecycle, providerStatus, attempt.userDeadline);
      if (providerStatus === "SUCCESS" && Array.isArray(details.destinationChainTxHashes) && (details.destinationChainTxHashes.length > 20 || details.destinationChainTxHashes.some((row) => !row || typeof row.hash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(row.hash)))) attempt.lifecycle = "needs_review";
      attempt.originTxHashes = [...new Set([...attempt.originTxHashes, ...hashes(details.originChainTxHashes, /^0x[a-fA-F0-9]{64}$/)])];
      attempt.destinationTxHashes = [...new Set([...attempt.destinationTxHashes, ...destination])];
      const source = SOURCES.find((row) => row.assetId === attempt.sourceAssetId)!;
      let reportedIn = atomic(details.amountIn);
      if (!reportedIn && typeof details.amountInFormatted === "string") {
        try { reportedIn = decimalToAtomic(details.amountInFormatted, source.decimals); } catch { /* Do not invent an actual spend from a malformed/missing report. */ }
      }
      attempt.amountIn = reportedIn || attempt.amountIn;
      if (attempt.amountIn) attempt.amountInFormatted = formatAtomic(attempt.amountIn, source.decimals);
      attempt.depositedAmount = atomic(details.depositedAmount) || attempt.depositedAmount;
      attempt.amountOut = atomic(details.amountOut);
      attempt.refundedAmount = atomic(details.refundedAmount);
      attempt.refundReason = safeReason(details.refundReason);
      attempt.lastPolledAt = new Date().toISOString(); attempt.updatedAt = attempt.lastPolledAt;
      attempt.nextPollAt = new Date(Date.now() + (attempt.lifecycle === "expired_unfunded" ? 60_000 : 8_000)).toISOString();
    });
    if (attempt.lifecycle !== "settlement_verifying") return;
    await verifyAndSettle(attempt);
  } catch {
    updateDb(() => { attempt.nextPollAt = new Date(Date.now() + 60_000).toISOString(); attempt.updatedAt = new Date().toISOString(); });
  }
}
async function verifyAndSettle(attempt: CrossChainAttempt) {
  const invoice = liveInvoice(attempt.invoiceId);
  const target = { ...invoice.settlement };
  const verification = await verifySolanaSettlement(target, attempt.destinationTxHashes, invoice.id, getDb().settlementClaims, readMainnetTransaction);
  updateDb((db) => {
    if (terminalAttempt(attempt.lifecycle)) return;
    const stamp = new Date().toISOString();
    attempt.evidence = verification.evidence;
    attempt.lastPolledAt = stamp; attempt.updatedAt = stamp;
    attempt.nextPollAt = new Date(Date.now() + 8_000).toISOString();
    if (verification.state !== "verified") { attempt.lifecycle = verification.state; return; }
    const row = db.invoices.find((item) => item.id === invoice.id);
    if (!row || !isLiveInvoice(row) || JSON.stringify(row.settlement) !== JSON.stringify(target) || row.status === "draft" || row.status === "paid" || row.receiptId || attempt.destinationTxHashes.some((signature) => db.settlementClaims.some((claim) => claim.chain === "sol" && claim.signature === signature && claim.attemptId !== attempt.id))) {
      attempt.lifecycle = "needs_review"; return;
    }
    const signature = attempt.destinationTxHashes[0]!;
    const crossChain = withReceiptAmounts({ sourceChain: attempt.sourceChain, sourceSymbol: attempt.sourceSymbol, amountInFormatted: attempt.amountInFormatted || "Not recorded",
      originTxHash: attempt.originTxHashes[0], originExplorerUrl: attempt.originTxHashes[0] ? originExplorer(attempt.sourceChain, attempt.originTxHashes[0]) : undefined,
      destinationTxHash: signature, destinationExplorerUrl: `https://explorer.solana.com/tx/${signature}`, correlationId: attempt.correlationId, network: "Solana mainnet" as const }, attempt, verification.evidence.totalAtomic);
    const paidRow = { ...row, status: "paid" as const, paidAt: stamp, updatedAt: stamp, amountReceived: formatAtomic(verification.evidence.totalAtomic, 6),
      txSignature: signature, explorerUrl: crossChain.destinationExplorerUrl, crossChain, paymentIssue: null, paymentIssueDetail: undefined };
    const receipt = { ...issueReceipt(paidRow, db.merchant), crossChain };
    // Build the receipt before changing claims/status; then commit all records
    // together synchronously, with no await between the CAS and store write.
    for (const sig of attempt.destinationTxHashes) db.settlementClaims.push({ chain: "sol", signature: sig, invoiceId: row.id, attemptId: attempt.id, claimedAt: stamp });
    Object.assign(row, paidRow, { receiptId: receipt.id });
    db.receipts.unshift(receipt); attempt.lifecycle = "settled";
    db.activities.unshift({ id: createId("act"), at: stamp, kind: "receipt_issued", title: `Verified mainnet payment for ${row.number}`, invoiceId: row.id, href: `/receipts/${receipt.id}` });
  });
}
export async function getPaymentAttempt(invoiceId: string, id: string) {
  liveInvoice(invoiceId); startReconciler();
  const attempt = getDb().crossChainAttempts.find((row) => row.id === id && row.invoiceId === invoiceId);
  if (!attempt) throw new Error("Payment not found. Reopen your invoice link.");
  if (!attempt.lastPolledAt || Date.now() - Date.parse(attempt.lastPolledAt) > 5_000) await refreshAttempt(id);
  return publicAttempt(attempt);
}
export async function submitDepositHint(invoiceId: string, id: string, hash: unknown) {
  const attempt = getDb().crossChainAttempts.find((row) => row.id === id && row.invoiceId === invoiceId);
  if (!attempt?.depositAddress || terminalAttempt(attempt.lifecycle) || typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("Enter a valid transaction hash from the network you paid on. This payment must still be open.");
  await auroraClient().submit(hash, attempt.depositAddress); // Hint only, never evidence.
  return { accepted: true };
}
const runtime = globalThis as typeof globalThis & { __paylinkAuroraReconciler?: ReturnType<typeof setInterval>; __paylinkAuroraReconciling?: boolean };
export async function reconcileDueAttempts() {
  if (runtime.__paylinkAuroraReconciling) return;
  runtime.__paylinkAuroraReconciling = true;
  try {
    const due = getDb().crossChainAttempts.filter((row) => !terminalAttempt(row.lifecycle) && Date.parse(row.nextPollAt) <= Date.now() && (row.lifecycle !== "expired_unfunded" || Date.now() - Date.parse(row.createdAt) <= 86_400_000))
      .sort((a, b) => Date.parse(a.nextPollAt) - Date.parse(b.nextPollAt)).slice(0, 4);
    for (const row of due) await refreshAttempt(row.id);
  } finally { runtime.__paylinkAuroraReconciling = false; }
}
export function startReconciler() {
  if (!auroraAvailable() || runtime.__paylinkAuroraReconciler || process.env.NEXT_PHASE === "phase-production-build") return;
  runtime.__paylinkAuroraReconciler = setInterval(() => {
    void reconcileDueAttempts().catch(() => {});
  }, 8_000);
  runtime.__paylinkAuroraReconciler.unref?.();
}
export type PaymentOptions = Awaited<ReturnType<typeof paymentOptions>>;
export type PublicPaymentAttempt = ReturnType<typeof publicAttempt>;
