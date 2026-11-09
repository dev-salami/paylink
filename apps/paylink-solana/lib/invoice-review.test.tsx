import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvoiceReview } from "../components/invoice-review";
import type { InvoicePreview } from "./invoice-preview";

const preview: InvoicePreview = {
  id: "prv_test",
  description: "website design deposit",
  amount: "2",
  clientName: null,
  dueDate: "2026-11-15",
  dueLabel: "Sunday, 15 Nov 2026",
  dueAssumed: true,
  network: "devnet",
  networkLabel: "Solana devnet · USDC with no monetary value. The network selected above stays in control.",
  settlement: { mode: "demo" },
  expiresAt: Date.now() + 60_000,
  status: "open",
};

describe("invoice review", () => {
  it("shows the draft for confirmation and does not present it as saved", () => {
    const html = renderToStaticMarkup(createElement(InvoiceReview, { preview, busy: false, onConfirm: () => undefined, onCancel: () => undefined }));
    expect(html).toContain("website design deposit");
    expect(html).toContain("Save draft");
    expect(html).toContain("draft not saved");
    expect(html).toContain("Solana devnet");
    expect(html).toContain("No client named");
    expect(html).not.toContain("150 USDC");
  });
});
