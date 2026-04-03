
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";
import { computeWeeklyFlagFromMetrics, type Metric, type WeeklyFlag } from "@/lib/flags/rules";
import { hashParticipantId } from "@/lib/pseudonym-crypto";

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

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

  // 4. Fetch Metrics via pseudonym_id (supports pagination)
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "30", 10);
  const clampedLimit = Math.min(Math.max(limit, 1), 100);

  let metricsData: Record<string, unknown>[] = [];
  let totalCount = 0;
  if (pseudonymId) {
    // Get total count for pagination
    const { count } = await supabase
      .from("garmin_metrics")
      .select("id", { count: "exact", head: true })
      .eq("pseudonym_id", pseudonymId);
    totalCount = count ?? 0;

    const { data: metrics, error: mError } = await supabase
      .from("garmin_metrics")
      .select("id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high")
      .eq("pseudonym_id", pseudonymId)
      .order("metric_date", { ascending: false })
      .range(offset, offset + clampedLimit - 1);

    if (mError) {
      console.error(`[PARTICIPANT_DETAILS] Error fetching metrics:`, mError);
    }
    metricsData = (metrics || []).map((m) => {
      const mm = m as unknown as { body_battery_start?: number | null; body_battery_highest?: number | null };
      return {
        ...m,
        // Use daily peak as the "morning start" proxy (fixes historic data too).
        body_battery_start: mm.body_battery_highest ?? mm.body_battery_start ?? null,
      };
    });
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const inferredWeekEndingFromPage =
    offset === 0 && metricsData.length > 0
      ? ((metricsData[0] as unknown as { metric_date?: string }).metric_date ?? null)
      : null;
  const weekEnding = inferredWeekEndingFromPage ?? todayYmd;
  let weekly_flag: WeeklyFlag | null = null;
  if (offset === 0 && pseudonymId) {
    const since = ymdAddDays(weekEnding, -40);
    const { data: weeklyMetrics } = await supabase
      .from("garmin_metrics")
      .select(
        "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
      )
      .eq("pseudonym_id", pseudonymId)
      .gte("metric_date", since)
      .lte("metric_date", todayYmd)
      .order("metric_date", { ascending: false });

    const inferredWeekEnding =
      (weeklyMetrics?.[0]?.metric_date as string | undefined) ?? weekEnding;
    const weeklyTyped: Metric[] = (weeklyMetrics ?? []).map((m) => ({
      // Prefer daily peak as "start" for scoring and display semantics.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body_battery_start: ((m as any).body_battery_highest ?? (m as any).body_battery_start) as number | null,
      id: m.id as string,
      metric_date: m.metric_date as string,
      resting_heart_rate: m.resting_heart_rate as number | null,
      average_stress_level: m.average_stress_level as number | null,
      sleep_duration_seconds: m.sleep_duration_seconds as number | null,
      sleep_score: m.sleep_score as number | null,
      awake_seconds: (m as unknown as { awake_seconds?: number | null }).awake_seconds ?? null,
      body_battery_charged: m.body_battery_charged as number | null,
      body_battery_drained: m.body_battery_drained as number | null,
      body_battery_lowest: m.body_battery_lowest as number | null,
      body_battery_most_recent: m.body_battery_most_recent as number | null,
      hrv_last_night_average: m.hrv_last_night_average as number | null,
      hrv_last_night_5_min_high: m.hrv_last_night_5_min_high as number | null,
    }));

    weekly_flag = computeWeeklyFlagFromMetrics(weeklyTyped, inferredWeekEnding);
  }

  return NextResponse.json({
    participant,
    is_connected: isConnected,
    metrics: metricsData,
    weekly_flag,
    pagination: { offset, limit: clampedLimit, total: totalCount, hasMore: offset + clampedLimit < totalCount },
  });
}
