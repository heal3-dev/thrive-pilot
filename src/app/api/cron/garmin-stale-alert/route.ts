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
  participant_id: string;
  pseudonym_id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  garmin_user_id: string | null;
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

  for (const c of candidates) {
    const display = c.name?.trim() || c.email?.trim() || c.participant_id;
    const refIso = c.last_metric_updated_at ?? c.garmin_connected_at ?? null;
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
          <tr><td style="padding:6px 0; color:#64748b;">Participant ID</td><td style="padding:6px 0;"><code>${escapeHtml(c.participant_id)}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Pseudonym ID</td><td style="padding:6px 0;"><code>${escapeHtml(c.pseudonym_id)}</code></td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Email</td><td style="padding:6px 0;">${escapeHtml(c.email ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Phone</td><td style="padding:6px 0;">${escapeHtml(c.phone_number ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin user id</td><td style="padding:6px 0;">${escapeHtml(c.garmin_user_id ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Garmin connected at</td><td style="padding:6px 0;">${escapeHtml(c.garmin_connected_at ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last metric updated at</td><td style="padding:6px 0;">${escapeHtml(c.last_metric_updated_at ?? "—")}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Stale for</td><td style="padding:6px 0;">${staleForHours == null ? "—" : `${staleForHours} hours`}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">Last alerted at</td><td style="padding:6px 0;">${escapeHtml(c.last_alerted_at ?? "—")}</td></tr>
        </table>

        <p style="margin:14px 0 0 0; color:#64748b; font-size:12px;">
          This alert is rate-limited per participant (default: once per ${resendHours} hours) until data updates again.
        </p>
      </div>
    `.trim();

    for (const to of ALERT_RECIPIENTS) {
      const idempotencyKey = `garmin-stale:${c.participant_id}:${dayBucket}:${to}`;
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
    participant_id: c.participant_id,
    pseudonym_id: c.pseudonym_id,
    last_metric_updated_at: c.last_metric_updated_at,
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

