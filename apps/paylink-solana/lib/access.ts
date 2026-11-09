/**
 * Access gate for the merchant side of PayLink.
 *
 * The code comes only from PAYLINK_ACCESS_CODE. When it is unset the gate is
 * off, so local dev keeps working without a code. A successful login sets a
 * signed cookie: "<expiresAtMs>.<hmac>", HMAC-SHA256 over "paylink-access:v1:<expiresAtMs>"
 * with PAYLINK_SESSION_SECRET. Everything here uses Web Crypto so it runs in
 * both the middleware (edge) and route handlers (node).
 */

export const ACCESS_COOKIE = "paylink_access";
export const ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function read(name: string): string {
  return process.env[name]?.trim() || "";
}

export function accessCode(): string {
  return read("PAYLINK_ACCESS_CODE");
}

export function accessGateEnabled(): boolean {
  return accessCode().length > 0;
}

/** The HMAC key. Falls back to a value derived from the code if no session secret is set. */
export function sessionSecret(): string {
  return read("PAYLINK_SESSION_SECRET") || `paylink-fallback:${accessCode()}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time comparison of two strings (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/** Case-insensitive, whitespace-trimmed, constant-time check against the configured code. */
export function checkAccessCode(input: string, expected = accessCode()): boolean {
  if (!expected) return false;
  const a = input.trim().toUpperCase();
  const b = expected.trim().toUpperCase();
  // Compare digests of equal length so the input length is not leaked either.
  return safeEqual(a.padEnd(256, "\0").slice(0, 256), b.padEnd(256, "\0").slice(0, 256)) && a.length === b.length;
}

export async function signAccessToken(secret: string, now = Date.now(), maxAgeSeconds = ACCESS_MAX_AGE_SECONDS): Promise<string> {
  const expires = String(now + maxAgeSeconds * 1000);
  return `${expires}.${await hmac(secret, `paylink-access:v1:${expires}`)}`;
}

export async function verifyAccessToken(token: string | undefined | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expires = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d{10,16}$/.test(expires)) return false;
  if (Number(expires) <= now) return false;
  const expected = await hmac(secret, `paylink-access:v1:${expires}`);
  return safeEqual(signature, expected);
}

/** Only allow same-site relative redirects after login. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/dashboard";
  if (value.startsWith("/access") || value.startsWith("/api/")) return "/dashboard";
  return value;
}

/**
 * Secure flag for the access cookie. Honor the proxy proto first so a TLS
 * terminator and a plain local server set and clear the same cookie.
 */
export function accessCookieSecure(request: Request, origin = ""): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // Relative or unparseable request URLs fall through to the configured origin.
  }
  return origin.startsWith("https://");
}

/** Paths that stay open with no code: the landing page, payer pages, raw x402, and the APIs they need. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/access") return true;
  if (pathname.startsWith("/pay/") || pathname.startsWith("/receipts/")) return true;
  if (pathname === "/api/health" || pathname === "/api/access" || pathname === "/api/access/logout") return true;
  if (pathname === "/api/rpc") return true;
  if (/^\/api\/pay\/[^/]+\/aurora\/(options|quote|attempts\/[^/]+(?:\/deposit)?)$/.test(pathname)) return true;
  if (/^\/api\/receipts\/[^/]+\/pdf$/.test(pathname) || /^\/api\/invoices\/[^/]+\/receipt\.pdf$/.test(pathname)) return true;
  // The pay page polls /sync and builds the wallet transaction with /tx; `pnpm pay` uses /sync too.
  if (/^\/api\/invoices\/[^/]+\/(sync|tx|pdf)$/.test(pathname)) return true;
  // Judges hit the raw x402 challenge, accept, and lab routes without the merchant code.
  if (/^\/api\/x402\/[^/]+$/.test(pathname)) return true;
  if (pathname.startsWith("/_next/") || pathname.startsWith("/art/") || pathname.startsWith("/fonts/")) return true;
  if (/^\/(favicon\.ico|robots\.txt|sitemap\.xml|icon\.[a-z]+|apple-icon\.[a-z]+)$/.test(pathname)) return true;
  return false;
}
