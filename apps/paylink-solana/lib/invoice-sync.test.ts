import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@181hacks/paylink-core";
import { DEVNET_BUSY } from "./rpc-errors";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, type SettlementInvoice } from "./settlement/types";

const mocks = vi.hoisted(() => ({ check: vi.fn(), db: { merchant: { name: "Studio", city: "Lagos" }, invoices: [] as Invoice[], activities: [] as unknown[], receipts: [] as unknown[] } }));
vi.mock("./solana", () => ({ createSolanaProvider: () => ({ check: mocks.check }) }));
vi.mock("./store", () => ({ getDb: () => mocks.db, updateDb: (fn: (db: typeof mocks.db) => unknown) => fn(mocks.db) }));
vi.mock("./mail", () => ({ deliverEmail: vi.fn(async () => undefined), receiptEmail: vi.fn(), resendAlreadyDelivered: () => false }));
vi.mock("./qr", () => ({ qrDataUrl: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  mocks.check.mockReset();
  mocks.db.activities = [];
  mocks.db.receipts = [];
  mocks.db.invoices = [{
    id: "inv_test", number: "PL-1041", clientName: "Ada", description: "Logo", amount: "10", currency: "USDC", dueDate: "2026-12-01", status: "pending",
    createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z",
    payment: { provider: "solana", reference: "reference", recipient: "merchant", asset: "mint", network: "solana:devnet", url: "solana:merchant" },
  }];
});

describe("single-flight invoice synchronization", () => {
  it("never lets the devnet provider settle a live mainnet invoice", async () => {
    (mocks.db.invoices[0] as SettlementInvoice).settlement = { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant", amountAtomic: "10000000", feePolicy: "payer_pays_exact_output" };
    mocks.check.mockResolvedValue({ status: "paid" });
    const { syncInvoice } = await import("./invoices");
    expect((await syncInvoice("inv_test"))?.status).toBe("pending");
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("persists fee payer metadata on both invoice and receipt when confirmed, without another RPC lookup", async () => {
    mocks.check.mockResolvedValue({ status: "paid", signature: "4".repeat(88), amountReceived: "10", payerWallet: "confirmed-fee-payer" });
    const { syncInvoice } = await import("./invoices");
    const invoice = await syncInvoice("inv_test");
    expect((invoice as Invoice & { payerWallet?: string }).payerWallet).toBe("confirmed-fee-payer");
    expect((mocks.db.receipts[0] as { payerWallet?: string }).payerWallet).toBe("confirmed-fee-payer");
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
  it("collapses concurrent checks and stores friendly text instead of raw 429 details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.check.mockResolvedValue({ status: "pending", issue: "rpc_down", message: "429 Too many requests https://rpc.example.test/private-key" });
    const { syncInvoice } = await import("./invoices");
    const results = await Promise.all([syncInvoice("inv_test"), syncInvoice("inv_test"), syncInvoice("inv_test")]);
    await syncInvoice("inv_test");
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(results[0]?.paymentIssueDetail).toBe(DEVNET_BUSY);
    expect(mocks.db.invoices[0]?.paymentIssueDetail).not.toMatch(/429|https:|private-key/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-key");
    warn.mockRestore();
  });
  it("skips paid, draft and sample invoices without RPC checks", async () => {
    const { syncInvoice } = await import("./invoices");
    for (const status of ["paid", "draft"] as const) {
      mocks.db.invoices[0]!.status = status;
      await syncInvoice("inv_test");
    }
    mocks.db.invoices[0]!.status = "pending";
    mocks.db.invoices[0]!.sample = true;
    await syncInvoice("inv_test");
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
