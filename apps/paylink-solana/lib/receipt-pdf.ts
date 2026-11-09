import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFString, StandardFonts, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import type { CrossChainReceipt } from "./settlement/types";
import { originExplorer, sourceChainName } from "./aurora/assets";
import { receiptAmountRows, receiptAmountsNote } from "./receipt-amounts";
import { clientLabel, displayClientName } from "./client-name";

export interface ReceiptPdfData {
  number: string;
  merchantName: string;
  clientName?: string;
  description: string;
  amount: string;
  paidAt: string;
  signature?: string;
  payerWallet?: string;
  merchantWallet?: string;
  reference?: string;
  mint?: string;
  crossChain?: CrossChainReceipt;
  /** Supplied by the server adapter, never read from disk by the builder. */
  fontBytes?: Uint8Array;
}

export function receiptPdfFilename(number: string): string {
  const safe = number.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "receipt";
  return `paylink-receipt-${safe}.pdf`;
}

/** USDC display without converting a 64-bit atomic balance to a float. */
export function formatReceiptAmount(amount: string): string {
  if (!/^\d{1,100}(?:\.\d{1,6})?$/.test(amount)) return "Not recorded";
  const [whole = "0", fraction = ""] = amount.split(".");
  const integer = BigInt(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integer}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

function printable(value: string, font: PDFFont): string {
  return Array.from(value.replace(/[\r\n\t]+/g, " ").slice(0, 4096)).map((char) => {
    try { font.encodeText(char); return char; } catch { return "?"; }
  }).join("");
}

export function fitPdfText(value: string, font: PDFFont, size: number, width: number): string {
  const safe = printable(value, font);
  if (font.widthOfTextAtSize(safe, size) <= width) return safe;
  const ellipsis = printable("…", font);
  if (font.widthOfTextAtSize(ellipsis, size) > width) return "";
  const chars = Array.from(safe);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${chars.slice(0, mid).join("")}${ellipsis}`, size) <= width) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join("")}${ellipsis}`;
}

export function wrapPdfText(value: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const chars = Array.from(printable(value, font));
  const lines: string[] = [];
  let line = "";
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    if (font.widthOfTextAtSize(line + char, size) > width && line) {
      lines.push(line);
      line = "";
      if (lines.length === maxLines - 1) {
        lines.push(fitPdfText(chars.slice(index).join(""), font, size, width));
        return lines;
      }
    }
    line += char;
  }
  if (line) lines.push(line);
  return lines;
}

