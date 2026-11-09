import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@181hacks/paylink-core";
import type { PaymentRequired } from "@x402/core/types";
import { GET } from "../app/api/x402/[resource]/route";

const mocks = vi.hoisted(() => ({ invoices: [] as Invoice[], issue: vi.fn(), accept: vi.fn() }));
vi.mock("./store", () => ({ getDb: () => ({ invoices: mocks.invoices }) }));
vi.mock("./env", () => ({ appOrigin: () => "https://pay.example.test" }));
vi.mock("./x402-service", async () => ({ issueChallenge: mocks.issue, acceptPayment: mocks.accept,
  paymentRequiredResponse: (await import("./x402-response")).paymentRequiredResponse, toHttpResponse: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network blocked in offline regression"); }));
  // Synthetic fixture using only the requested identifier; no production reads.
  mocks.invoices = [{ id: "inv_2f85e2e8", number: "PL-MOCK", clientName: "", description: "Design", amount: "2", currency: "USDC", dueDate: "2026-11-08", status: "paid", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z" }];
  const paymentRequired: PaymentRequired = { x402Version: 2,
    resource: { url: "https://pay.example.test/api/x402/pdf?invoice=inv_2f85e2e8", description: "Invoice PDF", mimeType: "application/pdf" },
    accepts: [{ scheme: "exact", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", amount: "250000", asset: "mock-usdc", payTo: "mock-merchant", maxTimeoutSeconds: 90, extra: { memo: "mock-quote" } }],
  };
  mocks.issue.mockReset().mockResolvedValue({ paymentRequired, header: "mock-payment-required" });
  mocks.accept.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("x402 PDF GET contract — offline formatting only", () => {
  it("uses invoice=, returns readable 402 JSON and never accepts a payment without a signature", async () => {
    const response = await GET(new Request("https://pay.example.test/api/x402/pdf?invoice=inv_2f85e2e8"), { params: Promise.resolve({ resource: "pdf" }) });
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBe("mock-payment-required");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text(); const json = JSON.parse(text);
    expect(text).toBe(JSON.stringify(json, null, 2));
    expect(text).toContain('\n  "x402Version": 2');
    expect(json.error).toBe("Payment required"); expect(json.accepts).toHaveLength(1);
    expect(mocks.issue).toHaveBeenCalledWith({ resourceName: "pdf", invoice: mocks.invoices[0], origin: "https://pay.example.test" });
    expect(mocks.accept).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not guess an invoice from an unsupported query parameter", async () => {
    const response = await GET(new Request("https://pay.example.test/api/x402/pdf?invoiceId=inv_2f85e2e8"), { params: Promise.resolve({ resource: "pdf" }) });
    expect(response.status).toBe(400); expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled();
  });
});
