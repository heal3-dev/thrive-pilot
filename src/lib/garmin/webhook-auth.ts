/**
 * Shared authentication logic for Garmin webhook endpoints.
 *
 * Supports three verification modes:
 *   1. HMAC-SHA1 Signature header (OAuth 1.0a partners)
 *   2. garmin-client-id header (OAuth 2.0 Push model)
 *   3. No auth headers (accepted with warning — Garmin relies on HTTPS)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyGarminSignature } from '@/lib/garmin/webhook';

export type AuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Verify a Garmin webhook request's authenticity.
 * Returns { ok: true } if the request should be processed,
 * or { ok: false, response } with the error response to return.
 */
export function verifyWebhookAuth(
  request: NextRequest,
  rawBody: string,
  endpointName: string,
): AuthResult {
  const signature = request.headers.get('Signature');
  const garminClientId = request.headers.get('garmin-client-id');

  if (signature) {
    let isValid: boolean;
    try {
      isValid = verifyGarminSignature(rawBody, signature);
    } catch (error) {
      console.error(`[${endpointName}] Signature verification error:`, error);
      return { ok: false, response: NextResponse.json({ error: 'Server configuration error' }, { status: 500 }) };
    }

    if (!isValid) {
      console.warn(`[${endpointName}] Invalid HMAC signature — rejecting`);
      return { ok: false, response: NextResponse.json({ error: 'Invalid signature' }, { status: 401 }) };
    }
    console.log(`[${endpointName}] HMAC signature verified`);
  } else if (garminClientId) {
    const expectedClientId = process.env.GARMIN_CLIENT_ID;
    if (expectedClientId && garminClientId !== expectedClientId) {
      console.warn(`[${endpointName}] garmin-client-id mismatch — rejecting`);
      return { ok: false, response: NextResponse.json({ error: 'Invalid client ID' }, { status: 401 }) };
    }
    console.log(`[${endpointName}] Verified via garmin-client-id header`);
  } else {
    console.warn(`[${endpointName}] No auth headers — accepting (OAuth 2.0 Push model)`);
  }

  return { ok: true };
}
