import { DEVNET_BUSY, friendlyPaymentError } from "./rpc-errors";

export const RPC_METHODS = new Set([
  "getLatestBlockhash", "getAccountInfo", "getBalance", "getTokenAccountBalance",
  "getSignatureStatuses", "getBlockHeight", "getSlot", "getMinimumBalanceForRentExemption",
  "getFeeForMessage", "simulateTransaction", "sendTransaction", "getVersion", "getGenesisHash", "getEpochInfo",
]);
const MAX_BYTES = 64 * 1024;
type RpcCall = { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown[] };
const error = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("size"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}

/** Dependency injection keeps proxy tests offline and independent of secrets. */
export async function handleRpcProxy(request: Request, endpoint: () => string, upstream: typeof fetch): Promise<Response> {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  // TLS terminators may give Next an internal HTTP URL but preserve Host/proto.
  const forwardedOrigin = host && /^(https?)$/.test(proto) ? `${proto}://${host}` : url.origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== url.origin && origin !== forwardedOrigin)) {
    return Response.json(error(null, -32600, "Use the same-origin payment page."), { status: 403 });
  }
  let raw: string;
  try { raw = await readBody(request); } catch { return Response.json(error(null, -32600, "RPC request is too large."), { status: 413 }); }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return Response.json(error(null, -32700, "Invalid JSON request."), { status: 400 }); }
  const calls = Array.isArray(data) ? data : [data];
  if (calls.length === 0 || calls.length > 10) return Response.json(error(null, -32600, "Use between 1 and 10 RPC requests."), { status: 400 });
  // Reject the whole batch BEFORE forwarding even a single disallowed method.
  for (const item of calls) {
    const call = item as Partial<RpcCall> | null;
    if (!call || call.jsonrpc !== "2.0" || typeof call.method !== "string" || !RPC_METHODS.has(call.method)) {
      return Response.json(error(null, -32601, "This RPC method is not available on the payment page."), { status: 400 });
    }
    if (!(call.id === null || typeof call.id === "string" || (typeof call.id === "number" && Number.isFinite(call.id))) || (call.params !== undefined && !Array.isArray(call.params))) {
      return Response.json(error(null, -32600, "Invalid RPC request."), { status: 400 });
    }
  }
  const results = await Promise.all((calls as RpcCall[]).map(async (call) => {
    try {
      const response = await upstream(endpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call), cache: "no-store" });
      if (!response.ok) return error(call.id, -32005, DEVNET_BUSY);
      const json = await response.json() as { result?: unknown; error?: { code?: number; message?: string } };
      if (json.error) return error(call.id, typeof json.error.code === "number" ? json.error.code : -32000, friendlyPaymentError(json.error.message));
      if (!("result" in json)) return error(call.id, -32005, DEVNET_BUSY);
      return { jsonrpc: "2.0", id: call.id, result: json.result };
    } catch { return error(call.id, -32005, DEVNET_BUSY); }
  }));
  return Response.json(Array.isArray(data) ? results : results[0], { headers: { "Cache-Control": "no-store" } });
}
