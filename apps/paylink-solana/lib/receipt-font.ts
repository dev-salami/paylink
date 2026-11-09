import { readFile } from "node:fs/promises";
import path from "node:path";

/** Supports app cwd (Next standalone/Docker) and monorepo-root cwd. */
export async function readReceiptFont(): Promise<Uint8Array | undefined> {
  for (const root of [process.cwd(), path.join(process.cwd(), "apps/paylink-solana")]) {
    try { return await readFile(path.join(root, "app/fonts/DegularDisplay-Regular.ttf")); } catch { /* Try the next deployment shape. */ }
  }
  return undefined;
}
