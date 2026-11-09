"use client";
import { useEffect, useState } from "react";
import type { SolanaInvoice } from "../lib/receipt-types";
import { CrossChainPaymentPanel } from "./cross-chain-payment";
import { PayStepper } from "./pay-stepper";
import { formatAtomic } from "../lib/settlement/types";
import { PaidSeal } from "./paid-seal";
import { ReceiptAmounts } from "./receipt-amounts";
import { mergePaymentSnapshot, paymentStage, startPaymentResume } from "../lib/payment-resume";
import type { PaymentOptions } from "../lib/aurora/service";

/** No devnet wallet provider, QR, token details or sync can run in this flow. */
export function LivePayer({ invoice: initial, merchantName }: { invoice: SolanaInvoice; merchantName: string }) {
  const [snapshot, setSnapshot] = useState<PaymentOptions | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [opened, setOpened] = useState(false);
  const invoice = { ...initial, ...snapshot?.invoice };
  // Paid truth is monotonic. Never regress a server-rendered paid invoice.
  const paid = initial.status === "paid" || snapshot?.invoice.status === "paid";
  useEffect(() => {
    if (initial.status === "draft" || initial.status === "paid") return;
    return startPaymentResume(initial.id, (next) => {
      setSnapshot((previous) => mergePaymentSnapshot(previous, next));
      setRefreshError(false);
    }, () => setRefreshError(true), { checking: setChecking });
  }, [initial.id, initial.status]);
  const amount = invoice.settlement?.mode === "live" ? formatAtomic(invoice.settlement.amountAtomic, 6) : invoice.amount;
  const [whole = "0", fraction = ""] = amount.split(".");
  const stage = paymentStage(paid, snapshot, opened);
  return <article className="paper pay-card min-w-0 p-5 [overflow-wrap:anywhere] sm:p-6">
    <PayStepper step={paid ? 3 : stage === "payment" ? 2 : 1} />
    <p className="pill mt-5">Solana mainnet · real funds</p>
    {paid ? <section className="mt-6 grid gap-4 text-center"><PaidSeal /><h1 className="t-h2">Payment verified</h1><p>{merchantName} received USDC on Solana mainnet.</p>{invoice.crossChain ? <ReceiptAmounts receipt={invoice.crossChain} /> : null}<a className="btn btn-mint w-full" href={`/api/invoices/${encodeURIComponent(invoice.id)}/receipt.pdf?download=1`} download>Download receipt</a>{invoice.receiptId ? <a className="btn btn-ghost w-full" href={`/receipts/${encodeURIComponent(invoice.receiptId)}`}>Open receipt</a> : null}{invoice.explorerUrl ? <a className="text-sm underline" href={invoice.explorerUrl} target="_blank" rel="noreferrer">View payment on Solana</a> : null}</section> : <>
      <h1 className="t-h2 mt-4">Pay {merchantName}</h1><p className="num pay-amount mt-4">${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}<span className="dec">.{fraction.padEnd(2, "0")}</span></p><p className="mt-2 text-sm">USDC on Solana mainnet · {invoice.number}</p><p className="mt-2 text-sm text-muted">{invoice.description}</p>
      {refreshError ? <p className="mt-4 text-sm" role="status">We couldn’t refresh your payment. Retrying automatically. Your last known status is kept; do not send again.</p> : null}
      {checking && snapshot && !refreshError ? <p className="mt-4 text-sm" role="status">Updating payment status…</p> : null}
      {invoice.status === "draft" ? <p className="mt-4">This invoice is not ready for payment.</p> : stage === "loading" ? <p className="mt-4" role="status">Checking your payment status…</p> : stage === "review" ? <><p className="mt-5 text-sm">This payment uses real funds. Choose from the available tokens and networks. The merchant receives USDC on Solana mainnet at the address set on this invoice.</p><button className="btn btn-mint mt-5 w-full" type="button" onClick={() => setOpened(true)}>Pay from another network</button></> : snapshot ? <CrossChainPaymentPanel invoiceId={invoice.id} amount={amount} options={snapshot} refreshingFailed={refreshError} onAttemptChange={(attempt) => setSnapshot((current) => current && current.invoice.status !== "paid" ? { ...current, attempt } : current)} /> : null}
    </>}
  </article>;
}
