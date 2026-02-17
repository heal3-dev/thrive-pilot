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

// Ensure this route is never cached and always runs as a serverless function
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — Webhook verification / health check
// ---------------------------------------------------------------------------
// Garmin may send a GET request to verify the endpoint is reachable when you
// register or update the webhook URL in the developer portal.  Returning 200
// confirms the endpoint is alive.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { status: 'ok', endpoint: 'garmin-dailies-webhook' },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// POST — Receive daily summary push notifications
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const startMs = Date.now();

  console.log('[GARMIN_WEBHOOK] Incoming POST request', {
    url: request.url,
    headers: {
      'content-type': request.headers.get('content-type'),
      'content-length': request.headers.get('content-length'),
      signature: request.headers.get('Signature') ? '(present)' : '(missing)',
      'user-agent': request.headers.get('user-agent'),
    },
  });

  // -----------------------------------------------------------------------
  // 1. Read raw body for signature verification
  // -----------------------------------------------------------------------
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('[GARMIN_WEBHOOK] Failed to read request body:', err);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!rawBody) {
    console.warn('[GARMIN_WEBHOOK] Empty request body received');
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  console.log('[GARMIN_WEBHOOK] Body received', {
    length: rawBody.length,
    preview: rawBody.slice(0, 200),
  });

  // -----------------------------------------------------------------------
  // 2. Verify signature (Critical Security)
  // -----------------------------------------------------------------------
  const signature = request.headers.get('Signature');
  if (!signature) {
    console.warn('[GARMIN_WEBHOOK] Missing Signature header — all headers:', Object.fromEntries(request.headers.entries()));
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
    console.warn('[GARMIN_WEBHOOK] Invalid signature — rejecting request', {
      signatureHeader: signature.slice(0, 16) + '...',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log('[GARMIN_WEBHOOK] Signature verified successfully');

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

  // Log all top-level keys to detect unexpected payload shapes
  const topLevelKeys = Object.keys(payload);
  console.log('[GARMIN_WEBHOOK] Payload keys:', topLevelKeys, {
    dailiesCount: Array.isArray(payload.dailies) ? payload.dailies.length : 0,
  });

  if (!Array.isArray(payload.dailies) || payload.dailies.length === 0) {
    console.log('[GARMIN_WEBHOOK] No dailies in payload — returning 200');
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
