import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvoiceMode } from "../components/invoice-mode";
import { StatusPill } from "../components/status-pill";
import { invoiceStatusCopy, actionCopy, paymentPhaseCopy } from "./product-copy";
import type { SettlementInvoice } from "./settlement/types";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("product copy — source and rendering only; no storage, wallet or network access", () => {
  it("labels networks honestly without changing the underlying mode/status keys", () => {
    const invoice = { settlement: { mode: "demo" } } as unknown as SettlementInvoice;
    const devnet = renderToStaticMarkup(createElement(InvoiceMode, { invoice }));
    expect(devnet).toContain("Solana devnet · no monetary value");
    const mainnet = renderToStaticMarkup(createElement(InvoiceMode, { invoice: { settlement: { mode: "live" } } as unknown as SettlementInvoice }));
    expect(mainnet).toContain("Solana mainnet"); expect(mainnet).not.toContain("devnet");
    expect(Object.keys(invoiceStatusCopy)).toEqual(["draft", "pending", "paid", "underpaid", "expired"]);
    expect(renderToStaticMarkup(createElement(StatusPill, { status: "underpaid" }))).toContain("Partially paid");
    expect(renderToStaticMarkup(createElement(StatusPill, { status: "pending" }))).toContain("Awaiting payment");
    expect(actionCopy.create_invoice).toBe("Invoice");
    expect(paymentPhaseCopy.settle).toBe("Confirming payment");
  });

  it("preserves exact-amount, network, expiry, refund-wallet and verification guidance", () => {
    const panel = source("../components/cross-chain-payment.tsx");
    expect(panel).toContain("Send only {attempt.source.symbol} on {attempt.source.name} mainnet.");
    expect(panel).toContain("Sending another token or network may lose funds.");
    expect(panel).toContain("Do not send from an exchange.");
    expect(panel).toContain("Enter a wallet you control, not an exchange address.");
    expect(panel).toContain("Confirm your full refund wallet");
    expect(panel).toContain("Send the exact quoted amount, not this minimum.");
    expect(panel).toContain("Required memo — include with your payment");
    expect(panel).toContain("Quote expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, \"0\")}");
    expect(panel).toContain("We still need to verify the payment before this invoice is marked paid.");
    expect(panel).toContain("A failed payment does not confirm that a refund has arrived.");
    for (const retired of ["Transaction hint recorded", "Submit transaction hint", "Support correlation:", "Attempt:", "Provider reports"]) expect(panel).not.toContain(retired);
  });

  it("keeps preview/devnet receipts honest on web, payer flow and PDFs", () => {
    const payer = source("../components/pay-client.tsx");
    expect(payer).toContain("This invoice uses devnet USDC with no monetary value.");
    expect(payer).toContain("No payment was processed and no receipt was issued.");
    expect(payer).toContain("Do not send mainnet funds.");
    const receipt = source("../app/receipts/[id]/page.tsx");
    expect(receipt).toContain("Preview receipt. No payment was processed.");
    for (const file of ["../app/receipts/[id]/page.tsx", "./receipt-pdf.ts"]) {
      const content = source(file);
      expect(content).toContain("PayLink · Solana mainnet");
      expect(content).toContain("PayLink · Solana devnet · No monetary value");
      expect(content).not.toContain("Devnet only");
    }
  });

  it("removes retired promotional copy and changes only seed-source presentation, not record identifiers", () => {
    const home = source("../app/page.tsx");
    for (const retired of ["HackWiz", "Sample data", "paid in 4s", "asks before it issues"]) expect(home).not.toContain(retired);
    expect(source("./env.ts")).toContain('name: env("MERCHANT_NAME", "Morrow Quay Studio")');
    const seeds = source("./store.ts");
    expect(seeds).toContain('id: "inv_sample_northwind"');
    expect(seeds).toContain('description: "Product packaging illustration"');
    expect(source("./solana.ts")).toContain("memo: invoice.id");
  });
});
