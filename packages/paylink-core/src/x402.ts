import { fromAtomic } from "./money";
import type { PaidResource } from "./types";

export const X402_FAILURES = [
  "insufficient_budget",
  "over_cap",
  "price_mismatch",
  "underpaid",
  "wrong_mint",
  "replayed_proof",
  "expired_quote",
  "facilitator_down",
  "paid_delivery_failed",
] as const;

export type X402FailureCode = (typeof X402_FAILURES)[number];

export type X402TracePhase = "request" | "policy" | "verify" | "settle" | "deliver";

export interface X402TraceStep {
  phase: X402TracePhase;
  ok: boolean;
  title: string;
  detail: string;
  httpStatus?: number;
  code?: X402FailureCode | "needs_approval" | "pending_settlement";
  body?: unknown;
}

export interface X402QuoteInput {
  id: string;
  resource: PaidResource;
  invoiceId?: string;
  amountAtomic: bigint;
  asset: string;
  payTo: string;
  network: string;
  memo: string;
  expiresAt: string;
}

export interface X402ProofInput {
  proofId: string;
  amountAtomic: bigint;
  asset: string;
  payTo: string;
  memo?: string;
}

export interface X402SettlementState {
  proofId: string;
  quoteId: string;
  signature?: string;
  charged: boolean;
  delivered: boolean;
  pending: boolean;
  deliveryError?: string;
}

export interface FacilitatorPort {
  verify(): Promise<{ ok: boolean; down?: boolean; reason?: string }>;
  settle(): Promise<{
    ok: boolean;
    down?: boolean;
    pending?: boolean;
    signature?: string;
    reason?: string;
  }>;
}

export interface X402ExecutionInput {
  now: Date;
  quote: X402QuoteInput;
  proof?: X402ProofInput;
  existing?: X402SettlementState;
  /** On-chain observation. Omit when the facilitator has not looked yet. */
  observed?: { amountAtomic?: bigint; asset?: string; recipient?: string };
  facilitator?: FacilitatorPort;
  deliver?: () => Promise<{ ok: boolean; error?: string }>;
}

export interface X402ExecutionResult {
  httpStatus: number;
  code?: X402FailureCode;
  charged: boolean;
  delivered: boolean;
  signature?: string;
  pending: boolean;
  settlement?: X402SettlementState;
  steps: X402TraceStep[];
  /** True when the same proof was presented again and no second transfer was made. */
  retriedSameProof: boolean;
}

function quoteExpired(quote: X402QuoteInput, now: Date): boolean {
  return new Date(quote.expiresAt).getTime() <= now.getTime();
}

function baseSettlement(quote: X402QuoteInput, proofId: string): X402SettlementState {
  return {
    proofId,
    quoteId: quote.id,
    charged: false,
    delivered: false,
    pending: false,
  };
}

/**
 * Run one x402 attempt.
 * Budget caps are applied by {@link evaluateAgentSpend} before the wallet signs.
 * This function is the resource-server gate: price, mint, expiry, replay,
 * facilitator failure, and delivery retry.
 */
