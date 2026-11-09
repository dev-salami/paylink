import { describe, expect, it } from "vitest";
import { executeX402Attempt, mapFacilitatorReason, type X402QuoteInput } from "./x402";

const now = new Date("2026-11-06T12:00:00.000Z");

const quote: X402QuoteInput = {
  id: "q_pdf",
  resource: "pdf",
  invoiceId: "inv_ada",
  amountAtomic: 250_000n,
  asset: "MintUSDC",
  payTo: "Merchant",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  memo: "q_pdf",
  expiresAt: "2026-11-06T12:02:00.000Z",
};

const proof = {
  proofId: "q_pdf",
  amountAtomic: 250_000n,
  asset: "MintUSDC",
  payTo: "Merchant",
  memo: "q_pdf",
};

describe("executeX402Attempt", () => {
  it("returns 402 when the client has not paid", async () => {
    const result = await executeX402Attempt({ now, quote });
    expect(result.httpStatus).toBe(402);
    expect(result.charged).toBe(false);
    expect(result.steps[0]?.body).toMatchObject({ x402Version: 2 });
  });

  it("rejects an expired quote before calling the facilitator", async () => {
    let calls = 0;
    const result = await executeX402Attempt({
      now: new Date("2026-11-06T12:03:00.000Z"),
      quote,
      proof,
      facilitator: {
        verify: async () => {
          calls += 1;
          return { ok: true };
        },
        settle: async () => {
          calls += 1;
          return { ok: true, signature: "sig" };
        },
      },
    });
    expect(result.code).toBe("expired_quote");
    expect(calls).toBe(0);
    expect(result.charged).toBe(false);
  });

  it("rejects a price mismatch and an underpaid declaration", async () => {
    const mismatch = await executeX402Attempt({
      now,
      quote,
      proof: { ...proof, amountAtomic: 500_000n },
    });
    expect(mismatch.code).toBe("price_mismatch");
    const short = await executeX402Attempt({
      now,
      quote,
      proof: { ...proof, amountAtomic: 100_000n },
    });
    expect(short.code).toBe("underpaid");
    expect(short.charged).toBe(false);
  });

  it("rejects the wrong mint", async () => {
    const result = await executeX402Attempt({
      now,
      quote,
      proof: { ...proof, asset: "SomeOtherMint" },
    });
    expect(result.code).toBe("wrong_mint");
  });

  it("rejects a replay after delivery and does not settle again", async () => {
    let settlements = 0;
    const result = await executeX402Attempt({
      now,
      quote,
      proof,
      existing: {
        proofId: proof.proofId,
        quoteId: quote.id,
        signature: "sig1",
        charged: true,
        delivered: true,
        pending: false,
      },
      facilitator: {
        verify: async () => ({ ok: true }),
        settle: async () => {
          settlements += 1;
          return { ok: true, signature: "sig2" };
        },
      },
    });
    expect(result.code).toBe("replayed_proof");
    expect(result.httpStatus).toBe(409);
    expect(settlements).toBe(0);
    expect(result.charged).toBe(false);
    expect(result.signature).toBe("sig1");
  });

  it("fails closed when the facilitator is down and does not charge", async () => {
    const result = await executeX402Attempt({
      now,
      quote,
      proof,
      facilitator: {
        verify: async () => ({ ok: false, down: true, reason: "fetch failed" }),
        settle: async () => ({ ok: true, signature: "should-not-happen" }),
      },
    });
    expect(result.code).toBe("facilitator_down");
    expect(result.charged).toBe(false);
    expect(result.signature).toBeUndefined();
  });

  it("keeps a pending signature and does not charge twice when confirmation is unknown", async () => {
    const first = await executeX402Attempt({
      now,
      quote,
      proof,
      facilitator: {
        verify: async () => ({ ok: true }),
        settle: async () => ({ ok: false, pending: true, signature: "sig-pending" }),
      },
    });
    expect(first.pending).toBe(true);
    expect(first.charged).toBe(false);
    expect(first.signature).toBe("sig-pending");

    let settleCalls = 0;
    const retry = await executeX402Attempt({
      now,
      quote,
      proof,
      existing: first.settlement,
      facilitator: {
        verify: async () => ({ ok: true }),
        settle: async () => {
          settleCalls += 1;
          return { ok: true, signature: "sig-pending" };
        },
      },
      deliver: async () => ({ ok: true }),
    });
    expect(retry.httpStatus).toBe(200);
    expect(retry.signature).toBe("sig-pending");
    expect(retry.retriedSameProof).toBe(true);
    expect(settleCalls).toBe(1);
    expect(retry.charged).toBe(true);
  });

  it("delivers on retry with the same proof after a paid delivery failure", async () => {
    let settlements = 0;
    const paid = await executeX402Attempt({
      now,
      quote,
      proof,
      facilitator: {
        verify: async () => ({ ok: true }),
        settle: async () => {
          settlements += 1;
          return { ok: true, signature: "sig-paid" };
        },
      },
      deliver: async () => ({ ok: false, error: "mailer timeout" }),
    });
    expect(paid.code).toBe("paid_delivery_failed");
    expect(paid.charged).toBe(true);
    expect(paid.delivered).toBe(false);

    const retry = await executeX402Attempt({
      now,
      quote,
      proof,
      existing: paid.settlement,
      facilitator: {
        verify: async () => ({ ok: true }),
        settle: async () => {
          settlements += 1;
          return { ok: true, signature: "sig-second" };
        },
      },
      deliver: async () => ({ ok: true }),
    });
    expect(retry.httpStatus).toBe(200);
    expect(retry.delivered).toBe(true);
    expect(retry.signature).toBe("sig-paid");
    expect(settlements).toBe(1);
  });

  it("maps facilitator reasons onto the failure table", () => {
    expect(mapFacilitatorReason("amount too low")).toBe("underpaid");
    expect(mapFacilitatorReason("mint mismatch")).toBe("wrong_mint");
    expect(mapFacilitatorReason("blockhash expired")).toBe("expired_quote");
    expect(mapFacilitatorReason("duplicate settlement")).toBe("replayed_proof");
    expect(mapFacilitatorReason("invalid_exact_svm_recipient_ata_missing")).toBe("facilitator_down");
    expect(mapFacilitatorReason("ATA missing")).toBe("facilitator_down");
  });
});
