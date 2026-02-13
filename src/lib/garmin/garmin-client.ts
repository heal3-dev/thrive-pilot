/**
 * Garmin API Client with Auto-Refresh Interceptor
 *
 * Wraps outbound Garmin Health API requests with:
 *   1. Automatic Bearer token injection
 *   2. 401 detection → token refresh → single retry
 *   3. Revocation handling when refresh permanently fails
 *
 * Usage:
 *   const client = new GarminClient(participantId);
 *   const data = await client.get('/wellness-api/rest/backfill/dailies', { params });
 */

import {
  getValidToken,
  refreshGarminToken,
  GarminTokenRevokedError,
} from '@/lib/garmin/token-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GARMIN_API_BASE = 'https://apis.garmin.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GarminRequestOptions {
  /** URL search params to append */
  params?: Record<string, string>;
  /** Additional fetch options (method, headers, body, etc.) */
  fetchOptions?: RequestInit;
}

export interface GarminResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GarminClient {
  private participantId: string;
  private tokenId: string | null = null;
  private accessToken: string | null = null;

  constructor(participantId: string) {
    this.participantId = participantId;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Make a GET request to the Garmin Health API.
   *
   * Automatically injects the Bearer token and retries once on 401.
   */
  async get<T = unknown>(
    path: string,
    options?: GarminRequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      fetchOptions: { ...options?.fetchOptions, method: 'GET' },
    });
  }

  /**
   * Make an authenticated request to the Garmin Health API.
   *
   * Flow:
   *   1. Obtain a valid access token (from cache or DB, refreshing if expired)
   *   2. Execute the request with Authorization header
   *   3. If 401 → refresh the token and retry exactly once
   *   4. If second attempt also 401 → throw (token is revoked)
   */
  async request<T = unknown>(
    path: string,
    options?: GarminRequestOptions,
  ): Promise<T> {
    // Ensure we have a token
    await this.ensureToken();

    // First attempt
    const response = await this.executeRequest(path, options);

    if (response.status !== 401) {
      return this.handleResponse<T>(response);
    }

    // 401 — try refreshing the token once
    console.warn(
      '[GARMIN_CLIENT] Got 401 for participant',
      this.participantId,
      '— attempting token refresh',
    );

    await this.refreshToken();

    // Retry with fresh token
    const retryResponse = await this.executeRequest(path, options);

    if (retryResponse.status === 401) {
      // Refresh didn't help — the token/connection is truly invalid.
      // Revocation is already handled inside refreshGarminToken when the
      // refresh endpoint itself returns 401.  But if the *resource* endpoint
      // keeps returning 401 after a successful refresh, we also revoke.
      throw new GarminTokenRevokedError(
        this.tokenId ?? 'unknown',
        'Garmin API returned 401 after token refresh — access may have been revoked by user',
      );
    }

    return this.handleResponse<T>(retryResponse);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Ensure we have a valid access token loaded.  Will fetch from DB and
   * refresh if the stored token is expired.
   */
  private async ensureToken(): Promise<void> {
    if (this.accessToken && this.tokenId) {
      return;
    }

    const result = await getValidToken(this.participantId);
    if (!result) {
      throw new Error(
        `No valid Garmin access token found for participant ${this.participantId}. ` +
          'Ensure they have connected their Garmin account.',
      );
    }

    this.tokenId = result.tokenId;
    this.accessToken = result.accessToken;
  }

  /**
   * Force a token refresh (called after a 401).
   */
  private async refreshToken(): Promise<void> {
    if (!this.tokenId) {
      throw new Error('Cannot refresh — no token ID loaded');
    }

    const result = await refreshGarminToken(this.tokenId);
    this.accessToken = result.accessToken;
  }

  /**
   * Execute a single HTTP request against the Garmin API.
   */
  private async executeRequest(
    path: string,
    options?: GarminRequestOptions,
  ): Promise<Response> {
    const url = new URL(`${GARMIN_API_BASE}${path}`);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    return fetch(url.toString(), {
      ...options?.fetchOptions,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...options?.fetchOptions?.headers,
      },
    });
  }

  /**
   * Handle a non-401 response: parse JSON or throw on error.
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 429) {
      throw new Error('Garmin API rate limit exceeded (HTTP 429)');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Garmin API error: ${response.status} ${response.statusText} – ${body}`,
      );
    }

    return response.json() as Promise<T>;
  }
}
