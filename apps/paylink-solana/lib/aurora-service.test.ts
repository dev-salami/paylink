import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { CrossChainAttempt, SettlementClaim, SettlementInvoice, SettlementReceipt, QuoteRequest } from "./settlement/types";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT } from "./settlement/types";
import { SOURCES } from "./aurora/assets";
import { isPublicPath } from "./access";

const mocks = vi.hoisted(() => ({
  quote: vi.fn(), status: vi.fn(), submit: vi.fn(), read: vi.fn(), sources: vi.fn(),
  db: { merchant: { name: "Studio", city: "Lagos" }, invoices: [] as SettlementInvoice[], receipts: [] as SettlementReceipt[], crossChainAttempts: [] as CrossChainAttempt[], settlementClaims: [] as SettlementClaim[], activities: [] as unknown[] },
}));
vi.mock("./store", () => ({ getDb: () => mocks.db, updateDb: (fn: (db: typeof mocks.db) => unknown) => fn(mocks.db) }));
vi.mock("./aurora/client", () => ({ auroraAvailable: () => true, auroraClient: () => ({ sources: mocks.sources, quote: mocks.quote, status: mocks.status, submit: mocks.submit }) }));
vi.mock("./settlement/solana-mainnet", async (original) => ({ ...await original<typeof import("./settlement/solana-mainnet")>(), readMainnetTransaction: mocks.read }));
const sig = "4".repeat(88);
const runtime = globalThis as typeof globalThis & { __paylinkAuroraReconciler?: unknown; __paylinkAuroraReconciling?: boolean };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  vi.stubEnv("AURORA_INTENTS_API_KEY", "fake-private-key"); vi.stubEnv("SOLANA_MAINNET_RPC_URL", "https://mainnet.example.test/private-key");
  vi.stubEnv("NEXT_PHASE", "");
  delete runtime.__paylinkAuroraReconciler; delete runtime.__paylinkAuroraReconciling;
  mocks.db.invoices = [{ id: "inv_live", number: "PL-2026-1044", clientName: "Ada", description: "Logo", amount: "2", currency: "USDC", dueDate: "2026-11-08", status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    settlement: { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant", amountAtomic: "2000000", feePolicy: "payer_pays_exact_output" } }];
  mocks.db.receipts = []; mocks.db.crossChainAttempts = []; mocks.db.settlementClaims = []; mocks.db.activities = [];
  let addressSequence = 1;
  mocks.quote.mockReset().mockImplementation(async (request: QuoteRequest) => ({ request, correlationId: "e1562882-5252-43fe-9cb0-70e494916b46", quote: { amountIn: "2020495", minAmountIn: "2010442", amountOut: "2000000", minAmountOut: "2000000", ...(request.dry ? {} : { depositAddress: `0x${(++addressSequence).toString(16).padStart(40, "0")}` }) } }));
  mocks.sources.mockReset().mockResolvedValue(SOURCES);
  mocks.status.mockReset().mockResolvedValue({ status: "PENDING_DEPOSIT" }); mocks.submit.mockReset().mockResolvedValue({});
  mocks.read.mockReset().mockResolvedValue({ meta: { err: null, preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, owner: "merchant", mint: MAINNET_USDC_MINT, uiTokenAmount: { amount: "2000000", decimals: 6, uiAmount: null } }] } } as unknown as VersionedTransactionResponse);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); delete runtime.__paylinkAuroraReconciler; delete runtime.__paylinkAuroraReconciling; });
