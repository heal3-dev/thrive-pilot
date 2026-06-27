import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";
import { hashParticipantId } from "@/lib/pseudonym-crypto";
import { type Metric } from "@/lib/flags/rules";

const querySchema = z.object({
  participantId: z.string().uuid(),
});

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function list28DaysEnding(monthEnding: string): string[] {
  return Array.from({ length: 28 }, (_, i) => ymdAddDays(monthEnding, -27 + i));
}

function computeCompleteness(metrics: Metric[], monthEnding: string) {
  const days = list28DaysEnding(monthEnding);
  const byDate = new Map(metrics.map((m) => [m.metric_date, m]));

  const calPresentAny = days.filter((d) => {
    const m = byDate.get(d);
    return Boolean(m && (m.body_battery_start != null || m.average_stress_level != null || m.resting_heart_rate != null));
  }).length;

  const nights = metrics
    .filter((m) => m.metric_date <= monthEnding)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, 28);

  const nightsPresentAny = nights.filter((m) => {
    return Boolean(
      m.sleep_duration_seconds != null ||
        m.sleep_score != null ||
        m.awake_seconds != null ||
        m.hrv_last_night_average != null
    );
  }).length;

  return {
    monthEnding,
    calendarDaysPresent: calPresentAny,
    calendarDaysExpected: 28,
    sleepNightsPresent: nightsPresentAny,
    sleepNightsExpected: 28,
  };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ participantId: url.searchParams.get("participantId") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const admin = guard.admin;
  const participantId = parsed.data.participantId;

  const participantIdHash = hashParticipantId(participantId);
  const { data: pseudonymRow, error: pseudonymError } = await admin
    .from("participant_pseudonyms")
    .select("pseudonym_id")
    .eq("participant_id_hash", participantIdHash)
    .maybeSingle();

  if (pseudonymError) {
    return NextResponse.json({ error: "Failed to fetch participant mapping" }, { status: 500 });
  }

  const pseudonymId = pseudonymRow?.pseudonym_id;
  if (!pseudonymId) {
    return NextResponse.json({
      connected: false,
      canGenerate: false,
      reason: "Participant is not connected (no health data yet)",
    });
  }

  const todayYmd = new Date().toISOString().slice(0, 10);

  const { data: latestRow, error: latestErr } = await admin
    .from("garmin_metrics")
    .select("metric_date")
    .eq("pseudonym_id", pseudonymId)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    return NextResponse.json({ error: "Failed to fetch latest metric date" }, { status: 500 });
  }

  const monthEnding =
    (latestRow && typeof (latestRow as unknown as { metric_date?: unknown }).metric_date === "string"
      ? ((latestRow as unknown as { metric_date: string }).metric_date as string)
      : todayYmd) || todayYmd;

  const since = ymdAddDays(monthEnding, -60); // fetch enough buffer
  const { data: rows, error: metricsError } = await admin
    .from("garmin_metrics")
    .select(
      "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
    )
    .eq("pseudonym_id", pseudonymId)
    .gte("metric_date", since)
    .lte("metric_date", monthEnding)
    .order("metric_date", { ascending: false })
    .limit(200);

  if (metricsError) {
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({
      connected: true,
      canGenerate: false,
      reason: "No health data available for participant",
    });
  }

  const latestMetricDate = monthEnding;

  const typed: Metric[] = (rows ?? []).map((m) => {
    const mm = m as unknown as {
      body_battery_start?: number | null;
      body_battery_highest?: number | null;
      awake_seconds?: number | null;
    };
    return {
      id: (m as unknown as { id: string }).id,
      metric_date: (m as unknown as { metric_date: string }).metric_date,
      resting_heart_rate: (m as unknown as { resting_heart_rate: number | null }).resting_heart_rate ?? null,
      average_stress_level: (m as unknown as { average_stress_level: number | null }).average_stress_level ?? null,
      sleep_duration_seconds: (m as unknown as { sleep_duration_seconds: number | null }).sleep_duration_seconds ?? null,
      sleep_score: (m as unknown as { sleep_score: number | null }).sleep_score ?? null,
      awake_seconds: mm.awake_seconds ?? null,
      body_battery_charged: (m as unknown as { body_battery_charged: number | null }).body_battery_charged ?? null,
      body_battery_drained: (m as unknown as { body_battery_drained: number | null }).body_battery_drained ?? null,
      body_battery_start: (mm.body_battery_highest ?? mm.body_battery_start ?? null) as number | null,
      body_battery_lowest: (m as unknown as { body_battery_lowest: number | null }).body_battery_lowest ?? null,
      body_battery_most_recent: (m as unknown as { body_battery_most_recent: number | null }).body_battery_most_recent ?? null,
      hrv_last_night_average: (m as unknown as { hrv_last_night_average: number | null }).hrv_last_night_average ?? null,
      hrv_last_night_5_min_high: (m as unknown as { hrv_last_night_5_min_high: number | null }).hrv_last_night_5_min_high ?? null,
    };
  });

  const completeness = computeCompleteness(typed, monthEnding);
  const hasAnyRecent = completeness.calendarDaysPresent > 0 || completeness.sleepNightsPresent > 0;

  return NextResponse.json({
    connected: true,
    canGenerate: hasAnyRecent,
    reason: hasAnyRecent ? null : "No recent health data in the last 28 days",
    monthEnding,
    completeness,
    latestMetricDate,
  });
}
