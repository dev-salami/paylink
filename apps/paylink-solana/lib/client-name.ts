/** Presentation only: do not rewrite stored invoices or invent a payer identity. */
export function displayClientName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return !name || /^unnamed\s+client$/i.test(name) ? undefined : name;
}

export function clientLabel(value: unknown): string {
  return displayClientName(value) || "Not provided";
}

/** Old generated activity copy may embed the placeholder; presentation only. */
export function clientActivityCopy(value: string): string {
  return value.replace(/\bunnamed\s+client\b/gi, "client");
}
