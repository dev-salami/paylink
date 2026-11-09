import { getPaymentAttempt } from "@/lib/aurora/service";
import { paymentResponse } from "@/lib/aurora/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await context.params;
  return paymentResponse(request, () => getPaymentAttempt(id, attemptId));
}
