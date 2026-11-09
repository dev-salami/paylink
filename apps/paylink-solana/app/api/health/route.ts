import { NextResponse } from "next/server";
import { demoMode, serverRpcUrl, usdcMint } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    demoMode: demoMode(),
    mint: usdcMint(),
    rpcHost: new URL(serverRpcUrl()).host,
    network: "solana-devnet",
  });
}
