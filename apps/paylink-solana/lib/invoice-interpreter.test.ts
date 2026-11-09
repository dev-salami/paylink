import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVOICE_INTERPRETATION_SCHEMA,
  canonicalizeInvoiceAmount,
  interpreterRequestBody,
  readInterpretation,
  requestInterpretation,
  reviewExtraction,
  type InvoiceExtraction,
} from "./invoice-interpreter";

const now = new Date("2026-11-08T12:00:00.000Z");
const sentence = "create an invoice for website design deposit two dollar";

function extraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    intent: "create_invoice",
    description: "website design deposit",
    amount: "2",
    amountClarity: "clear",
    currency: "usd",
    clientName: null,
    clientEmail: null,
    dueDate: null,
    query: null,
    networkMention: "none",
    mentionsWallet: false,
    ...overrides,
  };
}

function previewOf(value: InvoiceExtraction, mode: "demo" | "live" = "demo", recipient?: string) {
  const review = reviewExtraction(value, { now, settlementMode: mode, recipient });
  expect(review.type).toBe("preview");
  if (review.type !== "preview") throw new Error("expected a preview");
  return review;
}

describe("structured invoice interpretation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the model to read the exact sentence and does not give the model a wallet or a send action", () => {
    const body = interpreterRequestBody({ message: sentence });
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.at(-1)).toEqual({ role: "user", content: sentence });
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(body)).toContain("two");
    expect(JSON.stringify(body)).toContain("Do not invent an amount");
    const schema = (body.response_format as { json_schema: { schema: typeof INVOICE_INTERPRETATION_SCHEMA } }).json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
    for (const forbidden of ["recipient", "wallet", "network", "status", "secret", "apiKey", "sendEmail"]) {
      expect(schema.properties).not.toHaveProperty(forbidden);
    }
  });

  it.each([
    ["create an invoice for website design deposit two dollar", "usd"],
    ["please create an invoice for a website design deposit, two dollars", "usd"],
    ["create an invoice for website design deposit $2", "usd"],
    ["create an invoice for website design deposit, 2 USDC", "usdc"],
    ["2 USDC for website design deposit", "usdc"],
    ["Could you invoice the website design deposit for two dollars?", "usd"],
  ])("prepares a 2 USDC website design deposit from %s", (message, currency) => {
    const body = interpreterRequestBody({ message });
    expect((body.messages as { content: string }[]).at(-1)?.content).toBe(message);
    const review = previewOf(extraction({ currency: currency as InvoiceExtraction["currency"] }));
    expect(review.preview).toMatchObject({
      description: "website design deposit",
      amount: "2",
      clientName: null,
      network: "devnet",
      settlement: { mode: "demo" },
    });
    expect(review.reply).toContain("Review this invoice");
    expect(review.reply).toContain("2 USDC");
    expect(review.reply).not.toContain("150 USDC");
    expect(review.reply).not.toContain("logo");
  });

  it("asks for an amount instead of inventing one", () => {
    const review = reviewExtraction(extraction({ amount: "150", amountClarity: "missing" }), { now, settlementMode: "demo" });
    expect(review).toEqual({ type: "followup", reply: expect.stringMatching(/USDC amount/) });
  });

  it("does not keep a number when the amount is ambiguous", () => {
    const review = reviewExtraction(extraction({ amount: "2", amountClarity: "ambiguous" }), { now, settlementMode: "demo" });
    expect(review.type).toBe("followup");
    if (review.type === "followup") expect(review.reply).toMatch(/single USDC amount/);
  });

  it.each([
    ["-2", "can't use that amount"],
    ["0", "greater than 0"],
    ["1e2", "can't use that amount"],
    ["2 USDC", "can't use that amount"],
    ["1.0000001", "6 decimal"],
    ["18446744073709.551616", "larger than"],
  ])("rejects unsafe amount %s", (amount, fragment) => {
    const review = reviewExtraction(extraction({ amount, currency: "usdc" }), { now, settlementMode: "demo" });
    expect(review.type).toBe("followup");
    if (review.type === "followup") expect(review.reply.toLowerCase()).toContain(fragment);
  });

  it("does not convert another currency", () => {
    const review = reviewExtraction(extraction({ currency: "other", amount: null, amountClarity: "clear" }), { now, settlementMode: "demo" });
    expect(review.type).toBe("followup");
    if (review.type === "followup") expect(review.reply).toMatch(/didn't convert/);
  });

  it("keeps six-decimal USDC precision", () => {
    expect(canonicalizeInvoiceAmount("2.500000")).toEqual({ ok: true, amount: "2.5" });
    expect(canonicalizeInvoiceAmount("0.000001")).toEqual({ ok: true, amount: "0.000001" });
    const review = previewOf(extraction({ amount: "2.000000", currency: "usdc" }));
    expect(review.preview.amount).toBe("2");
  });

  it("drops a recipient the model tries to add and does not switch network", () => {
    const parsed = readInterpretation({ ...extraction({ networkMention: "mainnet", mentionsWallet: true }), recipient: "So11111111111111111111111111111111111111112" });
    expect(parsed).not.toHaveProperty("recipient");
    const review = previewOf(parsed!, "demo");
    expect(review.preview.settlement).toEqual({ mode: "demo" });
    expect(review.preview.network).toBe("devnet");
    expect(review.reply).toContain("did not switch");
    expect(review.reply).toContain("wallet");
  });

  it("answers an unrelated prompt without creating an invoice", () => {
    const review = reviewExtraction(extraction({ intent: "unrelated", amount: null, amountClarity: "missing", description: null }), { now, settlementMode: "demo" });
    expect(review.type).toBe("unrelated");
    if (review.type === "unrelated") {
      expect(review.reply).toContain("Nothing was created");
      expect(review.reply).not.toContain("150 USDC");
    }
  });

  it("calls the configured endpoint with the key only in the header", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).not.toContain("server-key");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer server-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(extraction()) } }] }), { status: 200 });
    });
    const result = await requestInterpretation(
      { message: sentence },
      { apiKey: "server-key", baseUrl: "https://api.openai.com/v1", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
    expect(result.ok).toBe(true);
  });

  it("reports an unavailable interpreter without using the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("LLM_API_KEY leaked in an error", { status: 503 }));
    const result = await requestInterpretation({ message: sentence }, { apiKey: "server-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});
