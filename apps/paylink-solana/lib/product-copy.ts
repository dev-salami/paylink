import type { InvoiceStatus } from "@181hacks/paylink-core";

/** Display labels only. Stored statuses and API codes remain unchanged. */
export const invoiceStatusCopy: Record<InvoiceStatus, string> = {
  draft: "Draft", pending: "Awaiting payment", paid: "Paid", underpaid: "Partially paid", expired: "Overdue",
};
export const actionCopy: Record<string, string> = {
  create_invoice: "Invoice", generate_pdf: "Invoice PDF", send_reminder: "Reminder", check_status: "Payment status",
  pdf: "Invoice PDF", reminder: "Payment reminder",
};
export const paymentPhaseCopy: Record<string, string> = {
  request: "Payment requested", policy: "Spending limits", verify: "Checking payment", settle: "Confirming payment", deliver: "Preparing your request",
};
export const spendStatusCopy: Record<string, string> = {
  rejected: "Not approved", pending_chain: "Awaiting confirmation", settled: "Paid", delivered: "Completed", delivery_failed: "Paid · delivery needs attention", paid_delivery_failed: "Paid · delivery needs attention",
};
export const paymentCheckCopy: Record<string, { title: string; summary: string; detail: string }> = {
  insufficient_budget: { title: "Insufficient budget", summary: "Not enough budget remains.", detail: "Increase the available budget before requesting this service." },
  over_cap: { title: "Spending limit reached", summary: "The charge exceeds your per-payment limit.", detail: "Review your spending limit before continuing." },
  price_mismatch: { title: "Amount changed", summary: "The payment does not match the quote.", detail: "Get a current quote before paying." },
  underpaid: { title: "Partial payment", summary: "The amount received is below the amount due.", detail: "The request stays incomplete until the required amount is verified." },
  wrong_mint: { title: "Wrong token", summary: "The payment used a different token.", detail: "Use the token and network shown in your payment instructions." },
  replayed_proof: { title: "Payment already used", summary: "The same payment cannot be charged again.", detail: "The existing payment record is used without a second charge." },
  expired_quote: { title: "Quote expired", summary: "The payment window has closed.", detail: "Get a new quote. Do not use expired payment instructions." },
  facilitator_down: { title: "Connection unavailable", summary: "The payment could not be confirmed.", detail: "Check the payment status before trying again." },
  paid_delivery_failed: { title: "Document unavailable", summary: "Payment was received, but delivery did not complete.", detail: "Retry delivery using the existing payment, without a second charge." },
};
