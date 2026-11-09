import { startVisibilityPolling } from "./polling";
import type { PaymentOptions, PublicPaymentAttempt } from "./aurora/service";

export function paymentRouteFundable(options: PaymentOptions, attempt: PublicPaymentAttempt | null, now: number, healthy = true): boolean {
  return Boolean(healthy && options.invoice.status !== "paid" && options.available && attempt?.lifecycle === "awaiting_deposit"
    && options.attempt?.id === attempt.id
    && attempt.canDeposit === true && Date.parse(attempt.userDeadline) > now
    && attempt.source && options.sources.some((row) => row.assetId === attempt.source?.assetId));
}
export function paymentFundingAllowed(options: PaymentOptions, attempt: PublicPaymentAttempt | null, confirmedId: string | null, now: number, healthy = true): boolean {
  return paymentRouteFundable(options, attempt, now, healthy) && confirmedId === attempt?.id;
}

/** Read-only, single-flight resume. No POST, quote, wallet, or funding action. */
export function startPaymentResume(invoiceId: string, update: (value: PaymentOptions) => void, failed: () => void,
  options: { fetchImpl?: typeof fetch; page?: Parameters<typeof startVisibilityPolling>[3]; wake?: Parameters<typeof startVisibilityPolling>[4]; checking?: (value: boolean) => void } = {}) {
  let active = true;
  const stop = startVisibilityPolling(async () => {
    if (active) options.checking?.(true);
    try {
      const response = await (options.fetchImpl || fetch)(`/api/pay/${encodeURIComponent(invoiceId)}/aurora/options`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Payment status unavailable");
      const value = await response.json() as PaymentOptions;
      if (!value.invoice || value.invoice.id !== invoiceId || !Array.isArray(value.sources)) throw new Error("Invalid payment status");
      if (active) update(value);
      // Terminal attempts can still receive late funds, but invoice-wide paid
      // truth is final. Stop the timer AND wake listeners once it is reported.
      return value.invoice.status === "paid" ? "stop" : "ok";
    } catch { if (active) failed(); return "error"; }
    finally { if (active) options.checking?.(false); }
  }, 4_000, 30_000, options.page, options.wake);
  return () => { active = false; stop(); };
}

export function paymentStage(paid: boolean, options: PaymentOptions | null, opened: boolean): "loading" | "review" | "payment" | "paid" {
  if (paid || options?.invoice.status === "paid") return "paid";
  if (!options) return "loading";
  return options.attempt || opened ? "payment" : "review";
}
export function mergePaymentSnapshot(previous: PaymentOptions | null, next: PaymentOptions): PaymentOptions {
  return previous?.invoice.status === "paid" ? previous : next;
}
