import { NextResponse } from "next/server";
import { runChat } from "@/lib/agent";
import { appOrigin } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    approval?: { resource: "pdf" | "reminder"; invoiceId: string };
    settlement?: { mode?: string; recipient?: string };
    confirmPreview?: { previewId?: string };
    cancelPreview?: { previewId?: string };
    activePreviewId?: string;
  };
  const confirmId = body.confirmPreview?.previewId?.trim();
  const cancelId = body.cancelPreview?.previewId?.trim();
  if (!body.message?.trim() && !body.approval && !confirmId && !cancelId) {
    return NextResponse.json({ error: "Say what you want PayLink to do." }, { status: 400 });
  }
  try {
    const result = await runChat(
      {
        message: body.message?.trim() ?? "",
        history: body.history,
        approval: body.approval,
        settlement: body.settlement,
        confirmPreview: confirmId ? { previewId: confirmId } : undefined,
        cancelPreview: cancelId ? { previewId: cancelId } : undefined,
        activePreviewId: body.activePreviewId?.trim() || undefined,
      },
      appOrigin(request),
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The agent failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
