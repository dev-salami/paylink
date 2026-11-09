import { downloadReceiptPdf } from "../../../../../lib/receipt-download";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return downloadReceiptPdf((await context.params).id, "invoice", new URL(request.url).searchParams.get("download") === "1");
}
