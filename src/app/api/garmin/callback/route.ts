import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from "@sentry/nextjs";
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyStateToken } from '@/lib/garmin/oauth-state';
import { exchangeCodeForToken, fetchGarminUserId } from '@/lib/garmin/oauth-client';
import { hashParticipantId, encryptParticipantId } from '@/lib/pseudonym-crypto';
import { SupabaseClient } from '@supabase/supabase-js';

function redirectToError(request: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(`/garmin/error?reason=${reason}`, request.url)
  );
}

function redirectToSuccess(request: NextRequest) {
  return NextResponse.redirect(new URL('/garmin/success', request.url));
}

/**
 * Sign out any temporary session then redirect to the error page.
 * Prevents stale invite cookies from blocking subsequent admin logins.
 */
async function signOutAndRedirectToError(
  supabase: SupabaseClient,
  request: NextRequest,
  reason: string
) {
  try {
    await supabase.auth.signOut();
  } catch {
    // Best-effort; don't let signOut failure block the redirect.
  }
  return redirectToError(request, reason);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!code || !state) {
    Sentry.captureMessage("[GARMIN_CALLBACK] Missing code/state", {
      level: "warning",
    });
    await Sentry.flush(1500);
    return redirectToError(request, 'invalid_callback');
  }

  // User-scoped client for session cleanup (respects RLS).
  const supabase = await createClient();
  // Service-role client for privileged DB operations (bypasses RLS).
  // Needed because the invite flow uses a temporary session that lacks
  // INSERT privileges on participant_pseudonyms, garmin_tokens, etc.
  const adminClient = getSupabaseAdmin();

  // Verify state token from encrypted HttpOnly cookie to prevent CSRF.
  const oauthState = await verifyStateToken(state);
  if (!oauthState) {
    Sentry.captureMessage("[GARMIN_CALLBACK] CSRF state verification failed", {
      level: "warning",
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'csrf_failure');
  }

  Sentry.setUser({ id: oauthState.user_id });
  Sentry.setTag("flow", "garmin_connect");
  Sentry.setTag("route", "api/garmin/callback");
  Sentry.setContext('garmin', { participant_id_hash: hashParticipantId(oauthState.participant_id) });

  const { data: tempData, error: tempError } = await adminClient
    .from('garmin_oauth_temp')
    .select('state_token, code_verifier, participant_id, expires_at')
    .eq('state_token', state)
    .maybeSingle();

  if (tempError) {
    console.error('[GARMIN_CALLBACK] Failed to read OAuth temp state:', tempError);
    Sentry.captureException(tempError, {
      extra: { context: "Failed to read OAuth temp state" },
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'db_error');
  }

  if (!tempData) {
    Sentry.captureMessage("[GARMIN_CALLBACK] No temp OAuth state row found", {
      level: "warning",
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'session_expired');
  }

  if (oauthState.participant_id !== tempData.participant_id) {
    console.error('[GARMIN_CALLBACK] State participant mismatch:', {
      cookie_participant_id: oauthState.participant_id,
      temp_participant_id: tempData.participant_id,
    });
    Sentry.captureMessage("[GARMIN_CALLBACK] State participant mismatch", {
      level: "warning",
      extra: {
        cookie_participant_id: oauthState.participant_id,
        temp_participant_id: tempData.participant_id,
      },
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'csrf_failure');
  }

  if (new Date(tempData.expires_at).getTime() < Date.now()) {
    await adminClient
      .from('garmin_oauth_temp')
      .delete()
      .eq('state_token', state);
    Sentry.captureMessage("[GARMIN_CALLBACK] Temp OAuth state expired", {
      level: "warning",
      extra: { expires_at: tempData.expires_at },
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'session_expired');
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokens = await exchangeCodeForToken({
      code,
      codeVerifier: tempData.code_verifier,
    });
  } catch (error) {
    console.error('[GARMIN_CALLBACK] Token exchange failed:', error);
    Sentry.captureException(error, {
      extra: { context: "Token exchange failed" },
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'token_exchange_failed');
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scope = Array.isArray(tokens.scope)
    ? tokens.scope
    : typeof tokens.scope === 'string'
      ? tokens.scope.split(' ').filter(Boolean)
      : [];

  // Ensure a pseudonym mapping exists for this participant (create if needed).
  // participant_id is stored as HMAC hash (for lookups) + AES-encrypted (for decryption).
  const pidHash = hashParticipantId(tempData.participant_id);
  const pidEncrypted = encryptParticipantId(tempData.participant_id);

  const { data: existingPseudonym } = await adminClient
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', pidHash)
    .maybeSingle();

  let pseudonymId: string;
  if (existingPseudonym?.pseudonym_id) {
    pseudonymId = existingPseudonym.pseudonym_id;
  } else {
    const { data: newPseudonym, error: pseudonymError } = await adminClient
      .from('participant_pseudonyms')
      .insert({
        participant_id_hash: pidHash,
        participant_id_encrypted: pidEncrypted,
      })
      .select('pseudonym_id')
      .single();

    if (pseudonymError || !newPseudonym) {
      console.error('[GARMIN_CALLBACK] Failed to create pseudonym:', pseudonymError);
      Sentry.captureException(pseudonymError ?? new Error("Failed to create pseudonym"), {
        extra: { context: "Failed to create pseudonym" },
      });
      await Sentry.flush(1500);
      return signOutAndRedirectToError(supabase, request, 'db_error');
    }
    pseudonymId = newPseudonym.pseudonym_id;
  }

  Sentry.setContext('garmin', { participant_id_hash: pidHash, pseudonym_id: pseudonymId });

  const { error: tokenInsertError } = await adminClient
    .from('garmin_tokens')
    .insert({
      pseudonym_id: pseudonymId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt,
      scope,
    });

  if (tokenInsertError) {
    console.error('[GARMIN_CALLBACK] Failed to persist Garmin tokens:', tokenInsertError);
    Sentry.captureException(tokenInsertError, {
      extra: { context: "Failed to persist Garmin tokens" },
    });
    await Sentry.flush(1500);
    return signOutAndRedirectToError(supabase, request, 'db_error');
  }

  // Fetch the Garmin API User ID and store it on the participant.
  // This ID is needed by webhooks to resolve incoming data.
  try {
    const garminUserId = await fetchGarminUserId(tokens.access_token);
    console.log('[GARMIN_CALLBACK] Fetched Garmin user ID:', {
      participant_id: tempData.participant_id,
      garmin_user_id: garminUserId,
    });

    const { error: userIdError } = await adminClient
      .from('participants')
      .update({ garmin_user_id: garminUserId })
      .eq('id', tempData.participant_id);

    if (userIdError) {
      console.error('[GARMIN_CALLBACK] Failed to save garmin_user_id:', userIdError);
      Sentry.captureException(userIdError, {
        extra: { context: "Failed to save garmin_user_id" },
      });
    }
  } catch (err) {
    console.error('[GARMIN_CALLBACK] Failed to fetch Garmin user ID:', err);
    Sentry.captureException(err, {
      extra: { context: "Failed to fetch Garmin user ID" },
    });
  }

  const { error: auditError } = await adminClient.from('audit_logs').insert({
    user_id: oauthState.user_id,
    action: 'garmin_connected',
    table_name: 'garmin_tokens',
    record_id: tempData.participant_id,
    metadata: {
      participant_id: tempData.participant_id,
      expires_at: expiresAt,
    },
  });

  if (auditError) {
    console.error('[GARMIN_CALLBACK] Failed to write audit log:', auditError);
    Sentry.captureException(auditError, {
      extra: { context: "Failed to write audit log" },
    });
  }

  const { error: cleanupError } = await adminClient
    .from('garmin_oauth_temp')
    .delete()
    .eq('state_token', state);

  if (cleanupError) {
    console.error('[GARMIN_CALLBACK] Failed to clean up temp OAuth state:', cleanupError);
    Sentry.captureException(cleanupError, {
      extra: { context: "Failed to clean up temp OAuth state" },
    });
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error('[GARMIN_CALLBACK] Failed to sign out temporary session:', signOutError);
    Sentry.captureException(signOutError, {
      extra: { context: "Failed to sign out temporary session" },
    });
  }

  return redirectToSuccess(request);
}

