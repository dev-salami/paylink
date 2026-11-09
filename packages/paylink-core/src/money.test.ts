import { describe, expect, it } from "vitest";
import { formatUsdc, fromAtomic, toAtomic } from "./money";

describe("money", () => {
  it("converts USDC amounts to 6-decimal atomic units", () => {
    expect(toAtomic("0")).toBe(0n);
    expect(toAtomic("1")).toBe(1_000_000n);
    expect(toAtomic("0.25")).toBe(250_000n);
    expect(toAtomic("150")).toBe(150_000_000n);
    expect(toAtomic("0.000001")).toBe(1n);
  });

  it("rejects junk and extra precision", () => {
    expect(() => toAtomic("abc")).toThrow(/Invalid amount/);
    expect(() => toAtomic("1.0000001")).toThrow(/decimal/);
    expect(() => toAtomic("-1")).toThrow(/Invalid amount/);
  });

  it("round-trips and formats for display", () => {
    expect(fromAtomic(250_000n)).toBe("0.25");
    expect(fromAtomic(150_000_000n)).toBe("150");
    expect(formatUsdc("150")).toBe("150.00");
    expect(formatUsdc("1234.5")).toBe("1,234.50");
  });
});
