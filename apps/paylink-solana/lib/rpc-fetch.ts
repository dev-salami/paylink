import { DEVNET_BUSY } from "./rpc-errors";

export interface RpcFetchOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  maxRetries?: number;
}

export function retryDelay(attempt: number, retryAfter: string | null, now = Date.now(), random = Math.random): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now : 0;
  return Math.max(0, requested, Math.min(4_000, 300 * 2 ** attempt) + Math.floor(random() * 250));
}

export function createRetryingRpcFetch(options: RpcFetchOptions = {}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep: (ms: number) => Promise<void> = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let cooldownUntil = 0;
  return async (input, init) => {
    if (cooldownUntil > now()) throw new Error(DEVNET_BUSY);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(input, {
          ...init, redirect: "error",
          signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
        });
      } catch {
        if (init?.signal?.aborted || attempt >= (options.maxRetries ?? 4)) throw new Error(DEVNET_BUSY);
        await sleep(retryDelay(attempt, null, now(), random));
        continue;
      }
      let retryable = response.status === 429 || response.status >= 500;
      if (response.ok) {
        // Some providers report rate limits as JSON-RPC errors with HTTP 200.
        const json = await response.clone().json().catch(() => null) as { error?: { code?: number; message?: string } } | null;
        retryable = json?.error?.code === 429 || json?.error?.code === -32005 || /rate.?limit|too many requests/i.test(json?.error?.message || "");
      }
      if (!retryable && response.ok) return response;
      if (!retryable || attempt >= (options.maxRetries ?? 4)) {
        await response.body?.cancel();
        throw new Error(DEVNET_BUSY);
      }
      const delay = retryDelay(attempt, response.headers.get("retry-after"), now(), random);
      // Long provider cooldowns must not tie up an HTTP request indefinitely.
      // Fail without retrying early; a subsequent poll can try again later.
      if (delay > 15_000) {
        cooldownUntil = now() + delay;
        await response.body?.cancel();
        throw new Error(DEVNET_BUSY);
      }
      await response.body?.cancel();
      await sleep(delay);
    }
  };
}

export const RPC_READ_METHODS = new Set([
  "getLatestBlockhash", "getAccountInfo", "getBalance", "getTokenAccountBalance",
  "getSignatureStatuses", "getBlockHeight", "getSlot", "getMinimumBalanceForRentExemption",
  "getFeeForMessage", "getVersion", "getGenesisHash", "getEpochInfo",
  // Server-only Solana Pay lookups; NOT all exposed by the browser proxy.
  "getSignaturesForAddress", "getTransaction",
]);

/** Exact read keys only; request IDs are rewritten for each waiting caller. */
export function createCachedRpcFetch(options: RpcFetchOptions & { mint?: string } = {}): typeof fetch {
  const request = createRetryingRpcFetch(options);
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  return async (input, init) => {
    let body: { id?: unknown; method?: string; params?: unknown[] };
    try { body = JSON.parse(String(init?.body)); } catch { return request(input, init); }
    if (!body.method || !RPC_READ_METHODS.has(body.method)) return request(input, init);
    const key = JSON.stringify([body.method, body.params]);
    const hit = cache.get(key);
    const makeResponse = (value: unknown) => Response.json({ ...(value as object), id: body.id });
    if (hit && hit.expires > now()) return makeResponse(hit.value);
    if (pending.has(key)) return makeResponse(await pending.get(key));
    if (pending.size >= 128) throw new Error(DEVNET_BUSY);
    const job = (async () => {
      const response = await request(input, init);
      const value = await response.json() as { result?: unknown; error?: unknown };
      if (!value.error && value.result != null) {
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        const isMint = body.method === "getAccountInfo" && options.mint && body.params?.[0] === options.mint && (value.result as { value?: unknown }).value != null;
        const ttl = isMint ? 60_000 : 1_500;
        cache.set(key, { expires: now() + ttl, value });
      }
      return value;
    })();
    pending.set(key, job);
    try { return makeResponse(await job); } finally { pending.delete(key); }
  };
}