export async function executeX402Attempt(input: X402ExecutionInput): Promise<X402ExecutionResult> {
  const steps: X402TraceStep[] = [];
  const { quote, proof, existing } = input;

  if (!proof) {
    steps.push({
      phase: "request",
      ok: false,
      httpStatus: 402,
      title: "402 Payment Required",
      detail: `${quote.resource} costs ${fromAtomic(quote.amountAtomic)} USDC on ${quote.network}. Retry with a PAYMENT-SIGNATURE header.`,
      body: {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: quote.network,
            amount: quote.amountAtomic.toString(),
            asset: quote.asset,
            payTo: quote.payTo,
            extra: { memo: quote.memo },
          },
        ],
      },
    });
    return {
      httpStatus: 402,
      charged: false,
      delivered: false,
      pending: false,
      retriedSameProof: false,
      steps,
    };
  }

  steps.push({
    phase: "request",
    ok: true,
    httpStatus: 402,
    title: "Client retried with PAYMENT-SIGNATURE",
    detail: `Proof ${proof.proofId} offers ${fromAtomic(proof.amountAtomic)} of ${proof.asset}.`,
  });

  if (quoteExpired(quote, input.now)) {
    steps.push({
      phase: "policy",
      ok: false,
      code: "expired_quote",
      httpStatus: 402,
      title: "Quote expired",
      detail: "The payment requirements are past maxTimeoutSeconds. Ask for a fresh 402. Nothing was settled.",
    });
    return fail("expired_quote", 402, steps, false);
  }

  if (proof.amountAtomic !== quote.amountAtomic) {
    const under = proof.amountAtomic < quote.amountAtomic;
    const code: X402FailureCode = under ? "underpaid" : "price_mismatch";
    steps.push({
      phase: "policy",
      ok: false,
      code,
      httpStatus: 402,
      title: under ? "Underpaid" : "Price mismatch",
      detail: `The quote requires ${quote.amountAtomic.toString()} base units. The proof declares ${proof.amountAtomic.toString()}.`,
    });
    return fail(code, 402, steps, false);
  }

  if (proof.asset !== quote.asset) {
    steps.push({
      phase: "policy",
      ok: false,
      code: "wrong_mint",
      httpStatus: 402,
      title: "Wrong mint",
      detail: `Expected asset ${quote.asset}. The proof names ${proof.asset}.`,
    });
    return fail("wrong_mint", 402, steps, false);
  }

  if (proof.payTo !== quote.payTo || (proof.memo && proof.memo !== quote.memo)) {
    steps.push({
      phase: "policy",
      ok: false,
      code: "price_mismatch",
      httpStatus: 402,
      title: "Requirements do not match the quote",
      detail: "Recipient or memo does not match the 402 challenge. Settlement was refused.",
    });
    return fail("price_mismatch", 402, steps, false);
  }

  if (input.observed?.asset && input.observed.asset !== quote.asset) {
    steps.push({
      phase: "verify",
      ok: false,
      code: "wrong_mint",
      httpStatus: 402,
      title: "On-chain mint mismatch",
      detail: "The transfer's mint is not the asset in the payment requirements.",
    });
    return fail("wrong_mint", 402, steps, false);
  }

  if (input.observed?.amountAtomic !== undefined && input.observed.amountAtomic < quote.amountAtomic) {
    steps.push({
      phase: "verify",
      ok: false,
      code: "underpaid",
      httpStatus: 402,
      title: "On-chain amount is short",
      detail: `Observed ${input.observed.amountAtomic.toString()} base units, need ${quote.amountAtomic.toString()}.`,
    });
    return fail("underpaid", 402, steps, false);
  }

  if (input.observed?.recipient && input.observed.recipient !== quote.payTo) {
    steps.push({
      phase: "verify",
      ok: false,
      code: "price_mismatch",
      httpStatus: 402,
      title: "Recipient mismatch",
      detail: "The transfer destination is not the merchant account in the quote.",
    });
    return fail("price_mismatch", 402, steps, false);
  }

  if (existing?.delivered && existing.proofId === proof.proofId) {
    steps.push({
      phase: "policy",
      ok: false,
      code: "replayed_proof",
      httpStatus: 409,
      title: "Replayed proof",
      detail: "This proof already paid for and delivered the resource. A second settle was not attempted.",
    });
    return {
      httpStatus: 409,
      code: "replayed_proof",
      charged: false,
      delivered: true,
      pending: false,
      signature: existing.signature,
      settlement: existing,
      retriedSameProof: true,
      steps,
    };
  }

  if (existing && existing.charged && !existing.delivered && existing.proofId === proof.proofId) {
    steps.push({
      phase: "settle",
      ok: true,
      code: "paid_delivery_failed",
      title: "Already settled",
      detail: existing.signature
        ? `Reusing signature ${existing.signature}. No second transfer.`
        : "The previous attempt already charged this proof. No second transfer.",
    });
    return deliverOnly(input, existing, steps);
  }

  if (existing?.pending && existing.signature && existing.proofId === proof.proofId) {
    steps.push({
      phase: "settle",
      ok: true,
      code: "pending_settlement",
      title: "Reconcile the broadcast transaction",
      detail: `Confirmation was unknown for ${existing.signature}. The retry looks up that signature instead of paying again.`,
    });
    const reconciled: X402SettlementState = { ...existing, pending: false, charged: true };
    if (!input.facilitator) {
      return deliverOnly(input, reconciled, steps);
    }
    const settle = await input.facilitator.settle();
    if (settle.down || settle.pending) {
      steps.push({
        phase: "settle",
        ok: false,
        code: "facilitator_down",
        httpStatus: 503,
        title: "Facilitator still unavailable",
        detail: "The original signature is kept. Budget was not charged a second time.",
      });
      return {
        httpStatus: 503,
        code: "facilitator_down",
        charged: false,
        delivered: false,
        pending: true,
        signature: existing.signature,
        settlement: existing,
        retriedSameProof: true,
        steps,
      };
    }
    if (!settle.ok && !settle.signature) {
      const code = mapFacilitatorReason(settle.reason);
      steps.push({
        phase: "settle",
        ok: false,
        code,
        httpStatus: 402,
        title: "Retry could not confirm the original transaction",
        detail: settle.reason ?? "Settlement did not confirm. The stored signature was not replaced.",
      });
      return {
        httpStatus: 402,
        code,
        charged: false,
        delivered: false,
        pending: true,
        signature: existing.signature,
        settlement: existing,
        retriedSameProof: true,
        steps,
      };
    }
    reconciled.signature = settle.signature ?? existing.signature;
    return deliverOnly(input, reconciled, steps);
  }

  if (!input.facilitator) {
    steps.push({
      phase: "verify",
      ok: false,
      code: "facilitator_down",
      httpStatus: 503,
      title: "No facilitator",
      detail: "Verification could not run. Fail closed: nothing was charged.",
    });
    return fail("facilitator_down", 503, steps, false);
  }

  let verified: { ok: boolean; down?: boolean; reason?: string };
  try {
    verified = await input.facilitator.verify();
  } catch (error) {
    verified = { ok: false, down: true, reason: error instanceof Error ? error.message : "verify threw" };
  }

  if (verified.down || !verified.ok && isTransportFailure(verified.reason)) {
    steps.push({
      phase: "verify",
      ok: false,
      code: "facilitator_down",
      httpStatus: 503,
      title: "Facilitator or RPC unavailable",
      detail: verified.reason ?? "Verify failed closed before any transaction was signed by the fee payer.",
    });
    return fail("facilitator_down", 503, steps, false);
  }

  if (!verified.ok) {
    const code = mapFacilitatorReason(verified.reason);
    steps.push({
      phase: "verify",
      ok: false,
      code,
      httpStatus: 402,
      title: "Facilitator rejected the payment",
      detail: explainFacilitatorReason(verified.reason) ?? code,
    });
    return fail(code, 402, steps, false);
  }

  steps.push({
    phase: "verify",
    ok: true,
    title: "Verified",
    detail: "Amount, mint, recipient, memo, and expiry checks passed. The proof has not been replayed.",
  });

  let settled: { ok: boolean; down?: boolean; pending?: boolean; signature?: string; reason?: string };
  try {
    settled = await input.facilitator.settle();
  } catch (error) {
    settled = { ok: false, down: true, reason: error instanceof Error ? error.message : "settle threw" };
  }

  if (settled.pending && settled.signature) {
    const settlement: X402SettlementState = {
      ...baseSettlement(quote, proof.proofId),
      signature: settled.signature,
      pending: true,
      charged: false,
    };
    steps.push({
      phase: "settle",
      ok: false,
      code: "pending_settlement",
      httpStatus: 503,
      title: "Broadcast, confirmation unknown",
      detail: `Signature ${settled.signature} may already be on-chain. It is stored so a retry cannot pay twice. The resource was not delivered.`,
    });
    return {
      httpStatus: 503,
      code: "facilitator_down",
      charged: false,
      delivered: false,
      pending: true,
      signature: settled.signature,
      settlement,
      retriedSameProof: false,
      steps,
    };
  }

  if (settled.down || (!settled.ok && isTransportFailure(settled.reason))) {
    steps.push({
      phase: "settle",
      ok: false,
      code: "facilitator_down",
      httpStatus: 503,
      title: "Settle did not broadcast",
      detail: settled.reason ?? "The facilitator was unreachable before broadcast. The agent wallet was not charged.",
    });
    return fail("facilitator_down", 503, steps, false);
  }

  if (!settled.ok || !settled.signature) {
    const code = mapFacilitatorReason(settled.reason);
    steps.push({
      phase: "settle",
      ok: false,
      code,
      httpStatus: 402,
      title: "Settlement failed",
      detail: settled.reason ?? "The facilitator refused to settle.",
    });
    return fail(code, 402, steps, false);
  }

  const settlement: X402SettlementState = {
    ...baseSettlement(quote, proof.proofId),
    signature: settled.signature,
    charged: true,
  };
  steps.push({
    phase: "settle",
    ok: true,
    title: "Settled on Solana",
    detail: `Transaction ${settled.signature}.`,
  });
  return deliverOnly(input, settlement, steps);
}

