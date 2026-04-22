/**
 * GET /api/cron/garmin-sync-health
 *
 * Daily health check for Garmin sync freshness:
 * - Finds participants with an active Garmin token but no successful ingestion recently
 * - Sends a magic-link reconnect email (throttled) when stale
 *
 * Scheduled via `vercel.json`.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptParticipantId } from '@/lib/pseudonym-crypto';
import { sendEmail } from '@/lib/email/send';
import { markGarminAlertSent } from '@/lib/garmin/connection-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MONITOR_SLUG = 'garmin-sync-health';
const SCHEDULE = '15 6 * * *'; // daily at 06:15 UTC (after token refresh cron)

const STALE_AFTER_DAYS = 3;
const ALERT_COOLDOWN_DAYS = 7;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export async function GET(request: NextRequest) {
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: 'in_progress' },
    {
      schedule: { type: 'crontab', value: SCHEDULE },
      checkinMargin: 10,
      maxRuntime: 60,
      timezone: 'UTC',
    },
  );

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // 1) Find active Garmin connections (tokens not revoked)
  const { data: activeTokens, error: tokenErr } = await supabase
    .from('garmin_tokens')
    .select('pseudonym_id')
    .is('revoked_at', null);

  if (tokenErr) {
    Sentry.captureException(tokenErr, { extra: { context: 'Failed to fetch active garmin tokens' } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'Failed to fetch tokens' }, { status: 500 });
  }

  const pseudonymIds = Array.from(new Set((activeTokens ?? []).map((t) => t.pseudonym_id).filter(Boolean)));
  if (pseudonymIds.length === 0) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
    return NextResponse.json({ message: 'No active Garmin connections' });
  }

  // 2) Load connection health rows (if present) for these pseudonyms
  const { data: healthRows, error: healthErr } = await supabase
    .from('garmin_connection_health')
    .select('pseudonym_id, last_success_at, last_alert_sent_at')
    .in('pseudonym_id', pseudonymIds);

  if (healthErr) {
    Sentry.captureException(healthErr, { extra: { context: 'Failed to fetch garmin_connection_health' } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'Failed to fetch health rows' }, { status: 500 });
  }

  const byPseudonym = new Map<string, { last_success_at: string | null; last_alert_sent_at: string | null }>();
  for (const row of healthRows ?? []) {
    byPseudonym.set(row.pseudonym_id, {
      last_success_at: (row as unknown as { last_success_at?: string | null }).last_success_at ?? null,
      last_alert_sent_at: (row as unknown as { last_alert_sent_at?: string | null }).last_alert_sent_at ?? null,
    });
  }

  const staleBefore = daysAgo(STALE_AFTER_DAYS);
  const alertCooldownBefore = daysAgo(ALERT_COOLDOWN_DAYS);

  let stale = 0;
  let alerted = 0;
  let skippedCooldown = 0;
  let errors = 0;

  // 3) For each active connection, decide if we should alert
  for (const pseudonymId of pseudonymIds) {
    const health = byPseudonym.get(pseudonymId);
    const lastSuccessAt = health?.last_success_at ? new Date(health.last_success_at) : null;
    const lastAlertAt = health?.last_alert_sent_at ? new Date(health.last_alert_sent_at) : null;

    const isStale = !lastSuccessAt || lastSuccessAt < staleBefore;
    if (!isStale) continue;
    stale++;

    if (lastAlertAt && lastAlertAt > alertCooldownBefore) {
      skippedCooldown++;
      continue;
    }

    try {
      // Resolve participant email by decrypting mapping (service-role only)
      const { data: mapping, error: mappingErr } = await supabase
        .from('participant_pseudonyms')
        .select('participant_id_encrypted')
        .eq('pseudonym_id', pseudonymId)
        .maybeSingle();

      if (mappingErr || !mapping?.participant_id_encrypted) {
        errors++;
        continue;
      }

      let participantId: string;
      try {
        participantId = decryptParticipantId(mapping.participant_id_encrypted);
      } catch {
        errors++;
        continue;
      }

      const { data: participant, error: participantErr } = await supabase
        .from('participants')
        .select('name, email')
        .eq('id', participantId)
        .maybeSingle();

      if (participantErr || !participant?.email) {
        errors++;
        continue;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.example.com';
      const nextPath = `/garmin/connect?participant_id=${encodeURIComponent(participantId)}&reauthorize=1`;

      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: participant.email,
        options: {
          redirectTo: `${siteUrl}/auth/callback?next=/garmin/connect`,
          data: { participant_id: participantId, action: 'garmin_reconnect' },
        },
      });

      if (linkErr || !linkData?.properties?.hashed_token) {
        errors++;
        continue;
      }

      const reconnectUrl = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(nextPath)}`;

      await sendEmail({
        to: participant.email,
        subject: 'Action Required: Reconnect Your Garmin Account',
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
            <h2>Garmin Sync Paused</h2>
            <p>Hi ${participant.name ?? 'there'},</p>
            <p>
              We haven’t received new Garmin wellness data recently. This can happen if your watch
              hasn’t been syncing, or if your Garmin authorization needs to be renewed.
            </p>
            <p style="text-align: center; margin: 24px 0;">
              <a href="${reconnectUrl}"
                 style="background: #4f46e5; color: white; padding: 12px 24px;
                        border-radius: 6px; text-decoration: none; font-weight: 600;">
                Reconnect Garmin
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">
              If you believe this is a mistake, try opening Garmin Connect and syncing your watch.
            </p>
          </div>
        `.trim(),
      });

      await markGarminAlertSent({ pseudonymId, alertType: 'reconnect' });
      alerted++;
    } catch (e) {
      errors++;
      Sentry.captureException(e, { extra: { context: 'Failed during sync-health alert flow', pseudonymId } });
    }
  }

  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: MONITOR_SLUG,
    status: errors > 0 ? 'error' : 'ok',
  });

  return NextResponse.json({
    checked: pseudonymIds.length,
    stale,
    alerted,
    skippedCooldown,
    errors,
    stale_after_days: STALE_AFTER_DAYS,
    cooldown_days: ALERT_COOLDOWN_DAYS,
  });
}

