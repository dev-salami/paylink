import { submitDepositHint } from "@/lib/aurora/service";
import { paymentResponse, readPaymentBody } from "@/lib/aurora/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await context.params;
  return paymentResponse(request, async () => submitDepositHint(id, attemptId, (await readPaymentBody(request)).txHash), "quote");
}
