import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const weekEnding = url.searchParams.get("weekEnding");

  let query = guard.admin
    .from("weekly_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");

  if (weekEnding && /^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
    query = query.eq("week_ending", weekEnding);
  }

  const { count, error } = await query;

  if (error) {
    return NextResponse.json({ error: `Failed to load weekly report summary: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ approvedCount: count ?? 0 });
}

