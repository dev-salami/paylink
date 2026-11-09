import { formatUsdc } from "@181hacks/paylink-core";

/** "$12,480.50" with the decimals greyed, Keel style. */
export function Money({ value, prefix = "", className = "" }: { value: number | string; prefix?: string; className?: string }) {
  const text = formatUsdc(Number(value).toFixed(2));
  const [whole, decimals] = text.split(".");
  return (
    <span className={className}>
      {prefix}
      {whole}
      {decimals !== undefined ? <span className="dec">.{decimals}</span> : null}
    </span>
  );
}

export function Delta({ tone, children }: { tone: "up" | "down" | "flat"; children: React.ReactNode }) {
  return (
    <span className={`delta ${tone}`}>
      {tone === "up" ? "↑" : tone === "down" ? "↓" : "•"} {children}
    </span>
  );
}

/** Half-circle arc gauge; mint for the filled share. */
export function ArcGauge({ ratio }: { ratio: number }) {
  const r = 90;
  const length = Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio)) * length;
  return (
    <svg viewBox="0 0 220 120" className="gauge" aria-hidden>
      <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#3a404d" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 5" />
      <path
        d="M20 110 A90 90 0 0 1 200 110"
        fill="none"
        stroke="#71FC8F"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${length}`}
      />
    </svg>
  );
}

export interface Bar {
  value: number;
  on: boolean;
  label?: { top: string; sub: string };
}

/** Thin vertical bars, grey turning mint, with floating labels. */
export function BarStrip({ bars, height = 160 }: { bars: Bar[]; height?: number }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <div className="relative" style={{ height: height + 44 }}>
      <div className="bars absolute inset-x-0 bottom-0" style={{ height }}>
        {bars.map((bar, index) => (
          <i key={index} className={bar.on ? "on" : ""} style={{ height: `${Math.max(6, (bar.value / max) * 100)}%` }} />
        ))}
      </div>
      {bars.map((bar, index) =>
        bar.label ? (
          <span
            key={`l${index}`}
            className="bar-label"
            style={{ left: `${((index + 0.5) / bars.length) * 100}%`, bottom: `${Math.max(6, (bar.value / max) * 100) * (height / 100) + 10}px`, transform: "translateX(-50%)" }}
          >
            {bar.label.top}
            <small>{bar.label.sub}</small>
          </span>
        ) : null,
      )}
    </div>
  );
}
