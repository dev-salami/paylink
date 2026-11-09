import { describe, expect, it } from "vitest";
import { checkAccessCode, isPublicPath, safeNext, signAccessToken, verifyAccessToken } from "./access";

const secret = "test-secret-0123456789";

describe("access cookie", () => {
  it("verifies a token it signed", async () => {
    const token = await signAccessToken(secret);
    expect(await verifyAccessToken(token, secret)).toBe(true);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signAccessToken("other-secret");
    expect(await verifyAccessToken(token, secret)).toBe(false);
  });

  it("rejects tampered or malformed tokens", async () => {
    const token = await signAccessToken(secret);
    const [expires = "", signature = ""] = token.split(".");
    expect(await verifyAccessToken(`${Number(expires) + 1000}.${signature}`, secret)).toBe(false);
    expect(await verifyAccessToken(`${expires}.${signature.slice(0, -1)}x`, secret)).toBe(false);
    expect(await verifyAccessToken("garbage", secret)).toBe(false);
    expect(await verifyAccessToken("", secret)).toBe(false);
    expect(await verifyAccessToken(undefined, secret)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const now = Date.now();
    const token = await signAccessToken(secret, now, 60);
    expect(await verifyAccessToken(token, secret, now + 30_000)).toBe(true);
    expect(await verifyAccessToken(token, secret, now + 61_000)).toBe(false);
  });
});

describe("access code", () => {
  it("matches case-insensitively and trims", () => {
    expect(checkAccessCode("  sesame ", "SESAME")).toBe(true);
    expect(checkAccessCode("Sesame", "sesame")).toBe(true);
  });
  it("accepts EARTH in any case when that is the configured code", () => {
    expect(checkAccessCode("EARTH", "EARTH")).toBe(true);
    expect(checkAccessCode("earth", "EARTH")).toBe(true);
    expect(checkAccessCode("Earth", "EARTH")).toBe(true);
    expect(checkAccessCode("  earth  ", "EARTH")).toBe(true);
    expect(checkAccessCode("EARTHS", "EARTH")).toBe(false);
    expect(checkAccessCode("EART", "EARTH")).toBe(false);
  });
  it("rejects wrong, partial, or empty codes, and an unset gate", () => {
    expect(checkAccessCode("sesam", "SESAME")).toBe(false);
    expect(checkAccessCode("sesamee", "SESAME")).toBe(false);
    expect(checkAccessCode("", "SESAME")).toBe(false);
    expect(checkAccessCode("anything", "")).toBe(false);
  });
});

describe("routing helpers", () => {
  it("keeps payer paths and raw x402 open, and merchant paths gated", () => {
    const open = [
      "/",
      "/access",
      "/pay/inv_1",
      "/receipts/rcpt_1",
      "/api/health",
      "/api/access",
      "/api/access/logout",
      "/api/invoices/inv_1/sync",
      "/api/invoices/inv_1/tx",
      "/api/invoices/inv_1/pdf",
      "/api/x402/pdf",
      "/api/x402/reminder",
      "/api/x402/lab",
    ];
    expect(open.filter((path) => !isPublicPath(path))).toEqual([]);
    const gated = [
      "/dashboard",
      "/invoices/inv_1",
      "/chat",
      "/activity",
      "/wallet",
      "/settings",
      "/api/chat",
      "/api/budget",
      "/api/demo/reset",
      "/api/invoices/sync-open",
      "/api/invoices/inv_1/issue",
    ];
    expect(gated.filter((path) => isPublicPath(path))).toEqual([]);
  });
  it("only redirects to same-site paths", () => {
    expect(safeNext("/chat")).toBe("/chat");
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});
