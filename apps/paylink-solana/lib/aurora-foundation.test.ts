import { describe, expect, it, vi } from "vitest";
import { availableSources, SOURCES, parseTokens } from "./aurora/assets";
import { buildQuoteRequest, validateQuote } from "./aurora/quote";
import { reduceProviderStatus } from "./aurora/lifecycle";
import { createAuroraClient } from "./aurora/client";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, decimalToAtomic, formatAtomic, type LiveSettlement } from "./settlement/types";
import { createSettlement } from "./settlement/config";
import { Keypair, PublicKey } from "@solana/web3.js";

const target: LiveSettlement = { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant-mainnet", amountAtomic: "2000000", feePolicy: "payer_pays_exact_output" };
const refund = `0x${"1".repeat(40)}`;
describe("MOCK Aurora foundations — no real API calls", () => {
  it("defaults to demo and only enables on-curve Solana mainnet receiving, not Base", () => {
    expect(createSettlement("2")).toEqual({ mode: "demo" });
    const recipient = Keypair.generate().publicKey.toBase58();
    expect(createSettlement("2", { mode: "live", recipient })).toMatchObject({ network: "solana-mainnet", mint: MAINNET_USDC_MINT, amountAtomic: "2000000", recipient });
    expect(() => createSettlement("2", { mode: "base", recipient })).toThrow();
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("mock")], Keypair.generate().publicKey);
    expect(() => createSettlement("2", { mode: "live", recipient: pda.toBase58() })).toThrow(/not a program address/);
  });
  it("builds exact output from stored settlement only, validates echoed destination and rejects short output", () => {
    const request = buildQuoteRequest(target, SOURCES[0]!.assetId, refund, true, "attempt", 0);
    expect(request.amount).toBe("2000000"); expect(request.recipient).toBe("merchant-mainnet");
    const quote = { amountIn: "2020495", minAmountIn: "2010442", amountOut: "2000000", minAmountOut: "2000000" };
    expect(validateQuote(request, { quoteRequest: request, quote }).quote.depositAddress).toBeUndefined();
    expect(() => validateQuote(request, { quoteRequest: { ...request, recipient: "attacker" }, quote })).toThrow();
    expect(() => validateQuote(request, { quoteRequest: request, quote: { ...quote, minAmountOut: "1999999" } })).toThrow(/full invoice amount/);
    expect(() => validateQuote(request, { quoteRequest: request, quote: { ...quote, depositAddress: refund } })).toThrow(/preview/);
  });
  it("parses the tokens envelope and pins exact asset IDs/decimals while filtering incidents", () => {
    const tokens = parseTokens({ tokens: [...SOURCES.map((item) => ({ ...item, blockchain: item.chain })), { assetId: MAINNET_USDC_ASSET, decimals: 6, blockchain: "sol" }] });
    expect(availableSources(tokens, [])).toHaveLength(7);
    expect(availableSources(tokens, [{ scopeType: "chain", scopeValue: "base" }]).some((s) => s.chain === "base")).toBe(false);
    expect(availableSources(tokens, [{ scopeType: "token", scopeValue: MAINNET_USDC_ASSET }])).toEqual([]);
  });
  it("never exposes a secret URL from fetch failures", async () => {
    const client = createAuroraClient("fake-private-key", async () => { throw new Error("https://intents-api.aurora.dev/api/tokens/fake-private-key"); }, async () => {});
    await expect(client.sources()).rejects.toThrow("couldn’t confirm this payment");
    try { await client.sources(); } catch (error) { expect(String(error)).not.toContain("fake-private-key"); }
  });
  it("retries a dry HTTP 429 with Retry-After and records a credential-free response snapshot", async () => {
    const request = buildQuoteRequest(target, SOURCES[0]!.assetId, refund, true, "mock-attempt", 0);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private error", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(Response.json({ quoteRequest: request, quote: { amountIn: "2020495", minAmountIn: "2010442", amountOut: "2000000", minAmountOut: "2000000" }, debugUrl: "https://intents-api.aurora.dev/api/quote/fake-private-key" }));
    const sleep = vi.fn(async (_ms: number) => {});
    const quote = await createAuroraClient("fake-private-key", fetchImpl, sleep).quote(request);
    expect(sleep).toHaveBeenCalledWith(1000); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(quote.response).toBeDefined(); expect(JSON.stringify(quote)).not.toContain("fake-private-key");
  });
  it("does not blindly retry an ambiguous real-quote 5xx", async () => {
    const request = buildQuoteRequest(target, SOURCES[0]!.assetId, refund, false, "mock-attempt", 0);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("fake-private-key", { status: 503 }));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(createAuroraClient("fake-private-key", fetchImpl, sleep).quote(request)).rejects.toThrow(/unavailable/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it.each([
    ["PENDING_DEPOSIT", "awaiting_deposit"], ["KNOWN_DEPOSIT_TX", "deposit_seen"], ["INCOMPLETE_DEPOSIT", "incomplete"],
    ["PROCESSING", "processing"], ["SUCCESS", "settlement_verifying"], ["REFUNDED", "refunded"], ["FAILED", "failed_needs_review"], ["NEW_STATE", "needs_review"],
  ])("maps %s fail-closed, never regresses settled", (status, expected) => {
    expect(reduceProviderStatus("awaiting_deposit", status, new Date(100000).toISOString(), 0)).toBe(expected);
    expect(reduceProviderStatus("settled", status, new Date(100000).toISOString(), 0)).toBe("settled");
  });
  it("keeps late funds reconcilable and converts 6/18 decimals without floating point", () => {
    expect(reduceProviderStatus("awaiting_deposit", "PENDING_DEPOSIT", new Date(0).toISOString(), 1)).toBe("expired_unfunded");
    expect(reduceProviderStatus("expired_unfunded", "SUCCESS", new Date(0).toISOString(), 1)).toBe("settlement_verifying");
    expect(decimalToAtomic("2.000001", 6)).toBe("2000001");
    expect(formatAtomic(decimalToAtomic("0.000000000000000001", 18), 18)).toBe("0.000000000000000001");
  });
});
