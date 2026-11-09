"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Invoice } from "@181hacks/paylink-core";
import { startVisibilityPolling } from "../lib/polling";

export function LiveInvoice({ initial }: { initial: Invoice }) {
  const router = useRouter();
  useEffect(() => {
    if (initial.sample || initial.status === "paid" || initial.status === "draft") return;
    return startVisibilityPolling(async () => {
      try {
        const response = await fetch(`/api/invoices/${initial.id}/sync`, { method: "POST", signal: AbortSignal.timeout(60_000) });
        if (!response.ok) return "error";
        const next = await response.json() as Invoice;
        router.refresh();
        return next.status === "paid" ? "stop" : next.paymentIssue === "rpc_down" ? "error" : "ok";
      } catch {
        return "error";
      }
    }, 5_000);
  }, [initial.id, initial.sample, initial.status, router]);
  return null;
}
