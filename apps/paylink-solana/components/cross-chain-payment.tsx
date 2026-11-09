"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import BigNumber from "bignumber.js";
import { formatAtomic, type Lifecycle, type QuoteSnapshot } from "../lib/settlement/types";
import type { SourceAsset } from "../lib/aurora/assets";
import type { PaymentOptions, PublicPaymentAttempt } from "../lib/aurora/service";
import { depositPaymentUri } from "../lib/aurora/payment-uri";
import { paymentRouteFundable, paymentFundingAllowed } from "../lib/payment-resume";

type Quote = QuoteSnapshot["quote"];
type Attempt = PublicPaymentAttempt;
type Preview = { quote: Quote; source: SourceAsset };
async function json(url: string, body?: unknown) {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Payment options are temporarily unavailable.");
  return data;
}
export function CrossChainPaymentPanel({ invoiceId, amount, options, refreshingFailed, onAttemptChange }: {
  invoiceId: string; amount: string; options: PaymentOptions; refreshingFailed: boolean; onAttemptChange: (attempt: Attempt) => void;
}) {
  const root = `/api/pay/${encodeURIComponent(invoiceId)}/aurora`;
  const available = options.available;
  const sources = options.sources;
  const [sourceId, setSourceId] = useState(options.sources[0]?.assetId || "");
  const [refundTo, setRefundTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(options.attempt || null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmedAttemptId, setConfirmedAttemptId] = useState<string | null>(null);
  const tabConfirmation = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [txHash, setTxHash] = useState("");
  const [hint, setHint] = useState("");
  const [now, setNow] = useState(Date.now());
  const source = sources.find((row) => row.assetId === sourceId);
  const attemptId = attempt?.id;
  const routeFundingAllowed = paymentRouteFundable(options, attempt, now, !refreshingFailed);
  const fundingAllowed = paymentFundingAllowed(options, attempt, confirmedAttemptId, now, !refreshingFailed);

  useEffect(() => {
    const next = options.attempt;
    // A fresh-quote button can dismiss an expired/refunded record, but late
    // funding must restore that record and its hold. No browser ID selects it.
    if (next && (next.id !== dismissedId || !["expired_unfunded", "refunded"].includes(next.lifecycle))) setAttempt(next);
    if (!sourceId) setSourceId(sources[0]?.assetId || "");
  }, [options.attempt, dismissedId, sourceId, sources]);

  useEffect(() => {
    setAcknowledged(false); setRefundTo(""); setConfirmedAttemptId(null);
    if (!attemptId) return;
    if (tabConfirmation.current === attemptId) setConfirmedAttemptId(attemptId);
    try {
      localStorage.setItem(`paylink:aurora:${invoiceId}`, attemptId);
      if (localStorage.getItem(`paylink:aurora:confirmed:${invoiceId}`) === attemptId) setConfirmedAttemptId(attemptId);
    } catch { /* Missing storage means explicit refund-wallet reconfirmation. */ }
  }, [attemptId, invoiceId]);

  const qrPayload = fundingAllowed && attempt?.depositAddress && attempt.source && attempt.quote
    ? depositPaymentUri(attempt.source.assetId, attempt.depositAddress, attempt.quote.amountIn, attempt.depositMemo) : undefined;
  useEffect(() => {
    let active = true;
    setQr("");
    if (qrPayload) {
      void QRCode.toDataURL(qrPayload, { width: 256, margin: 2 }).then((value) => { if (active) setQr(value); }).catch(() => {});
    }
    return () => { active = false; };
  }, [qrPayload]);
  useEffect(() => {
    if (attempt?.lifecycle !== "awaiting_deposit") return;
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    tick();
    const timer = setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick); window.addEventListener("pageshow", tick); window.addEventListener("online", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); window.removeEventListener("pageshow", tick); window.removeEventListener("online", tick); };
  }, [attempt?.id, attempt?.lifecycle]);

  async function quote(dry: boolean) {
    if (refreshingFailed || options.invoice.status === "paid") return;
    setBusy(true); setError("");
    try {
      const data = await json(`${root}/quote`, { sourceAssetId: sourceId, refundTo, dry, acknowledged });
      if (dry) { setPreview(data.preview); setAcknowledged(false); }
      else {
        setAttempt(data.attempt); onAttemptChange(data.attempt); setPreview(null);
        if (data.attempt?.lifecycle === "awaiting_deposit") {
          tabConfirmation.current = data.attempt.id;
          setConfirmedAttemptId(data.attempt.id);
          try { localStorage.setItem(`paylink:aurora:confirmed:${invoiceId}`, data.attempt.id); } catch { /* Current-tab acknowledgement still works. */ }
        }
        if (data.warning) setError(data.warning);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Quote unavailable."); }
    finally { setBusy(false); }
  }
  async function resume() {
    if (!attempt?.source || !acknowledged || !routeFundingAllowed) return;
    setBusy(true); setError("");
    try {
      const data = await json(`${root}/quote`, { sourceAssetId: attempt.source.assetId, refundTo, dry: false, acknowledged: true });
      setAttempt(data.attempt); onAttemptChange(data.attempt);
      if (data.attempt?.lifecycle === "awaiting_deposit") {
        tabConfirmation.current = data.attempt.id;
        setConfirmedAttemptId(data.attempt.id);
        try { localStorage.setItem(`paylink:aurora:confirmed:${invoiceId}`, data.attempt.id); } catch { /* Current-tab acknowledgement still works. */ }
      }
      if (data.warning) setError(data.warning);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We couldn’t reopen this payment. Please try again."); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!attempt) return;
    setBusy(true); setError("");
    try { await json(`${root}/attempts/${encodeURIComponent(attempt.id)}/deposit`, { txHash }); setHint("Transaction added. We still need to verify the payment before this invoice is marked paid."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "We couldn’t add this transaction. Please try again."); }
    finally { setBusy(false); }
  }
  const seconds = attempt ? Math.max(0, Math.ceil((Date.parse(attempt.userDeadline) - now) / 1_000)) : 0;
  const step = !attempt ? 0 : ({ awaiting_deposit: 1, quoted: 1, deposit_seen: 2, incomplete: 2, processing: 3, settlement_verifying: 4, settled: 5 } as Partial<Record<Lifecycle, number>>)[attempt.lifecycle] || 0;
  return (
    <section className="mt-4 min-w-0 space-y-4 [overflow-wrap:anywhere]" aria-label="Pay from another network">
      <div className="rounded-2xl border border-[#1f9d55] bg-mint-soft p-4 text-sm text-ink"><strong>Mainnet · real funds</strong><p>You are paying {amount} USDC to the merchant on Solana mainnet.</p></div>
      {!available ? <p>Payment options are unavailable. Contact the merchant. Send only to the address shown in your payment instructions.</p> : null}
      {!attempt && available ? <>
        <fieldset className="min-w-0"><legend className="mb-2 text-sm">You send</legend><div className="flex flex-wrap gap-2">{sources.map((asset) => <button type="button" key={asset.assetId} className={`btn btn-small payer-link-control ${sourceId === asset.assetId ? "btn-mint" : "btn-ghost"}`} aria-pressed={sourceId === asset.assetId} disabled={busy} onClick={() => { setSourceId(asset.assetId); setPreview(null); setAcknowledged(false); }}>{asset.name} {asset.symbol}</button>)}</div></fieldset>
        {sources.length === 0 ? <p>No payment options are available right now. Please check again later.</p> : null}
        <label className="block text-sm">Your {source?.name || "sending-network"} refund wallet<input className="field mt-2" value={refundTo} disabled={busy} onChange={(event) => { setRefundTo(event.target.value.trim()); setPreview(null); setAcknowledged(false); }} placeholder="0x…" autoComplete="off" spellCheck={false} /></label>
        <p className="text-xs text-muted">Enter a wallet you control, not an exchange address. Any refund returns on the network you send from.</p>
        <button type="button" className="btn btn-primary w-full" disabled={busy || refreshingFailed || !source || !/^0x[a-fA-F0-9]{40}$/.test(refundTo)} onClick={() => void quote(true)}>{busy ? "Getting quote…" : "Get quote"}</button>
        {preview ? <div className="rounded-2xl bg-elev p-4 text-sm">
          <p>You send <strong>{formatAtomic(preview.quote.amountIn, preview.source.decimals)} {preview.source.symbol}</strong> on {preview.source.name}{preview.quote.amountInUsd ? ` (≈$${new BigNumber(preview.quote.amountInUsd).toFixed(2)})` : ""}.</p>
          <p className="mt-2">Merchant receives exactly {amount} USDC on Solana mainnet.</p>
          <p className="mt-2 text-xs text-muted">Minimum accepted send: {formatAtomic(preview.quote.minAmountIn, preview.source.decimals)} {preview.source.symbol}. Send the exact quoted amount, not this minimum.</p>
          {preview.quote.amountInUsd && preview.quote.amountOutUsd ? <p className="mt-2">Estimated conversion cost: ${new BigNumber(preview.quote.amountInUsd).minus(preview.quote.amountOutUsd).toFixed(4)} (included in the quote).</p> : null}
          <p className="mt-2">Estimated time: ~{preview.quote.timeEstimate ?? "unknown"} seconds. {preview.source.name} network fees are paid separately.</p>
          <label className="mt-4 flex items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand this uses real funds on {preview.source.name} mainnet and I&apos;ll send only {preview.source.symbol} on {preview.source.name}.</span></label>
          <button type="button" className="btn btn-mint mt-4 w-full" disabled={!acknowledged || busy || refreshingFailed} onClick={() => void quote(false)}>Get payment instructions</button>
        </div> : null}
      </> : null}
      {attempt ? <div className="min-w-0 space-y-3">
        <ol className="space-y-2 text-sm" aria-label="Payment progress">{["Ready to pay", "Confirming your transfer", "Converting your payment", "Verifying receipt", "Paid"].map((label, index) => <li key={label} className="flex items-center gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${step >= index + 1 ? "bg-mint text-[#0b1a10]" : "bg-elev text-muted"}`} aria-hidden>{index + 1}</span>{label}{step === index + 1 ? <span className="sr-only"> — current</span> : null}</li>)}</ol>
        {attempt.lifecycle === "awaiting_deposit" && !routeFundingAllowed && seconds > 0 ? <p role="status">Do not send another payment. This invoice may already be paid, a transfer may be in progress, or this payment option may be unavailable. We’ll keep checking any funds already sent.</p> : null}
        {attempt.lifecycle === "awaiting_deposit" && routeFundingAllowed && !fundingAllowed && seconds > 0 && attempt.source ? <div className="rounded-2xl border border-line p-4 text-sm">
          <p>This quote uses refund wallet {attempt.refundTo}. Continue only if you control this wallet. It may belong to someone else.</p>
          <label className="mt-3 block">Confirm your full refund wallet<input className="field mt-1" value={refundTo} disabled={busy} onChange={(event) => setRefundTo(event.target.value.trim())} placeholder="0x…" spellCheck={false} /></label>
          <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I control that refund wallet and understand I must send only {attempt.source.symbol} on {attempt.source.name} mainnet using real funds.</span></label>
          <button type="button" className="btn btn-mint mt-3 w-full" disabled={busy || !acknowledged || !/^0x[a-fA-F0-9]{40}$/.test(refundTo)} onClick={() => void resume()}>Confirm refund wallet and resume</button>
        </div> : null}
        {attempt.lifecycle === "awaiting_deposit" && fundingAllowed && seconds > 0 && attempt.quote && attempt.source && attempt.depositAddress ? <>
          <p className="font-semibold">Send only {attempt.source.symbol} on {attempt.source.name} mainnet. Sending another token or network may lose funds. Do not send from an exchange.</p>
          <p role="status">Quote expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}. Refund wallet: {attempt.refundTo}</p>
          {qr ? <img src={qr} alt={`${attempt.source.name} payment QR code`} className="mx-auto h-auto w-full max-w-[256px] rounded-xl" /> : null}
          <DepositCopy label="Payment address" value={attempt.depositAddress} />
          <DepositCopy label={`Exact amount (${attempt.source.symbol})`} value={formatAtomic(attempt.quote.amountIn, attempt.source.decimals)} />
          {attempt.depositMemo ? <DepositCopy label="Required memo — include with your payment" value={attempt.depositMemo} /> : null}
          {attempt.depositMemo ? <p className="text-sm">This payment requires a memo, so a QR code is not available. Send only if your wallet supports the memo. If unsure, get help before paying.</p> : null}
        </> : null}
        {attempt.lifecycle === "awaiting_deposit" && seconds === 0 ? <p>This quote has expired. Do not send. We’re checking whether a transfer is already on its way.</p> : null}
        {!["settled", "refunded", "needs_review", "failed_needs_review", "expired_unfunded"].includes(attempt.lifecycle) ? <label className="block text-sm">Already paid? Add your transaction hash<input className="field mt-1" value={txHash} onChange={(event) => setTxHash(event.target.value.trim())} placeholder="0x…" /><button type="button" className="btn btn-ghost mt-2 w-full" disabled={busy || !/^0x[a-fA-F0-9]{64}$/.test(txHash)} onClick={() => void submit()}>Check transaction</button></label> : null}
        {hint ? <p className="text-xs text-muted" role="status">{hint}</p> : null}
        {attempt.lifecycle === "incomplete" || attempt.lifecycle === "refund_pending" ? <p>The payment is incomplete. A refund may still be processing. Do not send more unless support confirms the next step.</p> : null}
        {attempt.lifecycle === "incomplete" && attempt.depositedAmount && attempt.source ? <p className="text-sm">Transfer amount reported: {formatAtomic(attempt.depositedAmount, attempt.source.decimals)} {attempt.source.symbol}.</p> : null}
        {attempt.lifecycle === "refunded" ? <p>Refund reported{attempt.refundedAmount && attempt.source ? `: ${formatAtomic(attempt.refundedAmount, attempt.source.decimals)} ${attempt.source.symbol}` : ""}. {attempt.refundReason || "Check the wallet you sent from and the transaction record."}</p> : null}
        {attempt.lifecycle === "needs_review" || attempt.lifecycle === "failed_needs_review" ? <p>We couldn’t complete this payment automatically. Contact support before sending again. A failed payment does not confirm that a refund has arrived.</p> : null}
        {attempt.lifecycle === "expired_unfunded" ? <p>This quote expired with no transfer detected. Do not use the old address. We’ll check for late transfers for 24 hours.</p> : null}
        {["expired_unfunded", "refunded"].includes(attempt.lifecycle) ? <button className="btn btn-primary w-full" type="button" disabled={refreshingFailed} onClick={() => { setDismissedId(attempt.id); setAttempt(null); setPreview(null); setAcknowledged(false); setTxHash(""); }}>Get new quote</button> : null}
        {attempt.correlationId ? <p className="break-all text-xs text-muted">Help reference: {attempt.correlationId}</p> : null}
        <p className="break-all text-xs text-muted">Payment reference: {attempt.id}</p>
        <a href="https://aurora.dev/intents-support" className="text-sm underline" target="_blank" rel="noreferrer">Get payment help</a>
      </div> : null}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
    </section>
  );
}
function DepositCopy({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  return <div className="min-w-0"><label className="block text-xs">{label}<input ref={input} className="field mt-1 min-w-0 text-sm" value={value} readOnly onFocus={(event) => event.currentTarget.select()} /></label><button className="btn btn-ghost btn-small mt-1" type="button" onClick={() => { void (async () => { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value); setMessage("Copied"); } catch { input.current?.focus(); input.current?.select(); setMessage("Select and copy manually"); } })(); }}>Copy</button><span className="ml-2 text-xs" role="status">{message}</span></div>;
}
