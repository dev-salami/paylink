import {
  canTransition,
  createId,
  createInvoice,
  formatLongDate,
  formatUsdc,
  issueReceipt,
  type Invoice,
  type InvoiceStatus,
  type PaymentCheckResult,
} from "@181hacks/paylink-core";
import { createSolanaProvider } from "./solana";
import { getDb, updateDb } from "./store";
import { deliverEmail, receiptEmail, resendAlreadyDelivered } from "./mail";
import { qrDataUrl } from "./qr";
import { createAsyncCache } from "./async-cache";
import { DEVNET_BUSY, warnRpcFailure } from "./rpc-errors";
import type { SolanaInvoice, SolanaReceipt } from "./receipt-types";
import { createSettlement } from "./settlement/config";
import { isLiveInvoice } from "./settlement/types";
import { invoiceStatusCopy } from "./product-copy";
import { merchantInvoices } from "./books";

const provider = createSolanaProvider();
const syncCached = createAsyncCache<Invoice | null>(2_000);

export async function issueInvoice(input: {
  clientName: string;
  clientEmail?: string;
  description: string;
  amount: string;
  dueDate: string;
  asDraft?: boolean;
  settlement?: { mode?: string; recipient?: string };
}): Promise<SolanaInvoice> {
  const settlement = createSettlement(input.amount, input.settlement);
  const merchant = getDb().merchant;
  const invoice: SolanaInvoice = { ...createInvoice({
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    description: input.description,
    amount: input.amount,
    dueDate: input.dueDate,
    status: input.asDraft ? "draft" : "pending",
  }), settlement };
  const numbered = updateDb((db) => {
    db.sequence += 1;
    invoice.number = `PL-${new Date().getUTCFullYear()}-${db.sequence}`;
    return invoice.number;
  });
  invoice.number = numbered;

  if (invoice.status === "pending" && !isLiveInvoice(invoice)) {
    const request = await provider.createRequest({
      invoiceId: invoice.id,
      amount: invoice.amount,
      currency: "USDC",
      label: merchant.name,
      message: invoice.description,
      memo: invoice.id,
    });
    invoice.payment = { provider: provider.id, ...request };
  }

  updateDb((db) => {
    db.invoices.unshift(invoice);
    db.activities.unshift({
      id: createId("act"),
      at: invoice.createdAt,
      kind: invoice.status === "draft" ? "invoice_created" : "invoice_issued",
      title: `${invoice.status === "draft" ? "Draft" : "Invoice"} for ${invoice.clientName}`,
      detail: `${formatUsdc(invoice.amount)} USDC · ${invoice.description} · due ${formatLongDate(invoice.dueDate)}`,
      invoiceId: invoice.id,
      href: `/invoices/${invoice.id}`,
    });
  });
  return invoice;
}

/** Turn one saved draft into a payable invoice. Does not send email. A second call returns the same invoice. */
export async function publishDraft(id: string): Promise<SolanaInvoice> {
  const current = getDb().invoices.find((item) => item.id === id);
  if (!current) throw new Error("Invoice not found.");
  if (current.sample) throw new Error("Development fixtures cannot be issued.");
  if (current.status !== "draft") return current as SolanaInvoice;

  let payment = current.payment;
  if (!isLiveInvoice(current)) {
    const merchant = getDb().merchant;
    const request = await provider.createRequest({
      invoiceId: current.id,
      amount: current.amount,
      currency: "USDC",
      label: merchant.name,
      message: current.description,
      memo: current.id,
    });
    payment = { provider: provider.id, ...request };
  }

  return updateDb((db) => {
    const invoice = db.invoices.find((item) => item.id === id);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.sample) throw new Error("Development fixtures cannot be issued.");
    if (invoice.status !== "draft") return invoice as SolanaInvoice;
    invoice.status = "pending";
    if (payment) invoice.payment = payment;
    invoice.updatedAt = new Date().toISOString();
    db.activities.unshift({
      id: createId("act"),
      at: invoice.updatedAt,
      kind: "invoice_issued",
      title: `Invoice issued for ${invoice.clientName}`,
      detail: `${formatUsdc(invoice.amount)} USDC · ${invoice.description}. No email was sent.`,
      invoiceId: invoice.id,
      href: `/invoices/${invoice.id}`,
    });
    return invoice as SolanaInvoice;
  });
}

export async function syncInvoice(id: string): Promise<Invoice | null> {
  const current = getDb().invoices.find((invoice) => invoice.id === id);
  if (!current) return null;
  if (isLiveInvoice(current)) return current; // Never query or accept devnet payment for mainnet invoices.
  if (!current.payment || current.status === "paid" || current.status === "draft" || current.sample) return current;

  const key = JSON.stringify([id, current.payment.reference, current.amount, current.payment.asset, current.payment.recipient, current.dueDate]);
  return syncCached(key, () => syncInvoiceNow(id));
}

