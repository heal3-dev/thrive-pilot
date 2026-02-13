/**
 * POST /api/garmin/backfill
 *
 * Admin-only endpoint to manually trigger a Garmin data backfill for a
 * specific participant and date range.
 *
 * Body (JSON):
 *   - participant_id  (string, UUID)   – required
 *   - start_date      (string, YYYY-MM-DD) – required
 *   - end_date        (string, YYYY-MM-DD) – required
 *
 * Returns the backfill result with counts of imported / failed / skipped days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_utils';
import { runBackfill } from '@/lib/garmin/pull-client';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Admin auth check
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  // 2. Parse & validate request body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { participant_id, start_date, end_date } = body as {
    participant_id?: string;
    start_date?: string;
    end_date?: string;
  };

  if (!participant_id || !UUID_RE.test(participant_id)) {
    return NextResponse.json(
      { error: 'participant_id is required and must be a valid UUID' },
      { status: 400 },
    );
  }

  if (!start_date || !isValidDate(start_date)) {
    return NextResponse.json(
      { error: 'start_date is required and must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  if (!end_date || !isValidDate(end_date)) {
    return NextResponse.json(
      { error: 'end_date is required and must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  if (start_date > end_date) {
    return NextResponse.json(
      { error: 'start_date must be on or before end_date' },
      { status: 400 },
    );
  }

  // 3. Verify participant exists and has Garmin connected
  const supabase = guard.admin;
  const { data: participant, error: pError } = await supabase
    .from('participants')
    .select('id, name, garmin_user_id')
    .eq('id', participant_id)
    .maybeSingle();

  if (pError) {
    console.error('[GARMIN_BACKFILL] Participant lookup error:', pError.message);
    return NextResponse.json(
      { error: 'Failed to look up participant' },
      { status: 500 },
    );
  }

  if (!participant) {
    return NextResponse.json(
      { error: 'Participant not found' },
      { status: 404 },
    );
  }

  if (!participant.garmin_user_id) {
    return NextResponse.json(
      { error: 'Participant has not connected their Garmin account' },
      { status: 400 },
    );
  }

  // 4. Run the backfill
  try {
    const result = await runBackfill({
      participantId: participant_id,
      startDate: start_date,
      endDate: end_date,
    });

    console.log('[GARMIN_BACKFILL] Complete:', {
      participant_id,
      start_date,
      end_date,
      imported: result.daysImported,
      failed: result.daysFailed,
      skipped: result.daysSkipped,
      durationMs: result.durationMs,
    });

    return NextResponse.json({
      message: `Backfill complete: ${result.daysImported} day(s) imported, ${result.daysFailed} failed, ${result.daysSkipped} skipped`,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GARMIN_BACKFILL] Error:', { participant_id, error: message });

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
