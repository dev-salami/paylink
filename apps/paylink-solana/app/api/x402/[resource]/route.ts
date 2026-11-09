import { NextResponse } from "next/server";
import { reminderRefusal } from "@181hacks/paylink-core";
import { appOrigin } from "@/lib/env";
import { getDb } from "@/lib/store";
import { acceptPayment, issueChallenge, paymentRequiredResponse, toHttpResponse } from "@/lib/x402-service";

export const dynamic = "force-dynamic";

async function handle(request: Request, resource: string) {
  if (resource !== "pdf" && resource !== "reminder") {
    return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  }
  const url = new URL(request.url);
  const header = request.headers.get("payment-signature");
  const faultHeader = request.headers.get("x-paylink-fault");
  const fault = faultHeader === "delivery" || faultHeader === "facilitator" ? faultHeader : null;
  if (!header) {
    const invoiceId = url.searchParams.get("invoice");
    if (!invoiceId) return NextResponse.json({ error: "Choose an invoice before requesting this service." }, { status: 400 });
    const invoice = getDb().invoices.find((item) => item.id === invoiceId);
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const refusal = resource === "reminder" ? reminderRefusal(invoice) : null;
    if (refusal) return NextResponse.json({ error: refusal, code: "refused" }, { status: 409 });
    try {
      const challenge = await issueChallenge({ resourceName: resource, invoice, origin: appOrigin(request) });
      return paymentRequiredResponse(challenge);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build payment requirements.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }
  try {
    const result = await acceptPayment({ paymentSignature: header, fault, origin: appOrigin(request) });
    return toHttpResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment handling failed.";
    return NextResponse.json({ error: message, code: "facilitator_down" }, { status: 503 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  return handle(request, resource);
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  return handle(request, resource);
}
