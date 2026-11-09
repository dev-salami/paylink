import { afterEach, describe, expect, it, vi } from "vitest";
import { startVisibilityPolling } from "./polling";
import { prepareWalletTransaction } from "./wallet-transaction";
import { DEVNET_BUSY } from "./rpc-errors";

afterEach(() => { vi.useRealTimers(); });

describe("visibility-aware adaptive polling", () => {
  it("backs off up to 15s, pauses hidden tabs, resumes and stops when paid", async () => {
    vi.useFakeTimers();
    let listener: (() => void) | undefined;
    const page = {
      hidden: false,
      addEventListener: vi.fn((_name: string, fn: unknown) => { listener = fn as () => void; }),
      removeEventListener: vi.fn(),
    };
    const task = vi.fn<() => Promise<"error" | "stop">>().mockResolvedValue("error");
    const stop = startVisibilityPolling(task, 3_000, 15_000, page);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(task).toHaveBeenCalledTimes(4);
    page.hidden = true;
    listener?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(4);
    task.mockResolvedValue("stop");
    page.hidden = false;
    listener?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(5);
    stop();
  });
});

describe("transaction preparation before wallet approval", () => {
  it("automatically retries busy construction and returns the unsigned transaction", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: DEVNET_BUSY, retryable: true }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ transaction: "unsigned-base64" }));
    const onRetry = vi.fn();
    const transaction = await prepareWalletTransaction("/api/invoices/inv_1/tx", "payer", { fetchImpl, onRetry, sleep: async () => {} });
    expect(transaction).toBe("unsigned-base64");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("never retries missing USDC or reveals raw RPC/network details", async () => {
    const missing = vi.fn<typeof fetch>(async () => Response.json({ error: "TokenAccountNotFoundError", retryable: false }, { status: 400 }));
    await expect(prepareWalletTransaction("/tx", "payer", { fetchImpl: missing })).rejects.toThrow("no devnet USDC");
    expect(missing).toHaveBeenCalledTimes(1);
    const down = vi.fn<typeof fetch>(async () => { throw new Error("429 https://secret-rpc.test/key"); });
    await expect(prepareWalletTransaction("/tx", "payer", { fetchImpl: down, sleep: async () => {} })).rejects.toThrow(DEVNET_BUSY);
    expect(down).toHaveBeenCalledTimes(3);
  });
});
