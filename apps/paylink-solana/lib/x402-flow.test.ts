/**
 * x402 V2 premium-action gate.
 * The facilitator in this file is a labeled stand-in. It is not a Solana
 * settlement, and this test does not submit a transaction or spend devnet USDC.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeX402Attempt, type X402QuoteInput } from "@181hacks/paylink-core";

const mocks = vi.hoisted(() => ({
  invoice: {
    id: "inv_real",
    number: "PL-2026-1100",
    status: "pending" as string,
    clientName: "Ada",
    clientEmail: "ada@example.com",
    description: "Website design deposit",
    amount: "2",
    currency: "USDC",
    dueDate: "2026-11-20",
  },
  issueChallenge: vi.fn(async () => ({
    quote: { id: "q_labeled" },
    header: "labeled-payment-required-not-a-chain-header",
    merchantAccountReady: true,
    steps: [],
    paymentRequired: {
      x402Version: 2,
      resource: { url: "http://localhost/api/x402/pdf?invoice=inv_real" },
      accepts: [{ scheme: "exact", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", amount: "250000", asset: "MintUSDC", payTo: "Merchant" }],
    },
  })),
  acceptPayment: vi.fn(),
}));

vi.mock("@/lib/store", () => ({ getDb: () => ({ invoices: [mocks.invoice] }) }));
vi.mock("@/lib/x402-service", () => ({
  issueChallenge: mocks.issueChallenge,
  acceptPayment: mocks.acceptPayment,
  paymentRequiredResponse: (challenge: { header: string; paymentRequired: { accepts: unknown[] } }) =>
    new Response(JSON.stringify({ x402Version: 2, error: "Payment required", accepts: challenge.paymentRequired.accepts }), {
      status: 402,
      headers: { "PAYMENT-REQUIRED": challenge.header, "Content-Type": "application/json" },
    }),
  toHttpResponse: (result: { status: number; body: unknown }) =>
    new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } }),
}));

import { GET } from "../app/api/x402/[resource]/route";

const now = new Date("2026-11-08T12:00:00.000Z");
const quote: X402QuoteInput = {
  id: "q_pdf",
  resource: "pdf",
  invoiceId: "inv_real",
  amountAtomic: 250_000n,
  asset: "MintUSDC",
  payTo: "Merchant",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  memo: "q_pdf",
  expiresAt: "2026-11-08T12:10:00.000Z",
};
const proof = { proofId: "q_pdf", amountAtomic: 250_000n, asset: "MintUSDC", payTo: "Merchant", memo: "q_pdf" };
const labeledFacilitator = {
  verify: async () => ({ ok: true as const }),
  settle: async () => ({ ok: true as const, signature: "labeled-test-not-onchain" }),
};

async function policy(kind: "valid" | "expired" | "replay" | "mismatch") {
  let deliverCalls = 0;
  let settleCalls = 0;
  const facilitator = {
    verify: labeledFacilitator.verify,
    settle: async () => {
      settleCalls += 1;
      return labeledFacilitator.settle();
    },
  };
  const result = await executeX402Attempt({
    now: kind === "expired" ? new Date("2026-11-08T13:00:00.000Z") : now,
    quote,
    proof: kind === "mismatch" ? { ...proof, amountAtomic: 1n } : proof,
    existing: kind === "replay" ? { proofId: proof.proofId, quoteId: quote.id, signature: "labeled-old", charged: true, delivered: true, pending: false } : undefined,
    facilitator,
    deliver: async () => {
      deliverCalls += 1;
      return { ok: true };
    },
  });
  return { result, deliverCalls, settleCalls };
}

describe("x402 premium actions", () => {
  beforeEach(() => {
    mocks.invoice.status = "pending";
    mocks.issueChallenge.mockClear();
    mocks.acceptPayment.mockReset();
  });

  it("returns HTTP 402 and does not deliver when no payment proof is present", async () => {
    const response = await GET(new Request("http://localhost/api/x402/pdf?invoice=inv_real"), { params: Promise.resolve({ resource: "pdf" }) });
    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-REQUIRED")).toContain("labeled-payment-required");
    const body = await response.json();
    expect(body.x402Version).toBe(2);
    expect(body.delivered).toBeUndefined();
    expect(mocks.acceptPayment).not.toHaveBeenCalled();
    expect(mocks.issueChallenge).toHaveBeenCalledOnce();
  });

  it("grants the action only after a labeled valid proof, and rejects expired, replayed, and mismatched proofs", async () => {
    const valid = await policy("valid");
    expect(valid.result.httpStatus).toBe(200);
    expect(valid.result.delivered).toBe(true);
    expect(valid.result.signature).toBe("labeled-test-not-onchain");
    expect(valid.deliverCalls).toBe(1);
    expect(valid.settleCalls).toBe(1);

    const expired = await policy("expired");
    expect(expired.result.code).toBe("expired_quote");
    expect(expired.result.delivered).toBe(false);
    expect(expired.settleCalls).toBe(0);
    expect(expired.deliverCalls).toBe(0);

    const replay = await policy("replay");
    expect(replay.result.code).toBe("replayed_proof");
    expect(replay.result.httpStatus).toBe(409);
    expect(replay.settleCalls).toBe(0);
    expect(replay.deliverCalls).toBe(0);

    const mismatch = await policy("mismatch");
    expect(mismatch.result.code).toBe("underpaid");
    expect(mismatch.result.delivered).toBe(false);
    expect(mismatch.deliverCalls).toBe(0);

    mocks.acceptPayment.mockImplementation(async (input: { paymentSignature: string }) => {
      const ran = await policy(input.paymentSignature as "valid" | "expired" | "replay" | "mismatch");
      return { status: ran.result.httpStatus, contentType: "application/json", body: { code: ran.result.code, delivered: ran.result.delivered, charged: ran.result.charged }, headers: {}, result: ran.result };
    });
    const paid = await GET(new Request("http://localhost/api/x402/pdf?invoice=inv_real", { headers: { "payment-signature": "valid" } }), { params: Promise.resolve({ resource: "pdf" }) });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ delivered: true });
    const rejected = await GET(new Request("http://localhost/api/x402/pdf?invoice=inv_real", { headers: { "payment-signature": "replay" } }), { params: Promise.resolve({ resource: "pdf" }) });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "replayed_proof", charged: false });
    expect(mocks.issueChallenge).not.toHaveBeenCalled();
  });

  it("does not grant a reminder for an invoice that cannot be reminded, and does not price an unknown action", async () => {
    mocks.invoice.status = "paid";
    const refused = await GET(new Request("http://localhost/api/x402/reminder?invoice=inv_real"), { params: Promise.resolve({ resource: "reminder" }) });
    expect(refused.status).toBe(409);
    expect(mocks.issueChallenge).not.toHaveBeenCalled();
    expect(mocks.acceptPayment).not.toHaveBeenCalled();
    const unknown = await GET(new Request("http://localhost/api/x402/wire"), { params: Promise.resolve({ resource: "wire" }) });
    expect(unknown.status).toBe(404);
  });
});
