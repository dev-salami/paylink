import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessCookieSecure, accessGateEnabled } from "@/lib/access";
import { appOrigin } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Clear the merchant cookie and return to the gate, or the landing page when the gate is off. */
export async function POST(request: Request) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: accessGateEnabled() ? "/access" : "/" },
  });
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    secure: accessCookieSecure(request, appOrigin(request)),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
