export const DEVNET_BUSY = "Solana devnet is busy. Retrying…";
export const NO_USDC = "This wallet has no devnet USDC yet. Add devnet USDC, then retry.";

function text(error: unknown): string {
  return error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
}

export function isTransientRpcError(error: unknown): boolean {
  return /429|rate.?limit|too many requests|timeout|timed out|fetch|network|socket|connection|failed to get info about account|\b5\d\d\b|service unavailable|devnet is busy|rpc.?down|node is (?:behind|unhealthy)/i.test(text(error));
}

/** Allowlisted user messages only. Never echo upstream bodies, URLs or stacks. */
export function friendlyPaymentError(error: unknown): string {
  const message = text(error);
  if (isTransientRpcError(error)) return DEVNET_BUSY;
  if (/TokenAccountNotFoundError|TokenInvalidAccountOwnerError|sender not found|no devnet USDC/i.test(message)) return NO_USDC;
  if (/insufficient.*(?:token|usdc)|not (?:have )?enough.*usdc/i.test(message)) return "This wallet does not have enough devnet USDC for this invoice.";
  if (/insufficient.*(?:funds|sol|lamport)|not enough.*(?:sol|lamport)|needs a little devnet SOL/i.test(message)) return "This wallet needs a little devnet SOL for the network fee.";
  if (/reject|declin|cancel/i.test(message)) return "Wallet approval was cancelled. You can retry when ready.";
  return "We could not prepare or confirm the payment. Please retry, or check your wallet for a submitted transfer.";
}

/** Log useful categories, never arbitrary errors that may contain RPC keys/URLs. */
export function warnRpcFailure(context: string, error: unknown): void {
  console.warn(`[Solana ${context}] ${isTransientRpcError(error) ? "transient RPC failure" : "request failed"}; upstream details withheld.`);
}

export function friendlyInvoiceIssue(issue: string | null | undefined, detail: string): string {
  if (issue === "rpc_down") return DEVNET_BUSY;
  if (issue === "underpaid") return "The payment received is smaller than this invoice.";
  if (issue === "wrong_mint") return "This invoice needs devnet USDC. Please check the token.";
  return friendlyPaymentError(detail);
}
