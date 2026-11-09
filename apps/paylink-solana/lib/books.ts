import { addAtomic, fromAtomic, toAtomic, type Invoice, type SpendEntry } from "@181hacks/paylink-core";
import type { SettlementInvoice } from "./settlement/types";

/**
 * Assistant spend is the devnet USDC the agent wallet has paid for x402
 * reminders and branded PDFs. It is the sum of spend-log rows that are not
 * rejected, not development fixtures, and not still waiting on chain
 * (`pending_chain`). Settled and delivery-failed rows count, because those
 * were charged. It is not client revenue and it is not mainnet settlement.
 */
export const AGENT_SPEND_MEANING =
  "Devnet USDC spent on reminders and branded PDFs, excluding rejected and unconfirmed payments. Devnet USDC has no monetary value. It is not money received from clients.";

export function isDevelopmentFixture(record: { sample?: boolean } | null | undefined): boolean {
  return record?.sample === true;
}

export function merchantInvoices<T extends { sample?: boolean }>(invoices: T[]): T[] {
  return invoices.filter((invoice) => !isDevelopmentFixture(invoice));
}

/** Unknown/legacy networks are not assumed to be mainnet. Never alters records. */
export function mainnetInvoices(invoices: SettlementInvoice[]): SettlementInvoice[] {
  return merchantInvoices(invoices).filter((invoice) => invoice.settlement?.mode === "live" && invoice.settlement.network === "solana-mainnet");
}

export function sumAgentSpend(spends: Array<Pick<SpendEntry, "status" | "sample" | "amount">>): bigint {
  return spends.reduce((sum, spend) => {
    if (spend.status === "rejected" || spend.sample || spend.status === "pending_chain") return sum;
    return addAtomic(sum, toAtomic(spend.amount));
  }, 0n);
}

function atomicAmount(amount: string): bigint | null {
  try {
    return toAtomic(amount);
  } catch {
    return null;
  }
}

export interface MerchantFigures {
  receivedThisMonth: string;
  outstanding: string;
  collected: string;
  overdue: string;
  openCount: number;
  paidCount: number;
  overdueCount: number;
  draftCount: number;
  realCount: number;
  fixtureCount: number;
  unreadable: number;
}

/** Monetary figures are mainnet-only. The list count still includes devnet invoices. */
export function merchantFigures(invoices: SettlementInvoice[], now = new Date()): MerchantFigures {
  const real = merchantInvoices(invoices);
  const mainnet = mainnetInvoices(invoices);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  let unreadable = 0;
  const sum = (rows: Invoice[], when?: (invoice: Invoice) => boolean) =>
    rows.reduce((total, invoice) => {
      if (when && !when(invoice)) return total;
      const atomic = atomicAmount(invoice.amount);
      if (atomic === null) {
        unreadable += 1;
        return total;
      }
      return addAtomic(total, atomic);
    }, 0n);

  const open = mainnet.filter((invoice) => invoice.status === "pending" || invoice.status === "underpaid");
  const paid = mainnet.filter((invoice) => invoice.status === "paid").map((invoice) => ({ ...invoice, amount: invoice.amountReceived || invoice.amount }));
  return {
    receivedThisMonth: fromAtomic(
      sum(paid, (invoice) => Boolean(invoice.paidAt) && new Date(invoice.paidAt!) >= monthStart && new Date(invoice.paidAt!) < monthEnd),
    ),
    outstanding: fromAtomic(sum(open)),
    collected: fromAtomic(sum(paid)),
    overdue: fromAtomic(sum(mainnet, (invoice) => invoice.status === "expired")),
    openCount: open.length,
    paidCount: paid.length,
    overdueCount: mainnet.filter((invoice) => invoice.status === "expired").length,
    draftCount: real.filter((invoice) => invoice.status === "draft").length,
    realCount: real.length,
    fixtureCount: invoices.length - real.length,
    unreadable,
  };
}
