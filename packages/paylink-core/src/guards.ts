import type { Invoice } from "./types";

/**
 * Reasons the agent must not buy a reminder for an invoice. Checked before any
 * x402 payment so a paid invoice never costs the agent wallet a cent.
 */
export function reminderRefusal(invoice: Pick<Invoice, "number" | "status">): string | null {
  if (invoice.status === "paid") return `${invoice.number} is already paid, so there is nothing to remind the client about.`;
  if (invoice.status === "draft") return `${invoice.number} is still a draft. Send it before reminding anyone.`;
  return null;
}
