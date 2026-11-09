"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { Transaction } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import { formatLongDate, formatUsdc, type Invoice } from "@181hacks/paylink-core";
import { PaidSeal } from "./paid-seal";
import { UsdcChip } from "./usdc-chip";
import { QrCard } from "./qr-card";
import { Money } from "./keel";
import { DEVNET_BUSY, friendlyInvoiceIssue, friendlyPaymentError } from "../lib/rpc-errors";
import { startVisibilityPolling } from "../lib/polling";
import { prepareWalletTransaction } from "../lib/wallet-transaction";
import { PayStepper } from "./pay-stepper";
import { LivePayer } from "./live-payer";
import type { SolanaInvoice } from "../lib/receipt-types";

type PayStep = 1 | 2 | 3;
type PayMethod = "wallet" | "qr" | "details";

export function PayClient(props: { invoice: SolanaInvoice; qr: string | null; merchantName: string }) {
  if (props.invoice.settlement?.mode === "live") return <LivePayer invoice={props.invoice} merchantName={props.merchantName} />;
  return <DemoPayClient {...props} />;
}

function DemoPayClient(props: { invoice: SolanaInvoice; qr: string | null; merchantName: string }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  // Do not serialize a dedicated upstream URL into the RSC payload. Wait until
  // mount rather than giving web3.js a relative URL or an SSR dummy endpoint.
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => { setEndpoint(`${window.location.origin}/api/rpc`); }, []);
  if (!endpoint) return <article className="paper pay-card p-5 sm:p-6" role="status">Loading payment options…</article>;
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <PayFlow {...props} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function PayFlow({ invoice: initial, qr, merchantName }: { invoice: Invoice; qr: string | null; merchantName: string }) {
  const [invoice, setInvoice] = useState(initial);
  const [step, setStep] = useState<PayStep>(initial.status === "paid" ? 3 : 1);
  const [method, setMethod] = useState<PayMethod>("wallet");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoices/${initial.id}/sync`, { method: "POST", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) return null;
      const next = (await response.json()) as Invoice;
      setInvoice(next);
      return next;
    } catch {
      return null;
    }
  }, [initial.id]);

  const watching = !invoice.sample && invoice.status !== "paid" && invoice.status !== "draft";

  useEffect(() => {
    if (!watching) return;
    return startVisibilityPolling(async () => {
      const next = await refresh();
      return next?.status === "paid" ? "stop" : !next || next.paymentIssue === "rpc_down" ? "error" : "ok";
    }, 3_000);
  }, [watching, refresh]);

  useEffect(() => {
    if (invoice.status === "paid") setStep(3);
  }, [invoice.status]);

  async function payWithWallet() {
    setError("");
    if (invoice.sample) {
      setStep(3);
      return;
    }
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    setPaying(true);
    setStep(3);
    try {
      const transaction = await prepareWalletTransaction(`/api/invoices/${invoice.id}/tx`, publicKey.toBase58(), { onRetry: () => setError(DEVNET_BUSY) });
      setError("");
      const raw = Uint8Array.from(atob(transaction), (char) => char.charCodeAt(0));
      const signature = await sendTransaction(Transaction.from(raw), connection);
      setInvoice((current) => ({ ...current, txSignature: signature, paymentIssue: null }));
      window.setTimeout(() => void refresh(), 1500);
    } catch (caught) {
      setError(friendlyPaymentError(caught));
      setStep(2);
    } finally {
      setPaying(false);
    }
  }

  function markSent() {
    setError("");
    setStep(3);
    if (invoice.sample) return;
    void refresh();
  }

  const paid = invoice.status === "paid";

  return (
    <article className="paper pay-card p-5 sm:p-6">
      <PayStepper step={paid ? 3 : step} />
      {invoice.sample && !paid ? (
        <p className="mt-4 rounded-2xl bg-elev px-3 py-2 t-small text-muted">
          Solana devnet · no monetary value. This preview does not process payments or issue receipts.
        </p>
      ) : null}
      {step === 1 ? (
        <section className="mt-6">
          <p className="t-micro text-muted">You are paying</p>
          <h1 className="t-h2 mt-1">{merchantName}</h1>
          <p className="t-small mt-2 text-muted">Review the details before you pay. This invoice uses devnet USDC with no monetary value.</p>
          <p className="num pay-amount mt-6"><Money value={invoice.amount} /></p>
          <p className="mt-2 flex items-center gap-2">
            <UsdcChip />
            <span className="t-small text-muted">Solana devnet</span>
          </p>
          <div className="mt-6 rounded-2xl border border-line">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-semibold">{invoice.description}</span>
                <span className="t-small text-muted">Due {formatLongDate(invoice.dueDate)}</span>
              </span>
              <span className="num text-xl"><Money value={invoice.amount} /></span>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 font-bold">
              <span>Total</span>
              <span><Money value={invoice.amount} /> USDC</span>
            </div>
          </div>
          <button type="button" className="btn btn-primary mt-6 w-full" onClick={() => setStep(2)} disabled={invoice.status === "draft"}>
            Continue to payment
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-6">
          <p className="t-micro text-muted">Step 2 of 3</p>
          <h1 className="t-h2 mt-1">How would you like to pay?</h1>
          <p className="mt-2">
            <UsdcChip>Pay with USDC</UsdcChip>
          </p>
          <p className="t-small mt-2 text-muted">Send only USDC on Solana devnet. Do not send mainnet funds.</p>
          <div className="mt-4 grid gap-2">
            <MethodCard
              title="Pay with Solana wallet"
              body="Phantom or Solflare in the browser."
              selected={method === "wallet"}
              onSelect={() => setMethod("wallet")}
            />
            <MethodCard title="Scan QR" body="Use a wallet that supports Solana Pay." selected={method === "qr"} onSelect={() => setMethod("qr")} />
            <MethodCard
              title="Copy payment details"
              body="Wallet, amount, network, token, and reference."
              selected={method === "details"}
              onSelect={() => setMethod("details")}
            />
          </div>
          <div className="mt-4">
            {method === "wallet" ? (
              <button type="button" className="btn btn-primary w-full" onClick={() => void payWithWallet()} disabled={paying}>
                {paying ? "Waiting for the wallet…" : error && connected ? "Retry payment" : connected ? "Pay with wallet" : "Connect Phantom or Solflare"}
              </button>
            ) : null}
            {method === "qr" ? (
              <div className="grid gap-3">
                <QrCard src={qr} caption="Scan with a Solana wallet on devnet. We’ll check for your transfer." />
                {invoice.payment?.url ? <CopyRow label="Solana Pay link" value={invoice.payment.url} /> : null}
                <button type="button" className="btn btn-primary w-full" onClick={markSent}>
                  I have sent this payment
                </button>
              </div>
            ) : null}
            {method === "details" ? (
              <div>
                <p className="t-small text-muted">Use these exact details in your wallet, including the payment reference.</p>
                {invoice.payment?.url ? <CopyRow label="Solana Pay link" value={invoice.payment.url} /> : null}
                <CopyRow label="Wallet address" value={invoice.payment?.recipient ?? "Not issued yet"} />
                <CopyRow label="Amount" value={`${invoice.amount} USDC`} token />
                <CopyRow label="Network" value="Solana devnet" token />
                <CopyRow label="Token" value="USDC" token />
                <CopyRow label="Reference" value={invoice.payment?.reference ?? invoice.id} />
                <CopyRow label="Memo" value={invoice.id} />
                <button type="button" className="btn btn-primary mt-4 w-full" onClick={markSent}>
                  I have sent this payment
                </button>
              </div>
            ) : null}
          </div>
          {error ? <p className={`mt-3 t-small ${error === DEVNET_BUSY ? "text-muted" : "text-danger"}`} role="status">{error}</p> : null}
          {invoice.paymentIssueDetail ? <p className="mt-3 t-small text-muted" role="status">{friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail)}</p> : null}
          <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setStep(1)}>
            Back to the invoice
          </button>
          <p className="t-small mt-4 text-muted">Payments from other networks are available on Solana mainnet invoices only. Mainnet payments use real funds.</p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="mt-6">
          {paid ? (
            <div className="grid justify-items-center gap-4 py-4 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#71FC8F] text-2xl text-[#0b1a10]" aria-hidden>✓</span>
              <PaidSeal />
              <h1 className="t-h2">You are all set</h1>
              <p className="t-small max-w-xs text-muted">
                {formatUsdc(invoice.amount)} USDC received for {merchantName} on Solana devnet. No monetary value. Your receipt is ready.
              </p>
              {!invoice.sample ? <a className="btn btn-primary w-full" href={`/api/invoices/${encodeURIComponent(invoice.id)}/receipt.pdf?download=1`} download>
                Download receipt
              </a> : null}
              {invoice.receiptId ? (
                <a className="btn btn-ghost w-full" href={`/receipts/${invoice.receiptId}`}>
                  Open receipt
                </a>
              ) : null}
              {invoice.explorerUrl ? (
                <a className="t-small underline" href={invoice.explorerUrl}>
                  View the transaction
                </a>
              ) : null}
            </div>
          ) : invoice.sample ? (
            <div>
              <p className="t-micro text-muted">Step 3 of 3</p>
              <h1 className="t-h2 mt-1">Preview only</h1>
              <p className="t-small mt-2 text-muted">
                No payment was processed and no receipt was issued. Create an invoice to receive a payment link with verification.
              </p>
              <a className="btn btn-primary mt-6 w-full" href="/chat">
                Create an invoice
              </a>
              <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setStep(2)}>
                Back to payment options
              </button>
            </div>
          ) : (
            <div>
              <p className="t-micro text-muted">Step 3 of 3</p>
              <h1 className="t-h2 mt-1">Confirming your payment</h1>
              <p className="t-small mt-2 text-muted">We’re checking Solana devnet. Keep this page open for the latest status. Do not send again.</p>
              <div className="progress mt-6" aria-hidden>
                <i />
              </div>
              <p className="t-small mt-3 text-muted">{paying ? "Waiting for your wallet to approve." : "Looking for the transfer…"}</p>
              {error ? <p className={`mt-3 t-small ${error === DEVNET_BUSY ? "text-muted" : "text-danger"}`} role="status">{error}</p> : null}
              {invoice.paymentIssueDetail ? <p className="mt-3 t-small text-muted" role="status">{friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail)}</p> : null}
            </div>
          )}
        </section>
      ) : null}
    </article>
  );
}

function MethodCard({ title, body, selected, onSelect }: { title: string; body: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`method ${selected ? "on" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="block font-bold">{title}</span>
      <span className="t-small text-muted">{body}</span>
    </button>
  );
}

function CopyRow({ label, value, token = false }: { label: string; value: string; token?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <div className="min-w-0">
        <p className={`t-micro ${token ? "usdc" : "text-muted"}`}>{label}</p>
        <p className={`truncate font-semibold ${token ? "usdc" : ""}`} title={value}>{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Ok" : "Copy"}
      </button>
    </div>
  );
}
