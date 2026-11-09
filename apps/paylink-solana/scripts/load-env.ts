import { readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvFiles(): void {
  for (const file of [".env", ".env.local", "../../.env", "../../.env.local"]) {
    try {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {
      // optional file
    }
  }
}
