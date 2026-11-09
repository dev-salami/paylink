import { NextResponse } from "next/server";
import { syncInvoice } from "@/lib/invoices";
import { friendlyInvoiceIssue } from "@/lib/rpc-errors";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const invoice = await syncInvoice(id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json({ ...invoice, paymentIssueDetail: invoice.paymentIssueDetail ? friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail) : undefined });
}
