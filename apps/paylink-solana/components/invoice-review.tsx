"use client";

import { formatUsdc } from "@181hacks/paylink-core";
import type { InvoicePreview } from "../lib/invoice-preview";
import { Money } from "./keel";

export function InvoiceReview({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: InvoicePreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="tool-card">
      <header>
        <span className="t-micro">Review · draft not saved</span>
        <span className="t-small">{formatUsdc(preview.amount)} USDC</span>
      </header>
      <div className="p-4">
        <p className="display text-xl">{preview.description}</p>
        <p className="num mt-2 text-4xl">
          <Money value={preview.amount} />
        </p>
        <p className="t-small mt-2 text-muted">{preview.clientName ?? "No client named"}</p>
        <p className="t-small text-muted">
          Due {preview.dueLabel}
          {preview.dueAssumed ? " · assumed, 7 days from today" : ""}
        </p>
        <p className="t-small mt-2 text-muted">{preview.networkLabel}</p>
        <p className="t-small mt-2">Nothing is saved until you confirm. Reply to change the amount or the description.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={onConfirm}>
            Save draft
          </button>
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
