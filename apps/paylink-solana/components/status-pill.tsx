import type { InvoiceStatus } from "@181hacks/paylink-core";
import { invoiceStatusCopy } from "../lib/product-copy";


export function StatusPill({ status, live = false }: { status: InvoiceStatus; live?: boolean }) {
  return (
    <span className={`pill ${status} ${live && status === "pending" ? "live" : ""}`}>
      <i />
      {invoiceStatusCopy[status]}
    </span>
  );
}
