
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";
import { calculateFlags, type Metric } from "@/lib/flags/rules";
import { hashParticipantId } from "@/lib/pseudonym-crypto";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const supabase = guard.admin;
  const { id } = await params;

  // 1. Fetch Participant (PII zone)
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

  // 2. Resolve pseudonym_id via HMAC hash
  const pidHash = hashParticipantId(id);
  const { data: pseudonymRow } = await supabase
    .from("participant_pseudonyms")
    .select("pseudonym_id")
    .eq("participant_id_hash", pidHash)
    .maybeSingle();

  const pseudonymId = pseudonymRow?.pseudonym_id;

  // 3. Check Garmin connection (via pseudonym on tokens table)
  let isConnected = Boolean(participant.garmin_user_id);
  if (!isConnected && pseudonymId) {
    const { data: tokenData } = await supabase
      .from("garmin_tokens")
      .select("pseudonym_id")
      .eq("pseudonym_id", pseudonymId)
      .maybeSingle();
    isConnected = Boolean(tokenData);
  }

  // 4. Fetch Metrics (Last 30 days) via pseudonym_id
  let metricsData: Record<string, unknown>[] = [];
  if (pseudonymId) {
    const { data: metrics, error: mError } = await supabase
      .from("garmin_metrics")
      .select("id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, body_battery_charged, body_battery_drained, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high")
      .eq("pseudonym_id", pseudonymId)
      .order("metric_date", { ascending: false })
      .limit(30);

    if (mError) {
      console.error(`[PARTICIPANT_DETAILS] Error fetching metrics:`, mError);
    }
    metricsData = metrics || [];
  }

  // Calculate flags
  const typedMetrics: Metric[] = metricsData.map(m => ({
    id: m.id as string,
    metric_date: m.metric_date as string,
    resting_heart_rate: m.resting_heart_rate as number | null,
    average_stress_level: m.average_stress_level as number | null,
    sleep_duration_seconds: m.sleep_duration_seconds as number | null,
    sleep_score: m.sleep_score as number | null,
    body_battery_charged: m.body_battery_charged as number | null,
    body_battery_drained: m.body_battery_drained as number | null,
    hrv_last_night_average: m.hrv_last_night_average as number | null,
    hrv_last_night_5_min_high: m.hrv_last_night_5_min_high as number | null,
  }));
  const flags = calculateFlags(typedMetrics);

  return NextResponse.json({
    participant,
    is_connected: isConnected,
    metrics: metricsData,
    flags,
  });
}
