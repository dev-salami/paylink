"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ShellAlert } from "./shell-data";
import { ThemeToggle } from "./theme-toggle";
import { SectionTabLinks, SectionTabs } from "./section-tabs";

const icons: Record<string, string> = {
  approval: "☑",
  invoice_created: "＋",
  invoice_issued: "↗",
  status_changed: "↓",
  receipt_issued: "✓",
  email_sent: "✉",
  x402_request: "⚡",
  x402_settled: "⚡",
  x402_delivered: "⚡",
  x402_failed: "!",
  budget_changed: "◔",
  note: "•",
};

function ago(at: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function Shell({
  children,
  merchantName = "Morrow Quay Studio",
  alerts = [],
}: {
  children: React.ReactNode;
  openCount?: number;
  merchantName?: string;
  payHref?: string;
  alerts?: ShellAlert[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<number>(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeenAt(Number(localStorage.getItem("paylink-alerts-seen") || 0));
    try {
      const stored = JSON.parse(sessionStorage.getItem("paylink-declined-approvals") || "[]") as unknown;
      if (Array.isArray(stored)) setDismissed(stored.filter((id): id is string => typeof id === "string"));
    } catch {
      // A bad session value just means the approval shows again.
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const visible = alerts.filter((alert) => !dismissed.includes(alert.id));
  const unread = visible.filter((alert) => alert.approval || new Date(alert.at).getTime() > seenAt);
  const rows = unreadOnly ? unread : visible;
  const initials = merchantName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function dismiss(id: string) {
    setDismissed((list) => {
      const next = list.includes(id) ? list : [...list, id];
      sessionStorage.setItem("paylink-declined-approvals", JSON.stringify(next));
      return next;
    });
  }

  function toggle() {
    setOpen((value) => !value);
    const now = Date.now();
    localStorage.setItem("paylink-alerts-seen", String(now));
  }

  async function accept(alert: ShellAlert) {
    if (!alert.approval) return;
    setBusy(alert.id);
    setNote(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approval: { resource: alert.approval.resource, invoiceId: alert.approval.invoiceId } }),
      });
      if (response.status === 401) {
        window.location.href = `/access?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const data = (await response.json()) as { reply?: string; error?: string };
      setNote(data.reply ?? data.error ?? "Done.");
      setDismissed((list) => [...list, alert.id]);
      router.refresh();
    } catch {
      setNote("The agent could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="k-top">
        <Link href="/" className="k-logo" aria-label="PayLink home">
          P
        </Link>
        <span className="hidden flex-1 lg:block" />
        <Suspense fallback={<SectionTabLinks />}>
          <SectionTabs />
        </Suspense>
        <span className="flex-1 lg:hidden" />
        <div className="relative flex items-center gap-2" ref={box}>
          <button type="button" className="k-icon" aria-label="Alerts" aria-expanded={open} onClick={toggle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread.length ? <span className="k-dot" /> : null}
          </button>
          <span className="k-avatar" title={merchantName}>
            {initials}
          </span>
          <ThemeToggle />
          <form action="/api/access/logout" method="post">
            <button type="submit" className="btn btn-ghost btn-small">
              Sign out
            </button>
          </form>
          {open ? (
            <div className="k-pop" role="dialog" aria-label="Alerts">
              <div className="mb-2 flex items-center justify-between px-2">
                <h2 className="text-lg">Alerts</h2>
                <div className="k-seg" role="group" aria-label="Filter alerts">
                  <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
                  <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</button>
                </div>
              </div>
              {note ? <p className="mx-2 mb-2 rounded-xl bg-elev px-3 py-2 text-sm">{note}</p> : null}
              <div className="max-h-[60vh] overflow-y-auto">
                {rows.length === 0 ? <p className="px-2 py-6 text-sm text-muted">You are all caught up.</p> : null}
                {rows.map((alert) => (
                  <div key={alert.id} className={`k-row ${alert.approval ? "hl" : ""}`}>
                    <span className="k-tile" aria-hidden>{icons[alert.kind] ?? "•"}</span>
                    <div className="min-w-0">
                      {alert.href && !alert.approval ? (
                        <Link href={alert.href} className="block truncate">{alert.title}</Link>
                      ) : (
                        <p className="truncate">{alert.title}</p>
                      )}
                      {alert.detail ? <p className="truncate text-sm text-muted">{alert.detail}</p> : null}
                      {alert.approval ? (
                        <div className="mt-3 flex gap-2">
                          <button type="button" className="btn btn-ghost btn-small" onClick={() => dismiss(alert.id)}>
                            Decline
                          </button>
                          <button type="button" className="btn btn-primary btn-small" disabled={busy === alert.id} onClick={() => accept(alert)}>
                            {busy === alert.id ? "Paying…" : "Accept"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {new Date(alert.at).getTime() > seenAt && !alert.approval ? <span className="h-2 w-2 rounded-full bg-[#f04d23]" /> : null}
                      {ago(alert.at)}
                    </span>
                  </div>
                ))}
              </div>
              <Link href="/activity" className="btn btn-ghost btn-small mt-2 w-full" onClick={() => setOpen(false)}>
                View all activity
              </Link>
            </div>
          ) : null}
        </div>
      </header>
      <div className="k-content">{children}</div>
    </div>
  );
}
