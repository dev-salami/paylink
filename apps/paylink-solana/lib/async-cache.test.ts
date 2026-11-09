import { describe, expect, it, vi } from "vitest";
import { createAsyncCache } from "./async-cache";

describe("single-flight sync cache", () => {
  it("deduplicates in-flight loads and expires two seconds after completion", async () => {
    let now = 0;
    const cached = createAsyncCache<number>(2_000, 10, () => now);
    const load = vi.fn(async () => 42);
    expect(await Promise.all([cached("invoice", load), cached("invoice", load)])).toEqual([42, 42]);
    now = 1_999;
    await cached("invoice", load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 2_001;
    await cached("invoice", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache rejected work", async () => {
    const cached = createAsyncCache<number>(2_000);
    const load = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error("failure")).mockResolvedValue(42);
    await expect(cached("invoice", load)).rejects.toThrow("failure");
    expect(await cached("invoice", load)).toBe(42);
  });
});
