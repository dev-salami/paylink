"use client";

import { motion, useReducedMotion } from "framer-motion";

export function PaidSeal({ label = "Paid" }: { label?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="paid-seal display text-2xl"
      initial={reduce ? false : { scale: 1.35, rotate: -16, opacity: 0 }}
      animate={{ scale: 1, rotate: -8, opacity: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 16 }}
    >
      {!reduce ? (
        <motion.span
          className="paid-ring"
          initial={{ scale: 0.7, opacity: 0.7 }}
          animate={{ scale: 1.65, opacity: 0 }}
          transition={{ duration: 0.85, ease: "easeOut" }}
        />
      ) : null}
      <motion.svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <motion.path
          d="M5 12.5 9.2 17 19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.12 }}
        />
      </motion.svg>
      {label}
    </motion.div>
  );
}
