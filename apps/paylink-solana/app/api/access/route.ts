import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  accessCookieSecure,
  accessGateEnabled,
  checkAccessCode,
  safeNext,
  sessionSecret,
  signAccessToken,
} from "@/lib/access";
import { appOrigin } from "@/lib/env";

export const dynamic = "force-dynamic";

// Light brute-force brake: 10 wrong tries per client per 10 minutes.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

// Relative Location keeps the user on whichever host they used (custom domain or sslip alias),
// so the cookie and the next page share a host.
function redirect(_request: Request, path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function isHttps(request: Request): boolean {
  return accessCookieSecure(request, appOrigin(request));
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const code = String(form?.get("code") ?? "");
  const next = safeNext(String(form?.get("next") ?? ""));
  if (!accessGateEnabled()) return redirect(request, next);

  const key = clientKey(request);
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt < now) attempts.delete(key);
  const current = attempts.get(key);
  if (current && current.count >= MAX_FAILS) {
    return redirect(request, `/access?error=locked&next=${encodeURIComponent(next)}`);
  }

  if (!checkAccessCode(code)) {
    attempts.set(key, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt ?? now + WINDOW_MS });
    return redirect(request, `/access?error=wrong&next=${encodeURIComponent(next)}`);
  }

  attempts.delete(key);
  const response = redirect(request, next);
  response.cookies.set(ACCESS_COOKIE, await signAccessToken(sessionSecret()), {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  return response;
}

/** Sign out for API clients. The merchant shell posts to /api/access/logout, which also redirects. */
export async function DELETE(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: isHttps(request) });
  return response;
}