/** Pure data -> PDF bytes: no files, database, environment, or RPC calls. */
export async function buildReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const paid = new Date(data.paidAt);
  const validDate = Number.isFinite(paid.getTime());
  const timestamp = validDate ? paid : new Date(0);
  doc.setCreationDate(timestamp);
  doc.setModificationDate(timestamp);
  doc.setTitle(`PayLink receipt ${data.number.slice(0, 120)}`);
  doc.setAuthor("PayLink");
  const page = doc.addPage([595, 842]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  let sans = regular;
  if (data.fontBytes) {
    try {
      doc.registerFontkit(fontkit);
      sans = await doc.embedFont(data.fontBytes, { subset: true });
    } catch { /* Missing/invalid font assets must not prevent a receipt download. */ }
  }
  const ink = rgb(24 / 255, 28 / 255, 37 / 255);
  const muted = rgb(107 / 255, 111 / 255, 120 / 255);
  const mint = rgb(113 / 255, 252 / 255, 143 / 255);
  const line = rgb(217 / 255, 220 / 255, 225 / 255);
  const pale = rgb(243 / 255, 244 / 255, 246 / 255);
  const pageGrey = rgb(238 / 255, 239 / 255, 242 / 255);
  const stampFill = rgb(232 / 255, 1, 238 / 255);
  const stampGreen = rgb(31 / 255, 157 / 255, 85 / 255);
  const chipFill = rgb(230 / 255, 238 / 255, 1);
  const chipBlue = rgb(47 / 255, 91 / 255, 211 / 255);
  const mintInk = rgb(11 / 255, 26 / 255, 16 / 255);
  const white = rgb(1, 1, 1);
  const proofLine = rgb(49 / 255, 55 / 255, 68 / 255);
  const proofMuted = rgb(154 / 255, 160 / 255, 170 / 255);
  const height = page.getHeight();

  function panel(x: number, top: number, width: number, h: number, color: RGB, radius = 12) {
    const y = height - top - h;
    page.drawRectangle({ x: x + radius, y, width: width - 2 * radius, height: h, color });
    page.drawRectangle({ x, y: y + radius, width, height: h - 2 * radius, color });
    for (const cx of [x + radius, x + width - radius]) {
      for (const cy of [y + radius, y + h - radius]) page.drawCircle({ x: cx, y: cy, size: radius, color });
    }
  }
  function text(value: string, x: number, top: number, size = 11, font = sans, color = ink, width = 475, right = false) {
    const fitted = fitPdfText(value, font, size, width);
    page.drawText(fitted, { x: right ? x - font.widthOfTextAtSize(fitted, size) : x, y: height - top - size, size, font, color });
  }
  function divider(top: number, x = 60, right = 535, color = line) {
    page.drawLine({ start: { x, y: height - top }, end: { x: right, y: height - top }, thickness: 0.5, color });
  }
  const total = formatReceiptAmount(data.amount);
  const short = (value?: string, count = 8) => !value ? "Not recorded" : value.length <= count * 2 + 1 ? value : `${value.slice(0, count)}…${value.slice(-count)}`;
  const day = validDate ? paid.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "Not recorded";
  const time = validDate ? `${paid.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT` : "Not recorded";
  const explorer = data.signature && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(data.signature) ? `https://explorer.solana.com/tx/${encodeURIComponent(data.signature)}${data.crossChain ? "" : "?cluster=devnet"}` : undefined;

  page.drawRectangle({ x: 0, y: 0, width: 595, height, color: pageGrey });
  panel(24, 24, 547, 794, white, 20);
  panel(44, 44, 42, 42, ink, 10);
  const initials = data.merchantName.split(/\s+/).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase() || "P";
  text(initials, 56, 55, 16, sans, white, 24);
  text(data.merchantName, 98, 44, 18, sans, ink, 437);
  text(`Receipt ${data.number}`, 98, 69, 10, sans, muted, 437);

  // Rotate the whole outlined stamp as one group, including a vector checkmark.
  const angle = -6 * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = 492;
  const cy = height - 140;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy));
  panel(449, 124, 86, 33, stampGreen, 9);
  panel(450.4, 125.4, 83.2, 30.2, stampFill, 7.6);
  page.drawLine({ start: { x: 459, y: height - 140 }, end: { x: 464, y: height - 145 }, thickness: 1.8, color: stampGreen });
  page.drawLine({ start: { x: 464, y: height - 145 }, end: { x: 472, y: height - 135 }, thickness: 1.8, color: stampGreen });
  text("PAID", 481, 132, 12, bold, stampGreen, 45);
  page.pushOperators(popGraphicsState());
  page.drawCircle({ x: 48, y: height - 121, size: 3, color: mint });
  text("PAYMENT RECEIVED", 60, 114, 9, sans, muted);
  const clientName = displayClientName(data.clientName);
  const greeting = printable(clientName ? "Thanks, " : "Payment received", sans);
  const greetingWidth = sans.widthOfTextAtSize(greeting, 24);
  text(greeting, 44, 138, 24, sans, ink, 385);
  if (clientName) text(clientName, 44 + greetingWidth, 138, 24, bold, ink, 385 - greetingWidth);
  const subtitleEnd = data.crossChain ? " has been paid in full." : " · Solana devnet. No monetary value.";
  const subtitleName = fitPdfText(data.merchantName, sans, 10, 507 - sans.widthOfTextAtSize(subtitleEnd, 10));
  text(subtitleName + subtitleEnd, 44, 169, 10, sans, muted, 507);
  text("Invoice amount", 44, data.crossChain ? 198 : 190, data.crossChain ? 9 : 10, sans, muted);
  const [whole, fraction] = total.split(".");
  const cents = fraction ? `.${fraction}` : "";
  const amountWidth = 507 - 60 - 10;
  const headlineSize = data.crossChain ? 33 : 40;
  let amountSize = headlineSize;
  while (amountSize > 18 && sans.widthOfTextAtSize(printable(`$${total}`, sans), amountSize) > amountWidth) amountSize--;
  const centsWidth = sans.widthOfTextAtSize(cents, amountSize);
  const wholeText = fitPdfText(`$${whole}`, sans, amountSize, amountWidth - centsWidth);
  const wholeWidth = sans.widthOfTextAtSize(wholeText, amountSize);
  const amountTop = 247 - amountSize;
  text(wholeText, 44, amountTop, amountSize, sans, ink, amountWidth - centsWidth);
  text(cents, 44 + wholeWidth, amountTop, amountSize, sans, muted, centsWidth);
  const chipX = 44 + wholeWidth + centsWidth + 10;
  const chipTop = amountTop + (amountSize - 24) / 2;
  panel(chipX, chipTop, 60, 24, chipFill, 8);
  text("USDC", chipX + 14, chipTop + 6, 10, bold, chipBlue, 40);

  panel(44, 258, 507, 174, pale);
  const rows = [["Paid by", clientLabel(data.clientName)], ["For", data.description], ["Invoice", data.number], ["Date", day], ["Time", time], ["Status", "Paid"],
    ...(data.crossChain ? receiptAmountRows(data.crossChain) : [])];
  rows.forEach(([label, value], index) => {
    const top = 267 + index * (data.crossChain ? 17 : 29);
    text(label!, 60, top, data.crossChain ? 9 : 10, sans, muted, data.crossChain ? 155 : 115);
    text(value!, 535, top, data.crossChain ? 9 : 11, sans, ink, data.crossChain ? 310 : 340, true);
    if (index < rows.length - 1) divider(top + (data.crossChain ? 13 : 20));
  });
  panel(44, 442, 507, 42, ink);
  text("Total", 60, 456, 11, sans, proofMuted, 80);
  text(`$${total} USDC`, 535, 451, 20, sans, white, 360, true);
  if (data.crossChain) text(receiptAmountsNote, 44, 485, 6, sans, muted, 507);

  panel(44, 498, 507, 264, ink, 14);
  text("PAYMENT RECORD", 60, 513, 9, sans, proofMuted);
  text("Settled on Solana", 60, 531, 18, sans, white, 350);
  const proof = [
    ["Network", data.crossChain ? "Solana mainnet" : "Solana devnet"], ["Token", `USDC (${short(data.mint, 5)})`],
    ["Payer wallet*", short(data.payerWallet)], ["Merchant wallet", short(data.merchantWallet)],
    ["Reference", data.reference || "Not recorded"], ["Transaction", short(data.signature)],
  ];
  proof.forEach(([label, value], index) => {
    const top = 559 + index * 19;
    text(label!, 60, top, 9, sans, proofMuted, 100);
    text(value!, 428, top, 9, sans, white, 250, true);
    if (index < proof.length - 1) divider(top + 15, 60, 428, proofLine);
  });
  if (explorer) {
    const png = await QRCode.toBuffer(explorer, { type: "png", width: 172, margin: 1, errorCorrectionLevel: "M" });
    const image = await doc.embedPng(png);
    page.drawImage(image, { x: 449, y: height - 552 - 86, width: 86, height: 86 });
    text("Scan to verify", 449, 644, 7, sans, proofMuted, 86);
  }
  text("* Transaction fee payer (may be a sponsor).", 60, 679, 7, sans, proofMuted);
  wrapPdfText(data.signature || "Signature not recorded", mono, 8, 475, data.crossChain ? 2 : 3).forEach((part, index) => text(part, 60, 693 + index * 9, 8, mono, white));
  const sourceUrl = data.crossChain?.originTxHash ? originExplorer(data.crossChain.sourceChain, data.crossChain.originTxHash) : undefined;
  if (sourceUrl && data.crossChain) {
    text(`Source transaction (${sourceChainName(data.crossChain.sourceChain)}): ${short(data.crossChain.originTxHash, 10)}`, 60, 713, 7, sans, mint, 475);
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [60, height - 723, 535, height - 711], Border: [0, 0, 0], A: { Type: "Action", S: PDFName.of("URI"), URI: PDFString.of(sourceUrl) } })));
  }
  if (explorer) {
    panel(60, 725, 475, 27, mint, 9);
    const buttonLabel = printable("View on Solana Explorer", sans);
    const labelWidth = sans.widthOfTextAtSize(buttonLabel, 10);
    const labelX = 60 + (475 - labelWidth - 16) / 2;
    text(buttonLabel, labelX, 733, 10, sans, mintInk, 440);
    const arrowX = labelX + labelWidth + 8;
    page.drawLine({ start: { x: arrowX, y: height - 743 }, end: { x: arrowX + 7, y: height - 736 }, thickness: 1.1, color: mintInk });
    page.drawLine({ start: { x: arrowX + 1, y: height - 736 }, end: { x: arrowX + 7, y: height - 736 }, thickness: 1.1, color: mintInk });
    page.drawLine({ start: { x: arrowX + 7, y: height - 736 }, end: { x: arrowX + 7, y: height - 742 }, thickness: 1.1, color: mintInk });
    const annotation = doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [60, height - 752, 535, height - 725], Border: [0, 0, 0],
      A: { Type: "Action", S: PDFName.of("URI"), URI: PDFString.of(explorer) },
    });
    page.node.addAnnot(doc.context.register(annotation));
  }
  const footer = printable(data.crossChain ? "PayLink · Solana mainnet" : "PayLink · Solana devnet · No monetary value", sans);
  text(footer, (595 - sans.widthOfTextAtSize(footer, 9)) / 2, 786, 9, sans, muted, 475);
  return doc.save();
}
