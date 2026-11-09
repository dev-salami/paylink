import { describe, expect, it } from "vitest";
import { evaluateAgentSpend, policyFromDecimals } from "./budget";
import { toAtomic } from "./money";

const policy = policyFromDecimals({ total: "5", perCall: "0.5", approveAbove: "0.1" });

describe("evaluateAgentSpend", () => {
  it("auto-approves a reminder under the threshold", () => {
    const decision = evaluateAgentSpend(policy, 0n, toAtomic("0.05"), false);
    expect(decision.ok).toBe(true);
  });

  it("asks before a PDF above the threshold", () => {
    const decision = evaluateAgentSpend(policy, 0n, toAtomic("0.25"), false);
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("needs_approval");
  });

  it("allows the PDF once the person approves", () => {
    expect(evaluateAgentSpend(policy, 0n, toAtomic("0.25"), true).ok).toBe(true);
  });

  it("blocks a call over the per-call cap before any signature", () => {
    const decision = evaluateAgentSpend(policy, 0n, toAtomic("0.75"), true);
    expect(decision.code).toBe("over_cap");
    expect(decision.ok).toBe(false);
  });

  it("blocks a call that would break the total budget", () => {
    const decision = evaluateAgentSpend(policy, toAtomic("4.9"), toAtomic("0.25"), true);
    expect(decision.code).toBe("insufficient_budget");
  });
});
