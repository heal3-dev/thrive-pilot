/**
 * POST /api/garmin/webhooks/hrv
 *
 * Garmin Health API webhook receiver for HRV summary push notifications.
 * HRV data is merged into garmin_metrics rows (same participant + date).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  processHrvSummary,
  type GarminWebhookPayload,
  type ProcessingResult,
} from '@/lib/garmin/webhook';
import { verifyWebhookAuth } from '@/lib/garmin/webhook-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { status: 'ok', endpoint: 'garmin-hrv-webhook' },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const TAG = 'GARMIN_HRV';

  console.log(`[${TAG}] Incoming POST request`);

  // 1. Read raw body
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error(`[${TAG}] Failed to read body:`, err);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!rawBody) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  // 2. Verify auth
  const auth = verifyWebhookAuth(request, rawBody, TAG);
  if (!auth.ok) return auth.response;

  // 3. Parse payload
  let payload: GarminWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GarminWebhookPayload;
  } catch {
    console.error(`[${TAG}] Invalid JSON body`);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hrvSummaries = payload.hrv;
  if (!Array.isArray(hrvSummaries) || hrvSummaries.length === 0) {
    console.log(`[${TAG}] No HRV summaries in payload — returning 200`);
    return NextResponse.json({ message: 'No HRV data to process' }, { status: 200 });
  }

  console.log(`[${TAG}] Processing ${hrvSummaries.length} HRV summaries`);

  // 4. Process each HRV summary
  const results: ProcessingResult[] = [];

  for (const summary of hrvSummaries) {
    try {
      const result = await processHrvSummary(summary);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${TAG}] Unexpected error:`, { summaryId: summary.summaryId, error: message });
      results.push({
        summaryId: summary.summaryId ?? 'unknown',
        userId: summary.userId ?? 'unknown',
        calendarDate: summary.calendarDate ?? 'unknown',
        participantId: null,
        status: 'failed',
        error: message,
      });
    }
  }

  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const durationMs = Date.now() - startMs;

  console.log(`[${TAG}] Batch complete`, { total: results.length, succeeded, failed, skipped, durationMs });

  return NextResponse.json(
    { received: results.length, succeeded, failed, skipped, duration_ms: durationMs },
    { status: 200 },
  );
}
