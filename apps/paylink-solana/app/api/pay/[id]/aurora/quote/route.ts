import { createPaymentQuote } from "@/lib/aurora/service";
import { paymentResponse, readPaymentBody } from "@/lib/aurora/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return paymentResponse(request, async () => {
    const body = await readPaymentBody(request);
    return createPaymentQuote(id, { sourceAssetId: body.sourceAssetId, refundTo: body.refundTo, dry: body.dry, acknowledged: body.acknowledged });
  }, "quote");
}
