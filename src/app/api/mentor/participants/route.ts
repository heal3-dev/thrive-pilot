import { NextResponse } from "next/server";

import { requireMentor } from "@/app/api/_utils";
import { calculateFlags, type Metric } from "@/lib/flags/rules";
import { hashParticipantId } from "@/lib/pseudonym-crypto";

export async function GET(request: Request) {
  const guard = await requireMentor(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const mentorId = guard.mentor.id;

  const { data: assignmentsData, error: assignmentsError } = await admin
    .from("mentor_assignments")
    .select("participant_id, assigned_at, unassigned_at")
    .eq("mentor_id", mentorId)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false });

  if (assignmentsError) {
    return NextResponse.json({ error: "Failed to fetch assignments" }, { status: 500 });
  }

  const participantIds = (assignmentsData ?? []).map((a) => a.participant_id);
  if (participantIds.length === 0) {
    return NextResponse.json({ participants: [] });
  }

  const { data: participantsData, error: participantsError } = await admin
    .from("participants")
    .select("id, name, phone_number, email, is_active, garmin_user_id, created_at, updated_at")
    .in("id", participantIds)
    .order("created_at", { ascending: false });

  if (participantsError) {
    return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });
  }

  const assignmentMap = new Map(
    (assignmentsData ?? []).map((assignment) => [assignment.participant_id, assignment])
  );

  const participantHashMap = new Map<string, string>();
  for (const participantId of participantIds) {
    participantHashMap.set(participantId, hashParticipantId(participantId));
  }

  const participantHashes = Array.from(participantHashMap.values());
  const { data: pseudonymRows, error: pseudonymError } = await admin
    .from("participant_pseudonyms")
    .select("participant_id_hash, pseudonym_id")
    .in("participant_id_hash", participantHashes);

  if (pseudonymError) {
    return NextResponse.json({ error: "Failed to fetch participant mappings" }, { status: 500 });
  }

  const participantToPseudonym = new Map<string, string>();
  const pseudonymToParticipant = new Map<string, string>();
  for (const row of pseudonymRows ?? []) {
    const participantId = participantIds.find(
      (id) => participantHashMap.get(id) === row.participant_id_hash
    );
    if (!participantId) continue;
    participantToPseudonym.set(participantId, row.pseudonym_id);
    pseudonymToParticipant.set(row.pseudonym_id, participantId);
  }

  const pseudonymIds = Array.from(pseudonymToParticipant.keys());
  let connectedPseudonymIds = new Set<string>();
  if (pseudonymIds.length > 0) {
    const { data: garminTokensData, error: garminTokensError } = await admin
      .from("garmin_tokens")
      .select("pseudonym_id")
      .in("pseudonym_id", pseudonymIds)
      .is("revoked_at", null);

    if (garminTokensError) {
      return NextResponse.json({ error: "Failed to fetch Garmin connections" }, { status: 500 });
    }
    connectedPseudonymIds = new Set((garminTokensData ?? []).map((token) => token.pseudonym_id));
  }

  const fourDaysAgo = new Date();
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
  const dateStr = fourDaysAgo.toISOString().split("T")[0];

  let metricsData: {
    pseudonym_id: string;
    metric_date: string;
    resting_heart_rate: number | null;
    average_stress_level: number | null;
    sleep_duration_seconds: number | null;
    sleep_score: number | null;
    body_battery_charged: number | null;
    body_battery_drained: number | null;
    hrv_last_night_average: number | null;
    hrv_last_night_5_min_high: number | null;
  }[] = [];

  if (pseudonymIds.length > 0) {
    const { data: fetchedMetrics, error: metricsError } = await admin
      .from("garmin_metrics")
      .select(
        "pseudonym_id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, body_battery_charged, body_battery_drained, hrv_last_night_average, hrv_last_night_5_min_high"
      )
      .in("pseudonym_id", pseudonymIds)
      .gte("metric_date", dateStr)
      .order("metric_date", { ascending: false });

    if (metricsError) {
      return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
    }
    metricsData = fetchedMetrics ?? [];
  }

  const metricsByParticipant = new Map<string, Metric[]>();
  for (const metric of metricsData ?? []) {
    const participantId = pseudonymToParticipant.get(metric.pseudonym_id);
    if (!participantId) continue;
    if (!metricsByParticipant.has(participantId)) {
      metricsByParticipant.set(participantId, []);
    }
    metricsByParticipant.get(participantId)?.push({
      id: "temp",
      metric_date: metric.metric_date,
      resting_heart_rate: metric.resting_heart_rate,
      average_stress_level: metric.average_stress_level,
      sleep_duration_seconds: metric.sleep_duration_seconds,
      sleep_score: metric.sleep_score,
      body_battery_charged: metric.body_battery_charged,
      body_battery_drained: metric.body_battery_drained,
      hrv_last_night_average: metric.hrv_last_night_average,
      hrv_last_night_5_min_high: metric.hrv_last_night_5_min_high,
    });
  }

  const participants = (participantsData ?? []).map((p) => ({
    ...p,
    garmin_connected:
      Boolean(p.garmin_user_id) ||
      connectedPseudonymIds.has(participantToPseudonym.get(p.id) ?? ""),
    assigned_mentor: assignmentMap.get(p.id)
      ? {
          mentor_id: mentorId,
          mentor_name: guard.mentor.name,
          mentor_email: guard.mentor.email,
          assigned_at: assignmentMap.get(p.id)?.assigned_at ?? null,
          unassigned_at: assignmentMap.get(p.id)?.unassigned_at ?? null,
        }
      : null,
    flags: calculateFlags(metricsByParticipant.get(p.id) ?? []),
  }));

  return NextResponse.json({ participants });
}
