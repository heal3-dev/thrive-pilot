import crypto from 'crypto';

const GARMIN_AUTHORIZE_URL = 'https://connect.garmin.com/oauthConfirm';
const GARMIN_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';

/**
 * Get Garmin OAuth 2.0 credentials from environment
 */
function getGarminCredentials() {
  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;
  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/garmin/callback`;
  
  if (!clientId || !clientSecret) {
    throw new Error('GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET are required');
  }
  
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    throw new Error('NEXT_PUBLIC_SITE_URL is required');
  }
  
  return { clientId, clientSecret, callbackUrl };
}

/**
 * Generate PKCE code verifier (random string)
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge from verifier
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Build Garmin OAuth 2.0 authorization URL with PKCE
 * User will be redirected here to authorize the application
 */
export function getAuthorizationUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const { clientId, callbackUrl } = getGarminCredentials();
  
  const url = new URL(GARMIN_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'GARMIN_CONNECT');
  url.searchParams.set('state', params.state);
  
  // PKCE parameters
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  
  return url.toString();
}

/**
 * Exchange authorization code for access token (OAuth 2.0 step 3)
 * Called from the callback handler after user authorizes
 */
export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
}): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string | string[];
}> {
  const { clientId, clientSecret, callbackUrl } = getGarminCredentials();
  
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
    code_verifier: params.codeVerifier,
  });
  
  const response = await fetch(GARMIN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GARMIN_OAUTH] Token exchange error:', {
      status: response.status,
      body: errorText,
    });
    throw new Error(`Failed to exchange code for token: ${response.status}`);
  }
  
  const tokenData = await response.json();
  return tokenData;
}
