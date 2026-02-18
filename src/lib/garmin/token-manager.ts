/**
 * Garmin Token Manager
 *
 * Centralized token refresh logic with:
 *   - Concurrency handling (in-flight dedup per token ID)
 *   - Revocation detection (marks tokens revoked on permanent failure)
 *   - Participant email alerts on revocation
 *
 * Used by GarminClient and pull-client to ensure tokens stay fresh.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken } from '@/lib/garmin/oauth-client';
import { sendEmail } from '@/lib/email/send';
import { hashParticipantId, decryptParticipantId } from '@/lib/pseudonym-crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GarminTokenRow {
  id: string;
  participant_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  revoked_at: string | null;
  updated_at?: string | null;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export class GarminTokenRevokedError extends Error {
  constructor(
    public readonly tokenId: string,
    public readonly reason: string,
  ) {
    super(`Garmin token ${tokenId} has been revoked: ${reason}`);
    this.name = 'GarminTokenRevokedError';
  }
}

// ---------------------------------------------------------------------------
// In-flight refresh dedup
// ---------------------------------------------------------------------------

/**
 * In-memory map of in-flight refresh promises keyed by token row ID.
 *
 * When multiple callers try to refresh the same token concurrently (e.g. two
 * parallel backfill requests), the first caller initiates the refresh and all
 * subsequent callers await the same promise.  This avoids race conditions
 * where two callers both read the old refresh_token and one invalidates the
 * other's attempt.
 *
 * Note: This works within a single Node.js process.  In a multi-instance
 * serverless deployment the worst case is two instances refreshing
 * simultaneously — the second refresh will simply overwrite with a newer
 * token, which is acceptable.
 */
const inflightRefreshes = new Map<string, Promise<RefreshResult>>();

// ---------------------------------------------------------------------------
// Core: refreshGarminToken
// ---------------------------------------------------------------------------

/**
 * Refresh the Garmin OAuth access token for a given token row.
 *
 * - Deduplicates concurrent calls for the same token ID.
 * - Updates `garmin_tokens` with the new credentials.
 * - On permanent failure (refresh_token invalid / revoked), marks the token
 *   as revoked and sends an alert email to the participant.
 *
 * @param tokenId - The `garmin_tokens.id` UUID
 * @returns The fresh access token, refresh token, and new expiry
 * @throws {GarminTokenRevokedError} when the refresh token is invalid
 */
export async function refreshGarminToken(
  tokenId: string,
): Promise<RefreshResult> {
  // Deduplicate: if a refresh is already in-flight for this token, piggyback
  const existing = inflightRefreshes.get(tokenId);
  if (existing) {
    console.log('[TOKEN_MANAGER] Awaiting in-flight refresh for token', tokenId);
    return existing;
  }

  const promise = _doRefresh(tokenId);

  inflightRefreshes.set(tokenId, promise);

  try {
    return await promise;
  } finally {
    inflightRefreshes.delete(tokenId);
  }
}

// ---------------------------------------------------------------------------
// Internal refresh implementation
// ---------------------------------------------------------------------------

