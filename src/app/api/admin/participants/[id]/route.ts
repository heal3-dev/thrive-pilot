
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const supabase = guard.admin;
  const { id } = params;

  // 1. Fetch Participant
  const { data: participant, error: pError } = await supabase
    .from("participants")
    .select("id, name, email, garmin_user_id, garmin_connected_at")
    .eq("id", id)
    .single();

  if (pError) {
    console.error("Error fetching participant:", pError);
    return NextResponse.json({ error: "Failed to fetch participant" }, { status: 500 });
  }

  if (!participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  // 2. Fetch Metrics (Last 30 days)
  const { data: metrics, error: mError } = await supabase
    .from("garmin_metrics")
    .select("id, metric_date, steps, resting_heart_rate, average_stress_level, sleep_duration_seconds")
    .eq("participant_id", id)
    .order("metric_date", { ascending: false })
    .limit(30);

  if (mError) {
    console.error("Error fetching metrics:", mError);
    // Don't fail the whole request if metrics fail, just return empty array
  }

  return NextResponse.json({
    participant,
    metrics: metrics || [],
  });
}
