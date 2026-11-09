import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, PDFPage } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SolanaInvoice, SolanaReceipt } from "./receipt-types";
import { clientActivityCopy, clientLabel, displayClientName } from "./client-name";
import { buildReceiptPdf } from "./receipt-pdf";
import InvoicePage from "../app/invoices/[id]/page";
import ReceiptPage from "../app/receipts/[id]/page";

const mocks = vi.hoisted(() => ({ invoices: [] as SolanaInvoice[], receipts: [] as SolanaReceipt[] }));
vi.mock("./store", () => ({ getDb: () => ({ ...mocks, activities: [{ invoiceId: "inv_mock", title: "Receipt for Unnamed client", at: "2026-11-08T00:00:00Z", detail: "Paid by Unnamed client" }], crossChainAttempts: [] }) }));
vi.mock("./pdf", () => ({ readStoredPdf: () => null }));
vi.mock("../components/shell-data", () => ({ shellData: () => ({ merchantName: "Studio", alerts: [] }) }));
vi.mock("../components/shell", () => ({ Shell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("Not found"); } }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network blocked"); }));
  mocks.invoices = [{ id: "inv_mock", number: "PL-MOCK", clientName: "", description: "Design", amount: "2", currency: "USDC", dueDate: "2026-11-08", status: "paid", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", receiptId: "rcp_mock" }];
  mocks.receipts = [{ id: "rcp_mock", invoiceId: "inv_mock", number: "PL-MOCK", clientName: "", description: "Design", amount: "2", currency: "USDC", paidAt: "2026-11-08T00:00:00Z", merchantName: "Studio" }];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("client-name presentation and fixture-free copy — offline", () => {
  it.each([undefined, null, "", "   ", "Unnamed client", " unnamed CLIENT "])("does not invent a client name for %s", (name) => {
    expect(displayClientName(name)).toBeUndefined(); expect(clientLabel(name)).toBe("Not provided");
  });
  it("keeps a supplied client name", () => {
    expect(displayClientName("  Ada  ")).toBe("Ada");
    expect(clientActivityCopy("Receipt for Unnamed client")).toBe("Receipt for client");
    expect(clientActivityCopy("Receipt for Ada")).toBe("Receipt for Ada");
  });
  it.each(["", "  ", "Unnamed client"])("renders paid invoice/receipt and PDF without placeholder greetings: %s", async (name) => {
    mocks.invoices[0]!.clientName = name; mocks.receipts[0]!.clientName = name;
    const before = JSON.stringify(mocks);
    const invoice = renderToStaticMarkup(await InvoicePage({ params: Promise.resolve({ id: "inv_mock" }) }));
    const receipt = renderToStaticMarkup(await ReceiptPage({ params: Promise.resolve({ id: "rcp_mock" }) }));
    for (const html of [invoice, receipt]) { expect(html).not.toContain("Unnamed client"); expect(html).toContain("Not provided"); }
    expect(receipt).toContain("Payment received"); expect(receipt).not.toContain("Thanks,");
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    const bytes = await buildReceiptPdf({ number: "PL-MOCK", merchantName: "Studio", clientName: name, description: "Design", amount: "2", paidAt: "2026-11-08T00:00:00Z" });
    const text = draw.mock.calls.map(([value]) => value).join(" ");
    expect(text).toContain("Payment received"); expect(text).toContain("Not provided");
    expect(text).not.toContain("Unnamed client"); expect(text).not.toContain("Thanks,");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(JSON.stringify(mocks)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
  it("has no fixture section in ordinary workspace pages and keeps explicit PDF download links", () => {
    for (const file of ["../app/dashboard/page.tsx", "../app/activity/page.tsx", "../app/invoices/[id]/page.tsx"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).not.toContain("Development fixture");
    }
    for (const file of ["../components/live-payer.tsx", "../components/pay-client.tsx", "../app/receipts/[id]/page.tsx"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain("?download=1");
    }
  });
});
