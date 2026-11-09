"use client";

import { useState } from "react";

/** Confirms before a draft becomes payable. Does not send email. */
export function IssueDraftButton({ id }: { id: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "working">("idle");
  const [error, setError] = useState("");

  async function issue() {
    setStep("working");
    setError("");
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/issue`, { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (response.status === 401) {
        window.location.href = `/access?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!response.ok) throw new Error(data.error || "The invoice could not be issued.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invoice could not be issued.");
      setStep("confirm");
    }
  }

  if (step === "idle") {
    return (
      <button type="button" className="btn btn-primary btn-small" onClick={() => setStep("confirm")}>
        Issue invoice
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted">Issuing opens a pay link. It does not send an email.</p>
      <button type="button" className="btn btn-primary btn-small" disabled={step === "working"} onClick={() => void issue()}>
        {step === "working" ? "Issuing…" : "Confirm and issue"}
      </button>
      <button type="button" className="btn btn-ghost btn-small" disabled={step === "working"} onClick={() => setStep("idle")}>
        Back
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
