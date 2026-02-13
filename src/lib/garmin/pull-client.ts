/**
 * Garmin Health API – Pull (Backfill) Client
 *
 * Uses the Garmin Health "Backfill" endpoint to fetch historical daily
 * summaries for a given participant.  The participant must already have
 * a valid access token stored in `garmin_tokens`.
 *
 * Garmin Backfill API:
 *   GET /wellness-api/rest/backfill/dailies
 *     ?summaryStartTimeInSeconds=<epoch>&summaryEndTimeInSeconds=<epoch>
 *
 * The response is an array of daily-summary objects whose shape matches
 * the webhook payload (`GarminDailySummary`).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import {
  type GarminDailySummary,
  mapSummaryToMetrics,
} from '@/lib/garmin/webhook';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GARMIN_API_BASE = 'https://apis.garmin.com';
const BACKFILL_DAILIES_PATH = '/wellness-api/rest/backfill/dailies';

/** Max date range Garmin allows per backfill request (roughly 90 days). */
const MAX_RANGE_DAYS = 90;

/** Delay between successive Garmin API calls to respect rate limits. */
const RATE_LIMIT_DELAY_MS = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillRequest {
  /** The participant's UUID (from our `participants` table). */
  participantId: string;
  /** Inclusive start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD). */
  endDate: string;
}

export interface BackfillResult {
  participantId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  daysImported: number;
  daysFailed: number;
  daysSkipped: number;
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a YYYY-MM-DD date string to a Unix epoch (start of day UTC). */
function dateToEpoch(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

/** Count the number of days between two YYYY-MM-DD strings (inclusive). */
function daysBetween(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.floor(ms / 86_400_000) + 1; // inclusive
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Token retrieval
// ---------------------------------------------------------------------------

/**
 * Fetch the stored Garmin OAuth access token for a participant.
 *
 * Returns `null` if no token exists or the token has been revoked.
 */
async function getAccessToken(
  participantId: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('garmin_tokens')
    .select('access_token, expires_at, revoked_at')
    .eq('participant_id', participantId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[GARMIN_PULL] Token lookup error:', error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  // Check for obvious expiry (Garmin long-lived tokens rarely expire,
  // but we still guard against it).
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    console.warn('[GARMIN_PULL] Access token expired for participant', participantId);
    // Future: implement token refresh here
    return null;
  }

  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// Garmin API call
// ---------------------------------------------------------------------------

/**
 * Call the Garmin Backfill Dailies endpoint and return the array of daily
 * summaries.
 */
async function fetchDailiesFromGarmin(
  accessToken: string,
  startEpoch: number,
  endEpoch: number,
): Promise<GarminDailySummary[]> {
  const url = new URL(`${GARMIN_API_BASE}${BACKFILL_DAILIES_PATH}`);
  url.searchParams.set('summaryStartTimeInSeconds', String(startEpoch));
  url.searchParams.set('summaryEndTimeInSeconds', String(endEpoch));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 429) {
    throw new Error('Garmin API rate limit exceeded (HTTP 429)');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Garmin API error: ${response.status} ${response.statusText} – ${body}`,
    );
  }

  const data = await response.json();

  // The backfill endpoint returns an array directly (or wrapped in an object
  // depending on API version).  Handle both shapes.
  if (Array.isArray(data)) {
    return data as GarminDailySummary[];
  }

  if (data && Array.isArray(data.dailies)) {
    return data.dailies as GarminDailySummary[];
  }

  console.warn('[GARMIN_PULL] Unexpected response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of daily summaries into `garmin_metrics` and log results
 * to `ingestion_logs`.
 *
 * Returns counts of imported / failed / skipped days.
 */
async function upsertDailies(
  participantId: string,
  summaries: GarminDailySummary[],
): Promise<{ imported: number; failed: number; skipped: number; errors: string[] }> {
  const supabase = getSupabaseAdmin();
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const summary of summaries) {
    const startMs = Date.now();

    // Skip privacy-protected summaries
    if (summary.privacyProtected) {
      skipped++;
      await supabase.from('ingestion_logs').insert({
        participant_id: participantId,
        status: 'skipped',
        error_message: 'Privacy-protected summary',
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill',
      });
      continue;
    }

    try {
      const metricsRow = mapSummaryToMetrics(summary, participantId);

      const { error: upsertError } = await supabase
        .from('garmin_metrics')
        .upsert(metricsRow, { onConflict: 'participant_id,metric_date' });

      if (upsertError) {
        throw new Error(`Upsert failed: ${upsertError.message}`);
      }

      imported++;

      await supabase.from('ingestion_logs').insert({
        participant_id: participantId,
        status: 'success',
        metrics_imported: 1,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push(`${summary.calendarDate}: ${message}`);

      await supabase.from('ingestion_logs').insert({
        participant_id: participantId,
        status: 'failed',
        error_message: message,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill',
      });
    }
  }

  return { imported, failed, skipped, errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a backfill for the given participant and date range.
 *
 * The function:
 *   1. Validates the date range (max 90 days)
 *   2. Retrieves the participant's stored access token
 *   3. Calls the Garmin Backfill Dailies endpoint
 *   4. Upserts each returned summary into `garmin_metrics`
 *   5. Logs every result to `ingestion_logs` (source = 'backfill')
 *
 * @throws if the participant has no valid token or the date range is invalid.
 */
export async function runBackfill(req: BackfillRequest): Promise<BackfillResult> {
  const startMs = Date.now();
  const { participantId, startDate, endDate } = req;

  // --- Validate date range ---
  const days = daysBetween(startDate, endDate);
  if (days <= 0) {
    throw new Error('start_date must be before or equal to end_date');
  }
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Date range exceeds maximum of ${MAX_RANGE_DAYS} days`);
  }

  // --- Get access token ---
  const accessToken = await getAccessToken(participantId);
  if (!accessToken) {
    throw new Error(
      'No valid Garmin access token found for this participant. ' +
      'Ensure they have connected their Garmin account.',
    );
  }

  // --- Fetch from Garmin ---
  const startEpoch = dateToEpoch(startDate);
  // End of the end_date day (23:59:59 UTC) to be inclusive
  const endEpoch = dateToEpoch(endDate) + 86_399;

  // Apply rate-limit delay before making the API call
  await sleep(RATE_LIMIT_DELAY_MS);

  let summaries: GarminDailySummary[];
  try {
    summaries = await fetchDailiesFromGarmin(accessToken, startEpoch, endEpoch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch data from Garmin: ${message}`);
  }

  // --- Upsert into database ---
  const { imported, failed, skipped, errors } = await upsertDailies(
    participantId,
    summaries,
  );

  return {
    participantId,
    startDate,
    endDate,
    daysRequested: days,
    daysImported: imported,
    daysFailed: failed,
    daysSkipped: skipped,
    errors,
    durationMs: Date.now() - startMs,
  };
}
