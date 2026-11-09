import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESS_MAX_AGE_SECONDS, accessCookieSecure, isPublicPath, signAccessToken } from "./access";
import { merchantAccessState } from "./access-view";

const secret = "test-only-merchant-session-secret";
const now = Date.parse("2026-11-07T12:00:00Z");

describe("returning merchant access on the home/login pages", () => {
  it("recognises the same signed cookie after returning home, without renewing it", async () => {
    const token = await signAccessToken(secret, now, ACCESS_MAX_AGE_SECONDS);
    expect(await merchantAccessState({ token, secret, enabled: true, now })).toEqual({ unlocked: true, redirectTo: "/dashboard" });
    expect(await merchantAccessState({ token, secret, enabled: true, now: now + 7 * 86_400_000, next: "/chat?prompt=hello" })).toEqual({ unlocked: true, redirectTo: "/chat?prompt=hello" });
  });
  it("keeps absent, invalid, expired, and differently-signed tokens locked", async () => {
    const expired = await signAccessToken(secret, now - 120_000, 60);
    const other = await signAccessToken("different-test-secret", now);
    for (const token of [undefined, "invalid", expired, other]) {
      expect(await merchantAccessState({ token, secret, enabled: true, now })).toEqual({ unlocked: false, redirectTo: null });
    }
  });
  it("uses safeNext for already-unlocked sessions and preserves the disabled-gate experience", async () => {
    const token = await signAccessToken(secret, now);
    for (const next of [undefined, "https://other.example", "//other.example", "/access", "/api/access"]) {
      expect((await merchantAccessState({ token, secret, enabled: true, next, now })).redirectTo).toBe("/dashboard");
    }
    expect(await merchantAccessState({ secret, enabled: false, next: "/wallet" })).toEqual({ unlocked: true, redirectTo: "/wallet" });
  });
  it("keeps the Secure flag on behind Traefik HTTPS without changing the cookie contract", () => {
    expect(accessCookieSecure(new Request("http://app:3000/api/access", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(accessCookieSecure(new Request("http://app:3000/api/access", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(true);
    expect(accessCookieSecure(new Request("http://localhost/api/access"))).toBe(false);
    expect(ACCESS_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
    const api = readFileSync(new URL("../app/api/access/route.ts", import.meta.url), "utf8");
    expect(api).toContain("httpOnly: true");
    expect(api).toContain('sameSite: "lax"');
    expect(api).toContain('path: "/"');
  });
  it("wires both server pages to the cookie decision while middleware passes cookies through untouched", () => {
    for (const path of ["../app/page.tsx", "../app/access/page.tsx"]) {
      const page = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(page).toContain("await cookies()");
      expect(page).toContain("jar.get(ACCESS_COOKIE)?.value");
      expect(page).toContain("merchantAccessState(");
    }
    const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(home).toContain('unlocked ? "/dashboard" : "/access"');
    expect(home).toContain('unlocked ? "Open dashboard" : "Log in"');
    const login = readFileSync(new URL("../app/access/page.tsx", import.meta.url), "utf8");
    expect(login).toContain("if (state.redirectTo) redirect(state.redirectTo)");
    const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
    expect(middleware).toContain("return NextResponse.next()");
    expect(middleware).not.toContain("cookies.set");
    expect(middleware).not.toContain("cookies.delete");
  });
  it("preserves the public payer/receipt/RPC/x402 paths", () => {
    for (const path of ["/", "/access", "/pay/inv_test", "/receipts/rcp_test", "/api/receipts/rcp_test/pdf", "/api/invoices/inv_test/receipt.pdf", "/api/rpc", "/api/x402/pdf", "/api/x402/reminder"]) {
      expect(isPublicPath(path)).toBe(true);
    }
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});
