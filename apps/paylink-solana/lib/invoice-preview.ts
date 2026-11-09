/** Unconfirmed invoice reviews. Nothing here is an invoice until the merchant confirms. */

export interface InvoicePreviewSettlement {
  mode: "demo" | "live";
  recipient?: string;
}

export interface InvoicePreview {
  id: string;
  description: string;
  amount: string;
  clientName: string | null;
  clientEmail?: string;
  dueDate: string;
  dueLabel: string;
  dueAssumed: boolean;
  network: "devnet" | "mainnet";
  networkLabel: string;
  settlement: InvoicePreviewSettlement;
  expiresAt: number;
  status: "open" | "superseded" | "cancelled";
  invoiceId?: string;
}

const PREVIEWS = new Map<string, InvoicePreview>();
const INFLIGHT = new Map<string, Promise<string>>();
const TTL_MS = 30 * 60 * 1000;

export function resetInvoicePreviews(): void {
  PREVIEWS.clear();
  INFLIGHT.clear();
}

export function getInvoicePreview(id: string): InvoicePreview | undefined {
  return PREVIEWS.get(id);
}

export function saveInvoicePreview(preview: InvoicePreview): InvoicePreview {
  for (const existing of PREVIEWS.values()) {
    if (!existing.invoiceId && existing.status === "open") existing.status = "superseded";
  }
  PREVIEWS.set(preview.id, preview);
  return preview;
}

export function cancelInvoicePreview(id: string): InvoicePreview | undefined {
  const preview = getInvoicePreview(id);
  if (!preview || preview.invoiceId || preview.status !== "open") return preview;
  preview.status = "cancelled";
  return preview;
}

/**
 * Create the invoice at most once. A second confirmation returns the same id.
 * The factory runs only for an open, unexpired review.
 */
export async function confirmInvoicePreview(
  id: string,
  create: (preview: InvoicePreview) => Promise<string>,
): Promise<{ preview: InvoicePreview; invoiceId: string; created: boolean } | { error: "missing" | "superseded" | "cancelled" | "expired" }> {
  const preview = getInvoicePreview(id);
  if (!preview) return { error: "missing" };
  if (preview.invoiceId) return { preview, invoiceId: preview.invoiceId, created: false };
  if (preview.status === "superseded") return { error: "superseded" };
  if (preview.status === "cancelled") return { error: "cancelled" };
  if (preview.expiresAt <= Date.now()) {
    preview.status = "cancelled";
    return { error: "expired" };
  }
  const existing = INFLIGHT.get(id);
  if (existing) {
    const invoiceId = await existing;
    return { preview, invoiceId, created: false };
  }
  const flight = create(preview)
    .then((invoiceId) => {
      preview.invoiceId = invoiceId;
      return invoiceId;
    })
    .finally(() => {
      INFLIGHT.delete(id);
    });
  INFLIGHT.set(id, flight);
  try {
    const invoiceId = await flight;
    return { preview, invoiceId, created: true };
  } catch (error) {
    throw error;
  }
}