async function create() {
  const service = await import("./aurora/service");
  const input = { sourceAssetId: SOURCES[0]!.assetId, refundTo: `0x${"1".repeat(40)}`, dry: false, acknowledged: true, recipient: "attacker", amount: "1" };
  await service.createPaymentQuote("inv_live", input);
  return { service, attempt: mocks.db.crossChainAttempts[0]! };
}
describe("MOCK persisted Aurora orchestration — no network or payments", () => {
  it("ignores client destination/amount tampering and masks refund addresses on public responses", async () => {
    const { service, attempt } = await create();
    const request = mocks.quote.mock.calls.at(-1)![0] as QuoteRequest;
    expect(request.recipient).toBe("merchant"); expect(request.amount).toBe("2000000"); expect(request.destinationAsset).toBe(MAINNET_USDC_ASSET);
    const publicView = service.publicAttempt(attempt);
    expect(publicView.refundTo).not.toBe(attempt.refundTo); expect(JSON.stringify(publicView)).not.toContain(attempt.refundTo);
    const resumed = await service.createPaymentQuote("inv_live", { sourceAssetId: SOURCES[0]!.assetId, refundTo: attempt.refundTo, dry: false, acknowledged: true });
    expect(resumed).toMatchObject({ resumed: true, attempt: { id: attempt.id } });
    expect(mocks.quote).toHaveBeenCalledTimes(2); // Original dry + real, no replacement quote.
    await expect(service.createPaymentQuote("inv_live", { sourceAssetId: SOURCES[0]!.assetId, refundTo: `0x${"9".repeat(40)}`, dry: false, acknowledged: true })).rejects.toThrow(/payment may already be in progress/);
    attempt.lifecycle = "deposit_seen";
    await expect(service.createPaymentQuote("inv_live", { sourceAssetId: SOURCES[0]!.assetId, refundTo: attempt.refundTo, dry: false, acknowledged: true })).rejects.toThrow(/payment may already be in progress/);
  });
  it("requires real-funds acknowledgement and never treats a tx hint as paid", async () => {
    const { service, attempt } = await create();
    await service.submitDepositHint("inv_live", attempt.id, `0x${"3".repeat(64)}`);
    expect(mocks.db.invoices[0]!.status).toBe("pending"); expect(mocks.read).not.toHaveBeenCalled();
    await expect(service.createPaymentQuote("inv_live", { sourceAssetId: SOURCES[0]!.assetId, refundTo: attempt.refundTo, dry: false, acknowledged: false })).rejects.toThrow(/real funds on mainnet/);
  });
  it("expires only provider-confirmed unfunded quotes, then verifies late SUCCESS and claims credit exactly once", async () => {
    const { service, attempt } = await create();
    vi.setSystemTime(Date.now() + 610_000);
    await service.refreshAttempt(attempt.id); expect(attempt.lifecycle).toBe("expired_unfunded");
    mocks.status.mockResolvedValue({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: sig, explorerUrl: "https://untrusted.example" }], originChainTxHashes: [{ hash: `0x${"3".repeat(64)}` }], amountIn: "2020495" } });
    vi.setSystemTime(Date.now() + 61_000);
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("settled"); expect(mocks.db.invoices[0]!.status).toBe("paid");
    expect(mocks.db.invoices[0]!.explorerUrl).toBe(`https://explorer.solana.com/tx/${sig}`);
    expect(mocks.db.receipts).toHaveLength(1); expect(mocks.db.settlementClaims).toHaveLength(1);
    expect(mocks.db.receipts[0]!.crossChain?.originExplorerUrl).toContain("basescan.org/tx/");
    await service.refreshAttempt(attempt.id); expect(mocks.db.receipts).toHaveLength(1);
  });
  it("keeps SUCCESS unpaid while RPC evidence is unavailable, then verifies without needing more Aurora requests", async () => {
    const { service, attempt } = await create();
    mocks.status.mockResolvedValue({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: sig }] } }); mocks.read.mockRejectedValueOnce(new Error("private RPC key"));
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("settlement_verifying"); expect(mocks.db.receipts).toHaveLength(0);
    mocks.status.mockRejectedValue(new Error("Aurora quota unavailable")); vi.setSystemTime(Date.now() + 9_000);
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("settled"); expect(mocks.db.receipts).toHaveLength(1); expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(mocks.db.receipts[0]!.crossChain?.amountInFormatted).toBe("Not recorded"); // Missing actual input is not invented from a dry estimate.
  });
  it("treats FAILED as needs-review, not a refund or payment", async () => {
    const { service, attempt } = await create();
    mocks.status.mockResolvedValue({ status: "FAILED" });
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("failed_needs_review"); expect(mocks.db.invoices[0]!.status).toBe("pending"); expect(mocks.db.receipts).toHaveLength(0);
  });
  it("resumes stored attempts even if the token/incident catalogue is temporarily unavailable", async () => {
    const { service, attempt } = await create();
    mocks.sources.mockRejectedValue(new Error("Temporary catalogue outage"));
    const options = await service.paymentOptions("inv_live");
    expect(options.sources).toEqual([]); expect(options.attempt?.id).toBe(attempt.id);
  });
  it("resume reads reconcile the existing attempt and expiry without ever creating a quote or deposit", async () => {
    const { service, attempt } = await create();
    const quoteCalls = mocks.quote.mock.calls.length;
    mocks.status.mockResolvedValueOnce({ status: "PROCESSING" });
    const options = await service.paymentOptions("inv_live");
    expect(options.invoice.status).toBe("pending"); expect(options.attempt?.id).toBe(attempt.id);
    expect(options.attempt?.lifecycle).toBe("processing"); expect(options.attempt?.canDeposit).toBe(false);
    expect(mocks.quote).toHaveBeenCalledTimes(quoteCalls); expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.db.crossChainAttempts).toHaveLength(1);
  });
  it("coalesces concurrent options reads into one provider status read, verified settlement and receipt", async () => {
    const { service, attempt } = await create();
    mocks.quote.mockClear(); // Creation above is fixture setup, not a resume action.
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.status.mockImplementationOnce(async () => {
      entered(); await gate;
      return { status: "SUCCESS", swapDetails: { depositedAmount: "2030498", destinationChainTxHashes: [{ hash: sig }] } };
    });
    const first = service.paymentOptions("inv_live");
    await started;
    const second = service.paymentOptions("inv_live");
    // Both readers overlap while the first reconciliation is still awaiting
    // Aurora. refreshAttempt's existing refreshing map shares that promise.
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
    release();
    const results = await Promise.all([first, second]);
    for (const result of results) {
      expect(result.invoice.status).toBe("paid");
      expect(result.invoice.receiptId).toBe(mocks.db.receipts[0]!.id);
      expect(result.attempt?.id).toBe(attempt.id);
    }
    expect(mocks.status).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.quote).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.db.crossChainAttempts).toHaveLength(1);
    expect(mocks.db.receipts).toHaveLength(1); expect(mocks.db.settlementClaims).toHaveLength(1);
    await service.paymentOptions("inv_live");
    expect(mocks.status).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.db.receipts).toHaveLength(1); expect(mocks.db.settlementClaims).toHaveLength(1);
  });
  it("a time-expired awaiting quote is never fundable on resume, including before the next provider poll", async () => {
    const { service, attempt } = await create();
    vi.setSystemTime(Date.now() + 610_000);
    expect(service.publicAttempt(attempt).canDeposit).toBe(false);
    const options = await service.paymentOptions("inv_live");
    expect(options.attempt?.lifecycle).toBe("expired_unfunded"); expect(options.attempt?.canDeposit).toBe(false);
    expect(mocks.quote).toHaveBeenCalledTimes(2); expect(mocks.db.crossChainAttempts).toHaveLength(1);
  });
  it("resume finds invoice-wide paid truth, selects its settled attempt and records deposit vs minimum vs verified credit exactly once", async () => {
    const { service, attempt } = await create();
    attempt.realQuote!.quote.amountIn = "2020469"; attempt.realQuote!.quote.minAmountIn = "2010418";
    mocks.status.mockResolvedValue({ status: "SUCCESS", swapDetails: { amountIn: "2010418", depositedAmount: "2030498", destinationChainTxHashes: [{ hash: sig }] } });
    const options = await service.paymentOptions("inv_live");
    expect(options.invoice.status).toBe("paid"); expect(options.invoice.receiptId).toBe(mocks.db.receipts[0]!.id);
    expect(options.invoice.crossChain).toMatchObject({ depositedAmountAtomic: "2030498", quotedAmountAtomic: "2020469", quotedMinimumAtomic: "2010418", settlementAmountAtomic: "2000000", sourceDecimals: 6 });
    expect(mocks.db.receipts[0]!.crossChain).toEqual(options.invoice.crossChain);
    // A stale/different browser attempt must not replace the settled invoice.
    mocks.db.crossChainAttempts.push({ ...attempt, id: "another-browser", lifecycle: "awaiting_deposit", destinationTxHashes: [], refundTo: `0x${"9".repeat(40)}` });
    for (let i = 0; i < 3; i++) {
      const refreshed = await service.paymentOptions("inv_live");
      expect(refreshed.invoice.status).toBe("paid"); expect(refreshed.attempt?.id).toBe(attempt.id);
    }
    expect(mocks.db.receipts).toHaveLength(1); expect(mocks.db.settlementClaims).toHaveLength(1);
    expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(service.publicAttempt(mocks.db.crossChainAttempts[1]!).canDeposit).toBe(false);
  });
  it("records exact provider-reported input/deposit amounts and masks wallet addresses in refund reasons", async () => {
    const { service, attempt } = await create();
    mocks.status.mockResolvedValue({ status: "INCOMPLETE_DEPOSIT", swapDetails: { depositedAmount: "1000000", amountInFormatted: "1.000001" } });
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("incomplete"); expect(attempt.depositedAmount).toBe("1000000"); expect(attempt.amountIn).toBe("1000001");
    mocks.status.mockResolvedValue({ status: "REFUNDED", swapDetails: { refundedAmount: "999999", refundReason: `Refund to ${attempt.refundTo}; fake-private-key` } });
    vi.setSystemTime(Date.now() + 9_000); await service.refreshAttempt(attempt.id);
    const view = service.publicAttempt(attempt);
    expect(view.refundReason).not.toContain(attempt.refundTo); expect(view.refundReason).not.toContain("fake-private-key");
    expect(view.refundedAmount).toBe("999999"); expect(mocks.db.receipts).toHaveLength(0);
  });
  it("fails closed for an unknown/malformed provider status even without a correlation ID", async () => {
    const { service, attempt } = await create();
    attempt.correlationId = undefined; mocks.status.mockResolvedValue(null);
    await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("needs_review"); expect(service.publicAttempt(attempt).canDeposit).toBe(false);
  });
  it("restarts the singleton scheduler against persisted attempts without requiring an open browser", async () => {
    const { attempt } = await create();
    const timer = runtime.__paylinkAuroraReconciler as ReturnType<typeof setInterval>;
    clearInterval(timer); delete runtime.__paylinkAuroraReconciler;
    vi.resetModules();
    const restarted = await import("./aurora/service");
    restarted.startReconciler(); const newTimer = runtime.__paylinkAuroraReconciler;
    restarted.startReconciler(); expect(runtime.__paylinkAuroraReconciler).toBe(newTimer);
    mocks.status.mockResolvedValue({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: sig }] } });
    await restarted.reconcileDueAttempts();
    expect(attempt.lifecycle).toBe("settled"); expect(mocks.db.receipts).toHaveLength(1);
  });
  it("re-checks signature claims atomically if another invoice claims credit during an RPC read", async () => {
    const { service, attempt } = await create();
    mocks.status.mockResolvedValue({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: sig }] } });
    const payout = await mocks.read(); mocks.read.mockClear();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.read.mockImplementation(async () => { entered(); await gate; return payout; });
    const job = service.refreshAttempt(attempt.id);
    await waiting;
    mocks.db.settlementClaims.push({ chain: "sol", signature: sig, invoiceId: "another-invoice", attemptId: "another-attempt", claimedAt: new Date().toISOString() });
    release(); await job;
    expect(attempt.lifecycle).toBe("needs_review"); expect(mocks.db.receipts).toHaveLength(0); expect(mocks.db.invoices[0]!.status).toBe("pending");
  });
  it("holds a late second payment for review and never issues a second receipt", async () => {
    const { service, attempt } = await create();
    vi.setSystemTime(Date.now() + 610_000); await service.refreshAttempt(attempt.id);
    expect(attempt.lifecycle).toBe("expired_unfunded");
    await service.createPaymentQuote("inv_live", { sourceAssetId: SOURCES[0]!.assetId, refundTo: attempt.refundTo, dry: false, acknowledged: true });
    const second = mocks.db.crossChainAttempts[1]!;
    attempt.lifecycle = "deposit_seen"; // Late funds revive the old address.
    expect(service.publicAttempt(second).canDeposit).toBe(false);
    expect((await service.paymentOptions("inv_live")).attempt?.id).toBe(attempt.id);
    mocks.status.mockImplementation(async (address: string) => ({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: address === attempt.depositAddress ? sig : "5".repeat(88) }] } }));
    vi.setSystemTime(Date.now() + 61_000);
    await service.refreshAttempt(attempt.id); await service.refreshAttempt(second.id);
    expect(mocks.db.receipts).toHaveLength(1); expect(attempt.lifecycle).toBe("settled"); expect(second.lifecycle).toBe("needs_review");
  });
  it("opens only the new payer endpoints and leaves merchant invoice creation gated", () => {
    for (const path of ["/api/pay/inv_live/aurora/options", "/api/pay/inv_live/aurora/quote", "/api/pay/inv_live/aurora/attempts/swap_test", "/api/pay/inv_live/aurora/attempts/swap_test/deposit"]) expect(isPublicPath(path)).toBe(true);
    expect(isPublicPath("/api/invoices")).toBe(false); expect(isPublicPath("/api/pay/inv_live/aurora/private")).toBe(false);
  });
});
