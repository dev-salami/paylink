import { serverRpcUrl, usdcMint } from "@/lib/env";
import { createCachedRpcFetch } from "@/lib/rpc-fetch";
import { handleRpcProxy } from "@/lib/rpc-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let transport: ReturnType<typeof createCachedRpcFetch> | undefined;

export async function POST(request: Request) {
  transport ??= createCachedRpcFetch({ mint: usdcMint() });
  return handleRpcProxy(request, serverRpcUrl, transport);
}
