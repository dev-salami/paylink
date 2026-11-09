"use client";

import { useId, useRef, useState } from "react";
import { copyPayLink, publicPayUrl, type CopyResult } from "../lib/payer-link";

export function ShareLink({ id, label, className = "btn btn-ghost btn-small" }: { id: string; label?: string; className?: string }) {
  const [result, setResult] = useState<CopyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const feedbackId = useId();

  async function copy() {
    setBusy(true);
    setResult(null);
    const link = publicPayUrl(window.location.origin, id);
    setUrl(link);
    const next = await copyPayLink(link, navigator);
    setResult(next);
    setBusy(false);
  }

  return (
    <div className="min-w-0 max-w-sm">
      <button
        type="button"
        className={`${className} payer-link-control`}
        disabled={busy}
        aria-label={label ? `Copy pay link for ${label}` : "Copy pay link"}
        aria-describedby={result ? feedbackId : undefined}
        onClick={() => void copy()}
      >
        {busy ? "Copying…" : result === "copied" ? "Link copied" : "Copy pay link"}
      </button>
      <CopyLinkFeedback result={result} url={url} label={label} feedbackId={feedbackId} />
    </div>
  );
}

export function CopyLinkFeedback({ result, url, label, feedbackId }: { result: CopyResult | null; url: string; label?: string; feedbackId: string }) {
  const fallbackId = useId();
  const input = useRef<HTMLInputElement>(null);
  const fallback = result === "failed" || result === "unavailable";
  return (
    <>
      <p id={feedbackId} role="status" aria-live="polite" className="mt-1 text-xs">
        {result === "copied" ? "Pay link copied." : result === "failed" ? "Copy failed. Select and copy the link below." : result === "unavailable" ? "Clipboard unavailable. Select and copy the link below." : ""}
      </p>
      {fallback ? (
        <div className="mt-2 grid gap-2">
          <label htmlFor={fallbackId} className="text-xs">Public pay link{label ? ` for ${label}` : ""}</label>
          <input
            id={fallbackId}
            ref={input}
            type="text"
            readOnly
            value={url}
            className="field min-w-0 text-sm text-ink"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="btn btn-ghost btn-small payer-link-control text-ink" onClick={() => { input.current?.focus(); input.current?.select(); }}>
            Select link
          </button>
        </div>
      ) : null}
    </>
  );
}
