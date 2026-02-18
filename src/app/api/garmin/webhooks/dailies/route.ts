/**
 * POST /api/garmin/webhooks/dailies
 *
 * Garmin Health API webhook receiver for daily summary push notifications.
 *
 * Flow:
 *   1. Read raw body
 *   2. Verify authenticity (HMAC Signature OR garmin-client-id header)
 *   3. Parse JSON payload → array of daily summaries
 *   4. For each summary, processDailySummary():
 *      a. Resolve Garmin userId → participant_id
 *      b. Upsert mapped fields into garmin_metrics
 *      c. Log result to ingestion_logs
 *   5. Return 200 (even on partial failures — Garmin will retry on 5xx)
 *
 * Security:
 *   - HMAC-SHA1 Signature header verified when present (OAuth 1.0a)
 *   - garmin-client-id header verified when present (OAuth 2.0 Push)
 *   - Requests without either header are accepted (Garmin relies on HTTPS)
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
    preview: rawBody.slice(0, 200).replace(/"userAccessToken":"[^"]*"/g, '"userAccessToken":"[REDACTED]"'),
  });

  // -----------------------------------------------------------------------
  // 2. Verify request authenticity
  // -----------------------------------------------------------------------
  // Garmin Health API (OAuth 2.0 Push model) may NOT send an HMAC-SHA1
  // Signature header.  We support two verification methods:
  //   a) HMAC-SHA1 Signature header (legacy / OAuth 1.0a partners)
  //   b) garmin-client-id header matching our known client ID
  // If neither is present, we still accept the request (Garmin relies on
  // HTTPS + endpoint secrecy) but log a warning for auditing.
  const signature = request.headers.get('Signature');
  const garminClientId = request.headers.get('garmin-client-id');

  if (signature) {
    // Preferred: HMAC-SHA1 signature verification
    let isValid: boolean;
    try {
      isValid = verifyGarminSignature(rawBody, signature);
    } catch (error) {
      console.error('[GARMIN_WEBHOOK] Signature verification error:', error);
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (!isValid) {
      console.warn('[GARMIN_WEBHOOK] Invalid HMAC signature — rejecting', {
        signaturePrefix: signature.slice(0, 16) + '...',
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    console.log('[GARMIN_WEBHOOK] HMAC signature verified');
  } else if (garminClientId) {
    // Fallback: verify garmin-client-id matches our Client ID
    const expectedClientId = process.env.GARMIN_CLIENT_ID;
    if (expectedClientId && garminClientId !== expectedClientId) {
      console.warn('[GARMIN_WEBHOOK] garmin-client-id mismatch — rejecting', {
        received: garminClientId.slice(0, 8) + '...',
      });
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 401 });
    }
    console.log('[GARMIN_WEBHOOK] Verified via garmin-client-id header');
  } else {
    // No authentication headers — accept but log for monitoring.
    // Garmin Health API OAuth 2.0 Push model may not send either header.
    console.warn('[GARMIN_WEBHOOK] No Signature or garmin-client-id header — accepting request (OAuth 2.0 Push model)');
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