async function _doRefresh(tokenId: string): Promise<RefreshResult> {
  const supabase = getSupabaseAdmin();

  // 1. Fetch the current token row
  const { data: token, error: fetchError } = await supabase
    .from('garmin_tokens')
    .select('id, pseudonym_id, refresh_token, revoked_at')
    .eq('id', tokenId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to fetch token row: ${fetchError.message}`);
  }

  if (!token) {
    throw new Error(`Token row ${tokenId} not found`);
  }

  if (token.revoked_at) {
    throw new GarminTokenRevokedError(tokenId, 'Token was previously revoked');
  }

  if (!token.refresh_token) {
    await revokeGarminToken(tokenId, 'No refresh token available');
    throw new GarminTokenRevokedError(tokenId, 'No refresh token available');
  }

  // 2. Call Garmin OAuth refresh endpoint
  try {
    const newTokens = await refreshAccessToken(token.refresh_token);

    const newExpiresAt = new Date(
      Date.now() + newTokens.expires_in * 1000,
    ).toISOString();

    const newRefreshToken = newTokens.refresh_token ?? token.refresh_token;

    // 3. Persist refreshed credentials
    const { error: updateError } = await supabase
      .from('garmin_tokens')
      .update({
        access_token: newTokens.access_token,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenId)
      // Optimistic concurrency: only update if not revoked in the meantime
      .is('revoked_at', null);

    if (updateError) {
      console.error('[TOKEN_MANAGER] Failed to persist refreshed token:', updateError.message);
      // Token is still valid for this request even if DB write failed
    }

    console.log('[TOKEN_MANAGER] Token refreshed successfully:', tokenId);

    return {
      accessToken: newTokens.access_token,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect permanent failures: 401 means the refresh token itself is invalid
    const isPermanentFailure =
      message.includes('401') || message.includes('invalid_grant');

    if (isPermanentFailure) {
      console.error(
        '[TOKEN_MANAGER] Refresh token is invalid/revoked for token',
        tokenId,
      );
      await revokeGarminToken(tokenId, `Refresh failed: ${message}`);
      throw new GarminTokenRevokedError(tokenId, message);
    }

    // Transient failure (network, 5xx, etc.) — don't revoke, just throw
    throw new Error(`Token refresh failed (transient): ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Mark a Garmin token as revoked and alert the participant via email.
 *
 * @param tokenId - The `garmin_tokens.id` UUID
 * @param reason  - Human-readable reason for revocation
 */
export async function revokeGarminToken(
  tokenId: string,
  reason: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  // 1. Mark the token as revoked
  const { data: token, error: updateError } = await supabase
    .from('garmin_tokens')
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenId)
    .is('revoked_at', null) // Only revoke if not already revoked
    .select('pseudonym_id')
    .maybeSingle();

  if (updateError) {
    console.error('[TOKEN_MANAGER] Failed to mark token as revoked:', updateError.message);
    return;
  }

  if (!token) {
    // Already revoked or token not found — nothing to do
    return;
  }

  console.warn('[TOKEN_MANAGER] Token revoked:', { tokenId, reason });

  // 2. Resolve participant_id from pseudonym for email alert (requires decryption)
  if (token.pseudonym_id) {
    try {
      const { data: mapping } = await supabase
        .from('participant_pseudonyms')
        .select('participant_id_encrypted')
        .eq('pseudonym_id', token.pseudonym_id)
        .maybeSingle();
      if (mapping?.participant_id_encrypted) {
        const participantId = decryptParticipantId(mapping.participant_id_encrypted);
        await sendRevocationAlert(participantId, reason);
      }
    } catch (err) {
      console.error('[TOKEN_MANAGER] Failed to decrypt participant_id for revocation alert:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Token lookup helper
// ---------------------------------------------------------------------------

/**
 * Get a valid access token for a participant, refreshing if expired.
 *
 * Resolves participant_id → pseudonym_id internally so callers don't
 * need to know about the pseudonym layer.
 *
 * @returns The token row (with fresh access_token) or null if no valid token
 * @throws {GarminTokenRevokedError} if the token is revoked during refresh
 */
export async function getValidToken(
  participantId: string,
): Promise<{ tokenId: string; accessToken: string } | null> {
  const supabase = getSupabaseAdmin();

  // Resolve pseudonym_id via HMAC hash (participant_id is encrypted in DB)
  const hash = hashParticipantId(participantId);
  const { data: mapping } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', hash)
    .maybeSingle();

  if (!mapping?.pseudonym_id) {
    console.error('[TOKEN_MANAGER] No pseudonym found for participant');
    return null;
  }

  const { data, error } = await supabase
    .from('garmin_tokens')
    .select('id, access_token, refresh_token, expires_at, revoked_at')
    .eq('pseudonym_id', mapping.pseudonym_id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[TOKEN_MANAGER] Token lookup error:', error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  const isExpired =
    data.expires_at &&
    new Date(data.expires_at).getTime() < Date.now() + 60_000;

  if (!isExpired) {
    return { tokenId: data.id, accessToken: data.access_token as string };
  }

  console.warn('[TOKEN_MANAGER] Token expired — refreshing');

  const result = await refreshGarminToken(data.id);
  return { tokenId: data.id, accessToken: result.accessToken };
}

// ---------------------------------------------------------------------------
// Revocation email alert
// ---------------------------------------------------------------------------

async function sendRevocationAlert(
  participantId: string,
  reason: string,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    // Look up participant email
    const { data: participant, error } = await supabase
      .from('participants')
      .select('name, email')
      .eq('id', participantId)
      .maybeSingle();

    if (error || !participant?.email) {
      console.warn(
        '[TOKEN_MANAGER] Cannot send revocation alert — no email for participant',
        participantId,
      );
      return;
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.example.com';
    const reconnectUrl = `${siteUrl}/garmin/connect`;

    await sendEmail({
      to: participant.email,
      subject: 'Action Required: Reconnect Your Garmin Account',
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <h2>Garmin Connection Lost</h2>
          <p>Hi ${participant.name ?? 'there'},</p>
          <p>
            Your Garmin account connection has been disconnected. This means we
            can no longer receive your daily health data automatically.
          </p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>
            To continue participating in the study and sharing your health data,
            please reconnect your Garmin account:
          </p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${reconnectUrl}"
               style="background: #4f46e5; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; font-weight: 600;">
              Reconnect Garmin
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            If you did not revoke access yourself, this may have happened because
            your Garmin session expired. Simply click the button above to
            reconnect.
          </p>
        </div>
      `.trim(),
    });

    console.log(
      '[TOKEN_MANAGER] Revocation alert sent to',
      participant.email,
      'for participant',
      participantId,
    );
  } catch (emailErr) {
    // Email failure should not break the token revocation flow
    const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
    console.error('[TOKEN_MANAGER] Failed to send revocation alert:', msg);
  }
}
