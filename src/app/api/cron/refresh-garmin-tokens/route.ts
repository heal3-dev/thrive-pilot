/**
 * GET /api/cron/refresh-garmin-tokens
 *
 * Vercel Cron Job that proactively refreshes all Garmin OAuth tokens.
 * Runs daily at 06:00 UTC to keep refresh tokens alive (they expire
 * after ~90 days of inactivity).
 *
 * Protected by CRON_SECRET — only Vercel's cron scheduler can call this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { refreshGarminToken, GarminTokenRevokedError } from '@/lib/garmin/token-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[CRON_REFRESH] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Fetch all non-revoked tokens
  const { data: tokens, error: fetchError } = await supabase
    .from('garmin_tokens')
    .select('id, expires_at')
    .is('revoked_at', null);

  if (fetchError) {
    console.error('[CRON_REFRESH] Failed to fetch tokens:', fetchError.message);
    return NextResponse.json({ error: 'Failed to fetch tokens' }, { status: 500 });
  }

  if (!tokens || tokens.length === 0) {
    console.log('[CRON_REFRESH] No active tokens to refresh');
    return NextResponse.json({ message: 'No tokens to refresh', refreshed: 0, failed: 0, skipped: 0 });
  }

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const token of tokens) {
    // Only refresh tokens that are expired or will expire within 24 hours
    const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
    const oneDayFromNow = Date.now() + 86_400_000;

    if (expiresAt > oneDayFromNow) {
      skipped++;
      continue;
    }

    try {
      await refreshGarminToken(token.id);
      refreshed++;
      console.log('[CRON_REFRESH] Refreshed token:', token.id);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof GarminTokenRevokedError) {
        console.warn('[CRON_REFRESH] Token permanently revoked:', token.id);
        errors.push(`${token.id}: revoked`);
      } else {
        console.error('[CRON_REFRESH] Refresh failed:', { tokenId: token.id, error: message });
        errors.push(`${token.id}: ${message}`);
      }
    }
  }

  console.log('[CRON_REFRESH] Complete', { total: tokens.length, refreshed, failed, skipped });

  return NextResponse.json({
    message: 'Token refresh complete',
    total: tokens.length,
    refreshed,
    failed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
