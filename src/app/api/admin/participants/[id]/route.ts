
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";
import { calculateFlags, type Metric } from "@/lib/flags/rules";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const supabase = guard.admin;
  const { id } = await params;

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

  // 2. Check Garmin Tokens
  const { data: tokenData } = await supabase
    .from("garmin_tokens")
    .select("participant_id")
    .eq("participant_id", id)
    .maybeSingle();

  const isConnected = Boolean(participant.garmin_user_id) || Boolean(tokenData);

  // 3. Fetch Metrics (Last 30 days) — all pilot fields
  const { data: metrics, error: mError } = await supabase
    .from("garmin_metrics")
    .select("id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, body_battery_charged, body_battery_drained, hrv_last_night_average, hrv_last_night_5_min_high")
    .eq("participant_id", id)
    .order("metric_date", { ascending: false })
    .limit(30);

  if (mError) {
    console.error(`[PARTICIPANT_DETAILS] Error fetching metrics for ${id}:`, mError);
    // Don't fail the whole request if metrics fail, just return empty array
  }

  // Calculate flags
  const metricsData = metrics || [];
  const typedMetrics: Metric[] = metricsData.map(m => ({
    id: m.id,
    metric_date: m.metric_date,
    resting_heart_rate: m.resting_heart_rate,
    average_stress_level: m.average_stress_level,
    sleep_duration_seconds: m.sleep_duration_seconds,
    sleep_score: m.sleep_score,
    body_battery_charged: m.body_battery_charged,
    body_battery_drained: m.body_battery_drained,
    hrv_last_night_average: m.hrv_last_night_average,
    hrv_last_night_5_min_high: m.hrv_last_night_5_min_high,
  }));
  const flags = calculateFlags(typedMetrics);

  return NextResponse.json({
    participant,
    is_connected: isConnected,
    metrics: metricsData,
    flags,
  });
}

