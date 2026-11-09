import Link from "next/link";
import { notFound } from "next/navigation";
import { formatLongDate, formatUsdc } from "@181hacks/paylink-core";
import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { StatusPill } from "@/components/status-pill";
import { InvoiceMode } from "@/components/invoice-mode";
import { UsdcChip } from "@/components/usdc-chip";
import { LiveInvoice } from "@/components/live-invoice";
import { ShareLink } from "@/components/share-link";
import { PayerLinkActions } from "@/components/payer-link-actions";
import { IssueDraftButton } from "@/components/issue-draft";
import { Delta, Money } from "@/components/keel";
import { shortKey } from "@/lib/env";
import { readStoredPdf } from "@/lib/pdf";
import { getDb } from "@/lib/store";
import { friendlyInvoiceIssue } from "@/lib/rpc-errors";
import { clientActivityCopy, clientLabel } from "@/lib/client-name";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const invoice = db.invoices.find((item) => item.id === id);
  if (!invoice) notFound();
  const paidAmount = invoice.status === "paid" ? invoice.amount : invoice.amountReceived || "0";
  const events = [
    { title: "Invoice created", at: invoice.createdAt, detail: invoice.number },
    ...db.activities
      .filter((event) => event.invoiceId === invoice.id)
      .map((event) => ({ title: clientActivityCopy(event.title), at: event.at, detail: clientActivityCopy(event.detail || "") })),
  ].slice(0, 6);

  const outstanding = Math.max(0, Number(invoice.amount) - Number(paidAmount));
  const progress = Math.min(1, Number(paidAmount) / Math.max(Number(invoice.amount), 0.000001));
  const pdfReady = Boolean(readStoredPdf(invoice.id));
  const pdfHref = pdfReady
    ? `/api/invoices/${invoice.id}/pdf`
    : `/chat?prompt=${encodeURIComponent(`make a branded PDF for ${invoice.number}`)}`;
  const reminderHref = `/chat?prompt=${encodeURIComponent(`send ${invoice.number} a reminder`)}`;

  return (
    <Shell {...shellData()}>
      <LiveInvoice initial={invoice} />
      <p className="t-small text-muted">
        <Link href="/dashboard?view=invoices" className="hover:text-ink">Invoices</Link>
        <span> / </span>
        <span className="text-ink">{invoice.number}</span>
      </p>

      <section className="mt-3 grid items-end gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl">Invoice {invoice.number}</p>
            <StatusPill status={invoice.status} live={invoice.status === "pending"} />
            <InvoiceMode invoice={invoice} />
          </div>
          <p className="big-num mt-1">
            <Money value={invoice.amount} prefix="$" />
          </p>
          <p className="t-small mt-1 text-muted">
            {clientLabel(invoice.clientName)} · {invoice.status === "draft" ? "Saved" : "Issued"} {formatLongDate(invoice.createdAt.slice(0, 10))} · Due {formatLongDate(invoice.dueDate)}
          </p>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {pdfReady ? (
            <a className="btn btn-ghost btn-small" href={pdfHref}>
              Download PDF
            </a>
          ) : (
            <Link className="btn btn-ghost btn-small" href={pdfHref}>
              Branded PDF
            </Link>
          )}
          {invoice.status === "draft" && !invoice.sample ? <IssueDraftButton id={invoice.id} /> : null}
          {invoice.status !== "draft" && invoice.status !== "paid" && !invoice.sample ? (
            <Link className="btn btn-ghost btn-small" href={reminderHref}>
              Send reminder
            </Link>
          ) : null}
          <PayerLinkActions id={invoice.id} status={invoice.status} label={invoice.number} />
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile value={<Money value={paidAmount} prefix="$" />} label="Paid" delta={<Delta tone={invoice.status === "paid" ? "up" : "flat"}>{Math.round(progress * 100)}%</Delta>} />
        <Tile value={<Money value={outstanding} prefix="$" />} label="Outstanding" delta={<Delta tone={outstanding > 0 && invoice.status === "expired" ? "down" : "flat"}>{outstanding > 0 ? "open" : "settled"}</Delta>} />
        <Tile value={shortDate(invoice.dueDate)} label="Due date" delta={<Delta tone={invoice.status === "expired" ? "down" : "flat"}>{invoice.status === "expired" ? "late" : "on time"}</Delta>} />
        <Tile value={clientLabel(invoice.clientName)} label={invoice.clientEmail || "No email yet"} delta={<Delta tone="flat">client</Delta>} />
      </section>

      <div className="mt-3 grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <section className="card min-w-0 p-2 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
            <h2 className="text-xl">Line items</h2>
            <span className="pill">USDC · {invoice.settlement?.mode === "live" ? "Solana mainnet" : "Solana devnet"}</span>
          </div>
          <div className="mt-2 grid gap-4 px-3 py-4 sm:grid-cols-2">
            <div>
              <p className="t-micro text-muted">Bill to</p>
              <p className="mt-1 text-lg">{clientLabel(invoice.clientName)}</p>
              <p className="t-small text-muted">{invoice.clientEmail || "Email not added"}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="t-micro text-muted">Number</dt>
                <dd className="mt-1">{invoice.number}</dd>
              </div>
              <div>
                <dt className="t-micro text-muted">Issued</dt>
                <dd className="mt-1">{formatLongDate(invoice.createdAt.slice(0, 10))}</dd>
              </div>
              <div>
                <dt className="t-micro text-muted">Due</dt>
                <dd className="mt-1">{formatLongDate(invoice.dueDate)}</dd>
              </div>
              <div>
                <dt className="t-micro text-muted">Currency</dt>
                <dd className="mt-1"><UsdcChip /></dd>
              </div>
            </dl>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-paper">
            <table className="ledger min-w-[520px]">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{invoice.description}</td>
                  <td className="text-muted">1</td>
                  <td className="text-muted"><Money value={invoice.amount} prefix="$" /></td>
                  <td className="text-right"><Money value={invoice.amount} prefix="$" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="ml-auto mt-3 max-w-sm px-1 pb-1 text-sm">
            <div className="flex justify-between px-3 py-1.5 text-muted">
              <span>Subtotal</span>
              <Money value={invoice.amount} prefix="$" />
            </div>
            <div className="flex justify-between px-3 py-1.5 text-muted">
              <span>Network fee</span>
              <span>Paid by sender</span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#181C25] px-4 py-3 text-[#f4f5f7]">
              <span className="text-[#9a9ea8]">Total due</span>
              <span className="num text-2xl"><Money value={invoice.amount} prefix="$" /> <span className="text-sm text-[#9a9ea8]">USDC</span></span>
            </div>
          </div>
        </section>

        <div className="grid gap-3">
          <section className="card-dark p-6">
            <p className="text-sm text-[#9a9ea8]">Collected</p>
            <p className="mt-2 text-5xl">
              {Math.round(progress * 100)}
              <span className="text-[#6b6f78]">%</span>
            </p>
            <p className="text-sm text-[#9a9ea8]">of {formatUsdc(invoice.amount)} USDC</p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#313744]">
              <div className="h-full rounded-full bg-[#71FC8F]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <dl className="mt-6 grid gap-3 text-sm">
              <Info label="Method" value={invoice.settlement?.mode === "live" ? "Aurora Intents" : "Solana Pay"} />
              <Info label="Network" value={invoice.settlement?.mode === "live" ? "Solana mainnet" : "Solana devnet · no monetary value"} />
              <Info label="Wallet" value={invoice.settlement?.mode === "live" ? shortKey(invoice.settlement.recipient, 4) : invoice.payment ? shortKey(invoice.payment.recipient, 4) : "Not issued"} />
            </dl>
            {invoice.explorerUrl ? (
              <a className="btn btn-mint btn-small mt-5" href={invoice.explorerUrl} target="_blank" rel="noreferrer">
                View on Solana Explorer ↗
              </a>
            ) : invoice.status !== "draft" ? (
              <ShareLink id={invoice.id} className="btn btn-mint btn-small mt-5" />
            ) : null}
            {invoice.paymentIssueDetail ? <p className="mt-3 text-sm text-[#ff9b9e]">{friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail)}</p> : null}
          </section>
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl">Activity</h2>
              <Link href="/activity" className="text-sm text-muted">All ↗</Link>
            </div>
            <ol className="timeline mt-4">
              {events.map((event) => (
                <li key={`${event.title}-${event.at}`} className="pb-4">
                  <i />
                  <div>
                    <p>{event.title}</p>
                    <p className="t-small text-muted">{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {invoice.status === "paid" ? (
        <p className="mt-3 flex items-center gap-3 rounded-2xl bg-paper px-4 py-3 text-sm">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#71FC8F] text-[#0b1a10]" aria-hidden>✓</span>
          Payment recorded on Solana. Your receipt is available.
        </p>
      ) : null}
    </Shell>
  );
}

function Tile({ value, label, delta }: { value: React.ReactNode; label: string; delta: React.ReactNode }) {
  return (
    <article className="card flex min-w-0 flex-col-reverse gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div className="min-w-0">
        <p className="truncate text-2xl sm:text-3xl">{value}</p>
        <p className="mt-2 truncate text-sm text-muted">{label}</p>
      </div>
      <span className="shrink-0 self-start whitespace-nowrap">{delta}</span>
    </article>
  );
}

function shortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#313744] pb-3">
      <dt className="text-[#9a9ea8]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
