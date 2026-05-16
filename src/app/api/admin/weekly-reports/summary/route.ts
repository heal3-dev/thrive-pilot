import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { count, error } = await guard.admin
    .from("weekly_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");

  if (error) {
    return NextResponse.json({ error: `Failed to load weekly report summary: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ approvedCount: count ?? 0 });
}

