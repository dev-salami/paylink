import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { resetInvoicePreviews } from "./invoice-preview";

const mocks = vi.hoisted(() => ({
  db: {
    invoices: [] as Array<{ id: string; number: string; clientName: string; amount: string; description: string; status: string }>,
    merchant: { name: "Morrow Quay Studio", city: "Lagos", email: "billing@morrowquay.example" },
  },
  issue: vi.fn(async (input: { clientName: string; amount: string; description: string; asDraft?: boolean; settlement?: { mode: string; recipient?: string } }) => {
    const invoice = {
      id: `inv_${mocks.db.invoices.length + 1}`,
      number: `PL-2026-${1100 + mocks.db.invoices.length}`,
      status: input.asDraft ? "draft" : "pending",
      clientName: input.clientName,
      amount: input.amount,
      description: input.description,
      settlement: input.settlement,
    };
    mocks.db.invoices.unshift(invoice);
    return invoice;
  }),
}));

vi.mock("./invoices", () => ({
  issueInvoice: mocks.issue,
  findInvoice: vi.fn(),
  unpaidInvoices: () => [],
}));
vi.mock("./store", () => ({
  getDb: () => mocks.db,
  currentBudgetView: () => ({ spent: "0", total: "5", remaining: "5", perCall: "0.5", approveAbove: "0.1" }),
  budgetPolicy: () => ({ totalAtomic: 5_000_000n, perCallAtomic: 500_000n, approveAboveAtomic: 100_000n }),
  spentAtomic: () => 0n,
}));
vi.mock("./x402-service", () => ({
  acceptPayment: vi.fn(),
  issueChallenge: vi.fn(),
  signChallenge: vi.fn(),
}));

import { runChat } from "./agent";
import { findInvoice } from "./invoices";
import { issueChallenge } from "./x402-service";

const sentence = "create an invoice for website design deposit two dollar";

function model(content: Record<string, unknown>) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
}

function fields(overrides: Record<string, unknown> = {}) {
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

describe("assistant invoice confirmation", () => {
  const previousKey = process.env.LLM_API_KEY;
  beforeEach(() => {
    mocks.db.invoices = [];
    mocks.issue.mockClear();
    resetInvoicePreviews();
    process.env.LLM_API_KEY = "test-key-not-a-secret";
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
    vi.unstubAllGlobals();
  });

  it("prepares the user's sentence for review and saves one draft only after confirmation", async () => {
    vi.mocked(fetch).mockResolvedValue(model(fields()));
    const prepared = await runChat({ message: sentence, settlement: { mode: "demo" } }, "http://localhost");
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(prepared.invoicePreview).toMatchObject({ description: "website design deposit", amount: "2", network: "devnet" });
    expect(prepared.reply).toContain("Review this invoice");
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(sent.messages.at(-1).content).toBe(sentence);
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("test-key-not-a-secret");

    const saved = await runChat({ message: "", confirmPreview: { previewId: prepared.invoicePreview!.id }, settlement: { mode: "live", recipient: "not-used" } }, "http://localhost");
    expect(mocks.issue).toHaveBeenCalledOnce();
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({
      description: "website design deposit",
      amount: "2",
      clientName: "Unnamed client",
      asDraft: true,
      settlement: { mode: "demo" },
    }));
    expect(saved.invoice?.status).toBe("draft");
    expect(saved.reply).toContain("no email was sent");

    const again = await runChat({ message: "", confirmPreview: { previewId: prepared.invoicePreview!.id } }, "http://localhost");
    expect(mocks.issue).toHaveBeenCalledOnce();
    expect(again.reply).toContain("didn't create another");
  });

  it("applies a follow-up correction to the review and does not confirm the replaced one", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(model(fields()))
      .mockResolvedValueOnce(model(fields({ description: "website redesign", currency: "usdc" })));
    const first = await runChat({ message: sentence, settlement: { mode: "demo" } }, "http://localhost");
    const second = await runChat({
      message: "change the description to website redesign",
      activePreviewId: first.invoicePreview!.id,
      settlement: { mode: "demo" },
    }, "http://localhost");
    const draft = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).messages[1].content as string;
    expect(draft).toContain("website design deposit");
    expect(draft).toContain("\"amount\":\"2\"");
    const stale = await runChat({ message: "", confirmPreview: { previewId: first.invoicePreview!.id } }, "http://localhost");
    expect(stale.reply).toContain("replaced");
    expect(mocks.issue).not.toHaveBeenCalled();
    await runChat({ message: "", confirmPreview: { previewId: second.invoicePreview!.id } }, "http://localhost");
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ description: "website redesign", amount: "2", asDraft: true }));
  });

  it("keeps the selected mainnet wallet and ignores one supplied by the model", async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    vi.mocked(fetch).mockResolvedValue(model({ ...fields({ currency: "usdc" }), recipient: Keypair.generate().publicKey.toBase58(), network: "devnet" }));
    const prepared = await runChat({ message: "2 USDC for website design deposit", settlement: { mode: "live", recipient } }, "http://localhost");
    expect(prepared.invoicePreview?.settlement).toEqual({ mode: "live", recipient });
    expect(prepared.invoicePreview?.network).toBe("mainnet");
    await runChat({ message: "", confirmPreview: { previewId: prepared.invoicePreview!.id }, settlement: { mode: "demo" } }, "http://localhost");
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ settlement: { mode: "live", recipient }, asDraft: true }));
  });

  it("asks a focused question for a missing amount and does not call the model a command parser", async () => {
    vi.mocked(fetch).mockResolvedValue(model(fields({ amount: null, amountClarity: "missing" })));
    const result = await runChat({ message: "create an invoice for website design deposit", settlement: { mode: "demo" } }, "http://localhost");
    expect(result.invoicePreview).toBeUndefined();
    expect(result.reply).toMatch(/USDC amount/);
    expect(result.reply).not.toContain("150 USDC");
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("says the interpreter is unavailable instead of guessing an invoice", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("no", { status: 503 }));
    const result = await runChat({ message: sentence, settlement: { mode: "demo" } }, "http://localhost");
    expect(result.reply).toContain("didn't answer");
    expect(result.reply).not.toContain("website design deposit");
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("does not request reminder payment when email delivery is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const invoice = {
      id: "inv_real",
      number: "PL-1",
      clientName: "Ada",
      clientEmail: "ada@example.com",
      description: "Deposit",
      amount: "2",
      currency: "USDC" as const,
      dueDate: "2026-11-20",
      status: "pending" as const,
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
    };
    mocks.db.invoices = [invoice];
    vi.mocked(findInvoice).mockReturnValue(invoice);
    vi.mocked(fetch).mockResolvedValue(model(fields({ intent: "send_reminder", query: "Ada", amount: null, amountClarity: "missing", description: null })));
    const result = await runChat({ message: "send Ada a reminder", settlement: { mode: "demo" } }, "http://localhost");
    expect(result.reply).toContain("RESEND_API_KEY");
    expect(result.reply).toContain("Nothing was charged");
    expect(issueChallenge).not.toHaveBeenCalled();
  });

  it("does not call the model or invent an invoice when the key is missing", async () => {
    delete process.env.LLM_API_KEY;
    const result = await runChat({ message: sentence, settlement: { mode: "demo" } }, "http://localhost");
    expect(fetch).not.toHaveBeenCalled();
    expect(result.reply).toContain("LLM_API_KEY");
    expect(result.reply).not.toContain("150 USDC");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
