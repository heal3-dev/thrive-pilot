/**
 * GET /api/cron/garmin-sync-health
 *
 * Daily health check for Garmin sync freshness:
 * - Finds participants with an active Garmin token but no successful ingestion recently
 * - Reports counts to support admin-driven follow-up (no auto outreach)
 *
 * Scheduled via `vercel.json`.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MONITOR_SLUG = 'garmin-sync-health';
const SCHEDULE = '15 6 * * *'; // daily at 06:15 UTC (after token refresh cron)

const STALE_AFTER_DAYS = 3;

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

  let stale = 0;
  const errors = 0;

  // 3) For each active connection, decide if we should alert
  for (const pseudonymId of pseudonymIds) {
    const health = byPseudonym.get(pseudonymId);
    const lastSuccessAt = health?.last_success_at ? new Date(health.last_success_at) : null;

    const isStale = !lastSuccessAt || lastSuccessAt < staleBefore;
    if (!isStale) continue;
    stale++;
  }

  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: MONITOR_SLUG,
    status: errors > 0 ? 'error' : 'ok',
  });

  return NextResponse.json({
    checked: pseudonymIds.length,
    stale,
    errors,
    stale_after_days: STALE_AFTER_DAYS,
  });
}

