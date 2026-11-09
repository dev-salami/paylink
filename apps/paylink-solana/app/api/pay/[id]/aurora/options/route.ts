import { paymentOptions } from "@/lib/aurora/service";
import { paymentResponse } from "@/lib/aurora/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return paymentResponse(request, () => paymentOptions(id));
}
