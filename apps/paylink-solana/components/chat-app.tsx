"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatUsdc, type Invoice, type X402TraceStep } from "@181hacks/paylink-core";
import type { InvoicePreview } from "../lib/invoice-preview";
import { Money } from "./keel";
import { InvoiceReview } from "./invoice-review";
import { BudgetMeter } from "./budget-meter";
import { UsdcChip } from "./usdc-chip";
import { StatusPill } from "./status-pill";
import { StreamText } from "./stream-text";
import { actionCopy, paymentPhaseCopy } from "../lib/product-copy";
import { clientLabel } from "../lib/client-name";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  invoice?: Invoice;
  invoices?: Invoice[];
  steps?: X402TraceStep[];
  download?: string;
  preview?: InvoicePreview;
  approval?: {
    resource: "pdf" | "reminder";
    invoiceId: string;
    amount: string;
    clientName: string;
    summary: string;
    paymentRequired: unknown;
  };
  pending?: boolean;
  error?: boolean;
  stream?: boolean;
}

const prompts = [
  "Create an invoice for a website design deposit, two dollars",
  "what's still unpaid?",
  "send Ada a reminder",
  "make a branded PDF for Ada",
];

export function ChatApp({ modelReady, initialPrompt = "" }: { modelReady: boolean; initialPrompt?: string }) {
  const [turns, setTurns] = useState<Turn[]>([
    {
      id: "hello",
      role: "assistant",
      content: "Tell me the work and the amount in a normal sentence. I'll show a review before saving a draft. A reminder or a branded PDF is paid from the agent wallet.",
    },
  ]);
  const [text, setText] = useState(initialPrompt);
  const [receive, setReceive] = useState("demo");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [budget, setBudget] = useState<{ spent: string; total: string; remaining: string } | null>(null);

  useEffect(() => {
    fetch("/api/budget")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { spent?: string; total?: string; remaining?: string } | null) => {
        if (data?.spent && data.total && data.remaining) setBudget({ spent: data.spent, total: data.total, remaining: data.remaining });
      })
      .catch(() => undefined);
  }, []);

  async function send(message: string, approval?: Turn["approval"], action?: { confirmPreviewId?: string; cancelPreviewId?: string }) {
    const history = turns.filter((turn) => !turn.pending).map((turn) => ({ role: turn.role, content: turn.content }));
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      content: action?.confirmPreviewId ? "Save this draft" : action?.cancelPreviewId ? "Cancel this review" : approval ? `Approve ${approval.amount} USDC for the ${approval.resource}` : message,
    };
    setTurns((current) => [...current, userTurn, { id: "pending", role: "assistant", content: "", pending: true }]);
    setText("");
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          settlement: { mode: receive, ...(receive === "live" ? { recipient } : {}) },
          history,
          approval: approval ? { resource: approval.resource, invoiceId: approval.invoiceId } : undefined,
          confirmPreview: action?.confirmPreviewId ? { previewId: action.confirmPreviewId } : undefined,
          cancelPreview: action?.cancelPreviewId ? { previewId: action.cancelPreviewId } : undefined,
          activePreviewId,
        }),
      });
      if (response.status === 401) {
        window.location.href = `/access?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The agent could not answer.");
      if (data.budget) {
        setBudget(data.budget);
        window.dispatchEvent(new CustomEvent("paylink-budget", { detail: data.budget }));
      }
      if (data.invoicePreview?.id) setActivePreviewId(data.invoicePreview.id);
      if (action?.confirmPreviewId || action?.cancelPreviewId) setActivePreviewId(null);
      setTurns((current) => [
        ...current.filter((turn) => turn.id !== "pending"),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply,
          invoice: data.invoice,
          invoices: data.invoices,
          steps: data.steps,
          download: data.download,
          preview: data.invoicePreview,
          approval: data.approval,
          stream: true,
        },
      ]);
    } catch (error) {
      setTurns((current) => [
        ...current.filter((turn) => turn.id !== "pending"),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Something went wrong.",
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="card flex min-h-[72vh] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="t-micro text-muted">Agent</p>
            <h1 className="t-h2">Agent</h1>
          </div>
          <span className="pill">{modelReady ? "AI assistant" : "Invoice commands"}</span>
        </div>
        <div className="grid gap-2 border-b border-line px-5 py-3">
          <label htmlFor="receive-mode" className="t-micro text-muted">Receive (new invoices only)</label>
          <select id="receive-mode" className="field" value={receive} onChange={(event) => setReceive(event.target.value)} disabled={busy}>
            <option value="demo">Solana devnet — USDC with no monetary value</option>
            <option value="live">Solana mainnet — real USDC</option>
          </select>
          {receive === "live" ? <><label htmlFor="mainnet-recipient" className="text-sm">Your Solana mainnet receiving wallet</label><input id="mainnet-recipient" className="field" value={recipient} disabled={busy} onChange={(event) => setRecipient(event.target.value)} placeholder="Solana mainnet wallet address" required /><p className="text-xs text-muted">Real funds. Check this address carefully. It cannot change after the invoice is issued. Receiving on Base is not available.</p></> : null}
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-5 sm:px-5">
          {turns.map((turn) => (
            <motion.article
              key={turn.id}
              className={`max-w-[94%] ${turn.role === "user" ? "ml-auto" : ""}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
            >
              {turn.pending ? (
                <div className="tool-card p-4" aria-live="polite">
                  <p className="t-micro text-muted">Working</p>
                  <div className="sk sk-line" />
                  <div className="sk sk-line short" />
                </div>
              ) : (
                <div className={`rounded-[18px] px-4 py-3 ${turn.role === "user" ? "bg-accent text-accent-ink" : "border border-line bg-paper"} ${turn.error ? "border-danger" : ""}`}>
                  {turn.role === "assistant" ? <StreamText text={turn.content} active={turn.stream} /> : <p className="t-body whitespace-pre-wrap">{turn.content}</p>}
                </div>
              )}
              {turn.preview && !turn.invoice ? (
                <InvoiceReview
                  preview={turn.preview}
                  busy={busy}
                  onConfirm={() => void send("", undefined, { confirmPreviewId: turn.preview?.id })}
                  onCancel={() => void send("", undefined, { cancelPreviewId: turn.preview?.id })}
                />
              ) : null}
              {turn.invoice ? <ToolCard name={toolName(turn.content)} invoice={turn.invoice} /> : null}
              {turn.invoices && turn.invoices.length > 0 ? (
                <div className="tool-card">
                  <header>
                    <span className="t-micro">Outstanding invoices</span>
                    <span className="t-small">{turn.invoices.length}</span>
                  </header>
                  <ul>
                    {turn.invoices.map((invoice) => (
                      <li key={invoice.id} className="border-t border-line">
                        <InvoiceRow invoice={invoice} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {turn.steps ? <Trace steps={turn.steps} /> : null}
              {turn.download ? (
                <a className="btn btn-primary btn-small mt-3" href={turn.download}>
                  Download PDF
                </a>
              ) : null}
              {turn.approval ? (
                <div className="tool-card">
                  <header>
                    <span className="t-micro">Approve · {turn.approval.resource === "pdf" ? "Invoice PDF" : "Reminder"}</span>
                    <span className="t-small">{formatUsdc(turn.approval.amount)} USDC</span>
                  </header>
                  <div className="p-4">
                    <p className="num text-4xl"><Money value={turn.approval.amount} /></p>
                    <p className="t-small mt-2 text-muted">{turn.approval.summary}</p>
                    <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-bg p-3 text-xs leading-relaxed">{JSON.stringify(turn.approval.paymentRequired, null, 2)}</pre>
                    <div className="mt-3 flex gap-2">
                      <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => send("", turn.approval)}>
                        Approve and pay
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() =>
                          setTurns((current) =>
                            current.map((item) =>
                              item.id === turn.id ? { ...item, approval: undefined, content: `${item.content}\n\nDeclined. Nothing left the wallet.` } : item,
                            ),
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </motion.article>
          ))}
        </div>
        <form
          className="border-t border-line p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void send(text.trim());
          }}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <button key={prompt} type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => send(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="agent-message">
              Message
            </label>
            <input id="agent-message" className="field" placeholder="Create an invoice for a website design deposit, two dollars" value={text} onChange={(event) => setText(event.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
              Send
            </button>
          </div>
        </form>
      </section>
      <aside className="space-y-4">
        <div className="card p-5">
          <BudgetMeter spent={budget?.spent ?? "0"} total={budget?.total ?? "5"} label="Assistant spent · devnet" />
          <p className="mt-3 flex items-center gap-2 t-small text-muted">{budget ? <>{formatUsdc(budget.remaining)} <UsdcChip /> left of the devnet cap</> : "Loading the wallet…"}</p>
          <p className="mt-2 t-small text-muted">This is devnet USDC the assistant has paid for reminders and PDFs. It is not money received from clients.</p>
        </div>
        <div className="card p-5">
          <p className="t-micro text-muted">How it works</p>
          <ol className="mt-3 space-y-3 t-small">
            <li>Describe the work and the amount. Review the draft before it is saved.</li>
            <li>Issue the invoice when you want a pay link. The network stays on your selection above.</li>
            <li>Reminders and PDFs are paid from the agent wallet on Solana devnet, after you confirm.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}

function toolName(content: string): string {
  if (/is live|Draft /.test(content)) return "create_invoice";
  if (/branded PDF|\bpdf\b/i.test(content)) return "generate_pdf";
  if (/reminder/i.test(content)) return "send_reminder";
  return "check_status";
}

function ToolCard({ name, invoice }: { name: string; invoice: Invoice }) {
  return (
    <div className="tool-card">
      <header>
        <span className="t-micro">{actionCopy[name]}</span>
        <StatusPill status={invoice.status} />
      </header>
      <InvoiceRow invoice={invoice} />
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <Link href={`/invoices/${invoice.id}`} className="min-w-0">
        <span className="t-micro block text-muted">{invoice.number}</span>
        <span className="display block truncate text-xl">{clientLabel(invoice.clientName)}</span>
      </Link>
      <span className="flex items-center gap-3">
        <span className="num text-2xl"><Money value={invoice.amount} /></span>
        {invoice.status !== "draft" && invoice.payment ? (
          <Link href={`/pay/${invoice.id}`} className="btn btn-primary btn-small">
            Pay link
          </Link>
        ) : null}
      </span>
    </div>
  );
}

function Trace({ steps }: { steps: X402TraceStep[] }) {
  return (
    <ol className="tool-card">
      <li className="px-3 py-2">
        <span className="t-micro text-muted">Payment activity · devnet</span>
      </li>
      {steps.map((step, index) => (
        <li key={`${step.phase}-${index}`} className="border-t border-line px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="t-micro text-muted">
              {paymentPhaseCopy[step.phase] || "Payment update"}
              {step.httpStatus ? ` · ${step.httpStatus}` : ""}
            </span>
            <span className={`t-small ${step.ok ? "text-accent" : "text-warn"}`}>{step.ok ? "Done" : step.code ? "Needs attention" : "Waiting"}</span>
          </div>
          <p className="t-small mt-1">{step.title}</p>
          <p className="t-small text-muted">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}
