import { NextResponse } from "next/server";
import { resetDb } from "@/lib/store";

export function POST() {
  resetDb();
  return NextResponse.json({ ok: true });
}
