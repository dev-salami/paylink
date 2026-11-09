const DECIMALS = 6;

export function toAtomic(amount: string, decimals = DECIMALS): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const extra = frac.slice(decimals);
  if (extra && /[1-9]/.test(extra)) {
    throw new Error(`Amount has more than ${decimals} decimal places: ${amount}`);
  }
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function fromAtomic(atomic: bigint, decimals = DECIMALS): string {
  const negative = atomic < 0n;
  const value = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function formatUsdc(amount: string | bigint): string {
  const text = typeof amount === "bigint" ? fromAtomic(amount) : fromAtomic(toAtomic(amount));
  const [whole, frac = ""] = text.split(".");
  const withCommas = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (frac + "00").slice(0, 2);
  return `${withCommas}.${cents}`;
}

export function addAtomic(left: bigint, right: bigint): bigint {
  return left + right;
}

export function compareAtomic(left: bigint, right: bigint): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
