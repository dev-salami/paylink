import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    emails: [] as Array<{ invoiceId?: string; provider: string; subject: string; to: string }>,
    activities: [] as Array<{ title: string; kind: string; detail?: string }>,
    merchant: { name: "Morrow Quay Studio", city: "Lagos", email: "billing@morrowquay.example" },
  },
}));

vi.mock("./store", () => ({
  getDb: () => mocks.db,
  updateDb: (fn: (db: typeof mocks.db) => void) => fn(mocks.db),
}));

import { deliverEmail, receiptEmail, reminderEmail, resendAlreadyDelivered } from "./mail";

describe("email delivery", () => {
  const previous = process.env.RESEND_API_KEY;
  afterEach(() => {
    mocks.db.emails = [];
    mocks.db.activities = [];
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
    vi.unstubAllGlobals();
  });

  it("does not claim a message was sent when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const result = await deliverEmail(
      { to: "client@example.com", subject: "Receipt PL-1 from Studio", text: "Paid", html: "<p>Paid</p>" },
      "inv_1",
    );
    expect(result.delivered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.db.activities[0]).toMatchObject({ title: "Email not sent", kind: "note" });
    expect(mocks.db.emails).toHaveLength(0);
  });

  it("refuses an invalid recipient and a missing client address", async () => {
    process.env.RESEND_API_KEY = "test-key-not-real";
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const invalid = await deliverEmail({ to: "not-an-email", subject: "Reminder: PL-1 is still open", text: "x", html: "x" }, "inv_1");
    expect(invalid.delivered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(receiptEmail({ id: "r", invoiceId: "inv_1", number: "PL-1", clientName: "Ada", description: "Deposit", amount: "2", currency: "USDC", paidAt: "2026-11-08T00:00:00.000Z", merchantName: "Studio" })).toBeNull();
    expect(reminderEmail({ id: "inv_1", number: "PL-1", clientName: "Ada", description: "Deposit", amount: "2", currency: "USDC", dueDate: "2026-11-15", status: "pending", createdAt: "", updatedAt: "" }, "https://pay.example")).toBeNull();
  });

  it("sends once through Resend to the client address and then dedupes", async () => {
    process.env.RESEND_API_KEY = "test-key-not-real";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const email = {
      to: "client@example.com",
      subject: "Receipt PL-1 from Studio",
      text: "Paid",
      html: "<p>Paid</p>",
    };
    const sent = await deliverEmail(email, "inv_1");
    expect(sent).toMatchObject({ provider: "resend", delivered: true, id: "email_1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1].body));
    expect(body.to).toEqual(["client@example.com"]);
    expect(body).not.toHaveProperty("bcc");
    expect(mocks.db.activities[0]?.kind).toBe("email_sent");
    expect(resendAlreadyDelivered("inv_1", "Receipt ")).toBe(true);
    expect(resendAlreadyDelivered("inv_1", "Reminder:")).toBe(false);
    const again = await deliverEmail(email, "inv_1");
    expect(again).toMatchObject({ delivered: true, id: "already-sent" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("clears a failed send and does not keep the provider body", async () => {
    process.env.RESEND_API_KEY = "test-key-not-real";
    const fetchImpl = vi.fn(async () => new Response("sk_live_secret", { status: 502 }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      deliverEmail({ to: "client@example.com", subject: "Receipt PL-2 from Studio", text: "Paid", html: "<p>Paid</p>" }, "inv_2"),
    ).rejects.toThrow("Resend failed (502). Nothing was sent.");
    expect(mocks.db.emails).toHaveLength(0);
    expect(JSON.stringify(mocks.db.activities)).not.toContain("sk_live_secret");
  });
});
