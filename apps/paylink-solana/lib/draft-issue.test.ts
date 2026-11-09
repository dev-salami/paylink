import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(async () => ({ reference: "ref", url: "solana:labeled-test", recipient: "Merchant", asset: "mint", network: "solana:devnet" })),
  db: {
    merchant: { name: "Morrow Quay Studio", city: "Lagos", email: "billing@morrowquay.example" },
    invoices: [] as Array<Record<string, unknown>>,
    activities: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("./solana", () => ({ createSolanaProvider: () => ({ id: "solana", createRequest: mocks.createRequest, check: vi.fn() }) }));
vi.mock("./store", () => ({
  getDb: () => mocks.db,
  updateDb: (fn: (db: typeof mocks.db) => unknown) => fn(mocks.db),
}));
vi.mock("./mail", () => ({ deliverEmail: vi.fn(), receiptEmail: vi.fn(), resendAlreadyDelivered: () => false }));
vi.mock("./qr", () => ({ qrDataUrl: vi.fn() }));

import { publishDraft } from "./invoices";

describe("issuing a draft", () => {
  beforeEach(() => {
    mocks.createRequest.mockClear();
    mocks.db.invoices = [];
    mocks.db.activities = [];
  });

  it("issues a devnet draft once and does not send email", async () => {
    mocks.db.invoices.push({ id: "inv_draft", clientName: "Ada", description: "Deposit", amount: "2", status: "draft", settlement: { mode: "demo" } });
    const issued = await publishDraft("inv_draft");
    expect(issued.status).toBe("pending");
    expect(issued.payment).toMatchObject({ reference: "ref" });
    expect(mocks.createRequest).toHaveBeenCalledOnce();
    expect(mocks.db.activities).toHaveLength(1);
    expect(String(mocks.db.activities[0]?.detail)).toContain("No email was sent");
    const again = await publishDraft("inv_draft");
    expect(again.status).toBe("pending");
    expect(mocks.db.activities).toHaveLength(1);
    expect(mocks.createRequest).toHaveBeenCalledOnce();
  });

  it("does not build a devnet payment request for a mainnet draft", async () => {
    mocks.db.invoices.push({
      id: "inv_live",
      clientName: "Ada",
      description: "Deposit",
      amount: "2",
      status: "draft",
      settlement: { mode: "live", recipient: "Wallet" },
    });
    const issued = await publishDraft("inv_live");
    expect(issued.status).toBe("pending");
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("refuses a development fixture", async () => {
    mocks.db.invoices.push({ id: "inv_sample", status: "draft", sample: true, settlement: { mode: "demo" } });
    await expect(publishDraft("inv_sample")).rejects.toThrow(/fixtures/i);
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });
});
