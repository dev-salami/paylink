import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildReceiptPdf, fitPdfText, formatReceiptAmount, receiptPdfFilename, wrapPdfText, type ReceiptPdfData } from "./receipt-pdf";

const data: ReceiptPdfData = {
  number: "PL-2026-1044", merchantName: "Morrow Quay Studio", clientName: "Ada Lovelace",
  description: "Brand identity", amount: "480.00", paidAt: "2026-11-07T12:30:00Z",
  signature: "4".repeat(88), payerWallet: "PayerWallet", merchantWallet: "MerchantWallet", reference: "Reference", mint: "USDCMint",
};

describe("pure receipt PDF builder", () => {
  it("formats large and fractional USDC amounts exactly without floating-point rounding", () => {
    expect(formatReceiptAmount("18446744073709.551615")).toBe("18,446,744,073,709.551615");
    expect(formatReceiptAmount("0.000001")).toBe("0.000001");
    expect(formatReceiptAmount("480.000000")).toBe("480.00");
  });
  it("renders mainnet cross-chain receipts with trusted source/destination links, never a devnet explorer query", async () => {
    const bytes = await buildReceiptPdf({ ...data, crossChain: { network: "Solana mainnet", sourceChain: "base", sourceSymbol: "USDC", amountInFormatted: "2.020495", originTxHash: `0x${"3".repeat(64)}`, destinationTxHash: data.signature!, destinationExplorerUrl: `https://explorer.solana.com/tx/${data.signature}` } });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const annotations = doc.getPages()[0]!.node.Annots()!;
    expect(annotations.size()).toBe(2);
    const urls = annotations.asArray().map((ref) => doc.context.lookup(ref, PDFDict).lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText());
    expect(urls).toContain(`https://explorer.solana.com/tx/${data.signature}`);
    expect(urls.some((url) => url.startsWith("https://basescan.org/tx/"))).toBe(true);
    expect(urls.join(" ")).not.toContain("cluster=devnet");
  });
  it("produces a valid, single-page PDF with QR image and explorer link annotation", async () => {
    const bytes = await buildReceiptPdf(data);
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPages()[0]!.getSize()).toEqual({ width: 595, height: 842 });
    expect(doc.getPages()[0]!.node.Annots()?.size()).toBe(1);
    const annotation = doc.context.lookup(doc.getPages()[0]!.node.Annots()!.get(0), PDFDict);
    const rectangle = annotation.lookup(PDFName.of("Rect"), PDFArray).asArray().map((value) => (value as PDFNumber).asNumber());
    expect(rectangle).toEqual([60, 90, 535, 117]); // Mint button, not the old raw URL text.
    const action = annotation.lookup(PDFName.of("A"), PDFDict);
    expect(action.lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(`https://explorer.solana.com/tx/${data.signature}?cluster=devnet`);
  });

  it("embeds the supplied Degular font without filesystem access inside the builder", async () => {
    const fontBytes = readFileSync(new URL("../app/fonts/DegularDisplay-Regular.ttf", import.meta.url));
    const doc = await PDFDocument.load(await buildReceiptPdf({ ...data, fontBytes }));
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles long/unicode values and missing metadata without throwing or adding pages", async () => {
    const bytes = await buildReceiptPdf({ ...data,
      clientName: "Ada 🪐 李 ".repeat(500), merchantName: "Studio ".repeat(500), description: "A very long description ".repeat(1000),
      number: "long-number-".repeat(100), signature: "signature".repeat(1000), reference: "reference".repeat(1000),
      payerWallet: undefined, merchantWallet: undefined, fontBytes: new Uint8Array([0, 1, 2]),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("measures truncated and wrapped values against actual font widths", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(font.widthOfTextAtSize(fitPdfText("Very long name ".repeat(100), font, 11, 180), 11)).toBeLessThanOrEqual(180);
    expect(fitPdfText("Very long name ".repeat(100), font, 11, 180)).toContain("…");
    const lines = wrapPdfText("4".repeat(200), font, 8, 100, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(100);
  });

  it("sanitizes attachment names and preserves normal invoice numbers", () => {
    expect(receiptPdfFilename("PL-2026-1044")).toBe("paylink-receipt-PL-2026-1044.pdf");
    expect(receiptPdfFilename('bad/number\r\n"; evil')).toMatch(/^paylink-receipt-[A-Za-z0-9_-]+\.pdf$/);
    expect(receiptPdfFilename("../")).toBe("paylink-receipt-receipt.pdf");
  });
});
