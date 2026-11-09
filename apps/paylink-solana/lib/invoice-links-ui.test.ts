import { readFileSync } from "node:fs";
import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SectionTabs } from "../components/section-tabs";
import { PayerLinkActions } from "../components/payer-link-actions";
import { CopyLinkFeedback } from "../components/share-link";

const location = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props),
}));

describe("rendered navigation", () => {
  it.each([
    ["/dashboard", "", "Overview"],
    ["/dashboard", "view=invoices", "Invoices"],
    ["/dashboard", "status=paid&q=Ada", "Invoices"],
    ["/dashboard", "q=Ada", "Invoices"],
    ["/dashboard", "q=%20%20", "Overview"],
    ["/invoices/inv_123", "", "Invoices"],
  ])("marks only %s?%s's actual section current", (pathname, search, label) => {
    Object.assign(location, { pathname, search });
    const html = renderToStaticMarkup(createElement(SectionTabs));
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>(.*?)<\/a>/g)].map((match) => match[1])).toEqual([label]);
  });
});

describe("payer actions and clipboard feedback", () => {
  it.each(["pending", "underpaid", "expired", "paid"])("provides separate accessible copy/open controls for %s invoices", (status) => {
    const html = renderToStaticMarkup(createElement(PayerLinkActions, { id: "inv_123", status, label: "PL-1041" }));
    expect(html).toContain('aria-label="Copy pay link for PL-1041"');
    expect(html).toContain('aria-label="Open pay page for PL-1041"');
    expect(html).toContain('href="/pay/inv_123"');
    expect(html).not.toContain('/invoices/');
    expect(html).not.toMatch(/<a\b[^>]*>[^]*?<button/);
  });

  it("keeps draft preview open but never enables draft pay-link copying", () => {
    const html = renderToStaticMarkup(createElement(PayerLinkActions, { id: "inv_draft", status: "draft", label: "Draft" }));
    expect(html).toContain('href="/pay/inv_draft"');
    expect(html).not.toContain("Copy pay link");
  });

  it("announces successful copying without an unnecessary manual fallback", () => {
    const html = renderToStaticMarkup(createElement(CopyLinkFeedback, { result: "copied", url: "https://merchant.example/pay/inv_123", feedbackId: "copy-status" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Pay link copied.");
    expect(html).not.toContain("<input");
  });

  it.each(["failed", "unavailable"] as const)("offers a labeled, selectable public URL after clipboard %s", (result) => {
    const html = renderToStaticMarkup(createElement(CopyLinkFeedback, { result, url: "https://merchant.example/pay/inv_123", feedbackId: "copy-status", label: "PL-1041" }));
    expect(html).toContain(result === "failed" ? "Copy failed." : "Clipboard unavailable.");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Public pay link for PL-1041");
    expect(html).toMatch(/<label for="[^"]+"/);
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain('value="https://merchant.example/pay/inv_123"');
    expect(html).toContain("Select link");
  });

  it("wires the same actions into both list rows and invoice detail without changing customer links", () => {
    const list = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("../app/invoices/[id]/page.tsx", import.meta.url), "utf8");
    for (const source of [list, detail]) {
      expect(source).toContain('<PayerLinkActions id={invoice.id} status={invoice.status} label={invoice.number} />');
    }
    expect(list).toContain('<Link href={`/invoices/${invoice.id}`}>{clientLabel(invoice.clientName)}</Link>');
    expect(list).not.toContain("Development fixtures");
    expect(list).not.toContain("development fixture");
    expect(list).toContain("isInvoiceListView(params)");
  });
});
