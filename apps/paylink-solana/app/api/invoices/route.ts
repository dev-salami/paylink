import { parseDueDate } from "@181hacks/paylink-core";
import { issueInvoice } from "@/lib/invoices";

export const dynamic = "force-dynamic";

/** Merchant gated by middleware; NOT part of the public /api/pay routes. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.clientName !== "string" || !body.clientName.trim() || body.clientName.length > 200 || typeof body.description !== "string" || !body.description.trim() || body.description.length > 2000 || typeof body.amount !== "string") throw new Error("Enter a client name, description and USDC amount. Check that each field is complete and within its length limit.");
    if (body.clientEmail !== undefined && (typeof body.clientEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.clientEmail))) throw new Error("Use a valid client email.");
    const dueDate = parseDueDate(typeof body.dueDate === "string" ? body.dueDate : undefined, new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate) throw new Error("Use a valid due date.");
    return Response.json({ invoice: await issueInvoice({ clientName: body.clientName.trim(), clientEmail: body.clientEmail, description: body.description.trim(), amount: body.amount, dueDate, settlement: body.settlement, asDraft: false }) }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid invoice." }, { status: 400 }); }
}
