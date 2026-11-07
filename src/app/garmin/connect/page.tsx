import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateStateToken } from '@/lib/garmin/oauth-state';
import * as Sentry from '@sentry/nextjs';
import { 
  getAuthorizationUrl, 
  generateCodeVerifier, 
  generateCodeChallenge 
} from '@/lib/garmin/oauth-client';
import { hashParticipantId } from '@/lib/pseudonym-crypto';

export default async function GarminConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ participant_id?: string; reauthorize?: string }>;
}) {
  const params = await searchParams;

  // Step 1: Verify Supabase session (magic link creates it automatically)
  const supabase = await createClient();
  const { data, error: sessionError } = await supabase.auth.getSession();
  const session = data?.session;
  const user = session?.user;
  
  if (sessionError || !session || !user) {
    console.error('[GARMIN_CONNECT] No valid session:', sessionError);
    if (sessionError) {
      Sentry.captureException(sessionError, {
        extra: { context: "No valid session during Garmin connect" },
      });
      await Sentry.flush(1500);
    } else {
      Sentry.captureMessage("[GARMIN_CONNECT] No valid session during Garmin connect", "warning");
      await Sentry.flush(1500);
    }
    redirect('/garmin/error?reason=invalid_link');
  }
  
  Sentry.setUser({ id: user.id });
  Sentry.setTag("flow", "garmin_connect");

  // Step 2: Get participant_id from URL searchParams (passed through auth callback)
  const participantId = params.participant_id;
  const reauthorize = params.reauthorize === '1';
  
  if (!participantId) {
    console.error('[GARMIN_CONNECT] Missing participant_id in searchParams');
    Sentry.captureMessage("[GARMIN_CONNECT] Missing participant_id in searchParams", "warning");
    await Sentry.flush(1500);
    redirect('/garmin/error?reason=missing_context');
  }
  
  // Step 3: Check if already connected (resolve via pseudonym)
  const pidHash = hashParticipantId(participantId);
  Sentry.setContext('garmin', { participant_id_hash: pidHash });
  const { data: pseudonymRow } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', pidHash)
    .maybeSingle();

  let existingToken = null;
  if (pseudonymRow?.pseudonym_id) {
    const { data } = await supabase
      .from('garmin_tokens')
      .select('id')
      .eq('pseudonym_id', pseudonymRow.pseudonym_id)
      .is('revoked_at', null)
      .maybeSingle();
    existingToken = data;
  }
    
  if (existingToken) {
    if (!reauthorize) {
      console.log('[GARMIN_CONNECT] Already connected:', participantId);
      redirect('/garmin/error?reason=already_connected');
    }

    console.log('[GARMIN_CONNECT] Reauthorization requested; proceeding:', participantId);
  }
  
  // Step 4: Generate CSRF state token
  const state = await generateStateToken({
    user_id: user.id,
    participant_id: participantId,
  });
  
  // Step 5: Generate PKCE code verifier and challenge (OAuth 2.0 PKCE)
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  // Store code verifier temporarily for callback verification
  // Use admin client to bypass RLS (this table is service_role only)
  const adminDb = getSupabaseAdmin();
  const { error: tempInsertError } = await adminDb
    .from('garmin_oauth_temp')
    .insert({
      state_token: state,
      code_verifier: codeVerifier,
      participant_id: participantId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    });

  if (tempInsertError) {
    console.error('[GARMIN_CONNECT] Failed to persist OAuth temp state:', tempInsertError);
    Sentry.captureException(tempInsertError, {
      extra: { context: "Failed to persist garmin_oauth_temp row" },
    });
    await Sentry.flush(1500);
    redirect('/garmin/error?reason=db_error');
  }
  
  // Step 6: Build Garmin OAuth 2.0 authorization URL
  const authUrl = getAuthorizationUrl({
    state,
    codeChallenge,
  });
  
  console.log('[GARMIN_CONNECT] Redirecting to Garmin:', {
    participant_id: participantId,
    state,
  });

  // Step 7: Render a client-side navigation handoff with an explicit fallback link.
  // On Android (especially Gmail/Outlook in-app WebViews or when the Garmin Connect app is installed),
  // a server-side 307 redirect chain to connect.garmin.com/oauthConfirm can be intercepted or dropped,
  // resulting in a blank white screen.
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">Connecting to Garmin…</h1>
        <p className="text-sm text-slate-600 mb-6">
          You are being redirected to Garmin Connect to sign in and authorize Thrive Pilot.
        </p>
        <button
          id="garmin-continue-btn"
          type="button"
          className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors cursor-pointer"
        >
          Continue to Garmin Sign In
        </button>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var u=${JSON.stringify(authUrl)};var b=document.getElementById("garmin-continue-btn");if(b){b.onclick=function(){window.location.assign(u);};}window.location.replace(u);})();`,
          }}
        />
      </div>
    </div>
  );
}
