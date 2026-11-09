import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { LabPanel } from "@/components/lab-panel";
import { runAllFailureCases } from "@/lib/lab";
import { getDb } from "@/lib/store";
import { isDevelopmentFixture } from "@/lib/books";
import { clientActivityCopy } from "@/lib/client-name";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const cases = await runAllFailureCases();
  const events = getDb().activities.filter((event) => !isDevelopmentFixture(event));
  return (
    <Shell {...shellData()}>
      <div className="mb-6 flex items-center justify-between gap-6">
        <div>
        <p className="t-micro text-muted">Payments and documents</p>
        <h1 className="t-h1">Activity</h1>
        <p className="t-body mt-2 max-w-2xl text-muted">
          Invoice updates and devnet payments for reminders and documents.
        </p>
        </div>
        <img src="/art/statue-coin.webp" alt="" className="art-light hidden w-32 sm:block dark:sm:hidden" />
      </div>
      <section className="card mb-8 p-5">
        {events.length === 0 ? (
          <EmptyState title="No activity yet" body="Invoice updates, reminders and document requests appear here." href="/chat" action="Create an invoice" />
        ) : (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="grid gap-1 border-b border-line pb-4 last:border-0 sm:grid-cols-[160px_1fr]">
                <time className="text-xs uppercase tracking-[0.14em] text-muted">{new Date(event.at).toUTCString().slice(0, 22)}</time>
                <div>
                  <p>{clientActivityCopy(event.title)}</p>
                  {event.detail ? <p className="text-sm text-muted">{clientActivityCopy(event.detail)}</p> : null}
                  {event.explorerUrl ? (
                    <a className="text-sm underline" href={event.explorerUrl}>
                      Transaction
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="mb-3">
        <h2 className="t-h2">Reference checks</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">These cases explain how a paid request is refused. They do not move funds, record a payment, or change assistant spend.</p>
      </section>
      <LabPanel initial={cases} />
    </Shell>
  );
}
