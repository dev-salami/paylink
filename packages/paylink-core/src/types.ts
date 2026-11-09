export const INVOICE_STATUSES = ["draft", "pending", "paid", "underpaid", "expired"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type PaymentIssue = "wrong_mint" | "rpc_down" | "underpaid" | null;

/** Rail-specific payment details. Strings only — no chain types in core. */
export interface PaymentRequest {
  provider: string;
  reference: string;
  url: string;
  recipient: string;
  asset: string;
  network: string;
  explorerUrl?: string;
}

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  clientEmail?: string;
  description: string;
  amount: string;
  currency: "USDC";
  dueDate: string;
  status: InvoiceStatus;
  payment?: PaymentRequest;
  paymentIssue?: PaymentIssue;
  paymentIssueDetail?: string;
  txSignature?: string;
  explorerUrl?: string;
  paidAt?: string;
  amountReceived?: string;
  receiptId?: string;
  sample?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  invoiceId: string;
  number: string;
  clientName: string;
  clientEmail?: string;
  description: string;
  amount: string;
  currency: "USDC";
  paidAt: string;
  txSignature?: string;
  explorerUrl?: string;
  merchantName: string;
  sample?: boolean;
}

export type ActivityKind =
  | "invoice_created"
  | "invoice_issued"
  | "status_changed"
  | "receipt_issued"
  | "email_sent"
  | "x402_request"
  | "x402_settled"
  | "x402_delivered"
  | "x402_failed"
  | "budget_changed"
  | "note";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  invoiceId?: string;
  href?: string;
  txSignature?: string;
  explorerUrl?: string;
  sample?: boolean;
}

export interface BudgetPolicy {
  totalAtomic: bigint;
  perCallAtomic: bigint;
  approveAboveAtomic: bigint;
}

export interface BudgetView {
  total: string;
  perCall: string;
  approveAbove: string;
  spent: string;
  remaining: string;
}

export interface SpendEntry {
  id: string;
  at: string;
  resource: "pdf" | "reminder";
  invoiceId?: string;
  amount: string;
  status: "settled" | "delivery_failed" | "pending_chain" | "rejected";
  signature?: string;
  explorerUrl?: string;
  detail?: string;
  sample?: boolean;
}

export interface EmailRecord {
  id: string;
  at: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  provider: string;
  invoiceId?: string;
}

export interface MerchantProfile {
  name: string;
  city: string;
  email?: string;
}

export type PaidResource = "pdf" | "reminder";

export interface StoredQuote {
  id: string;
  resource: PaidResource;
  invoiceId?: string;
  amount: string;
  amountAtomic: string;
  asset: string;
  payTo: string;
  network: string;
  memo: string;
  expiresAt: string;
  createdAt: string;
  paymentRequired?: unknown;
}

export interface StoredSettlement {
  proofId: string;
  quoteId: string;
  resource: PaidResource;
  invoiceId?: string;
  amount: string;
  asset: string;
  signature?: string;
  explorerUrl?: string;
  charged: boolean;
  delivered: boolean;
  pending: boolean;
  deliveryError?: string;
  updatedAt: string;
}
