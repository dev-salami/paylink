import { getDb } from "@/lib/store";
import { merchantInvoices } from "@/lib/books";
import { clientActivityCopy } from "@/lib/client-name";

export interface ShellAlert {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  at: string;
  href?: string;
  approval?: { resource: "pdf" | "reminder"; invoiceId: string; amount: string };
}

export function shellData() {
  const db = getDb();
  const real = merchantInvoices(db.invoices);
  const open = real.filter((invoice) => invoice.status === "pending" || invoice.status === "underpaid");
  const alerts: ShellAlert[] = db.activities
    .filter((event) => !event.sample)
    .slice(0, 6)
    .map((event) => ({ id: event.id, kind: event.kind, title: clientActivityCopy(event.title), detail: event.detail ? clientActivityCopy(event.detail) : event.detail, at: event.at, href: event.href ?? event.explorerUrl }));
  return {
    openCount: open.length,
    merchantName: db.merchant.name,
    payHref: open[0] ? `/pay/${open[0].id}` : "/dashboard",
    alerts,
  };
}
