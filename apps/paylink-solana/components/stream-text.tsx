"use client";

import { useEffect, useState } from "react";

export function StreamText({ text, active }: { text: string; active?: boolean }) {
  const [count, setCount] = useState(active ? 0 : text.length);

  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((current) => {
        const next = Math.min(text.length, current + 3);
        if (next >= text.length) window.clearInterval(timer);
        return next;
      });
    }, 14);
    return () => window.clearInterval(timer);
  }, [text, active]);

  const shown = text.slice(0, count);
  return (
    <p className="t-body whitespace-pre-wrap">
      {shown}
      {count < text.length ? <span className="caret" aria-hidden /> : null}
    </p>
  );
}
