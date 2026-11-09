import { fromAtomic, toAtomic } from "./money";
import type { BudgetPolicy, BudgetView } from "./types";

export type SpendRefusal = "insufficient_budget" | "over_cap" | "needs_approval";

export interface SpendDecision {
  ok: boolean;
  code?: SpendRefusal;
  detail: string;
}

export function evaluateAgentSpend(
  policy: BudgetPolicy,
  spentAtomic: bigint,
  priceAtomic: bigint,
  approved: boolean,
): SpendDecision {
  if (priceAtomic > policy.perCallAtomic) {
    return {
      ok: false,
      code: "over_cap",
      detail: `This call costs ${fromAtomic(priceAtomic)} USDC, above the per-call cap of ${fromAtomic(policy.perCallAtomic)} USDC. The agent wallet was not asked to sign.`,
    };
  }
  if (spentAtomic + priceAtomic > policy.totalAtomic) {
    return {
      ok: false,
      code: "insufficient_budget",
      detail: `Spending ${fromAtomic(priceAtomic)} USDC would exceed the ${fromAtomic(policy.totalAtomic)} USDC budget. ${fromAtomic(policy.totalAtomic - spentAtomic)} USDC is left. Nothing was signed.`,
    };
  }
  if (priceAtomic > policy.approveAboveAtomic && !approved) {
    return {
      ok: false,
      code: "needs_approval",
      detail: `${fromAtomic(priceAtomic)} USDC is above the ${fromAtomic(policy.approveAboveAtomic)} USDC approval line. Confirm it and the agent wallet will pay.`,
    };
  }
  return {
    ok: true,
    detail: `Within budget. ${fromAtomic(policy.totalAtomic - spentAtomic - priceAtomic)} USDC will remain.`,
  };
}

export function budgetView(policy: BudgetPolicy, spentAtomic: bigint): BudgetView {
  const remaining = policy.totalAtomic > spentAtomic ? policy.totalAtomic - spentAtomic : 0n;
  return {
    total: fromAtomic(policy.totalAtomic),
    perCall: fromAtomic(policy.perCallAtomic),
    approveAbove: fromAtomic(policy.approveAboveAtomic),
    spent: fromAtomic(spentAtomic),
    remaining: fromAtomic(remaining),
  };
}

export function policyFromDecimals(input: { total: string; perCall: string; approveAbove: string }): BudgetPolicy {
  return {
    totalAtomic: toAtomic(input.total),
    perCallAtomic: toAtomic(input.perCall),
    approveAboveAtomic: toAtomic(input.approveAbove),
  };
}