async function syncInvoiceNow(id: string): Promise<Invoice | null> {
  const current = getDb().invoices.find((invoice) => invoice.id === id);
  if (!current?.payment || isLiveInvoice(current) || current.status === "paid" || current.status === "draft" || current.sample) return current ?? null;

  const check: PaymentCheckResult = await provider.check({
    reference: current.payment.reference,
    amount: current.amount,
    asset: current.payment.asset,
    recipient: current.payment.recipient,
    dueDate: current.dueDate,
  }).catch((error: unknown) => {
    warnRpcFailure("invoice sync", error);
    return { status: "pending" as const, issue: "rpc_down" as const, message: DEVNET_BUSY };
  });

  if (check.issue === "rpc_down") {
    warnRpcFailure("invoice sync", check.message);
    return updateDb((db) => {
      const invoice = db.invoices.find((item) => item.id === id);
      if (!invoice || invoice.status === "paid") return invoice ?? current;
      invoice.paymentIssue = "rpc_down";
      invoice.paymentIssueDetail = DEVNET_BUSY;
      invoice.updatedAt = new Date().toISOString();
      return invoice;
    });
  }

  const nextStatus: InvoiceStatus = check.status === "wrong_mint" ? "pending" : check.status;
  return updateDb((db) => {
    const invoice = db.invoices.find((item) => item.id === id);
    if (!invoice || invoice.status === "paid") return invoice ?? current;
    const previous = invoice.status;
    if (previous !== nextStatus && canTransition(previous, nextStatus)) {
      invoice.status = nextStatus;
      db.activities.unshift({
        id: createId("act"),
        at: new Date().toISOString(),
        kind: "status_changed",
        title: `${invoice.clientName} · ${invoiceStatusCopy[nextStatus]}`,
        detail: check.issue === "wrong_mint" ? "The transfer used the wrong token." : check.issue === "underpaid" ? "The transfer is smaller than the invoice amount." : `Payment status: ${invoiceStatusCopy[nextStatus]}.`,
        invoiceId: invoice.id,
        href: `/invoices/${invoice.id}`,
        txSignature: check.signature,
        explorerUrl: check.explorerUrl,
      });
    }
    invoice.paymentIssue = check.issue ?? null;
    invoice.paymentIssueDetail = check.issue === "wrong_mint" ? "The transfer used the wrong token. This invoice needs devnet USDC." : check.issue === "underpaid" ? "The transfer is smaller than the invoice amount." : undefined;
    if (check.signature) invoice.txSignature = check.signature;
    if (check.explorerUrl) invoice.explorerUrl = check.explorerUrl;
    if (check.amountReceived) invoice.amountReceived = check.amountReceived;
    const payerWallet = (check as PaymentCheckResult & { payerWallet?: string }).payerWallet;
    if (nextStatus === "paid" && payerWallet) (invoice as SolanaInvoice).payerWallet = payerWallet;
    invoice.updatedAt = new Date().toISOString();
    if (nextStatus === "paid" && !invoice.receiptId) {
      invoice.paidAt = new Date().toISOString();
      const receipt: SolanaReceipt = { ...issueReceipt(invoice, db.merchant), payerWallet: (invoice as SolanaInvoice).payerWallet };
      invoice.receiptId = receipt.id;
      db.receipts.unshift(receipt);
      db.activities.unshift({
        id: createId("act"),
        at: receipt.paidAt,
        kind: "receipt_issued",
        title: `Receipt for ${invoice.clientName}`,
        detail: `${formatUsdc(invoice.amount)} USDC · ${invoice.number}`,
        invoiceId: invoice.id,
        href: `/receipts/${receipt.id}`,
        txSignature: invoice.txSignature,
        explorerUrl: invoice.explorerUrl,
      });
      queueReceiptEmail(receipt.id);
    }
    return invoice;
  });
}

function queueReceiptEmail(receiptId: string): void {
  const receipt = getDb().receipts.find((item) => item.id === receiptId);
  if (!receipt || receipt.sample) return;
  if (resendAlreadyDelivered(receipt.invoiceId, "Receipt ")) return;
  const live = getDb().invoices.find((item) => item.id === receipt.invoiceId)?.settlement?.mode === "live";
  const email = receiptEmail(receipt, undefined, { live });
  if (!email) return;
  void deliverEmail(email, receipt.invoiceId).catch((error) => {
    updateDb((db) => {
      db.activities.unshift({
        id: createId("act"),
        at: new Date().toISOString(),
        kind: "note",
        title: "Receipt email failed",
        detail: error instanceof Error ? error.message : "Mailer error",
        invoiceId: receipt.invoiceId,
      });
    });
  });
}

export async function invoiceQr(invoice: Invoice): Promise<string | null> {
  if (!invoice.payment?.url) return null;
  return qrDataUrl(invoice.payment.url);
}

export function findInvoice(query: string): Invoice | undefined {
  const db = { invoices: merchantInvoices(getDb().invoices) };
  const needle = query.trim().toLowerCase();
  if (!needle) return db.invoices.find((invoice) => invoice.status !== "paid");
  return (
    db.invoices.find((invoice) => invoice.id.toLowerCase() === needle) ||
    db.invoices.find((invoice) => invoice.number.toLowerCase() === needle) ||
    db.invoices.find((invoice) => invoice.clientName.toLowerCase() === needle) ||
    db.invoices.find((invoice) => invoice.clientName.toLowerCase().includes(needle)) ||
    db.invoices.find((invoice) => invoice.description.toLowerCase().includes(needle))
  );
}

export function unpaidInvoices(): Invoice[] {
  return merchantInvoices(getDb().invoices).filter((invoice) => invoice.status !== "paid");
}

export function totals() {
  const invoices = getDb().invoices;
  const sum = (rows: Invoice[]) => rows.reduce((total, invoice) => total + Number(invoice.amount), 0);
  const open = invoices.filter((invoice) => invoice.status === "pending" || invoice.status === "draft" || invoice.status === "underpaid");
  return {
    outstanding: sum(open),
    collected: sum(invoices.filter((invoice) => invoice.status === "paid")),
    overdue: sum(invoices.filter((invoice) => invoice.status === "expired")),
    count: invoices.length,
  };
}
