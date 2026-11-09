import { describe, expect, it } from "vitest";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import { verifySolanaSettlement } from "./settlement/solana-mainnet";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, type LiveSettlement } from "./settlement/types";

const target: LiveSettlement = { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant", amountAtomic: "2000000", feePolicy: "payer_pays_exact_output" };
const signature = "4".repeat(88);
const tx = (amount: string, mint = MAINNET_USDC_MINT, owner = "merchant", err: unknown = null) => ({ meta: { err, preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null } }] } } as unknown as VersionedTransactionResponse);
describe("MOCK independent mainnet verifier — no RPC calls", () => {
  it.each([["wrong-mint", "merchant", null], [MAINNET_USDC_MINT, "wrong-owner", null], [MAINNET_USDC_MINT, "merchant", "reverted"]])("refuses wrong mint/owner or reverted transactions", async (mint, owner, err) => {
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => tx("2000000", mint!, owner!, err))).state).toBe("needs_review");
  });
  it("rejects insufficient credit and verifies split finalized payouts using atomic sums", async () => {
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => tx("1999999"))).state).toBe("needs_review");
    const split = await verifySolanaSettlement(target, [signature, "5".repeat(88)], "invoice", [], async () => tx("1000000"));
    expect(split.state).toBe("verified"); expect(split.evidence.totalAtomic).toBe("2000000");
  });
  it("refuses replay across invoices and waits for unavailable/unfinalized RPC evidence", async () => {
    expect((await verifySolanaSettlement(target, [signature], "invoice", [{ chain: "sol", signature, invoiceId: "other", attemptId: "other", claimedAt: "now" }], async () => tx("2000000"))).state).toBe("needs_review");
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => { throw new Error("private RPC URL"); })).state).toBe("settlement_verifying");
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => null)).state).toBe("settlement_verifying");
  });
  it("does not treat an existing token balance with missing pre-owner metadata as new credit", async () => {
    const value = tx("10000000");
    value.meta!.preTokenBalances = [{ accountIndex: 1, mint: MAINNET_USDC_MINT, uiTokenAmount: { amount: "9000000", decimals: 6, uiAmount: null } }];
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => value)).state).toBe("needs_review");
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => tx("2000000"))).state).toBe("verified"); // New ATA with no pre row.
  });
  it("refuses incomplete result metadata and duplicate token balance rows", async () => {
    const incomplete = tx("2000000");
    delete (incomplete.meta as unknown as Record<string, unknown>).err;
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => incomplete)).state).toBe("needs_review");
    const duplicate = tx("1000000");
    duplicate.meta!.postTokenBalances!.push(duplicate.meta!.postTokenBalances![0]!);
    expect((await verifySolanaSettlement(target, [signature], "invoice", [], async () => duplicate)).state).toBe("needs_review");
  });
});
