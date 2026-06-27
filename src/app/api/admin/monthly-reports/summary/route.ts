import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const monthEnding = url.searchParams.get("monthEnding");

  let query = guard.admin
    .from("monthly_reports")
    .select("id", { count: "exact", head: true })
    .not("approved_at", "is", null)
    .is("email_job_id", null);

  if (monthEnding && /^\d{4}-\d{2}-\d{2}$/.test(monthEnding)) {
    query = query.eq("month_ending", monthEnding);
  }

  const { count, error } = await query;

  if (error) {
    return NextResponse.json({ error: `Failed to load monthly report summary: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ approvedCount: count ?? 0 });
}
