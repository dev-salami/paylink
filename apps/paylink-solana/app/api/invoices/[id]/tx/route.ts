import { NextResponse } from "next/server";
import { buildPayTransaction } from "@/lib/solana";
import { getDb } from "@/lib/store";
import { isLiveInvoice } from "@/lib/settlement/types";
import { friendlyPaymentError, isTransientRpcError, warnRpcFailure } from "@/lib/rpc-errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const invoice = getDb().invoices.find((item) => item.id === id);
  if (invoice && isLiveInvoice(invoice)) return NextResponse.json({ error: "Open this invoice’s mainnet payment page to pay. Do not send a devnet transfer." }, { status: 409 });
  if (!invoice?.payment) return NextResponse.json({ error: "This invoice has no payment request." }, { status: 404 });
  if (invoice.status === "draft" || invoice.status === "paid" || invoice.sample) return NextResponse.json({ error: "This invoice is not available for a new payment." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { account?: string };
  if (typeof body.account !== "string" || !body.account) return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  try {
    const transaction = await buildPayTransaction({
      sender: body.account,
      recipient: invoice.payment.recipient,
      amount: invoice.amount,
      splToken: invoice.payment.asset,
      reference: invoice.payment.reference,
      memo: invoice.id,
    });
    return NextResponse.json({ transaction });
  } catch (error) {
    warnRpcFailure("build transfer", error);
    const retryable = isTransientRpcError(error);
    return NextResponse.json({ error: friendlyPaymentError(error), retryable }, { status: retryable ? 503 : 400 });
  }
}
