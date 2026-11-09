"use client";

import { useState, type FormEvent } from "react";
import type { BudgetView, SpendEntry } from "@181hacks/paylink-core";
import { Money } from "./keel";
import { formatUsdc } from "@181hacks/paylink-core";
import { BudgetMeter } from "./budget-meter";
import { UsdcChip } from "./usdc-chip";
import { actionCopy, spendStatusCopy } from "../lib/product-copy";

export function WalletPanel(props: {
  budget: BudgetView;
  spends: SpendEntry[];
  agent: string;
  merchant: string;
  mint: string;
  agentUrl: string;
  merchantUrl: string;
}) {
  const [form, setForm] = useState({
    total: props.budget.total,
    perCall: props.budget.perCall,
    approveAbove: props.budget.approveAbove,
  });
  const [budget, setBudget] = useState(props.budget);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not save the budget.");
      return;
    }
    setBudget(data);
    setMessage("Budget saved. The next agent call uses these limits.");
  }

  async function reset() {
    if (!window.confirm("This deletes the invoices, receipts and spend history in this shared workspace, including real records, and restores development fixtures. It cannot be undone.")) return;
    await fetch("/api/demo/reset", { method: "POST" });
    window.location.href = "/dashboard";
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="card p-6">
        <p className="t-micro text-muted">Agent wallet</p>
        <h1 className="t-h1 mt-2">Spend controls</h1>
        <p className="mt-3 max-w-xl text-muted">
          Reminders and PDFs are paid from the agent’s Solana devnet wallet, within these limits. Amounts above your approval limit wait for you. Devnet USDC has no monetary value.
        </p>
        <div className="mt-8">
          <div className="flex items-end justify-between">
            <p className="num text-5xl"><Money value={budget.remaining} /></p>
            <p className="mt-1 flex items-center justify-end gap-2 text-sm text-muted"><UsdcChip /> left of {formatUsdc(budget.total)}</p>
          </div>
          <div className="mt-4">
            <BudgetMeter spent={budget.spent} total={budget.total} label="Used" />
          </div>
        </div>
        <form className="mt-8 grid gap-4 sm:grid-cols-3" onSubmit={(event) => void save(event)}>
          <Field label="Total cap" value={form.total} onChange={(value) => setForm({ ...form, total: value })} />
          <Field label="Per-call cap" value={form.perCall} onChange={(value) => setForm({ ...form, perCall: value })} />
          <Field label="Approve above" value={form.approveAbove} onChange={(value) => setForm({ ...form, approveAbove: value })} />
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit">
              Save limits
            </button>
            {message ? <p className="text-sm text-accent">{message}</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
        </form>
        <dl className="mt-8 space-y-3 text-sm">
          <Key label="Agent" value={props.agent} href={props.agentUrl} />
          <Key label="Merchant" value={props.merchant} href={props.merchantUrl} />
          <Key label="USDC mint" token value={props.mint} href={`https://explorer.solana.com/address/${props.mint}?cluster=devnet`} />
        </dl>
        <button type="button" className="btn btn-ghost btn-small mt-6" onClick={() => void reset()}>
          Reset workspace to development fixtures
        </button>
      </section>
      <section className="card p-6">
        <h2 className="t-h2">Spend log</h2>
        {props.spends.length === 0 ? (
          <div className="mt-4">
            <p className="t-small text-muted">No spending yet. Payments for reminders and PDFs appear here with their Solana devnet transaction.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {props.spends.map((spend) => (
              <li key={spend.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="capitalize">{actionCopy[spend.resource] || "Payment"}</p>
                  <p className="text-sm text-muted">{spendStatusCopy[spend.status] || "Needs attention"}</p>
                  {spend.explorerUrl ? (
                    <a className="text-sm underline" href={spend.explorerUrl}>
                      Transaction
                    </a>
                  ) : null}
                </div>
                <p className="num text-2xl"><Money value={spend.amount} /></p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <label className="block text-sm" htmlFor={id}>
      <span className="mb-1 block text-muted">{label}</span>
      <input id={id} className="field" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Key({ label, value, href, token = false }: { label: string; value: string; href: string; token?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={token ? "usdc font-bold" : "text-muted"}>{label}</dt>
      <dd>
        <a className="font-mono text-xs underline" href={href}>
          {value.slice(0, 4)}…{value.slice(-4)}
        </a>
      </dd>
    </div>
  );
}
