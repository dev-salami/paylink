import { beforeEach, describe, expect, it, vi } from "vitest";
import { merchantInvoices } from "./books";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), rename: vi.fn(), attach: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: mocks.read, writeFileSync: mocks.write, mkdirSync: mocks.mkdir, renameSync: mocks.rename }));
vi.mock("./solana", () => ({ attachSamplePayments: mocks.attach }));
vi.mock("./env", () => ({ merchantProfile: () => ({ name: "Mock studio", city: "Lagos" }), defaultBudget: () => ({ total: "5", perCall: "0.5", approveAbove: "0.1" }) }));
beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("fresh workspace startup — mocked filesystem only", () => {
  it("starts empty without seeding, creating wallet keys or writing a file", async () => {
    mocks.read.mockImplementation(() => { throw Object.assign(new Error("Missing store"), { code: "ENOENT" }); });
    const { getDb } = await import("./store");
    const db = getDb();
    expect(db.invoices).toEqual([]); expect(db.receipts).toEqual([]); expect(db.activities).toEqual([]);
    expect(getDb()).toBe(db); expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.attach).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.mkdir).not.toHaveBeenCalled();
  });
  it("preserves old seeded:false records and hides fixtures by filtering, never by a data migration", async () => {
    const old = { version: 1, seeded: false, invoices: [{ id: "legacy-example", sample: true }, { id: "merchant-invoice" }], activities: [{ id: "example-event", sample: true }], crossChainAttempts: [], settlementClaims: [] };
    mocks.read.mockReturnValue(JSON.stringify(old));
    const { getDb } = await import("./store");
    const db = getDb();
    expect(db).toEqual(old);
    expect(merchantInvoices(db.invoices).map((invoice) => invoice.id)).toEqual(["merchant-invoice"]);
    expect(db.invoices).toHaveLength(2); expect(db.seeded).toBe(false);
    expect(mocks.attach).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.rename).not.toHaveBeenCalled();
  });
});
