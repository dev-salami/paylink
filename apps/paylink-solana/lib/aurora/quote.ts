import type { LiveSettlement, QuoteRequest, QuoteSnapshot } from "../settlement/types";
import { SOURCES } from "./assets";

export function buildQuoteRequest(settlement: LiveSettlement, sourceAssetId: string, refundTo: string, dry: boolean, sessionId: string, now = Date.now()): QuoteRequest {
  if (!SOURCES.some((item) => item.assetId === sourceAssetId)) throw new Error("Choose one of the available tokens and networks.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(refundTo) || /^0x0{40}$/i.test(refundTo)) throw new Error("Enter a valid refund wallet address that you control on the network you send from.");
  return { dry, swapType: "EXACT_OUTPUT", depositType: "ORIGIN_CHAIN", originAsset: sourceAssetId, destinationAsset: settlement.assetId, amount: settlement.amountAtomic,
    slippageTolerance: 50, refundTo, refundType: "ORIGIN_CHAIN", recipient: settlement.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 600_000).toISOString(), sessionId, confidentiality: "public" };
}
const decimal = (value: unknown) => typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100 ? value : undefined;
export function validateQuote(request: QuoteRequest, data: unknown): QuoteSnapshot {
  const value = data as { correlationId?: string; quoteRequest?: Record<string, unknown>; quote?: Record<string, unknown> };
  const echoed = value?.quoteRequest;
  const q = value?.quote;
  if (!echoed || !q || ["recipient", "originAsset", "destinationAsset", "amount", "dry", "swapType", "depositType", "refundType", "recipientType"].some((key) => echoed[key] !== request[key as keyof QuoteRequest]) ||
      typeof echoed.refundTo !== "string" || echoed.refundTo.toLowerCase() !== request.refundTo.toLowerCase()) throw new Error("The quote did not match this invoice. No payment address was accepted.");
  for (const key of ["amountIn", "minAmountIn", "amountOut", "minAmountOut"]) if (typeof q[key] !== "string" || !/^\d{1,100}$/.test(q[key] as string)) throw new Error("The quoted amounts could not be verified.");
  if (BigInt(q.minAmountOut as string) < BigInt(request.amount) || BigInt(q.amountOut as string) < BigInt(request.amount)) throw new Error("This payment option can't guarantee the full invoice amount.");
  if (BigInt(q.amountIn as string) <= 0n || BigInt(q.minAmountIn as string) <= 0n) throw new Error("The amount to send could not be verified.");
  if (BigInt(q.minAmountIn as string) > BigInt(q.amountIn as string)) throw new Error("The quoted sending amounts do not match.");
  if (request.dry && (q.depositAddress || q.depositMemo)) throw new Error("The quote preview included unexpected payment instructions. Do not send funds.");
  if (!request.dry && (typeof q.depositAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(q.depositAddress) || /^0x0{40}$/i.test(q.depositAddress))) throw new Error("A valid payment address could not be confirmed. Do not send funds.");
  if (q.depositMemo !== undefined && (typeof q.depositMemo !== "string" || q.depositMemo.length > 128)) throw new Error("The required payment memo could not be verified.");
  return { request, correlationId: typeof value.correlationId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.correlationId) ? value.correlationId : undefined,
    quote: { amountIn: q.amountIn as string, minAmountIn: q.minAmountIn as string, amountOut: q.amountOut as string, minAmountOut: q.minAmountOut as string,
      amountInFormatted: decimal(q.amountInFormatted), amountInUsd: decimal(q.amountInUsd), amountOutUsd: decimal(q.amountOutUsd),
      timeEstimate: typeof q.timeEstimate === "number" && q.timeEstimate >= 0 ? Math.min(q.timeEstimate, 86_400) : undefined,
      depositAddress: request.dry ? undefined : q.depositAddress as string, depositMemo: typeof q.depositMemo === "string" ? q.depositMemo.slice(0, 128) : undefined,
      deadline: typeof q.deadline === "string" && Number.isFinite(Date.parse(q.deadline)) ? q.deadline : undefined,
      timeWhenInactive: typeof q.timeWhenInactive === "string" && Number.isFinite(Date.parse(q.timeWhenInactive)) ? q.timeWhenInactive : undefined } };
}
