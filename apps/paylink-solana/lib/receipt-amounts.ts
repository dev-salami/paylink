import { SOURCES, sourceChainName } from "./aurora/assets";
import { formatAtomic, type CrossChainAttempt, type CrossChainReceipt } from "./settlement/types";

const atomic = (value: unknown): value is string => typeof value === "string" && /^\d{1,100}$/.test(value);

export function withReceiptAmounts(receipt: CrossChainReceipt, attempt: CrossChainAttempt, verifiedCredit?: string): CrossChainReceipt {
  const source = SOURCES.find((row) => row.assetId === attempt.sourceAssetId && row.chain === receipt.sourceChain && row.symbol === receipt.sourceSymbol);
  if (!source) return receipt;
  return { ...receipt, sourceDecimals: source.decimals,
    depositedAmountAtomic: atomic(attempt.depositedAmount) ? attempt.depositedAmount : undefined,
    quotedAmountAtomic: attempt.realQuote?.quote.amountIn,
    quotedMinimumAtomic: attempt.realQuote?.quote.minAmountIn,
    settlementAmountAtomic: atomic(verifiedCredit) ? verifiedCredit : undefined };
}

/** Read-only enrichment for old receipts: only the signature-matched settled
 * attempt can supply amounts. Never reuse legacy amountInFormatted as a deposit. */
export function resolveReceiptAmounts(invoiceId: string, receipt: CrossChainReceipt | undefined, attempts: CrossChainAttempt[] = []): CrossChainReceipt | undefined {
  if (!receipt) return undefined;
  const attempt = attempts.find((row) => row.invoiceId === invoiceId && row.lifecycle === "settled" && row.destinationTxHashes.includes(receipt.destinationTxHash));
  return attempt ? withReceiptAmounts(receipt, attempt, attempt.evidence?.totalAtomic) : receipt;
}

export const receiptAmountsNote = "Source deposit is reported by the payment service. Merchant credit is verified on Solana. Differences are not a fee breakdown.";
export function receiptAmountRows(receipt: CrossChainReceipt): [string, string][] {
  const decimals = receipt.sourceDecimals;
  const sourceAmount = (value: unknown) => atomic(value) && Number.isInteger(decimals) && decimals! >= 0 && decimals! <= 36
    ? `${formatAtomic(value, decimals!)} ${receipt.sourceSymbol} on ${sourceChainName(receipt.sourceChain)}` : "Unknown";
  return [
    ["Source deposit (reported)", sourceAmount(receipt.depositedAmountAtomic)],
    ["Quoted send amount", sourceAmount(receipt.quotedAmountAtomic)],
    ["Quoted minimum", sourceAmount(receipt.quotedMinimumAtomic)],
    ["Merchant credit (verified)", atomic(receipt.settlementAmountAtomic) ? `${formatAtomic(receipt.settlementAmountAtomic, 6)} USDC on Solana mainnet` : "Unknown"],
  ];
}
