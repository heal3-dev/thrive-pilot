import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { generateStateToken } from '@/lib/garmin/oauth-state';
import { 
  getAuthorizationUrl, 
  generateCodeVerifier, 
  generateCodeChallenge 
} from '@/lib/garmin/oauth-client';

export default async function GarminConnectPage() {
  // Step 1: Verify Supabase session (magic link creates it automatically)
  const supabase = await createClient();
  const { data, error: sessionError } = await supabase.auth.getSession();
  const session = data?.session;
  const user = session?.user;
  
  if (sessionError || !session || !user) {
    console.error('[GARMIN_CONNECT] No valid session:', sessionError);
    redirect('/garmin/error?reason=invalid_link');
  }
  
  // Step 2: Get participant context from magic link metadata
  const participantId = user.user_metadata?.participant_id;
  const action = user.user_metadata?.action;
  
  if (!participantId || action !== 'garmin_connect') {
    console.error('[GARMIN_CONNECT] Missing or invalid participant context:', {
      participantId,
      action,
    });
    redirect('/garmin/error?reason=missing_context');
  }
  
  // Step 3: Check if already connected
  const { data: existingToken } = await supabase
    .from('garmin_tokens')
    .select('id')
    .eq('participant_id', participantId)
    .is('revoked_at', null)
    .maybeSingle();
    
  if (existingToken) {
    console.log('[GARMIN_CONNECT] Already connected:', participantId);
    redirect('/garmin/error?reason=already_connected');
  }
  
  try {
    // Step 4: Generate CSRF state token
    const state = await generateStateToken({
      user_id: user.id,
      participant_id: participantId,
    });
    
    // Step 5: Generate PKCE code verifier and challenge (OAuth 2.0 PKCE)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    
    // Store code verifier temporarily for callback verification
    const { error: tempInsertError } = await supabase
      .from('garmin_oauth_temp')
      .insert({
        state_token: state,
        code_verifier: codeVerifier,
        participant_id: participantId,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
      });

    if (tempInsertError) {
      console.error('[GARMIN_CONNECT] Failed to persist OAuth temp state:', tempInsertError);
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
    
    // Step 7: Redirect to Garmin for user authorization
    redirect(authUrl);
  } catch (error) {
    console.error('[GARMIN_CONNECT] OAuth initialization failed:', error);
    redirect('/garmin/error?reason=garmin_unavailable');
  }
}
