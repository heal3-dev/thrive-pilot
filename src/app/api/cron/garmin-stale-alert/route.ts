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

type CandidateRow = {
  pseudonym_id: string;
  participant_id_encrypted: string | null;
  garmin_connected_at: string | null;
  last_metric_updated_at: string | null;
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

  const { data, error } = await admin.rpc("get_garmin_stale_alert_candidates", {
    stale_before: staleBefore,
    resend_before: resendBefore,
  });

  if (error) {
    Sentry.captureException(error, { extra: { context: "get_garmin_stale_alert_candidates" } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: "garmin-stale-alert", status: "error" });
    return NextResponse.json({ error: `Failed to query stale candidates: ${error.message}` }, { status: 500 });
  }

  const candidates = (data ?? []) as CandidateRow[];
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

  // Decrypt participant IDs and load participant details (mapping is encrypted in DB).
  const participantIds: string[] = [];
  const participantIdByPseudonym = new Map<string, string | null>();

  for (const c of candidates) {
    let participantId: string | null = null;
    if (c.participant_id_encrypted) {
      try {
        participantId = decryptParticipantId(c.participant_id_encrypted);
      } catch {
        participantId = null;
      }
    }
    participantIdByPseudonym.set(c.pseudonym_id, participantId);
    if (participantId) participantIds.push(participantId);
  }

  const uniqueParticipantIds = Array.from(new Set(participantIds));
  const participantById = new Map<
    string,
    {
      id: string;
      name: string | null;
      email: string | null;
      phone_number: string | null;
      garmin_user_id: string | null;
      garmin_connected_at: string | null;
      is_active: boolean | null;
    }
  >();

  if (uniqueParticipantIds.length > 0) {
    const { data: participantRows, error: participantErr } = await admin
      .from("participants")
      .select("id, name, email, phone_number, garmin_user_id, garmin_connected_at, is_active")
      .in("id", uniqueParticipantIds);

    if (participantErr) {
      Sentry.captureException(participantErr, { extra: { context: "load participants for garmin stale alerts" } });
    } else {
      for (const p of participantRows ?? []) {
        participantById.set(p.id, p);
      }
    }
  }

  const alerted: CandidateRow[] = [];

  for (const c of candidates) {
    const participantId = participantIdByPseudonym.get(c.pseudonym_id) ?? null;
    const participant = participantId ? participantById.get(participantId) ?? null : null;

    // If we can resolve participant state and they are inactive, skip alerting.
    if (participant?.is_active === false) continue;

    const display =
      participant?.name?.trim() || participant?.email?.trim() || participantId || c.pseudonym_id;

    const refIso =
      c.last_metric_updated_at ?? participant?.garmin_connected_at ?? c.garmin_connected_at ?? null;
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
          <tr><td style="padding:6px 0; color:#64748b;">Participant ID</td><td style="padding:6px 0;"><code>${escapeHtml(participantId ?? "—")}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Pseudonym ID</td><td style="padding:6px 0;"><code>${escapeHtml(c.pseudonym_id)}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Email</td><td style="padding:6px 0;">${escapeHtml(participant?.email ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Phone</td><td style="padding:6px 0;">${escapeHtml(participant?.phone_number ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin user id</td><td style="padding:6px 0;">${escapeHtml(participant?.garmin_user_id ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin connected at</td><td style="padding:6px 0;">${escapeHtml(participant?.garmin_connected_at ?? c.garmin_connected_at ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last metric updated at</td><td style="padding:6px 0;">${escapeHtml(c.last_metric_updated_at ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Stale for</td><td style="padding:6px 0;">${staleForHours == null ? "—" : `${staleForHours} hours`}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last alerted at</td><td style="padding:6px 0;">${escapeHtml(c.last_alerted_at ?? "—")}</td></tr>
        </table>

        <p style="margin:14px 0 0 0; color:#64748b; font-size:12px;">
          This alert is rate-limited per pseudonym (default: once per ${resendHours} hours) until data updates again.
        </p>
      </div>
    `.trim();

    for (const to of ALERT_RECIPIENTS) {
      const idempotencyKey = `garmin-stale:${participantId ?? c.pseudonym_id}:${dayBucket}:${to}`;
      toEnqueue.push({
        kind: "garmin_stale_alert",
        to_email: to,
        subject,
        html,
        idempotency_key: idempotencyKey,
      });
    }

    alerted.push(c);
  }

  // Record rate-limit state for each pseudonym we are alerting on.
  // Update last_metric_updated_at for visibility.
  const upserts = alerted.map((c) => ({
    pseudonym_id: c.pseudonym_id,
    last_metric_updated_at: c.last_metric_updated_at,
    last_alerted_at: new Date().toISOString(),
  }));

  const { error: alertsErr } = await admin
    .from("garmin_stale_alerts")
    .upsert(upserts, { onConflict: "pseudonym_id" });

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
    alerted: alerted.length,
    enqueuedEmails: toEnqueue.length,
    staleHours,
    resendHours,
  });
}

