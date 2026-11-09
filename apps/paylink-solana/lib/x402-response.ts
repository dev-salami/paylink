import type { PaymentRequired } from "@x402/core/types";

/** Pure formatting; creating/settling a challenge is deliberately separate. */
export function paymentRequiredResponse(challenge: { paymentRequired: PaymentRequired; header: string }): Response {
  return new Response(JSON.stringify({
    x402Version: 2,
    error: "Payment required",
    resource: challenge.paymentRequired.resource,
    accepts: challenge.paymentRequired.accepts,
    extensions: challenge.paymentRequired.extensions,
  }, null, 2), { status: 402, headers: {
    "Content-Type": "application/json",
    "PAYMENT-REQUIRED": challenge.header,
    "Cache-Control": "private, no-store",
  } });
}
