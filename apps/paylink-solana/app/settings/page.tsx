import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { modelConfigured } from "@/lib/env";
import { getDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();
  return (
    <Shell {...shellData()}>
      <p className="t-micro text-muted">Workspace</p>
      <h1 className="t-h1">Settings</h1>
      <section className="card mt-6 max-w-xl p-5">
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Studio</dt>
            <dd className="font-semibold">{db.merchant.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">City</dt>
            <dd className="font-semibold">{db.merchant.city}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Invoice assistant</dt>
            <dd className="font-semibold">{modelConfigured() ? "AI assistant" : "Invoice commands"}</dd>
          </div>
        </dl>
        <a className="btn btn-primary mt-6" href="/wallet">
          Edit the agent budget
        </a>
      </section>
    </Shell>
  );
}
