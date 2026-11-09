"use client";

import { Fragment, useState } from "react";
import { X402_FAILURES, type X402FailureCode, type X402TraceStep } from "@181hacks/paylink-core";
import { paymentCheckCopy } from "../lib/product-copy";

interface LabCase {
  code: X402FailureCode;
  title: string;
  summary: string;
  charged: boolean;
  detail: string;
  httpStatus?: number;
  steps?: X402TraceStep[];
}

export function LabPanel({ initial }: { initial: LabCase[] }) {
  const [cases, setCases] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [probe, setProbe] = useState<string>("");
  const [probeError, setProbeError] = useState("");

  async function rerun(code: X402FailureCode) {
    setRunning(code);
    const response = await fetch("/api/x402/lab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = (await response.json()) as LabCase;
    if (!response.ok || !data.code) {
      setRunning(null);
      return;
    }
    setCases((current) => current.map((item) => (item.code === code ? data : item)));
    setOpen(code);
    setRunning(null);
  }

  async function live402(invoiceId: string) {
    setProbeError("");
    setProbe("Requesting…");
    const response = await fetch(`/api/x402/pdf?invoice=${invoiceId}`);
    const header = response.headers.get("payment-required");
    const body = await response.text();
    if (!response.ok && response.status !== 402) {
      setProbe("");
      setProbeError(body);
      return;
    }
    setProbe(`HTTP ${response.status}\nPAYMENT-REQUIRED: ${header?.slice(0, 80) ?? "(missing)"}…\n\n${body}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-h2">Payment checks</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void Promise.all(X402_FAILURES.map((code) => rerun(code)))}>
          Run checks again
        </button>
      </div>
      <div className="overflow-hidden rounded-[22px] border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-elev text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Would charge</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => (
              <Fragment key={item.code}>
                <tr className="border-t border-line bg-paper">
                  <td className="px-4 py-3">
                    <p>{paymentCheckCopy[item.code]?.title || item.title}</p>
                    <p className="text-muted">{paymentCheckCopy[item.code]?.summary || item.summary}</p>
                  </td>
                  <td className="px-4 py-3">{item.httpStatus ?? "—"}</td>
                  <td className="hidden px-4 py-3 md:table-cell">{item.charged ? "Yes, once" : "No"}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void rerun(item.code)} disabled={running === item.code}>
                      {open === item.code ? "Checked" : "Check"}
                    </button>
                  </td>
                </tr>
                {open === item.code ? (
                  <tr className="border-t border-line bg-bg">
                    <td colSpan={4} className="px-4 py-3 text-muted">
                      {paymentCheckCopy[item.code]?.detail || item.detail}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <LiveProbe onProbe={live402} probe={probe} error={probeError} />
    </div>
  );
}

function LiveProbe({
  onProbe,
  probe,
  error,
}: {
  onProbe: (invoiceId: string) => void;
  probe: string;
  error: string;
}) {
  const [invoiceId, setInvoiceId] = useState("");
  return (
    <div className="card p-5">
      <h3 className="t-h2">Payment request details</h3>
      <p className="mt-2 text-sm text-muted">View the payment requirements for an invoice PDF. This request does not make a payment.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="field max-w-xs" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} aria-label="Invoice id" />
        <button type="button" className="btn btn-primary btn-small" onClick={() => onProbe(invoiceId)}>
          Request without paying
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {probe ? <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-bg p-3 text-xs">{probe}</pre> : null}
    </div>
  );
}
