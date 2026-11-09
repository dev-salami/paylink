export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const CIRCLE_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";

export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function serverRpcUrl(): string {
  const explicit = env("SOLANA_RPC_URL");
  if (explicit) return explicit;
  const helius = env("HELIUS_API_KEY");
  if (helius) return `https://devnet.helius-rpc.com/?api-key=${helius}`;
  return PUBLIC_DEVNET_RPC;
}

export function publicRpcUrl(): string {
  return env("NEXT_PUBLIC_SOLANA_RPC_URL", PUBLIC_DEVNET_RPC);
}

export function usdcMint(): string {
  return env("USDC_MINT", CIRCLE_DEVNET_USDC_MINT);
}

export function appOrigin(request?: Request): string {
  const configured = env("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function demoMode(): boolean {
  const flag = env("PAYLINK_DEMO_MODE");
  if (flag === "0") return false;
  if (flag === "1" || flag === "true") return true;
  return !env("LLM_API_KEY");
}

/** True when a server-only model key is configured. The key itself is never returned. */
export function modelConfigured(): boolean {
  return env("LLM_API_KEY").length > 0;
}

export function merchantProfile() {
  return {
    name: env("MERCHANT_NAME", "Morrow Quay Studio"),
    city: env("MERCHANT_CITY", "Lagos"),
    email: env("MERCHANT_EMAIL", "billing@morrowquay.example"),
  };
}

export function defaultBudget() {
  return {
    total: env("BUDGET_TOTAL_USDC", "5"),
    perCall: env("BUDGET_PER_CALL_USDC", "0.5"),
    approveAbove: env("BUDGET_APPROVE_ABOVE_USDC", "0.1"),
  };
}

export function resourcePrice(resource: "pdf" | "reminder"): string {
  return resource === "pdf" ? env("X402_PDF_PRICE_USDC", "0.25") : env("X402_REMINDER_PRICE_USDC", "0.05");
}

export function quoteTtlSeconds(): number {
  const parsed = Number(env("X402_QUOTE_TTL_SECONDS", "600"));
  return Number.isFinite(parsed) && parsed > 30 ? parsed : 600;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function shortKey(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}
