import Link from "next/link";
import { notFound } from "next/navigation";
import { Money } from "@/components/keel";
import { PaidSeal } from "@/components/paid-seal";
import { ThemeToggle } from "@/components/theme-toggle";
import { UsdcChip } from "@/components/usdc-chip";
import { shortKey } from "@/lib/env";
import { getDb } from "@/lib/store";
import { originExplorer } from "@/lib/aurora/assets";
import { resolveReceiptAmounts } from "@/lib/receipt-amounts";
import { ReceiptAmounts } from "@/components/receipt-amounts";
import { clientLabel, displayClientName } from "@/lib/client-name";

export const dynamic = "force-dynamic";

function formatWhen(date: Date) {
  return {
    day: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }),
    time: `${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT`,
  };
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const receipt = db.receipts.find((item) => item.id === id);
  if (!receipt) notFound();
  const crossChain = resolveReceiptAmounts(receipt.invoiceId, receipt.crossChain, db.crossChainAttempts);
  const clientName = displayClientName(receipt.clientName);
  const when = formatWhen(new Date(receipt.paidAt));
  const initials = receipt.merchantName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-bg px-3 pb-10 pt-3 sm:px-5 sm:pt-5">
      <header className="mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-2xl bg-paper p-1.5 pl-2">
        <Link href="/" className="flex items-center gap-2">
          <span className="k-logo h-9 w-9 text-sm">{initials || "P"}</span>
          <span className="text-[0.95rem]">{receipt.merchantName}</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <span className="hidden rounded-xl bg-elev px-3 py-2 text-xs text-muted sm:inline">Receipt {receipt.number}</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto mt-3 grid max-w-4xl items-start gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
        <article className="paper p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="eyebrow">Payment received</span>
              <h1 className="mt-3 text-[1.6rem] leading-tight">
                {clientName ? <>Thanks, <span className="bold">{clientName}</span></> : "Payment received"}
              </h1>
              <p className="t-small mt-1 text-muted">{receipt.merchantName} · Invoice paid{receipt.crossChain ? " in full." : " on Solana devnet. No monetary value."}</p>
              {crossChain ? <ReceiptAmounts receipt={crossChain} /> : null}
            </div>
            <PaidSeal />
          </div>

          <p className="t-micro mt-10 text-muted">Invoice amount</p>
          <p className="num mt-2 flex flex-wrap items-baseline gap-x-3 text-[clamp(3.4rem,13vw,5.25rem)]">
            <Money value={receipt.amount} prefix="$" />
            <span className="self-center"><UsdcChip /></span>
          </p>

          <dl className="mt-10 divide-y divide-line rounded-2xl bg-elev px-4 text-sm">
            <Line label="Paid by" value={clientLabel(receipt.clientName)} />
            <Line label="For" value={receipt.description} />
            <Line label="Invoice" value={receipt.number} />
            <Line label="Date" value={when.day} />
            <Line label="Time" value={when.time} />
          </dl>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#181C25] px-4 py-3 text-[#f4f5f7]">
            <span className="text-sm text-[#9a9ea8]">Total</span>
            <span className="num text-2xl"><Money value={receipt.amount} prefix="$" /> <span className="text-sm text-[#9a9ea8]">USDC</span></span>
          </div>
        </article>

        <aside className="grid gap-3">
          <section className="card-dark relative overflow-hidden p-6">
            <img src="/art/armillary-dark.webp" alt="" aria-hidden className="mix-blend-lighten [mask-image:radial-gradient(closest-side,#000_70%,transparent)] pointer-events-none absolute -right-16 -top-10 w-56 opacity-60" />
            <div className="relative">
              <span className="eyebrow text-[#9a9ea8]">Payment record</span>
              <p className="mt-4 text-2xl leading-tight">
                Settled on <span className="bold">Solana</span>
              </p>
              <dl className="mt-6 grid gap-3 text-sm">
                <Proof label="Network" value={receipt.crossChain ? "Solana mainnet" : "Solana devnet"} />
                <Proof label="Token" value="USDC" />
                <Proof label="Transaction" value={receipt.txSignature ? shortKey(receipt.txSignature, 6) : receipt.sample ? "Not available" : "Recorded"} mono />
              </dl>
              {receipt.explorerUrl ? (
                <a className="btn btn-mint mt-6 w-full" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                  View on Solana Explorer ↗
                </a>
              ) : (
                <p className="mt-6 rounded-xl bg-[#222733] px-3 py-2.5 text-sm text-[#9a9ea8]">
                  {receipt.sample ? "Preview receipt. No payment was processed." : "Payment recorded."}
                </p>
              )}
              {receipt.crossChain?.originTxHash && originExplorer(receipt.crossChain.sourceChain, receipt.crossChain.originTxHash) ? <a className="btn btn-ghost mt-3 w-full text-ink" href={originExplorer(receipt.crossChain.sourceChain, receipt.crossChain.originTxHash)} target="_blank" rel="noreferrer">View source transaction ↗</a> : null}
            </div>
          </section>
          <section className="card p-5">
            <p className="t-micro text-muted">Keep this page</p>
            <p className="t-small mt-2 text-muted">
              Save this link for your records. Use the transaction link, when available, to check the payment on Solana.
            </p>
            {!receipt.sample ? (
              <a className="btn btn-mint mt-4 w-full" href={`/api/receipts/${encodeURIComponent(receipt.id)}/pdf?download=1`} download>
                Download PDF
              </a>
            ) : null}
          </section>
        </aside>
      </main>
      <p className="mt-6 text-center t-micro text-muted">{receipt.crossChain ? "PayLink · Solana mainnet" : "PayLink · Solana devnet · No monetary value"}</p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Proof({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#313744] pb-3">
      <dt className="text-[#9a9ea8]">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}
