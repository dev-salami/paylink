import type { Lifecycle } from "../settlement/types";

export function reduceProviderStatus(current: Lifecycle, providerStatus: string, userDeadline: string, now = Date.now()): Lifecycle {
  if (current === "settled") return current;
  switch (providerStatus) {
    case "PENDING_DEPOSIT":
      if (["deposit_seen", "incomplete", "processing", "settlement_verifying", "refund_pending"].includes(current)) return "needs_review";
      return now >= Date.parse(userDeadline) ? "expired_unfunded" : "awaiting_deposit";
    case "KNOWN_DEPOSIT_TX": return "deposit_seen";
    case "INCOMPLETE_DEPOSIT": return "incomplete";
    case "PROCESSING": return "processing";
    case "SUCCESS": return "settlement_verifying";
    case "REFUNDED": return "refunded";
    case "FAILED": return "failed_needs_review";
    default: return "needs_review";
  }
}
export const terminalAttempt = (state: Lifecycle) => ["settled", "refunded", "failed_needs_review", "needs_review"].includes(state);
