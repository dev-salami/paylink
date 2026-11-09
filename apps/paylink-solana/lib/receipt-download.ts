import { getDb, updateDb } from "./store";
import { getConfirmedPayerWallet } from "./solana";
import { readReceiptFont } from "./receipt-font";
import { buildReceiptPdf, receiptPdfFilename } from "./receipt-pdf";
import type { SolanaInvoice, SolanaReceipt } from "./receipt-types";
import { resolveReceiptAmounts } from "./receipt-amounts";

/** Both public URLs resolve the SAME stored, paid, non-sample receipt. */
export async function downloadReceiptPdf(id: string, by: "receipt" | "invoice", download = false): Promise<Response> {
  const db = getDb();
  const requestedInvoice = by === "invoice" ? db.invoices.find((row) => row.id === id) : undefined;
  const receipt: SolanaReceipt | undefined = by === "receipt"
    ? db.receipts.find((row) => row.id === id)
    : requestedInvoice ? db.receipts.find((row) => row.id === requestedInvoice.receiptId && row.invoiceId === requestedInvoice.id) : undefined;
  const invoice: SolanaInvoice | undefined = receipt ? db.invoices.find((row) => row.id === receipt.invoiceId) : undefined;
  if (!receipt || receipt.sample || !invoice || invoice.sample || invoice.status !== "paid") {
    return Response.json({ error: "Receipt not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  let payerWallet = receipt.payerWallet || invoice.payerWallet;
  if (!payerWallet && receipt.txSignature && !receipt.crossChain) {
    payerWallet = await getConfirmedPayerWallet(receipt.txSignature).catch(() => undefined);
  }
  if (payerWallet && (!receipt.payerWallet || !invoice.payerWallet)) {
    const recorded = payerWallet;
    updateDb((store) => {
      const savedReceipt = store.receipts.find((row) => row.id === receipt.id) as SolanaReceipt | undefined;
      const savedInvoice = store.invoices.find((row) => row.id === invoice.id) as SolanaInvoice | undefined;
      if (savedReceipt) savedReceipt.payerWallet = recorded;
      if (savedInvoice) savedInvoice.payerWallet = recorded;
    });
  }
  const bytes = await buildReceiptPdf({
    number: receipt.number, merchantName: receipt.merchantName, clientName: receipt.clientName,
    description: receipt.description, amount: receipt.amount, paidAt: receipt.paidAt,
    signature: receipt.txSignature, payerWallet, merchantWallet: invoice.settlement?.mode === "live" ? invoice.settlement.recipient : invoice.payment?.recipient,
    reference: invoice.payment?.reference || receipt.crossChain?.correlationId, mint: invoice.settlement?.mode === "live" ? invoice.settlement.mint : invoice.payment?.asset, fontBytes: await readReceiptFont(),
    crossChain: resolveReceiptAmounts(invoice.id, receipt.crossChain, db.crossChainAttempts),
  });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${receiptPdfFilename(receipt.number)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
