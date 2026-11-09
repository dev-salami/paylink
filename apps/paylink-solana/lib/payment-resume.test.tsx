import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergePaymentSnapshot, paymentFundingAllowed, paymentStage, startPaymentResume } from "./payment-resume";
import { LivePayer } from "../components/live-payer";
import { CrossChainPaymentPanel } from "../components/cross-chain-payment";
import type { PaymentOptions } from "./aurora/service";
import type { SolanaInvoice } from "./receipt-types";
import { SOURCES } from "./aurora/assets";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, type Lifecycle } from "./settlement/types";

function snapshot(lifecycle: Lifecycle = "awaiting_deposit", paid = false): PaymentOptions {
  return { available: true, sources: SOURCES, invoice: { id: "inv_resume", status: paid ? "paid" : "pending", receiptId: paid ? "rcp_resume" : undefined, explorerUrl: undefined, crossChain: undefined },
    attempt: { id: "swap_existing", invoiceId: "inv_resume", lifecycle, refundTo: "0x1111…1111", source: SOURCES[0], userDeadline: new Date(Date.now() + 60_000).toISOString(), canDeposit: !paid && lifecycle === "awaiting_deposit",
      providerStatus: undefined, depositMemo: undefined, correlationId: undefined, amountInFormatted: undefined, depositedAmount: undefined, refundedAmount: undefined, refundReason: undefined, nextPollAt: new Date().toISOString(),
      depositAddress: `0x${"2".repeat(40)}`, originTxHashes: [], destinationTxHashes: [], quote: { amountIn: "2020469", minAmountIn: "2010418", amountOut: "2000000", minAmountOut: "2000000" } },
    target: { amount: "2", amountAtomic: "2000000", asset: "USDC", assetId: "usdc", decimals: 6, network: "Solana mainnet", feePolicy: "payer_pays_exact_output" },
  };
}
function events() {
  const listeners = new Map<string, () => void>();
  return { hidden: false, addEventListener: vi.fn((name: string, callback: unknown) => listeners.set(name, callback as () => void)),
    removeEventListener: vi.fn((name: string) => { listeners.delete(name); }), fire: (name: string) => listeners.get(name)?.() };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("read-only payer resume with lifecycle wake events", () => {
  it.each(["awaiting_deposit", "processing", "settled", "refunded", "expired_unfunded"] as const)("initial load restores %s without selecting or creating a browser-local attempt", async (lifecycle) => {
    vi.useFakeTimers(); const page = events(); const wake = events();
    const expected = snapshot(lifecycle, lifecycle === "settled");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(expected));
    let current: PaymentOptions | null = null;
    const stop = startPaymentResume("inv_resume", (value) => { current = value; }, vi.fn(), { page, wake, fetchImpl });
    expect(paymentStage(false, null, false)).toBe("loading");
    await vi.advanceTimersByTimeAsync(0);
    expect(current).toEqual(expected);
    expect(paymentStage(false, current, false)).toBe(lifecycle === "settled" ? "paid" : "payment");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/pay/inv_resume/aurora/options");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBeUndefined(); // GET only, never a quote/deposit POST.
    stop();
  });

  it("retains pending state through a missed poll/outage and refreshes on focus, pageshow, visibility and online", async () => {
    vi.useFakeTimers(); const page = events(); const wake = events(); const failed = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(snapshot()))
      .mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => Response.json(snapshot("processing")));
    let current: PaymentOptions | null = null;
    const stop = startPaymentResume("inv_resume", (value) => { current = mergePaymentSnapshot(current, value); }, failed, { page, wake, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(failed).toHaveBeenCalledTimes(1); expect((current as PaymentOptions | null)?.attempt?.lifecycle).toBe("awaiting_deposit");
    await vi.advanceTimersByTimeAsync(7_999); expect(fetchImpl).toHaveBeenCalledTimes(2); // Error backoff is 8 seconds.
    page.hidden = true; page.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(60_000); expect(fetchImpl).toHaveBeenCalledTimes(2);
    page.hidden = false; page.fire("visibilitychange"); await vi.advanceTimersByTimeAsync(0);
    expect((current as PaymentOptions | null)?.attempt?.lifecycle).toBe("processing");
    for (const event of ["focus", "pageshow", "online"]) { wake.fire(event); await vi.advanceTimersByTimeAsync(0); }
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    fetchImpl.mockResolvedValue(Response.json(snapshot("settled", true)));
    wake.fire("focus"); await vi.advanceTimersByTimeAsync(0);
    expect(paymentStage(false, current, false)).toBe("paid");
    expect(mergePaymentSnapshot(current, snapshot()).invoice.status).toBe("paid");
    stop();
    for (const event of ["focus", "pageshow", "online"]) expect(wake.removeEventListener).toHaveBeenCalledWith(event, expect.any(Function));
  });

  it("coalesces wallet-return events while a request is in flight, then checks again without overlap", async () => {
    vi.useFakeTimers(); const page = events(); const wake = events();
    let release!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; })).mockResolvedValue(Response.json(snapshot("settled", true)));
    const update = vi.fn(); const stop = startPaymentResume("inv_resume", update, vi.fn(), { page, wake, fetchImpl });
    wake.fire("focus"); wake.fire("pageshow"); wake.fire("online");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(Response.json(snapshot("processing"))); await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(update.mock.calls.at(-1)?.[0].invoice.status).toBe("paid");
    stop();
  });

  it("stops all periodic and wake-event refreshes as soon as the server reports the invoice paid", async () => {
    vi.useFakeTimers(); const page = events(); const wake = events();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(snapshot("processing")))
      .mockImplementation(async () => Response.json(snapshot("settled", true)));
    const update = vi.fn(); const failed = vi.fn(); const checking = vi.fn();
    const stop = startPaymentResume("inv_resume", update, failed, { page, wake, fetchImpl, checking });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(update.mock.calls.at(-1)?.[0].invoice.status).toBe("paid");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(checking).toHaveBeenLastCalledWith(false);
    expect(page.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    for (const event of ["focus", "pageshow", "online"]) {
      expect(wake.removeEventListener).toHaveBeenCalledWith(event, expect.any(Function));
      wake.fire(event);
    }
    page.hidden = true; page.fire("visibilitychange"); page.hidden = false; page.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(update).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
    stop();
  });

  it("requires per-attempt ownership acknowledgement and hides expired, paid or stale funding instructions", () => {
    const options = snapshot(); const attempt = options.attempt!;
    expect(paymentFundingAllowed(options, attempt, null, Date.now())).toBe(false);
    expect(paymentFundingAllowed(options, attempt, "another-payer-attempt", Date.now())).toBe(false);
    expect(paymentFundingAllowed(options, attempt, attempt.id, Date.now())).toBe(true);
    expect(paymentFundingAllowed(options, attempt, attempt.id, Date.now(), false)).toBe(false);
    expect(paymentFundingAllowed({ ...options, attempt: { ...attempt, id: "different-server-attempt" } }, attempt, attempt.id, Date.now())).toBe(false);
    expect(paymentFundingAllowed(options, { ...attempt, userDeadline: new Date(0).toISOString() }, attempt.id, Date.now())).toBe(false);
    expect(paymentFundingAllowed({ ...options, invoice: { ...options.invoice, status: "paid" } }, attempt, attempt.id, Date.now())).toBe(false);
    const html = renderToStaticMarkup(createElement(CrossChainPaymentPanel, { invoiceId: "inv_resume", amount: "2", options, refreshingFailed: false, onAttemptChange: vi.fn() }));
    expect(html).toContain("Confirm your full refund wallet"); expect(html).not.toContain(attempt.depositAddress);
    const expired = snapshot("expired_unfunded");
    const expiredHtml = renderToStaticMarkup(createElement(CrossChainPaymentPanel, { invoiceId: "inv_resume", amount: "2", options: expired, refreshingFailed: false, onAttemptChange: vi.fn() }));
    expect(expiredHtml).toContain("Get new quote"); expect(expiredHtml).not.toContain(attempt.depositAddress);
  });

  it("renders a paid invoice immediately, without an options click or polling", () => {
    const invoice: SolanaInvoice = { id: "inv_resume", number: "PL-2026-1044", clientName: "Ada", description: "Design", currency: "USDC", dueDate: "2026-11-08", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z",
      status: "paid", amount: "2", receiptId: "rcp_resume", settlement: { mode: "live", amountAtomic: "2000000", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant", feePolicy: "payer_pays_exact_output" } };
    const html = renderToStaticMarkup(createElement(LivePayer, { invoice, merchantName: "Studio" }));
    expect(html).toContain("Payment verified"); expect(html).toContain("rcp_resume"); expect(html).not.toContain("Pay from another network");
  });
});
