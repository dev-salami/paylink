"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { startVisibilityPolling } from "../lib/polling";

/** Poll chain status for live invoices so the books update after a payer sends USDC. */
export function LiveLedger() {
  const router = useRouter();
  useEffect(() => {
    return startVisibilityPolling(async () => {
      try {
        const response = await fetch("/api/invoices/sync-open", { method: "POST", signal: AbortSignal.timeout(60_000) });
        if (response.status === 401) {
          window.location.href = `/access?next=${encodeURIComponent(window.location.pathname)}`;
          return "stop";
        }
        if (!response.ok) return "error";
        const data = (await response.json()) as { invoices?: { paymentIssue?: string }[] };
        if (data.invoices && data.invoices.length > 0) router.refresh();
        return data.invoices?.some((invoice) => invoice.paymentIssue === "rpc_down") ? "error" : "ok";
      } catch {
        return "error";
      }
    }, 6_000);
  }, [router]);
  return null;
}
