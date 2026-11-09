import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Invoice, MerchantProfile } from "@181hacks/paylink-core";
import { formatLongDate, formatUsdc } from "@181hacks/paylink-core";
import { invoiceStatusCopy } from "./product-copy";
import type { SolanaInvoice } from "./receipt-types";
import { clientLabel } from "./client-name";

const dir = path.join(process.cwd(), "data", "pdfs");

export function pdfPath(invoiceId: string): string {
  return path.join(dir, `${invoiceId}.pdf`);
}

export function readStoredPdf(invoiceId: string): Buffer | null {
  const file = pdfPath(invoiceId);
  if (!existsSync(file)) return null;
  return readFileSync(file);
}

export async function buildInvoicePdf(input: {
  invoice: Invoice;
  merchant: MerchantProfile;
  payUrl?: string;
  settlementSignature?: string;
}): Promise<Uint8Array> {
  const { invoice, merchant } = input;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.09, 0.08);
  const muted = rgb(0.4, 0.38, 0.34);
  const accent = rgb(0.06, 0.43, 0.34);

  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: accent });
  page.drawText("PAYLINK", { x: 48, y: 810, size: 11, font: sans, color: rgb(0.9, 1, 0.96) });
  page.drawText(merchant.name, { x: 48, y: 740, size: 28, font: serifBold, color: ink });
  page.drawText(`${merchant.city}  ·  Invoice ${invoice.number}`, {
    x: 48,
    y: 716,
    size: 11,
    font: sans,
    color: muted,
  });

  page.drawText("Amount due", { x: 48, y: 670, size: 10, font: sans, color: muted });
  page.drawText(`${formatUsdc(invoice.amount)} USDC`, { x: 48, y: 640, size: 32, font: serifBold, color: ink });

  const rows: [string, string][] = [
    ["Bill to", clientLabel(invoice.clientName)],
    ["Email", invoice.clientEmail || "Not provided"],
    ["For", invoice.description],
    ["Due", formatLongDate(invoice.dueDate)],
    ["Status", invoiceStatusCopy[invoice.status]],
    ["Currency", (invoice as SolanaInvoice).settlement?.mode === "live" ? "USDC on Solana mainnet" : "Solana devnet USDC - no monetary value"],
  ];
  let y = 590;
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), { x: 48, y, size: 9, font: sans, color: muted });
    page.drawText(value.slice(0, 80), { x: 160, y: y - 1, size: 12, font: serif, color: ink });
    y -= 28;
  }

  if (input.payUrl) {
    page.drawText("PAYMENT LINK", { x: 48, y: 390, size: 9, font: sans, color: accent });
    const wrapped = wrap(input.payUrl, 78);
    wrapped.forEach((line, index) => {
      page.drawText(line, { x: 48, y: 370 - index * 14, size: 9, font: sans, color: ink });
    });
  }

  page.drawText("PayLink - Invoice document", {
    x: 48,
    y: 72,
    size: 10,
    font: serif,
    color: muted,
  });
  if (input.settlementSignature) {
    page.drawText(`Document payment: ${input.settlementSignature}`, {
      x: 48,
      y: 54,
      size: 8,
      font: sans,
      color: muted,
    });
  }

  const bytes = await doc.save();
  mkdirSync(dir, { recursive: true });
  writeFileSync(pdfPath(invoice.id), bytes);
  return bytes;
}

function wrap(value: string, size: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += size) lines.push(value.slice(i, i + size));
  return lines.slice(0, 6);
}
