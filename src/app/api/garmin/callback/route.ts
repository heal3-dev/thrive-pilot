import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyStateToken } from '@/lib/garmin/oauth-state';
import { exchangeCodeForToken, fetchGarminUserId } from '@/lib/garmin/oauth-client';
import { hashParticipantId, encryptParticipantId } from '@/lib/pseudonym-crypto';

function redirectToError(request: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(`/garmin/error?reason=${reason}`, request.url)
  );
}

function redirectToSuccess(request: NextRequest) {
  return NextResponse.redirect(new URL('/garmin/success', request.url));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return redirectToError(request, 'invalid_callback');
  }

  const supabase = await createClient();

  // Verify state token from encrypted HttpOnly cookie to prevent CSRF.
  const oauthState = await verifyStateToken(state);
  if (!oauthState) {
    return redirectToError(request, 'csrf_failure');
  }

  const { data: tempData, error: tempError } = await supabase
    .from('garmin_oauth_temp')
    .select('state_token, code_verifier, participant_id, expires_at')
    .eq('state_token', state)
    .maybeSingle();

  if (tempError) {
    console.error('[GARMIN_CALLBACK] Failed to read OAuth temp state:', tempError);
    return redirectToError(request, 'db_error');
  }

  if (!tempData) {
    return redirectToError(request, 'session_expired');
  }

  if (oauthState.participant_id !== tempData.participant_id) {
    console.error('[GARMIN_CALLBACK] State participant mismatch:', {
      cookie_participant_id: oauthState.participant_id,
      temp_participant_id: tempData.participant_id,
    });
    return redirectToError(request, 'csrf_failure');
  }

  if (new Date(tempData.expires_at).getTime() < Date.now()) {
    await supabase
      .from('garmin_oauth_temp')
      .delete()
      .eq('state_token', state);
    return redirectToError(request, 'session_expired');
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokens = await exchangeCodeForToken({
      code,
      codeVerifier: tempData.code_verifier,
    });
  } catch (error) {
    console.error('[GARMIN_CALLBACK] Token exchange failed:', error);
    return redirectToError(request, 'token_exchange_failed');
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

  const { data: existingPseudonym } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', pidHash)
    .maybeSingle();

  let pseudonymId: string;
  if (existingPseudonym?.pseudonym_id) {
    pseudonymId = existingPseudonym.pseudonym_id;
  } else {
    const { data: newPseudonym, error: pseudonymError } = await supabase
      .from('participant_pseudonyms')
      .insert({
        participant_id_hash: pidHash,
        participant_id_encrypted: pidEncrypted,
      })
      .select('pseudonym_id')
      .single();

    if (pseudonymError || !newPseudonym) {
      console.error('[GARMIN_CALLBACK] Failed to create pseudonym:', pseudonymError);
      return redirectToError(request, 'db_error');
    }
    pseudonymId = newPseudonym.pseudonym_id;
  }

  const { error: tokenInsertError } = await supabase
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
    return redirectToError(request, 'db_error');
  }

  // Fetch the Garmin API User ID and store it on the participant.
  // This ID is needed by webhooks to resolve incoming data.
  try {
    const garminUserId = await fetchGarminUserId(tokens.access_token);
    console.log('[GARMIN_CALLBACK] Fetched Garmin user ID:', {
      participant_id: tempData.participant_id,
      garmin_user_id: garminUserId,
    });

    const { error: userIdError } = await supabase
      .from('participants')
      .update({ garmin_user_id: garminUserId })
      .eq('id', tempData.participant_id);

    if (userIdError) {
      console.error('[GARMIN_CALLBACK] Failed to save garmin_user_id:', userIdError);
    }
  } catch (err) {
    console.error('[GARMIN_CALLBACK] Failed to fetch Garmin user ID:', err);
  }

  const { error: auditError } = await supabase.from('audit_logs').insert({
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
  }

  const { error: cleanupError } = await supabase
    .from('garmin_oauth_temp')
    .delete()
    .eq('state_token', state);

  if (cleanupError) {
    console.error('[GARMIN_CALLBACK] Failed to clean up temp OAuth state:', cleanupError);
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error('[GARMIN_CALLBACK] Failed to sign out temporary session:', signOutError);
  }

  return redirectToSuccess(request);
}
