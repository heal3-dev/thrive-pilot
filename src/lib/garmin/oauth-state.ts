import crypto from 'crypto';

/**
 * Generate CSRF state token for OAuth flow
 * Returns a short random string suitable for OAuth providers with strict limits.
 *
 * The token is validated by looking up a matching row in `garmin_oauth_temp`
 * during the callback and consuming it (one-time use) with an expiry.
 */
export async function generateStateToken(params: {
  user_id: string;
  participant_id: string;
}): Promise<string> {
  void params;
  return crypto.randomBytes(32).toString('base64url');
}

export type OAuthStateToken = string;

