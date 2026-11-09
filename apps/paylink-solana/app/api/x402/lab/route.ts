import { NextResponse } from "next/server";
import { X402_FAILURES, type X402FailureCode } from "@181hacks/paylink-core";
import { runAllFailureCases, runFailureCase } from "@/lib/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ cases: await runAllFailureCases() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  if (!body.code || body.code === "all") return NextResponse.json({ cases: await runAllFailureCases() });
  if (!X402_FAILURES.includes(body.code as X402FailureCode)) {
    return NextResponse.json({ error: "Unknown failure case" }, { status: 400 });
  }
  return NextResponse.json(await runFailureCase(body.code as X402FailureCode));
}
