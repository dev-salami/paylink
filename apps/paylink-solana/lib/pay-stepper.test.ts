import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayStepper } from "../components/pay-stepper";

describe("payer progress and receipt download wiring", () => {
  it.each([1, 2, 3] as const)("marks exactly step %s current and prior steps completed", (step) => {
    const html = renderToStaticMarkup(createElement(PayStepper, { step }));
    expect(html).toContain('aria-label="Payment progress"');
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(3);
    expect([...html.matchAll(/aria-current="step"/g)]).toHaveLength(1);
    expect([...html.matchAll(/class="done"/g)]).toHaveLength(step - 1);
    for (const label of ["Review", "Pay", "Done"]) expect(html).toContain(label);
  });

  it("uses flexible connector lines without a mobile wrapping rule", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".stepper li:not(:last-child)::after");
    expect(css).toMatch(/\.stepper\s*\{[^}]*flex-wrap: nowrap/);
    expect(css).not.toMatch(/\.stepper\s*\{[^}]*flex-wrap: wrap[; ]/);
    expect(css).toMatch(/\.k-tab\s*\{[^}]*border: 1px solid var\(--line\)/);
  });

  it("replaces the browser text download with plain attachment navigation on both payer surfaces", () => {
    const payer = readFileSync(new URL("../components/pay-client.tsx", import.meta.url), "utf8");
    const receipt = readFileSync(new URL("../app/receipts/[id]/page.tsx", import.meta.url), "utf8");
    expect(payer).toContain("/receipt.pdf");
    expect(payer).not.toContain("downloadReceipt(");
    expect(payer).not.toContain("receipt.txt");
    expect(payer).toContain("Open receipt");
    expect(receipt).toContain("Download PDF");
    expect(receipt).toContain("encodeURIComponent(receipt.id)");
  });
});
