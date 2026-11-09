import { NextResponse } from "next/server";
import { publishDraft } from "@/lib/invoices";

export const dynamic = "force-dynamic";

/** Merchant-gated. Issues one draft. Does not send email or move money. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const invoice = await publishDraft(id);
    return NextResponse.json({ invoice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The invoice could not be issued.";
    const status = message === "Invoice not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
