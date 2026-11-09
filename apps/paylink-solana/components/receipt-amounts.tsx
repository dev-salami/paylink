import type { CrossChainReceipt } from "../lib/settlement/types";
import { receiptAmountRows, receiptAmountsNote } from "../lib/receipt-amounts";

export function ReceiptAmounts({ receipt }: { receipt: CrossChainReceipt }) {
  return <div className="mt-3 text-sm text-muted">
    <dl className="grid gap-2">{receiptAmountRows(receipt).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="mt-2 text-xs">{receiptAmountsNote}</p>
  </div>;
}
