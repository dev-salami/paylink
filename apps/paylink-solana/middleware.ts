import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessGateEnabled, isPublicPath, sessionSecret, verifyAccessToken } from "@/lib/access";

export async function middleware(request: NextRequest) {
  if (!accessGateEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (await verifyAccessToken(token, sessionSecret())) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Access code required.", code: "access_required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
