/**
 * POST /api/garmin/webhooks/stress
 *
 * Garmin Health API webhook receiver for stress detail push notifications.
 * Extracts body battery score (most recent, highest, lowest) from the
 * TimeOffsetBodyBatteryValues time-series and merges into garmin_metrics.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  processStressDetailSummary,
  type ProcessingResult,
} from '@/lib/garmin/webhook';
import { verifyWebhookAuth } from '@/lib/garmin/webhook-auth';
import * as Sentry from "@sentry/nextjs";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { status: 'ok', endpoint: 'garmin-stress-webhook' },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const TAG = 'GARMIN_STRESS';

  console.log(`[${TAG}] Incoming POST request`);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error(`[${TAG}] Failed to read body:`, err);
    Sentry.captureException(err, { extra: { context: "Failed to read request body", TAG } });
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!rawBody) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  const auth = verifyWebhookAuth(request, rawBody, TAG);
  if (!auth.ok) return auth.response;

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error(`[${TAG}] Invalid JSON body`);
    Sentry.captureException(err, { extra: { context: "Invalid JSON body", TAG, rawBody } });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const stressDetails = payload.stressDetails;
  if (!Array.isArray(stressDetails) || stressDetails.length === 0) {
    console.log(`[${TAG}] No stressDetails in payload — returning 200`);
    return NextResponse.json({ message: 'No stress data to process' }, { status: 200 });
  }

  console.log(`[${TAG}] Processing ${stressDetails.length} stress detail summaries`);

  const results: ProcessingResult[] = [];

  for (const summary of stressDetails) {
    try {
      const result = await processStressDetailSummary(summary);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${TAG}] Unexpected error:`, { summaryId: summary.summaryId, error: message });
      Sentry.captureException(error, { extra: { context: "Unexpected error", TAG, summaryId: summary.summaryId } });
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
