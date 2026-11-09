import { DEVNET_BUSY, friendlyPaymentError } from "./rpc-errors";

/** Retry construction only. Never retry a wallet approval or signed submission. */
export async function prepareWalletTransaction(url: string, account: string, options: {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: () => void;
} = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep: (ms: number) => Promise<void> = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryable = true;
    let message = DEVNET_BUSY;
    try {
      const response = await fetchImpl(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }), signal: AbortSignal.timeout(60_000),
      });
      const data = await response.json() as { transaction?: string; error?: string; retryable?: boolean };
      if (response.ok && typeof data.transaction === "string") return data.transaction;
      retryable = data.retryable === true || response.status === 429 || response.status >= 500;
      message = retryable ? DEVNET_BUSY : friendlyPaymentError(data.error);
    } catch { /* A network error is safe to retry before wallet approval. */ }
    if (!retryable || attempt === 2) throw new Error(message);
    options.onRetry?.();
    await sleep(700 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
  throw new Error(DEVNET_BUSY);
}
