import { describe, expect, it } from "vitest";
import type { SettlementInvoice } from "./settlement/types";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT } from "./settlement/types";
import { AGENT_SPEND_MEANING, mainnetInvoices, merchantFigures, merchantInvoices, sumAgentSpend } from "./books";

const now = new Date("2026-11-08T12:00:00.000Z");

function invoice(overrides: Partial<SettlementInvoice>): SettlementInvoice {
  return {
    id: "inv_real",
    number: "PL-2026-1100",
    clientName: "Ada",
    description: "Website design deposit",
    amount: "2",
    currency: "USDC",
    dueDate: "2026-11-15",
    status: "pending",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    settlement: { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "mock-merchant", amountAtomic: "2000000", feePolicy: "payer_pays_exact_output" },
    ...overrides,
  };
}

describe("merchant books", () => {
  it("excludes development fixtures from totals and keeps real invoices", () => {
    const figures = merchantFigures(
      [
        invoice({ id: "inv_real", amount: "2.5", status: "paid", paidAt: "2026-11-08T01:00:00.000Z" }),
        invoice({ id: "inv_open", amount: "0.000001", status: "pending" }),
        invoice({ id: "inv_sample", amount: "420", status: "paid", paidAt: "2026-11-08T01:00:00.000Z", sample: true }),
      ],
      now,
    );
    expect(figures.receivedThisMonth).toBe("2.5");
    expect(figures.collected).toBe("2.5");
    expect(figures.outstanding).toBe("0.000001");
    expect(figures.realCount).toBe(2);
    expect(figures.fixtureCount).toBe(1);
  });

  it("excludes devnet and unknown networks from mainnet financials but keeps those invoices in the list", () => {
    const records = [
      invoice({ id: "mainnet", status: "paid", amount: "2", amountReceived: "2.000001", paidAt: "2026-11-08T01:00:00Z" }),
      invoice({ id: "devnet", settlement: { mode: "demo" }, status: "paid", amount: "999", paidAt: "2026-11-08T01:00:00Z" }),
      invoice({ id: "legacy", settlement: undefined, status: "paid", amount: "888", paidAt: "2026-11-08T01:00:00Z" }),
      invoice({ id: "fixture", sample: true, status: "paid", amount: "777", paidAt: "2026-11-08T01:00:00Z" }),
      invoice({ id: "devnet-open", settlement: { mode: "demo" }, amount: "50" }),
    ];
    const before = JSON.stringify(records);
    const figures = merchantFigures(records, now);
    expect(figures.receivedThisMonth).toBe("2.000001"); expect(figures.collected).toBe("2.000001");
    expect(figures.paidCount).toBe(1); expect(figures.outstanding).toBe("0"); expect(figures.realCount).toBe(4);
    expect(mainnetInvoices(records).map((record) => record.id)).toEqual(["mainnet"]);
    expect(merchantInvoices(records).map((record) => record.id)).toEqual(["mainnet", "devnet", "legacy", "devnet-open"]);
    expect(JSON.stringify(records)).toBe(before);
  });

  it("keeps monthly collections inside the calendar month", () => {
    const records = [
      invoice({ status: "paid", amountReceived: "2", paidAt: "2026-11-08T01:00:00Z" }),
      invoice({ status: "paid", amountReceived: "3", paidAt: "2026-10-15T01:00:00Z" }),
      invoice({ status: "paid", amountReceived: "4", paidAt: "2026-12-15T01:00:00Z" }),
    ];
    expect(merchantFigures(records, now).receivedThisMonth).toBe("2");
    expect(merchantFigures(records, now).collected).toBe("9");
  });

  it("describes assistant spend as the devnet x402 log, not client revenue", () => {
    expect(AGENT_SPEND_MEANING).toMatch(/not money received from clients/);
    expect(
      sumAgentSpend([
        { amount: "0.25", status: "settled" },
        { amount: "0.05", status: "delivery_failed" },
        { amount: "1", status: "rejected" },
        { amount: "1", status: "pending_chain" },
        { amount: "9", status: "settled", sample: true },
      ]),
    ).toBe(300_000n);
  });
});
