import { describe, expect, it, vi } from "vitest";
import { copyPayLink, publicPayPath, publicPayUrl, type ClipboardHost } from "./payer-link";

describe("public payer links", () => {
  it("constructs only the public route on the current origin", () => {
    expect(publicPayPath("inv_123")).toBe("/pay/inv_123");
    expect(publicPayUrl("https://merchant.example/dashboard?status=paid&q=Ada", "inv_123")).toBe("https://merchant.example/pay/inv_123");
    expect(publicPayUrl("http://localhost:3000", "inv_sample")).toBe("http://localhost:3000/pay/inv_sample");
  });

  it("encodes the id as one path segment rather than accepting another route", () => {
    expect(publicPayPath("inv/a?view=invoices#x")).toBe("/pay/inv%2Fa%3Fview%3Dinvoices%23x");
    expect(publicPayUrl("https://merchant.example", "//other.example")).toBe("https://merchant.example/pay/%2F%2Fother.example");
  });
});

describe("clipboard outcomes", () => {
  const url = "https://merchant.example/pay/inv_123";

  it("reports success only after writeText resolves", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyPayLink(url, { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("reports rejected permission errors instead of silently swallowing failure", async () => {
    expect(await copyPayLink(url, { clipboard: { writeText: async () => { throw new Error("Permission denied"); } } })).toBe("failed");
  });

  it("reports clipboard-unavailable environments for manual copying", async () => {
    expect(await copyPayLink(url)).toBe("unavailable");
    expect(await copyPayLink(url, {})).toBe("unavailable");
  });

  it("handles synchronous clipboard access and write failures", async () => {
    const host: ClipboardHost = { get clipboard(): ClipboardHost["clipboard"] { throw new Error("Blocked clipboard access"); } };
    expect(await copyPayLink(url, host)).toBe("failed");
    expect(await copyPayLink(url, { clipboard: { writeText: () => { throw new Error("Blocked write"); } } })).toBe("failed");
  });
});
