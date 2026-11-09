/** Never share the merchant detail route, filters, or a Solana payment URI. */
export function publicPayPath(id: string): string {
  return `/pay/${encodeURIComponent(id)}`;
}

export function publicPayUrl(origin: string, id: string): string {
  return new URL(publicPayPath(id), new URL(origin).origin).href;
}

export type CopyResult = "copied" | "failed" | "unavailable";
export interface ClipboardHost {
  clipboard?: { writeText(text: string): Promise<void> };
}

/** Also catches synchronous access/permission errors, not just rejected writes. */
export async function copyPayLink(url: string, host?: ClipboardHost): Promise<CopyResult> {
  try {
    const clipboard = host?.clipboard;
    if (!clipboard?.writeText) return "unavailable";
    await clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
