import { describe, expect, it } from "vitest";
import { DEVNET_BUSY, NO_USDC, friendlyInvoiceIssue, friendlyPaymentError, isTransientRpcError } from "./rpc-errors";

describe("payer-safe error messages", () => {
  it.each([
    "failed to get info about account payer: Error: 429 Too Many Requests",
    "429 Too many requests for a specific RPC call",
    "Connection rate limits exceeded https://rpc.example.test?api-key=secret",
    "503 Service Unavailable", "fetch failed", "TimeoutError: timed out",
  ])("maps transient RPC text without exposing it: %s", (raw) => {
    expect(isTransientRpcError(new Error(raw))).toBe(true);
    expect(friendlyPaymentError(raw)).toBe(DEVNET_BUSY);
    expect(friendlyInvoiceIssue("rpc_down", raw)).toBe(DEVNET_BUSY);
  });
  it("distinguishes missing USDC, insufficient USDC/SOL and wallet cancellation", () => {
    expect(friendlyPaymentError(new Error("TokenAccountNotFoundError"))).toBe(NO_USDC);
    expect(friendlyPaymentError("Insufficient devnet USDC")).toContain("not have enough devnet USDC");
    expect(friendlyPaymentError("insufficient funds for rent")).toContain("devnet SOL");
    expect(friendlyPaymentError("User rejected the request")).toContain("cancelled");
    expect(friendlyPaymentError("unknown stack https://private.example/secret")).not.toContain("secret");
  });
});
