import { evaluateAgentSpend, executeX402Attempt, policyFromDecimals, toAtomic, X402_FAILURES, FAILURE_COPY, type X402FailureCode } from "@181hacks/paylink-core";

const now = new Date("2026-11-06T12:00:00.000Z");
const quote = {
  id: "q_lab",
  resource: "pdf" as const,
  invoiceId: "inv_lab",
  amountAtomic: 250_000n,
  asset: "MintUSDC",
  payTo: "Merchant",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  memo: "q_lab",
  expiresAt: "2026-11-06T12:10:00.000Z",
};
const proof = {
  proofId: "q_lab",
  amountAtomic: 250_000n,
  asset: "MintUSDC",
  payTo: "Merchant",
  memo: "q_lab",
};

export async function runFailureCase(code: X402FailureCode) {
  if (code === "insufficient_budget" || code === "over_cap") {
    const policy = policyFromDecimals({ total: "5", perCall: "0.5", approveAbove: "0.1" });
    const decision = evaluateAgentSpend(
      policy,
      code === "insufficient_budget" ? toAtomic("4.9") : 0n,
      code === "over_cap" ? toAtomic("0.75") : toAtomic("0.25"),
      true,
    );
    return {
      code,
      title: FAILURE_COPY[code].title,
      summary: FAILURE_COPY[code].summary,
      charged: false,
      detail: decision.detail,
      steps: [
        {
          phase: "policy" as const,
          ok: false,
          code,
          title: FAILURE_COPY[code].title,
          detail: decision.detail,
        },
      ],
    };
  }

  const common = { now, quote, proof };
  const okFacilitator = {
    verify: async () => ({ ok: true }),
    settle: async () => ({ ok: true, signature: "lab-signature" }),
  };

  const result = await (async () => {
    if (code === "price_mismatch") {
      return executeX402Attempt({ ...common, proof: { ...proof, amountAtomic: 900_000n } });
    }
    if (code === "underpaid") {
      return executeX402Attempt({ ...common, observed: { amountAtomic: 100_000n, asset: quote.asset } });
    }
    if (code === "wrong_mint") {
      return executeX402Attempt({ ...common, proof: { ...proof, asset: "WrongMint" } });
    }
    if (code === "replayed_proof") {
      return executeX402Attempt({
        ...common,
        existing: { proofId: proof.proofId, quoteId: quote.id, signature: "sig-old", charged: true, delivered: true, pending: false },
        facilitator: okFacilitator,
      });
    }
    if (code === "expired_quote") {
      return executeX402Attempt({ ...common, now: new Date("2026-11-06T13:00:00.000Z") });
    }
    if (code === "facilitator_down") {
      return executeX402Attempt({
        ...common,
        facilitator: {
          verify: async () => ({ ok: false, down: true, reason: "fetch failed: facilitator unreachable" }),
          settle: async () => ({ ok: true, signature: "should-not-settle" }),
        },
      });
    }
    return executeX402Attempt({
      ...common,
      facilitator: okFacilitator,
      deliver: async () => ({ ok: false, error: "PDF renderer crashed after the transfer landed." }),
    });
  })();

  return {
    code,
    title: FAILURE_COPY[code].title,
    summary: FAILURE_COPY[code].summary,
    charged: result.charged,
    delivered: result.delivered,
    pending: result.pending,
    signature: result.signature,
    retriedSameProof: result.retriedSameProof,
    httpStatus: result.httpStatus,
    detail: result.steps.at(-1)?.detail ?? FAILURE_COPY[code].summary,
    steps: result.steps,
  };
}

export async function runAllFailureCases() {
  const cases = [];
  for (const code of X402_FAILURES) cases.push(await runFailureCase(code));
  return cases;
}
