/**
 * POST /api/garmin/webhooks/dailies
 *
 * Garmin Health API webhook receiver for daily summary push notifications.
 *
 * Flow:
 *   1. Read raw body & verify HMAC-SHA1 Signature header (anti-spoofing)
 *   2. Parse JSON payload → array of daily summaries
 *   3. For each summary, processDailySummary():
 *      a. Resolve Garmin userId → participant_id
 *      b. Upsert mapped fields into garmin_metrics
 *      c. Log result to ingestion_logs
 *   4. Return 200 (even on partial failures — Garmin will retry on 5xx)
 *
 * Security:
 *   - No auth header required (Garmin doesn't send one)
 *   - Signature header is the sole authentication mechanism
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyGarminSignature,
  processDailySummary,
  type GarminWebhookPayload,
  type ProcessingResult,
} from '@/lib/garmin/webhook';

export async function POST(request: NextRequest) {
  const startMs = Date.now();

  // -----------------------------------------------------------------------
  // 1. Read raw body for signature verification
  // -----------------------------------------------------------------------
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    console.error('[GARMIN_WEBHOOK] Failed to read request body');
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!rawBody) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  // -----------------------------------------------------------------------
  // 2. Verify signature (Critical Security)
  // -----------------------------------------------------------------------
  const signature = request.headers.get('Signature');
  if (!signature) {
    console.warn('[GARMIN_WEBHOOK] Missing Signature header');
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  let isValid: boolean;
  try {
    isValid = verifyGarminSignature(rawBody, signature);
  } catch (error) {
    console.error('[GARMIN_WEBHOOK] Signature verification error:', error);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (!isValid) {
    console.warn('[GARMIN_WEBHOOK] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // -----------------------------------------------------------------------
  // 3. Parse JSON payload
  // -----------------------------------------------------------------------
  let payload: GarminWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GarminWebhookPayload;
  } catch {
    console.error('[GARMIN_WEBHOOK] Invalid JSON body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(payload.dailies) || payload.dailies.length === 0) {
    // Not an error — Garmin may send empty payloads for other summary types
    return NextResponse.json({ message: 'No dailies to process' }, { status: 200 });
  }

  // -----------------------------------------------------------------------
  // 4. Process each daily summary inline (simple for pilot)
  // -----------------------------------------------------------------------
  const results: ProcessingResult[] = [];

  for (const summary of payload.dailies) {
    try {
      const result = await processDailySummary(summary);
      results.push(result);
    } catch (error) {
      // Catch-all — should not happen since processDailySummary handles errors
      const message = error instanceof Error ? error.message : String(error);
      console.error('[GARMIN_WEBHOOK] Unexpected error processing summary:', {
        summaryId: summary.summaryId,
        error: message,
      });
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

  console.log('[GARMIN_WEBHOOK] Batch complete', {
    total: results.length,
    succeeded,
    failed,
    skipped,
    durationMs,
  });

  // Always return 200 so Garmin doesn't retry the whole batch.
  // Individual failures are logged in ingestion_logs for review.
  return NextResponse.json(
    {
      received: results.length,
      succeeded,
      failed,
      skipped,
      duration_ms: durationMs,
    },
    { status: 200 }
  );
}
