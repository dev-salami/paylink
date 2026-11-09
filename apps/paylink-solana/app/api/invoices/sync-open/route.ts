import { NextResponse } from "next/server";
import { syncInvoice } from "@/lib/invoices";
import { getDb } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Watch live invoices from the merchant dashboard. Stays behind the access gate. */
export async function POST() {
  const open = getDb()
    .invoices.filter((invoice) => invoice.payment && !invoice.sample && invoice.status !== "paid" && invoice.status !== "draft")
    .slice(0, 12);
  const invoices = [];
  const started = Date.now();
  for (const invoice of open) {
    const next = await syncInvoice(invoice.id);
    if (next) invoices.push(next);
    // A struggling node does not need another eleven slow checks this request.
    if (next?.paymentIssue === "rpc_down" || Date.now() - started > 15_000) break;
  }
  invoices.push(...getDb().invoices.filter((row) => row.settlement?.mode === "live").slice(0, 12)); // Cached store state only, never devnet RPC.
  return NextResponse.json({ invoices });
}
