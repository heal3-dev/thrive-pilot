/**
 * GET /api/cron/garmin-stale-alert
 *
 * Vercel Cron job that alerts when a connected participant has not had any
 * garmin_metrics.updated_at change for >48 hours (uses pseudonymized health tables).
 *
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { getSupabaseAdmin } from "@/lib/supabase";
import { decryptParticipantId } from "@/lib/pseudonym-crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ALERT_RECIPIENTS = ["dev@heal-3.com", "olga@heal-3.com", "darren@heal-3.com"] as const;

function parsePositiveNumber(v: string | undefined | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type ParticipantRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  garmin_user_id: string | null;
  garmin_connected_at: string | null;
  is_active: boolean | null;
};

type PseudonymRow = {
  pseudonym_id: string;
  participant_id_encrypted: string;
};

type GarminTokenRow = {
  pseudonym_id: string;
};

type LastMetricRow = {
  pseudonym_id: string;
  last_metric_updated_at: string | null;
};

type AlertRow = {
  participant_id: string;
  last_alerted_at: string | null;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  const isAuthorized = authHeader === `Bearer ${secret}` || (querySecret && querySecret === secret);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleHours = parsePositiveNumber(process.env.GARMIN_STALE_HOURS, 48);
  const resendHours = parsePositiveNumber(process.env.GARMIN_STALE_ALERT_RESEND_HOURS, 24);

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "garmin-stale-alert", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "0 7 * * *" },
      maxRuntime: 60,
      timezone: "UTC",
    }
  );

  const now = Date.now();
  const staleBefore = new Date(now - staleHours * 36e5).toISOString();
  const resendBefore = new Date(now - resendHours * 36e5).toISOString();

  const admin = getSupabaseAdmin();

  const { data: participantsRaw, error: participantsErr } = await admin
    .from("participants")
    .select("id, name, email, phone_number, garmin_user_id, garmin_connected_at, is_active");

  if (participantsErr) {
    Sentry.captureException(participantsErr, { extra: { context: "fetch participants" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to fetch participants: ${participantsErr.message}` }, { status: 500 });
  }

  const participants = (participantsRaw ?? []) as ParticipantRow[];
  const activeParticipants = participants.filter((p) => p.is_active !== false);

  const { data: pseudonymsRaw, error: pseudonymsErr } = await admin
    .from("participant_pseudonyms")
    .select("pseudonym_id, participant_id_encrypted");

  if (pseudonymsErr) {
    Sentry.captureException(pseudonymsErr, { extra: { context: "fetch participant_pseudonyms" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to fetch pseudonym mappings: ${pseudonymsErr.message}` }, { status: 500 });
  }

  const pseudonyms = (pseudonymsRaw ?? []) as PseudonymRow[];
  const participantIdToPseudonym = new Map<string, string>();
  const pseudonymToParticipantId = new Map<string, string>();

  for (const row of pseudonyms) {
    try {
      const participantId = decryptParticipantId(row.participant_id_encrypted);
      participantIdToPseudonym.set(participantId, row.pseudonym_id);
      pseudonymToParticipantId.set(row.pseudonym_id, participantId);
    } catch (e) {
      // If a row can't be decrypted (bad key / corrupted data), skip it but keep the job running.
      Sentry.captureException(e, { extra: { context: "decrypt participant_id_encrypted" } });
    }
  }

  const { data: tokensRaw, error: tokensErr } = await admin
    .from("garmin_tokens")
    .select("pseudonym_id")
    .is("revoked_at", null);

  if (tokensErr) {
    Sentry.captureException(tokensErr, { extra: { context: "fetch garmin_tokens" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to fetch garmin tokens: ${tokensErr.message}` }, { status: 500 });
  }

  const activeTokenPseudonymIds = new Set(((tokensRaw ?? []) as GarminTokenRow[]).map((t) => t.pseudonym_id));

  const connected = activeParticipants
    .map((p) => {
      const pseudonymId = participantIdToPseudonym.get(p.id) ?? null;
      if (!pseudonymId) return null;
      const isConnected = Boolean(p.garmin_user_id) || activeTokenPseudonymIds.has(pseudonymId);
      if (!isConnected) return null;
      return { participant: p, pseudonymId };
    })
    .filter((x): x is { participant: ParticipantRow; pseudonymId: string } => Boolean(x));

  if (connected.length === 0) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "ok" });
    return NextResponse.json({ ok: true, alerted: 0, enqueuedEmails: 0, message: "No connected participants" });
  }

  const pseudonymIds = Array.from(new Set(connected.map((c) => c.pseudonymId)));
  const { data: lastMetricsRaw, error: lastMetricsErr } = await admin.rpc("get_garmin_metrics_last_updated", {
    pseudonym_ids: pseudonymIds,
  });

  if (lastMetricsErr) {
    Sentry.captureException(lastMetricsErr, { extra: { context: "get_garmin_metrics_last_updated" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json(
      { error: `Failed to compute last metric timestamps: ${lastMetricsErr.message}` },
      { status: 500 }
    );
  }

  const lastMetricByPseudonym = new Map<string, string>();
  for (const row of (lastMetricsRaw ?? []) as LastMetricRow[]) {
    if (row.pseudonym_id && row.last_metric_updated_at) {
      lastMetricByPseudonym.set(row.pseudonym_id, row.last_metric_updated_at);
    }
  }

  const participantIds = connected.map((c) => c.participant.id);
  const { data: alertsRaw, error: alertsErr } = await admin
    .from("garmin_stale_alerts")
    .select("participant_id, last_alerted_at")
    .in("participant_id", participantIds);

  if (alertsErr) {
    Sentry.captureException(alertsErr, { extra: { context: "fetch garmin_stale_alerts" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to fetch alert state: ${alertsErr.message}` }, { status: 500 });
  }

  const lastAlertedByParticipant = new Map<string, string>();
  for (const row of (alertsRaw ?? []) as AlertRow[]) {
    if (row.participant_id && row.last_alerted_at) {
      lastAlertedByParticipant.set(row.participant_id, row.last_alerted_at);
    }
  }

  const staleBeforeMs = new Date(staleBefore).getTime();
  const resendBeforeMs = new Date(resendBefore).getTime();

  const candidates = connected
    .map((c) => {
      const p = c.participant;
      const pseudonymId = c.pseudonymId;
      const lastMetricUpdatedAt = lastMetricByPseudonym.get(pseudonymId) ?? null;
      const refIso = lastMetricUpdatedAt ?? p.garmin_connected_at ?? null;
      if (!refIso) return null;
      const refMs = new Date(refIso).getTime();
      if (!Number.isFinite(refMs) || refMs >= staleBeforeMs) return null;

      const lastAlertedIso = lastAlertedByParticipant.get(p.id) ?? null;
      if (lastAlertedIso) {
        const lastAlertedMs = new Date(lastAlertedIso).getTime();
        if (Number.isFinite(lastAlertedMs) && lastAlertedMs >= resendBeforeMs) return null;
      }

      return {
        participant: p,
        pseudonymId,
        lastMetricUpdatedAt,
        lastAlertedAt: lastAlertedIso,
      };
    })
    .filter(
      (x): x is { participant: ParticipantRow; pseudonymId: string; lastMetricUpdatedAt: string | null; lastAlertedAt: string | null } =>
        Boolean(x)
    );

  if (candidates.length === 0) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "ok" });
    return NextResponse.json({ ok: true, alerted: 0, enqueuedEmails: 0, message: "No stale participants" });
  }

  const dayBucket = new Date(now).toISOString().slice(0, 10);
  const toEnqueue: Array<{
    kind: string;
    to_email: string;
    subject: string;
    html: string;
    idempotency_key: string;
  }> = [];

  for (const c of candidates) {
    const p = c.participant;
    const display = p.name?.trim() || p.email?.trim() || p.id;
    const refIso = c.lastMetricUpdatedAt ?? p.garmin_connected_at ?? null;
    const refMs = refIso ? new Date(refIso).getTime() : NaN;
    const staleForHours =
      Number.isFinite(refMs) ? Math.round(((now - refMs) / 36e5) * 10) / 10 : null;

    const subject = `Garmin metrics stale >${staleHours}h: ${display}`;
    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
        <h2 style="margin:0 0 10px 0;">Garmin metrics stale alert</h2>
        <p style="margin:0 0 12px 0;">
          A connected participant has had no <code>garmin_metrics.updated_at</code> change for more than <strong>${staleHours} hours</strong>.
        </p>

        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; max-width:720px;">
          <tr><td style="padding:6px 0; color:#64748b;">Participant</td><td style="padding:6px 0; font-weight:600;">${escapeHtml(display)}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Participant ID</td><td style="padding:6px 0;"><code>${escapeHtml(p.id)}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Pseudonym ID</td><td style="padding:6px 0;"><code>${escapeHtml(c.pseudonymId)}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Email</td><td style="padding:6px 0;">${escapeHtml(p.email ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Phone</td><td style="padding:6px 0;">${escapeHtml(p.phone_number ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin user id</td><td style="padding:6px 0;">${escapeHtml(p.garmin_user_id ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin connected at</td><td style="padding:6px 0;">${escapeHtml(p.garmin_connected_at ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last metric updated at</td><td style="padding:6px 0;">${escapeHtml(c.lastMetricUpdatedAt ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Stale for</td><td style="padding:6px 0;">${staleForHours == null ? "—" : `${staleForHours} hours`}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last alerted at</td><td style="padding:6px 0;">${escapeHtml(c.lastAlertedAt ?? "—")}</td></tr>
        </table>

        <p style="margin:14px 0 0 0; color:#64748b; font-size:12px;">
          This alert is rate-limited per participant (default: once per ${resendHours} hours) until data updates again.
        </p>
      </div>
    `.trim();

    for (const to of ALERT_RECIPIENTS) {
      const idempotencyKey = `garmin-stale:${p.id}:${dayBucket}:${to}`;
      toEnqueue.push({
        kind: "garmin_stale_alert",
        to_email: to,
        subject,
        html,
        idempotency_key: idempotencyKey,
      });
    }
  }

  // Record rate-limit state for each participant we are alerting on.
  // Update last_metric_updated_at for visibility.
  const upserts = candidates.map((c) => ({
    participant_id: c.participant.id,
    pseudonym_id: c.pseudonymId,
    last_metric_updated_at: c.lastMetricUpdatedAt,
    last_alerted_at: new Date().toISOString(),
  }));

  const { error: alertsErr } = await admin
    .from("garmin_stale_alerts")
    .upsert(upserts, { onConflict: "participant_id" });

  if (alertsErr) {
    Sentry.captureException(alertsErr, { extra: { context: "upsert garmin_stale_alerts" } });
  }

  const { error: enqueueErr } = await admin
    .from("email_jobs")
    .upsert(toEnqueue, { onConflict: "idempotency_key", ignoreDuplicates: true });

  if (enqueueErr) {
    Sentry.captureException(enqueueErr, { extra: { context: "enqueue email_jobs" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to enqueue email jobs: ${enqueueErr.message}` }, { status: 500 });
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "ok" });
  return NextResponse.json({
    ok: true,
    alerted: candidates.length,
    enqueuedEmails: toEnqueue.length,
    staleHours,
    resendHours,
  });
}

