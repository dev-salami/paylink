import { NextResponse } from "next/server";
import { readStoredPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const pdf = readStoredPdf(id);
  if (!pdf) {
    return NextResponse.json(
      { error: "No PDF is available yet. Ask the invoice assistant to create one. Document fees apply." },
      { status: 404 },
    );
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${id}.pdf"`,
    },
  });
}
