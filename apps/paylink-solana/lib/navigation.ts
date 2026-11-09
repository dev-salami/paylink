export interface DashboardView {
  view?: string | null;
  status?: string | null;
  q?: string | null;
}

/** Keep the dashboard layout and the selected section on the same rules. */
export function isInvoiceListView(params: DashboardView): boolean {
  return params.view === "invoices" || Boolean(params.status) || Boolean(params.q?.trim());
}

export const sectionTabs = [
  { id: "overview", href: "/dashboard", label: "Overview" },
  { id: "invoices", href: "/dashboard?view=invoices", label: "Invoices" },
  { id: "agent", href: "/chat", label: "Agent" },
  { id: "activity", href: "/activity", label: "Activity" },
  { id: "wallet", href: "/wallet", label: "Wallet" },
] as const;

export type Section = (typeof sectionTabs)[number]["id"];

/** A single section, never overlapping pathname predicates. */
export function activeSection(pathname: string, params: DashboardView = {}): Section | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const within = (root: string) => path === root || path.startsWith(`${root}/`);
  if (path === "/dashboard") return isInvoiceListView(params) ? "invoices" : "overview";
  if (within("/invoices")) return "invoices";
  if (within("/chat")) return "agent";
  if (within("/activity")) return "activity";
  if (within("/wallet") || within("/settings")) return "wallet";
  return null;
}
