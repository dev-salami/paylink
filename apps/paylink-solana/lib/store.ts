import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import {
  budgetView,
  policyFromDecimals,
  type ActivityEvent,
  type BudgetPolicy,
  type BudgetView,
  type EmailRecord,
  type Invoice,
  type MerchantProfile,
  type Receipt,
  type SpendEntry,
  type StoredQuote,
  type StoredSettlement,
} from "@181hacks/paylink-core";
import { sumAgentSpend } from "./books";
import { defaultBudget, merchantProfile } from "./env";
import { attachSamplePayments } from "./solana";
import type { SolanaInvoice, SolanaReceipt } from "./receipt-types";
import type { CrossChainAttempt, SettlementClaim } from "./settlement/types";

export interface Database {
  version: 1;
  merchant: MerchantProfile;
  invoices: SolanaInvoice[];
  receipts: SolanaReceipt[];
  crossChainAttempts: CrossChainAttempt[];
  settlementClaims: SettlementClaim[];
  activities: ActivityEvent[];
  budget: { total: string; perCall: string; approveAbove: string };
  spends: SpendEntry[];
  quotes: StoredQuote[];
  settlements: StoredSettlement[];
  emails: EmailRecord[];
  sequence: number;
  seeded: boolean;
}

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "store.json");

let memory: Database | null = null;

function emptyDb(): Database {
  return {
    version: 1,
    merchant: merchantProfile(),
    invoices: [],
    receipts: [],
    crossChainAttempts: [],
    settlementClaims: [],
    activities: [],
    budget: defaultBudget(),
    spends: [],
    quotes: [],
    settlements: [],
    emails: [],
    sequence: 1040,
    seeded: true,
  };
}

function readFromDisk(): Database {
  try {
    const parsed = JSON.parse(readFileSync(dbPath, "utf8")) as Database;
    if (parsed.version !== 1) return emptyDb();
    parsed.crossChainAttempts ??= [];
    parsed.settlementClaims ??= [];
    return parsed;
  } catch {
    return emptyDb();
  }
}

function writeToDisk(db: Database): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${dbPath}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(`${dbPath}.tmp`, dbPath);
}

export function getDb(): Database {
  if (!memory) {
    memory = readFromDisk();
    // Startup reads never seed or rewrite existing records, or create wallet
    // keys for legacy examples. The legacy reset helper remains opt-in only.
  }
  return memory;
}

export function updateDb<T>(mutate: (db: Database) => T): T {
  const db = getDb();
  const result = mutate(db);
  memory = db;
  writeToDisk(db);
  return result;
}

export function resetDb(): Database {
  memory = seed(emptyDb());
  attachSamplePayments(memory);
  writeToDisk(memory);
  return memory;
}

export function budgetPolicy(db: Database = getDb()): BudgetPolicy {
  return policyFromDecimals(db.budget);
}

export function spentAtomic(db: Database = getDb()): bigint {
  return sumAgentSpend(db.spends);
}

export function currentBudgetView(db: Database = getDb()): BudgetView {
  return budgetView(budgetPolicy(db), spentAtomic(db));
}

function seed(db: Database): Database {
  const now = new Date();
  const day = (offset: number) => {
    const date = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  };
  const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * 60 * 60 * 1000).toISOString();

  const paid: Invoice = {
    id: "inv_sample_harbour",
    number: "PL-2026-1038",
    clientName: "Harbour & Co",
    clientEmail: "accounts@harbour.example",
    description: "Brand identity and website design",
    amount: "420",
    currency: "USDC",
    dueDate: day(-12),
    status: "paid",
    paidAt: at(-240),
    amountReceived: "420",
    receiptId: "rcp_sample_harbour",
    sample: true,
    createdAt: at(-400),
    updatedAt: at(-240),
  };
  const pending: Invoice = {
    id: "inv_sample_northwind",
    number: "PL-2026-1039",
    clientName: "Northwind",
    clientEmail: "studio@northwind.example",
    description: "Product packaging illustration",
    amount: "220",
    currency: "USDC",
    dueDate: day(6),
    status: "pending",
    sample: true,
    createdAt: at(-30),
    updatedAt: at(-30),
  };
  const underpaid: Invoice = {
    id: "inv_sample_mina",
    number: "PL-2026-1036",
    clientName: "Studio Mina",
    clientEmail: "mina@studio.example",
    description: "24 custom interface icons",
    amount: "90",
    currency: "USDC",
    dueDate: day(2),
    status: "underpaid",
    amountReceived: "40",
    paymentIssue: "underpaid",
    paymentIssueDetail: "40 USDC arrived. 50 USDC is still outstanding.",
    sample: true,
    createdAt: at(-80),
    updatedAt: at(-6),
  };
  const expired: Invoice = {
    id: "inv_sample_kola",
    number: "PL-2026-1031",
    clientName: "Kola Adeyemi",
    clientEmail: "kola@adeyemi.example",
    description: "Campaign poster design",
    amount: "60",
    currency: "USDC",
    dueDate: day(-4),
    status: "expired",
    sample: true,
    createdAt: at(-200),
    updatedAt: at(-4),
  };

  db.invoices = [pending, underpaid, paid, expired];
  db.receipts = [
    {
      id: "rcp_sample_harbour",
      invoiceId: paid.id,
      number: paid.number,
      clientName: paid.clientName,
      clientEmail: paid.clientEmail,
      description: paid.description,
      amount: paid.amount,
      currency: "USDC",
      paidAt: paid.paidAt ?? at(-240),
      merchantName: db.merchant.name,
      sample: true,
    },
  ];
  db.activities = [
    {
      id: "act_seed_paid",
      at: paid.paidAt ?? at(-240),
      kind: "receipt_issued",
      title: "Receipt for Harbour & Co",
      detail: "Brand identity and website design · Solana devnet record.",
      invoiceId: paid.id,
      href: "/receipts/rcp_sample_harbour",
      sample: true,
    },
    {
      id: "act_seed_pending",
      at: pending.createdAt,
      kind: "invoice_created",
      title: "Invoice issued to Northwind",
      detail: "220 USDC for product packaging illustration.",
      invoiceId: pending.id,
      href: "/invoices/inv_sample_northwind",
      sample: true,
    },
    {
      id: "act_seed_under",
      at: underpaid.updatedAt,
      kind: "status_changed",
      title: "Partial payment from Studio Mina",
      detail: "40 of 90 USDC. The invoice stays open.",
      invoiceId: underpaid.id,
      sample: true,
    },
  ];
  db.sequence = 1040;
  db.seeded = true;
  db.merchant = merchantProfile();
  return db;
}
