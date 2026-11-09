import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, PDFPage } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptAmounts } from "../components/receipt-amounts";
import { receiptAmountRows, resolveReceiptAmounts } from "./receipt-amounts";
import { buildReceiptPdf } from "./receipt-pdf";
import { SOURCES } from "./aurora/assets";
import type { CrossChainAttempt, CrossChainReceipt } from "./settlement/types";

const signature = "4".repeat(88);
const receipt: CrossChainReceipt = { sourceChain: "base", sourceSymbol: "USDC", amountInFormatted: "2.010418", network: "Solana mainnet", destinationTxHash: signature, destinationExplorerUrl: `https://explorer.solana.com/tx/${signature}` };
const attempt = { id: "swap_mock", invoiceId: "inv_mock", sourceAssetId: SOURCES[0]!.assetId, lifecycle: "settled", depositedAmount: "2030498", amountIn: "2010418",
  destinationTxHashes: [signature], evidence: { totalAtomic: "2000000", signatures: [signature], checkedAt: "2026-11-08T12:00:00Z" },
  realQuote: { quote: { amountIn: "2020469", minAmountIn: "2010418" } },
} as unknown as CrossChainAttempt;
afterEach(() => vi.restoreAllMocks());

describe("receipt source deposit, quotes and verified merchant credit — offline", () => {
  it("uses the persisted deposit, never the swap minimum, and formats 6/18 decimals exactly", () => {
    const amounts = resolveReceiptAmounts("inv_mock", receipt, [attempt])!;
    expect(receiptAmountRows(amounts)).toEqual([
      ["Source deposit (reported)", "2.030498 USDC on Base"],
      ["Quoted send amount", "2.020469 USDC on Base"],
      ["Quoted minimum", "2.010418 USDC on Base"],
      ["Merchant credit (verified)", "2 USDC on Solana mainnet"],
    ]);
    expect(receipt.depositedAmountAtomic).toBeUndefined(); // Historical data was not modified.
    const eth = { ...receipt, sourceSymbol: "ETH" };
    const ethAmounts = resolveReceiptAmounts("inv_mock", eth, [{ ...attempt, sourceAssetId: SOURCES[1]!.assetId, depositedAmount: "100000000000000001" }])!;
    expect(receiptAmountRows(ethAmounts)[0]?.[1]).toBe("0.100000000000000001 ETH on Base");
  });

  it("labels missing actual deposit/credit unknown and never borrows another invoice's or unmatched attempt's amounts", () => {
    expect(receiptAmountRows(receipt).map((row) => row[1])).toEqual(["Unknown", "Unknown", "Unknown", "Unknown"]);
    for (const mismatch of [{ ...attempt, invoiceId: "another-invoice" }, { ...attempt, destinationTxHashes: ["5".repeat(88)] }, { ...attempt, lifecycle: "processing" as const }]) {
      expect(receiptAmountRows(resolveReceiptAmounts("inv_mock", receipt, [mismatch])!)[0]?.[1]).toBe("Unknown");
    }
    const missing = resolveReceiptAmounts("inv_mock", receipt, [{ ...attempt, depositedAmount: undefined }])!;
    expect(receiptAmountRows(missing)[0]?.[1]).toBe("Unknown");
    expect(receiptAmountRows(missing)[2]?.[1]).toBe("2.010418 USDC on Base");
  });

  it("renders identical labelled amounts in the web receipt and a single-page PDF without claiming a fee difference", async () => {
    const enriched = resolveReceiptAmounts("inv_mock", receipt, [attempt])!;
    const html = renderToStaticMarkup(createElement(ReceiptAmounts, { receipt: enriched }));
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    const bytes = await buildReceiptPdf({ number: "PL-2026-MOCK", merchantName: "Studio", clientName: "Ada", description: "Design", amount: "2", paidAt: "2026-11-08T12:00:00Z", signature, crossChain: enriched });
    const texts = draw.mock.calls.map(([text]) => text);
    for (const [label, value] of receiptAmountRows(enriched)) {
      expect(html).toContain(label); expect(html).toContain(value);
      expect(texts).toContain(label); expect(texts).toContain(value);
    }
    expect(html).not.toContain("Paid from"); expect(texts.some((text) => text.includes("Paid from"))).toBe(false);
    expect(html).toContain("Differences are not a fee breakdown.");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
