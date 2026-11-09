import { createId } from "./ids";
import type { Invoice, InvoiceStatus, MerchantProfile, Receipt } from "./types";

export interface CreateInvoiceInput {
  clientName: string;
  clientEmail?: string;
  description: string;
  amount: string;
  dueDate: string;
  status?: Extract<InvoiceStatus, "draft" | "pending">;
  now?: Date;
}

let invoiceSequence = 1040;

export function nextInvoiceNumber(now = new Date()): string {
  invoiceSequence += 1;
  const year = now.getUTCFullYear();
  return `PL-${year}-${invoiceSequence}`;
}

export function resetInvoiceSequence(value = 1040): void {
  invoiceSequence = value;
}

export function createInvoice(input: CreateInvoiceInput): Invoice {
  const now = input.now ?? new Date();
  const stamp = now.toISOString();
  const status = input.status ?? "pending";
  return {
    id: createId("inv"),
    number: nextInvoiceNumber(now),
    clientName: input.clientName.trim(),
    clientEmail: input.clientEmail?.trim() || undefined,
    description: input.description.trim(),
    amount: input.amount,
    currency: "USDC",
    dueDate: input.dueDate,
    status,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function issueReceipt(invoice: Invoice, merchant: MerchantProfile, now = new Date()): Receipt {
  return {
    id: createId("rcp"),
    invoiceId: invoice.id,
    number: invoice.number,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    description: invoice.description,
    amount: invoice.amount,
    currency: "USDC",
    paidAt: invoice.paidAt ?? now.toISOString(),
    txSignature: invoice.txSignature,
    explorerUrl: invoice.explorerUrl,
    merchantName: merchant.name,
    sample: invoice.sample,
  };
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
    draft: ["pending", "expired"],
    pending: ["paid", "underpaid", "expired", "draft"],
    underpaid: ["paid", "pending", "expired"],
    expired: ["paid", "pending", "underpaid"],
    paid: [],
  };
  return allowed[from].includes(to);
}
