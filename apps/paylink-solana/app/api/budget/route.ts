import { NextResponse } from "next/server";
import { toAtomic } from "@181hacks/paylink-core";
import { currentBudgetView, updateDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(currentBudgetView());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { total?: string; perCall?: string; approveAbove?: string };
  try {
    toAtomic(body.total || "0");
    toAtomic(body.perCall || "0");
    toAtomic(body.approveAbove || "0");
  } catch {
    return NextResponse.json({ error: "Use decimal USDC amounts." }, { status: 400 });
  }
  const view = updateDb((db) => {
    db.budget = {
      total: body.total || db.budget.total,
      perCall: body.perCall || db.budget.perCall,
      approveAbove: body.approveAbove || db.budget.approveAbove,
    };
    db.activities.unshift({
      id: `act_budget_${Date.now()}`,
      at: new Date().toISOString(),
      kind: "budget_changed",
      title: "Agent budget updated",
      detail: `Cap ${db.budget.total} USDC · per call ${db.budget.perCall} · approve above ${db.budget.approveAbove}`,
      href: "/wallet",
    });
    return currentBudgetView(db);
  });
  return NextResponse.json(view);
}