async function deliverOnly(
  input: X402ExecutionInput,
  settlement: X402SettlementState,
  steps: X402TraceStep[],
): Promise<X402ExecutionResult> {
  const retriedSameProof = Boolean(input.existing && input.existing.proofId === settlement.proofId);
  if (!input.deliver) {
    steps.push({
      phase: "deliver",
      ok: false,
      code: "paid_delivery_failed",
      httpStatus: 502,
      title: "Delivery failed",
      detail: "The payment is settled. Retry this same proof to deliver without paying again.",
    });
    return {
      httpStatus: 502,
      code: "paid_delivery_failed",
      charged: settlement.charged,
      delivered: false,
      pending: false,
      signature: settlement.signature,
      settlement: { ...settlement, charged: true, delivered: false, pending: false, deliveryError: "deliver threw" },
      retriedSameProof,
      steps,
    };
  }
  try {
    const delivered = await input.deliver();
    if (!delivered.ok) {
      steps.push({
        phase: "deliver",
        ok: false,
        code: "paid_delivery_failed",
        httpStatus: 502,
        title: "Paid, delivery failed",
        detail: `${delivered.error ?? "The resource handler failed."} Retry the same PAYMENT-SIGNATURE. It will not settle again.`,
      });
      return {
        httpStatus: 502,
        code: "paid_delivery_failed",
        charged: true,
        delivered: false,
        pending: false,
        signature: settlement.signature,
        settlement: {
          ...settlement,
          charged: true,
          delivered: false,
          pending: false,
          deliveryError: delivered.error,
        },
        retriedSameProof,
        steps,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "deliver threw";
    steps.push({
      phase: "deliver",
      ok: false,
      code: "paid_delivery_failed",
      httpStatus: 502,
      title: "Paid, delivery failed",
      detail: `${message} Retry the same proof.`,
    });
    return {
      httpStatus: 502,
      code: "paid_delivery_failed",
      charged: true,
      delivered: false,
      pending: false,
      signature: settlement.signature,
      settlement: { ...settlement, charged: true, delivered: false, pending: false, deliveryError: message },
      retriedSameProof,
      steps,
    };
  }

  steps.push({
    phase: "deliver",
    ok: true,
    httpStatus: 200,
    title: "Resource delivered",
    detail: retriedSameProof ? "Delivered on retry. The original settlement was reused." : "Delivered after settlement.",
  });
  return {
    httpStatus: 200,
    charged: settlement.charged,
    delivered: true,
    pending: false,
    signature: settlement.signature,
    settlement: { ...settlement, charged: true, delivered: true, pending: false },
    retriedSameProof,
    steps,
  };
}

function fail(
  code: X402FailureCode,
  httpStatus: number,
  steps: X402TraceStep[],
  charged: boolean,
): X402ExecutionResult {
  return {
    httpStatus,
    code,
    charged,
    delivered: false,
    pending: false,
    retriedSameProof: false,
    steps,
  };
}

function isTransportFailure(reason: string | undefined): boolean {
  if (!reason) return false;
  return /timeout|econnrefused|network|fetch failed|503|unavailable|rpc|facilitator/i.test(reason);
}

const MISSING_MERCHANT_ACCOUNT = /ata[_\s-]*missing|associated token|recipient_ata/;

export function mapFacilitatorReason(reason: string | undefined): X402FailureCode {
  const text = (reason ?? "").toLowerCase();
  if (!text) return "price_mismatch";
  if (/replay|duplicate/.test(text)) return "replayed_proof";
  if (MISSING_MERCHANT_ACCOUNT.test(text)) return "facilitator_down";
  if (/expir|blockhash/.test(text)) return "expired_quote";
  if (/mint|wrong asset|token mismatch/.test(text)) return "wrong_mint";
  if (/amount|underpay|insufficient/.test(text)) return "underpaid";
  if (/price|payto|recipient mismatch/.test(text)) return "price_mismatch";
  return "price_mismatch";
}

/** Plain-language detail for a facilitator reason. Unknown reasons pass through. */
export function explainFacilitatorReason(reason: string | undefined): string | undefined {
  if (reason && MISSING_MERCHANT_ACCOUNT.test(reason.toLowerCase())) {
    return "The merchant USDC account is not on devnet yet. A little SOL in the merchant wallet lets PayLink create it. Nothing was charged.";
  }
  return reason;
}

export const FAILURE_COPY: Record<X402FailureCode, { title: string; summary: string }> = {
  insufficient_budget: {
    title: "Insufficient budget",
    summary: "The call would push the agent wallet past its total USDC cap. No transaction is signed.",
  },
  over_cap: {
    title: "Over the per-call cap",
    summary: "The price is above the per-call ceiling. The wallet refuses before a 402 retry.",
  },
  price_mismatch: {
    title: "Price mismatch",
    summary: "The signed requirements do not match the quote the server advertised.",
  },
  underpaid: {
    title: "Underpaid",
    summary: "The transfer amount is below the invoice or the x402 quote. The resource stays locked.",
  },
  wrong_mint: {
    title: "Wrong mint",
    summary: "The token mint is not the configured USDC mint. The payment is rejected.",
  },
  replayed_proof: {
    title: "Replayed proof",
    summary: "This payment proof already delivered the resource. A second settle is refused.",
  },
  expired_quote: {
    title: "Expired quote",
    summary: "The 402 challenge is older than its timeout. The client must request a new one.",
  },
  facilitator_down: {
    title: "RPC or facilitator down",
    summary: "Verification or settlement could not be completed. Fail closed: no second charge, no delivery.",
  },
  paid_delivery_failed: {
    title: "Paid, delivery failed",
    summary: "USDC moved, then the handler failed. The same proof retries delivery and does not pay again.",
  },
};
