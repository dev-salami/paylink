import type { Invoice, Receipt } from "@181hacks/paylink-core";

export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MAINNET_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export type Settlement = { mode: "demo" } | {
  mode: "live"; network: "solana-mainnet"; chain: "sol"; assetId: string; mint: string;
  decimals: 6; recipient: string; amountAtomic: string; feePolicy: "payer_pays_exact_output";
};
export type LiveSettlement = Extract<Settlement, { mode: "live" }>;
export interface CrossChainReceipt {
  sourceChain: string; sourceSymbol: string;
  /** Legacy swap input field; never display as the payer's source deposit. */
  amountInFormatted: string;
  /** Source deposit is reported by Aurora, not inferred from swap input/minimum. */
  depositedAmountAtomic?: string; sourceDecimals?: number;
  quotedAmountAtomic?: string; quotedMinimumAtomic?: string;
  /** Independently verified Solana USDC credit (6 decimals). */
  settlementAmountAtomic?: string;
  originTxHash?: string; originExplorerUrl?: string; destinationTxHash: string;
  destinationExplorerUrl: string; correlationId?: string; network: "Solana mainnet";
}
export type SettlementInvoice = Invoice & { settlement?: Settlement; crossChain?: CrossChainReceipt };
export type SettlementReceipt = Receipt & { crossChain?: CrossChainReceipt };
export type Lifecycle = "quoted" | "awaiting_deposit" | "deposit_seen" | "incomplete" | "processing" | "settlement_verifying" | "settled" | "refund_pending" | "refunded" | "failed_needs_review" | "expired_unfunded" | "needs_review";
export interface QuoteRequest {
  dry: boolean; swapType: "EXACT_OUTPUT"; depositType: "ORIGIN_CHAIN"; originAsset: string;
  destinationAsset: string; amount: string; slippageTolerance: 50; refundTo: string;
  refundType: "ORIGIN_CHAIN"; recipient: string; recipientType: "DESTINATION_CHAIN";
  deadline: string; sessionId: string; confidentiality: "public";
}
export interface QuoteSnapshot {
  request: QuoteRequest; correlationId?: string;
  /** Server-side forensic response snapshot, scrubbed of the API credential. */
  response?: unknown;
  quote: { amountIn: string; minAmountIn: string; amountOut: string; minAmountOut: string;
    amountInFormatted?: string; amountInUsd?: string; amountOutUsd?: string; timeEstimate?: number;
    depositAddress?: string; depositMemo?: string; deadline?: string; timeWhenInactive?: string };
}
export interface SettlementEvidence { signatures: string[]; totalAtomic: string; checkedAt: string; reason?: string }
export interface CrossChainAttempt {
  id: string; invoiceId: string; sourceAssetId: string; sourceChain: string; sourceSymbol: string;
  refundTo: string; dryQuote?: QuoteSnapshot; realQuote?: QuoteSnapshot;
  depositAddress?: string; depositMemo?: string; userDeadline: string; providerDeadline?: string;
  lifecycle: Lifecycle; providerStatus?: string; originTxHashes: string[]; destinationTxHashes: string[];
  amountIn?: string; amountOut?: string; amountInFormatted?: string; depositedAmount?: string; refundedAmount?: string; refundReason?: string;
  correlationId?: string; evidence?: SettlementEvidence; lastPolledAt?: string; nextPollAt: string;
  createdAt: string; updatedAt: string;
}
export interface SettlementClaim { chain: "sol"; signature: string; invoiceId: string; attemptId: string; claimedAt: string }

export function isLiveInvoice(invoice: { settlement?: Settlement }): invoice is { settlement: LiveSettlement } {
  return invoice.settlement?.mode === "live";
}
export function decimalToAtomic(value: string, decimals: number): string {
  if (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 100) throw new Error("Use a positive decimal amount.");
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= 0n) throw new Error("Amount must be positive.");
  return amount.toString();
}
export function formatAtomic(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) throw new Error("Invalid atomic amount.");
  const padded = BigInt(value).toString().padStart(decimals + 1, "0");
  if (!decimals) return padded;
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return padded.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}
