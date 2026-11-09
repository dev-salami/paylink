import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import type { SolanaInvoice, SolanaReceipt } from "./receipt-types";
import { isPublicPath } from "./access";
import { GET as receiptGet } from "../app/api/receipts/[id]/pdf/route";
import { GET as invoiceGet } from "../app/api/invoices/[id]/receipt.pdf/route";
import type { CrossChainAttempt } from "./settlement/types";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT } from "./settlement/types";
import { SOURCES } from "./aurora/assets";

const mocks = vi.hoisted(() => ({
  db: { invoices: [] as SolanaInvoice[], receipts: [] as SolanaReceipt[], crossChainAttempts: [] as CrossChainAttempt[] },
  payer: vi.fn(), font: vi.fn(),
}));
vi.mock("./store", () => ({ getDb: () => mocks.db, updateDb: (mutate: (db: typeof mocks.db) => void) => mutate(mocks.db) }));
vi.mock("./solana", () => ({ getConfirmedPayerWallet: mocks.payer }));
vi.mock("./receipt-font", () => ({ readReceiptFont: mocks.font }));

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = new Request("https://pay.example/api/receipts/rcp_test/pdf");

beforeEach(() => {
  mocks.db.crossChainAttempts = [];
  mocks.db.invoices = [{
    id: "inv_test", number: "PL-2026-1044", clientName: "Ada", description: "Logo", amount: "10", currency: "USDC", dueDate: "2026-11-07", status: "paid",
    createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", receiptId: "rcp_test",
    payment: { provider: "solana", reference: "reference", recipient: "merchant", asset: "mint", network: "devnet", url: "solana:merchant" },
  }];
  mocks.db.receipts = [{
    id: "rcp_test", invoiceId: "inv_test", number: "PL-2026-1044", clientName: "Ada", description: "Logo", amount: "10", currency: "USDC",
    paidAt: "2026-11-07T12:30:00Z", merchantName: "Studio", txSignature: "4".repeat(88),
  }];
  mocks.payer.mockReset().mockResolvedValue("confirmed-fee-payer");
  mocks.font.mockReset().mockResolvedValue(undefined);
});

describe("public stored-receipt PDF routes (offline)", () => {
  it("returns 404 for unknown receipt/invoice ids without a font or RPC lookup", async () => {
    expect((await receiptGet(request, context("unknown"))).status).toBe(404);
    expect((await invoiceGet(request, context("unknown"))).status).toBe(404);
    expect(mocks.payer).not.toHaveBeenCalled();
    expect(mocks.font).not.toHaveBeenCalled();
  });

  it("opens PDFs inline by default through both identifiers and persists historical payer metadata", async () => {
    for (const [handler, id] of [[receiptGet, "rcp_test"], [invoiceGet, "inv_test"]] as const) {
      const response = await handler(request, context(id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe('inline; filename="paylink-receipt-PL-2026-1044.pdf"');
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBe(1);
    }
    expect(mocks.db.receipts[0]?.payerWallet).toBe("confirmed-fee-payer");
    expect(mocks.db.invoices[0]?.payerWallet).toBe("confirmed-fee-payer");
    expect(mocks.payer).toHaveBeenCalledTimes(1);
  });

  it.each(["1", "0", "true", "attachment"])("only download=1 requests an attachment, not download=%s", async (download) => {
    for (const [handler, id] of [[receiptGet, "rcp_test"], [invoiceGet, "inv_test"]] as const) {
      const response = await handler(new Request(`${request.url}?download=${download}`), context(id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(`${download === "1" ? "attachment" : "inline"}; filename="paylink-receipt-PL-2026-1044.pdf"`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("does not export sample receipts or unpaid invoices", async () => {
    mocks.db.receipts[0]!.sample = true;
    expect((await receiptGet(request, context("rcp_test"))).status).toBe(404);
    mocks.db.receipts[0]!.sample = false;
    mocks.db.invoices[0]!.status = "pending";
    expect((await invoiceGet(request, context("inv_test"))).status).toBe(404);
  });

  it("still downloads when historical transaction lookup is unavailable", async () => {
    mocks.payer.mockRejectedValue(new Error("RPC unavailable"));
    expect((await receiptGet(request, context("rcp_test"))).status).toBe(200);
    expect(mocks.db.receipts[0]?.payerWallet).toBeUndefined();
  });

  it("enriches legacy mainnet receipt PDFs read-only from the matched deposit, never from the old minimum", async () => {
    const invoice = mocks.db.invoices[0]!; const receipt = mocks.db.receipts[0]!;
    invoice.settlement = { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6, recipient: "merchant-mainnet", amountAtomic: "2000000", feePolicy: "payer_pays_exact_output" };
    receipt.crossChain = { sourceChain: "base", sourceSymbol: "USDC", amountInFormatted: "2.010418", network: "Solana mainnet", destinationTxHash: receipt.txSignature!, destinationExplorerUrl: `https://explorer.solana.com/tx/${receipt.txSignature}` };
    mocks.db.crossChainAttempts.push({ invoiceId: invoice.id, lifecycle: "settled", sourceAssetId: SOURCES[0]!.assetId, depositedAmount: "2030498", destinationTxHashes: [receipt.txSignature!],
      realQuote: { quote: { amountIn: "2020469", minAmountIn: "2010418" } }, evidence: { totalAtomic: "2000000" } } as unknown as CrossChainAttempt);
    const before = JSON.stringify(mocks.db); const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      for (const [handler, id] of [[receiptGet, receipt.id], [invoiceGet, invoice.id]] as const) expect((await handler(request, context(id))).status).toBe(200);
      const texts = draw.mock.calls.map(([text]) => text);
      for (const value of ["2.030498 USDC on Base", "2.020469 USDC on Base", "2.010418 USDC on Base", "2 USDC on Solana mainnet"]) expect(texts).toContain(value);
      expect(mocks.payer).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.db)).toBe(before);
    } finally { draw.mockRestore(); }
  });

  it("makes exactly the receipt download endpoints public, not unrelated merchant APIs", () => {
    expect(isPublicPath("/api/receipts/rcp_test/pdf")).toBe(true);
    expect(isPublicPath("/api/invoices/inv_test/receipt.pdf")).toBe(true);
    expect(isPublicPath("/api/receipts")).toBe(false);
    expect(isPublicPath("/api/receipts/rcp_test/private")).toBe(false);
    expect(isPublicPath("/api/invoices/sync-open")).toBe(false);
  });
});
