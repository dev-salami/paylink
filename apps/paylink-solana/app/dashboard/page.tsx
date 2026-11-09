import Link from "next/link";
import { formatUsdc, type Invoice, type InvoiceStatus } from "@181hacks/paylink-core";
import { EmptyState } from "@/components/empty-state";
import { LiveLedger } from "@/components/live-ledger";
import { BarStrip, Delta, Money, type Bar } from "@/components/keel";
import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { StatusPill } from "@/components/status-pill";
import { InvoiceMode } from "@/components/invoice-mode";
import { PayerLinkActions } from "@/components/payer-link-actions";
import { isInvoiceListView } from "@/lib/navigation";
import { AGENT_SPEND_MEANING, mainnetInvoices, merchantFigures, merchantInvoices } from "@/lib/books";
import { clientLabel } from "@/lib/client-name";
import { currentBudgetView, getDb } from "@/lib/store";
import { invoiceStatusCopy } from "@/lib/product-copy";

export const dynamic = "force-dynamic";

const filters: Array<InvoiceStatus | "all"> = ["all", "pending", "paid", "underpaid", "expired", "draft"];
const DAYS = 48;

function dailyBars(invoices: Invoice[]): Bar[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bars: Bar[] = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const start = today.getTime() - i * 86400000;
    const end = start + 86400000;
    const inDay = (iso?: string) => (iso ? new Date(iso).getTime() >= start && new Date(iso).getTime() < end : false);
    const paid = invoices.filter((inv) => inv.status === "paid" && inDay(inv.paidAt)).reduce((t, inv) => t + Number(inv.amountReceived || inv.amount), 0);
    const billed = invoices.filter((inv) => inDay(inv.createdAt)).reduce((t, inv) => t + Number(inv.amount), 0);
    bars.push({ value: paid || billed, on: paid > 0 });
  }
  // label the two biggest days
  [...bars]
    .map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => bar.value > 0)
    .sort((a, b) => b.bar.value - a.bar.value)
    .slice(0, 2)
    .forEach(({ bar }) => {
      bar.label = { top: formatUsdc(bar.value.toFixed(2)), sub: bar.on ? "Received" : "Billed" };
    });
  return bars;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string }> }) {
  const params = await searchParams;
  const status = filters.includes(params.status as InvoiceStatus) ? (params.status as InvoiceStatus | "all") : "all";
  const query = (params.q ?? "").trim().toLowerCase();
  const listOnly = isInvoiceListView(params);
  const db = getDb();
  const real = merchantInvoices(db.invoices);
  const matches = (invoice: Invoice) => {
    if (status !== "all" && invoice.status !== status) return false;
    if (!query) return true;
    return [invoice.clientName, invoice.number, invoice.description].join(" ").toLowerCase().includes(query);
  };
  const rows = real.filter(matches);
  const figures = merchantFigures(db.invoices);
  const budget = currentBudgetView();
  const bars = dailyBars(mainnetInvoices(db.invoices));
  const hasCollections = bars.some((bar) => bar.value > 0);

  return (
    <Shell {...shellData()}>
      <LiveLedger />
      {listOnly ? null : (
        <>
          <section className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="text-2xl">USDC received this month · mainnet</p>
              <p className="big-num mt-1">
                <Money value={figures.receivedThisMonth} />
              </p>
              <p className="mt-2 max-w-xl text-sm text-muted">Solana mainnet payments only. Devnet and unclassified networks are excluded from monetary totals.</p>
            </div>
            <Link href="/chat" className="btn btn-primary mb-3 w-fit px-5">
              + New invoice
            </Link>
          </section>

          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile value={<Money value={figures.outstanding} />} label="Outstanding USDC · mainnet" delta={<Delta tone="flat">{figures.openCount} open</Delta>} />
            <Tile value={<Money value={figures.collected} />} label="Collected USDC · mainnet" delta={<Delta tone="flat">{figures.paidCount} paid</Delta>} />
            <Tile value={<Money value={figures.overdue} />} label="Overdue USDC · mainnet" delta={<Delta tone={figures.overdueCount > 0 ? "down" : "flat"}>{figures.overdueCount}</Delta>} />
            <Tile value={<Money value={budget.spent} />} label="Assistant spent · devnet" delta={<Delta tone="flat">of {budget.total} cap</Delta>} />
          </section>
          <p className="mt-3 max-w-3xl text-sm text-muted">{AGENT_SPEND_MEANING} {figures.draftCount > 0 ? `${figures.draftCount} draft${figures.draftCount === 1 ? "" : "s"} ${figures.draftCount === 1 ? "is" : "are"} saved and not counted as outstanding.` : ""}</p>

          <section className="mt-3 grid gap-3 lg:grid-cols-[1.7fr_1fr]">
            <article className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl">Mainnet collections, last {DAYS} days</h2>
                  <p className="t-small text-muted">Solana mainnet only. Green: payments received. Grey: invoiced.</p>
                </div>
                <span className="pill">Payment history</span>
              </div>
              <div className="mt-6">
                {hasCollections ? <BarStrip bars={bars} /> : <p className="text-sm text-muted">No payments or invoices recorded in the last {DAYS} days.</p>}
              </div>
              {hasCollections ? (
                <div className="mt-3 flex justify-between text-xs text-muted">
                  <span>{DAYS} days ago</span>
                  <span>Today</span>
                </div>
              ) : null}
            </article>
            <article className="card flex flex-col p-6">
              <p className="t-micro text-muted">Assistant wallet</p>
              <p className="mt-2 text-4xl tabular-nums"><Money value={budget.spent} /></p>
              <p className="text-sm text-muted">USDC spent of {budget.total} devnet cap</p>
              <p className="mt-4 text-sm text-muted">Per call {budget.perCall} · approve above {budget.approveAbove}. Devnet USDC has no monetary value.</p>
              <Link href="/wallet" className="btn btn-primary btn-small mt-4 w-fit">Spend controls</Link>
            </article>
          </section>
        </>
      )}

      <section className="card mt-3 p-2 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
          <h2 className="text-xl">{listOnly ? "Invoices" : "Open invoices · latest"}</h2>
          <div className="k-seg flex-wrap">
            {filters.map((filter) => (
              <Link
                key={filter}
                href={filter === "all" ? "/dashboard?view=invoices" : `/dashboard?status=${filter}`}
                className={`rounded-[9px] px-3 py-1.5 text-xs capitalize ${status === filter && listOnly ? "bg-paper text-ink" : "text-muted"}`}
                aria-current={status === filter ? "page" : undefined}
              >
                {filter === "all" ? "All" : invoiceStatusCopy[filter]}
              </Link>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-3">
            <EmptyState
              title={figures.realCount === 0 ? "No invoices yet" : "No invoices found"}
              body={figures.realCount === 0 ? "Create your first invoice to start tracking payments." : "Change the filter, or create an invoice."}
              href="/chat"
              action="Create an invoice"
            />
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="ledger min-w-[640px]">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>For</th>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(listOnly ? rows : rows.slice(0, 6)).map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="min-w-[240px] align-top">
                      <Link href={`/invoices/${invoice.id}`}>{clientLabel(invoice.clientName)}</Link>
                      <span className="mt-0.5 block text-xs text-muted">
                        {invoice.number}
                      </span>
                      <div className="mt-3">
                        <PayerLinkActions id={invoice.id} status={invoice.status} label={invoice.number} />
                      </div>
                    </td>
                    <td className="text-muted">{invoice.description}</td>
                    <td className="text-muted">{invoice.dueDate}</td>
                    <td className="tabular-nums">
                      <Money value={invoice.amount} />
                    </td>
                    <td>
                      <StatusPill status={invoice.status} live={invoice.status === "pending"} />
                      <span className="mt-1 block"><InvoiceMode invoice={invoice} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}

function Tile({ value, label, delta }: { value: React.ReactNode; label: string; delta: React.ReactNode }) {
  return (
    <article className="card flex items-start justify-between gap-3 p-5">
      <div>
        <p className="text-3xl tabular-nums">{value}</p>
        <p className="mt-2 text-sm text-muted">{label}</p>
      </div>
      {delta}
    </article>
  );
}
