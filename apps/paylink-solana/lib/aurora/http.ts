import { publicRate } from "./service";

export async function readPaymentBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Use a JSON object.");
  return body;
}
export async function paymentResponse(request: Request, run: () => Promise<unknown>, kind: "quote" | "read" = "read") {
  try {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host))) throw new Error("Use the original payment page.");
    publicRate(request, kind);
    const payload = await run();
    const text = JSON.stringify(payload, (_name, value: unknown) => {
      if (typeof value !== "string") return value;
      let safe = value;
      for (const secret of [process.env.AURORA_INTENTS_API_KEY, process.env.SOLANA_MAINNET_RPC_URL]) if (secret) safe = safe.split(secret).join("[redacted]");
      return safe;
    });
    return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Payment options are temporarily unavailable.";
    for (const key of [process.env.AURORA_INTENTS_API_KEY, process.env.SOLANA_MAINNET_RPC_URL]) if (key) message = message.split(key).join("[redacted]");
    message = message.replace(/https?:\/\/\S+/g, "[redacted URL]").slice(0, 250);
    return Response.json({ error: message }, { status: /too many|please wait/i.test(message) ? 429 : 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
