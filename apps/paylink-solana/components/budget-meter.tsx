"use client";

import { motion } from "framer-motion";
import { formatUsdc } from "@181hacks/paylink-core";

export function BudgetMeter({
  spent,
  total,
  label = "Agent budget",
}: {
  spent: string;
  total: string;
  label?: string;
}) {
  const ratio = Math.min(100, (Number(spent) / Math.max(Number(total), 0.000001)) * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="t-micro whitespace-nowrap text-muted">{label}</span>
        <span className="t-small tabular-nums">
          {formatUsdc(spent)} <span className="text-muted">/ {formatUsdc(total)}</span>
        </span>
      </div>
      <div className="meter" role="meter" aria-valuenow={Number(spent)} aria-valuemin={0} aria-valuemax={Number(total)} aria-label={label}>
        <motion.span initial={false} animate={{ width: `${ratio}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
      </div>
    </div>
  );
}
