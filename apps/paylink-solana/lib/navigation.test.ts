import { describe, expect, it } from "vitest";
import { activeSection, isInvoiceListView, sectionTabs } from "./navigation";

describe("query-aware merchant navigation", () => {
  it.each([
    ["/dashboard", "", "overview"],
    ["/dashboard", "view=invoices", "invoices"],
    ["/dashboard", "status=pending", "invoices"],
    ["/dashboard", "status=all", "invoices"],
    ["/dashboard", "status=unknown", "invoices"],
    ["/dashboard", "q=Ada", "invoices"],
    ["/dashboard", "view=invoices&status=paid&q=Ada", "invoices"],
    ["/dashboard", "q=%20%20", "overview"],
    ["/dashboard", "status=&q=", "overview"],
    ["/dashboard", "view=overview", "overview"],
    ["/dashboard", "view=overview&status=draft", "invoices"],
    ["/dashboard", "view=unknown&unrelated=1", "overview"],
    ["/dashboard/", "view=invoices", "invoices"],
    ["/invoices/inv_123", "", "invoices"],
    ["/invoices/inv_123", "view=overview", "invoices"],
    ["/chat", "q=Ada", "agent"],
    ["/activity", "", "activity"],
    ["/wallet", "", "wallet"],
    ["/settings", "", "wallet"],
  ])("selects exactly one section for %s?%s", (path, search, expected) => {
    const query = new URLSearchParams(search);
    const params = { view: query.get("view"), status: query.get("status"), q: query.get("q") };
    const active = activeSection(path, params);
    expect(active).toBe(expected);
    expect(sectionTabs.filter((tab) => tab.id === active)).toHaveLength(1);
    if (path.replace(/\/$/, "") === "/dashboard") expect(isInvoiceListView(params)).toBe(active === "invoices");
  });

  it.each(["/pay/inv_123", "/", "/invoices-other", "/chatty", "/dashboard-other"])("does not highlight an unrelated route: %s", (path) => {
    expect(activeSection(path)).toBeNull();
  });
});
