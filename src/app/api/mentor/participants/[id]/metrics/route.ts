import { NextRequest, NextResponse } from "next/server";

import { requireMentor } from "@/app/api/_utils";
import { calculateFlags, type Metric } from "@/lib/flags/rules";
import { hashParticipantId } from "@/lib/pseudonym-crypto";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMentor(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const mentorId = guard.mentor.id;
  const { id: participantId } = await params;

  const { data: assignment, error: assignmentError } = await admin
    .from("mentor_assignments")
    .select("id")
    .eq("mentor_id", mentorId)
    .eq("participant_id", participantId)
    .is("unassigned_at", null)
    .maybeSingle();

  if (assignmentError) {
    return NextResponse.json({ error: "Failed to verify participant assignment" }, { status: 500 });
  }

  if (!assignment) {
    return NextResponse.json({ error: "Participant not found or access denied" }, { status: 404 });
  }

  const { data: participant, error: participantError } = await admin
    .from("participants")
    .select("id, name, email, garmin_user_id, garmin_connected_at")
    .eq("id", participantId)
    .maybeSingle();

  if (participantError) {
    return NextResponse.json({ error: "Failed to fetch participant" }, { status: 500 });
  }

  if (!participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

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

  let isConnected = Boolean(participant.garmin_user_id);
  if (!isConnected && pseudonymId) {
    const { data: tokenData, error: tokenError } = await admin
      .from("garmin_tokens")
      .select("pseudonym_id")
      .eq("pseudonym_id", pseudonymId)
      .is("revoked_at", null)
      .maybeSingle();
    if (tokenError) {
      return NextResponse.json({ error: "Failed to check Garmin connection" }, { status: 500 });
    }
    isConnected = Boolean(tokenData);
  }

  let metricsData: Record<string, unknown>[] = [];
  if (pseudonymId) {
    const { data: metrics, error: metricsError } = await admin
      .from("garmin_metrics")
      .select(
        "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, body_battery_charged, body_battery_drained, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
      )
      .eq("pseudonym_id", pseudonymId)
      .order("metric_date", { ascending: false })
      .limit(33);

    if (metricsError) {
      return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
    }
    metricsData = metrics || [];
  }

  const typedMetrics: Metric[] = metricsData.map((m) => ({
    id: m.id as string,
    metric_date: m.metric_date as string,
    resting_heart_rate: m.resting_heart_rate as number | null,
    average_stress_level: m.average_stress_level as number | null,
    sleep_duration_seconds: m.sleep_duration_seconds as number | null,
    sleep_score: m.sleep_score as number | null,
    body_battery_charged: m.body_battery_charged as number | null,
    body_battery_drained: m.body_battery_drained as number | null,
    body_battery_most_recent: m.body_battery_most_recent as number | null,
    hrv_last_night_average: m.hrv_last_night_average as number | null,
    hrv_last_night_5_min_high: m.hrv_last_night_5_min_high as number | null,
  }));

  return NextResponse.json({
    participant,
    is_connected: isConnected,
    metrics: metricsData,
    flags: calculateFlags(typedMetrics),
  });
}
