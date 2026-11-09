import { createAsyncCache } from "../async-cache";
import { retryDelay } from "../rpc-fetch";
import { availableSources, parseIncidents, parseTokens } from "./assets";
import { validateQuote } from "./quote";
import type { QuoteRequest } from "../settlement/types";

/** Server-only adapter. No upstream URL, response error body, or key escapes. */
export function createAuroraClient(key: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const catalogue = createAsyncCache<ReturnType<typeof parseTokens>>(300_000, 1);
  const health = createAsyncCache<ReturnType<typeof parseIncidents>>(15_000, 1);
  const statuses = createAsyncCache<unknown>(5_000, 500);
  const requests: number[] = [];
  let blockedUntil = 0;
  async function call(path: string, body?: unknown, query = "", realQuote = false): Promise<unknown> {
    if (!key) throw new Error("Pay from any chain is not available.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      while (requests[0] !== undefined && requests[0] < now - 3_600_000) requests.shift();
      if (now < blockedUntil || requests.length >= 1950 || requests.filter((at) => at > now - 10_000).length >= 95) throw new Error("Payment options are busy. Try again shortly.");
      requests.push(now);
      let response: Response;
      try {
        response = await fetchImpl(`https://intents-api.aurora.dev/api/${path}/${encodeURIComponent(key)}${query}`, {
          method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store",
          headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        if (realQuote || attempt === 2) throw new Error("We couldn’t confirm this payment. Check its status before trying again.");
        await sleep(retryDelay(attempt, null)); continue;
      }
      if (response.ok) {
        try { return await response.json(); } catch { throw new Error("Payment details could not be loaded. Please try again later."); }
      }
      const retryable = response.status === 429 || (!realQuote && response.status >= 500);
      const delay = retryDelay(attempt, response.headers.get("retry-after"));
      await response.body?.cancel();
      if (retryable && delay > 15_000) blockedUntil = Date.now() + delay;
      if (!retryable || attempt === 2 || delay > 15_000) throw new Error("This payment option is unavailable or the amount is below its minimum. No payment was confirmed.");
      await sleep(delay);
    }
    throw new Error("Payment options are unavailable.");
  }
  return {
    async sources() {
      const [tokens, incidents] = await Promise.all([catalogue("tokens", async () => parseTokens(await call("tokens"))), health("incidents", async () => parseIncidents(await call("incidents")))]);
      return availableSources(tokens, incidents);
    },
    async quote(request: QuoteRequest) {
      const response = await call("quote", request, "", !request.dry);
      const snapshot = validateQuote(request, response);
      try {
        const clean = (value: string) => key ? value.split(key).join("[redacted]").split(encodeURIComponent(key)).join("[redacted]") : value;
        let text = JSON.stringify(response, (_name, value: unknown) => typeof value === "string" ? clean(value) : value);
        if (key) text = text.split(JSON.stringify(key).slice(1, -1)).join("[redacted]");
        if (text.length > 65_536) throw new Error("Oversized snapshot");
        return { ...snapshot, response: JSON.parse(text) as unknown };
      } catch { throw new Error("We couldn’t save these payment instructions. Contact support before trying again."); }
    },
    status(address: string, memo?: string) {
      const query = new URLSearchParams({ depositAddress: address });
      if (memo) query.set("depositMemo", memo);
      return statuses(query.toString(), () => call("status", undefined, `?${query}`));
    },
    submit(txHash: string, depositAddress: string) { return call("deposit/submit", { txHash, depositAddress }); },
  };
}
const shared = globalThis as typeof globalThis & { __paylinkAuroraClient?: ReturnType<typeof createAuroraClient> };
export function auroraAvailable(): boolean { return Boolean(process.env.AURORA_INTENTS_API_KEY?.trim()); }
export function auroraClient() {
  return shared.__paylinkAuroraClient ??= createAuroraClient(process.env.AURORA_INTENTS_API_KEY?.trim() || "");
}
