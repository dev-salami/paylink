import type { Invoice } from "@181hacks/paylink-core";
import type { SettlementInvoice } from "../lib/settlement/types";

export function InvoiceMode({ invoice }: { invoice: Invoice }) {
  return <span className="pill">{(invoice as SettlementInvoice).settlement?.mode === "live" ? "Solana mainnet" : "Solana devnet · no monetary value"}</span>;
}
