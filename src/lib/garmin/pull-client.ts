/**
 * Garmin Health API – Pull (Backfill) Client
 *
 * Uses the Garmin Health "Backfill" endpoint to fetch historical daily
 * summaries for a given participant.  The participant must already have
 * a valid access token stored in `garmin_tokens`.
 *
 * Now uses GarminClient for all API calls, which provides:
 *   - Automatic token refresh on expiry
 *   - 401 auto-retry with single refresh attempt
 *   - Revocation handling when tokens are permanently invalid
 *
 * Garmin Backfill API:
 *   GET /wellness-api/rest/backfill/dailies
 *     ?summaryStartTimeInSeconds=<epoch>&summaryEndTimeInSeconds=<epoch>
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import {
  type GarminDailySummary,
  mapSummaryToMetrics,
} from '@/lib/garmin/webhook';
import { GarminClient, GarminBackfillConflictError } from '@/lib/garmin/garmin-client';
import { GarminTokenRevokedError } from '@/lib/garmin/token-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
  /** True when Garmin accepted the request asynchronously (data will arrive via webhook). */
  asyncSubmitted?: boolean;
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
// Garmin API call (via GarminClient)
// ---------------------------------------------------------------------------

/**
 * Call the Garmin Backfill Dailies endpoint and return the array of daily
 * summaries.  Uses GarminClient which handles 401 auto-retry.
 */
async function fetchDailiesFromGarmin(
  client: GarminClient,
  startEpoch: number,
  endEpoch: number,
): Promise<GarminDailySummary[]> {
  const data = await client.get<GarminDailySummary[] | { dailies: GarminDailySummary[] }>(
    BACKFILL_DAILIES_PATH,
    {
      params: {
        summaryStartTimeInSeconds: String(startEpoch),
        summaryEndTimeInSeconds: String(endEpoch),
      },
    },
  );

  // The backfill endpoint returns an array directly (or wrapped in an object
  // depending on API version).  Handle both shapes.
  if (Array.isArray(data)) {
    return data;
  }

  if (data && Array.isArray(data.dailies)) {
    return data.dailies;
  }

  console.warn('[GARMIN_PULL] Unexpected response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of daily summaries into `garmin_metrics` and log results
 * to `ingestion_logs`.  Uses pseudonym_id for PIPEDA compliance.
 *
 * Returns counts of imported / failed / skipped days.
 */
async function upsertDailies(
  pseudonymId: string,
  summaries: GarminDailySummary[],
): Promise<{ imported: number; failed: number; skipped: number; errors: string[] }> {
  const supabase = getSupabaseAdmin();
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const summary of summaries) {
    const startMs = Date.now();

    if (summary.privacyProtected) {
      skipped++;
      await supabase.from('ingestion_logs').insert({
        pseudonym_id: pseudonymId,
        status: 'skipped',
        error_message: 'Privacy-protected summary',
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill',
      });
      continue;
    }

    try {
      const metricsRow = mapSummaryToMetrics(summary, pseudonymId);

      const { error: upsertError } = await supabase
        .from('garmin_metrics')
        .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

      if (upsertError) {
        throw new Error(`Upsert failed: ${upsertError.message}`);
      }

      imported++;

      await supabase.from('ingestion_logs').insert({
        pseudonym_id: pseudonymId,
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
        pseudonym_id: pseudonymId,
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
 *   2. Creates a GarminClient (handles token lifecycle automatically)
 *   3. Calls the Garmin Backfill Dailies endpoint
 *   4. Upserts each returned summary into `garmin_metrics`
 *   5. Logs every result to `ingestion_logs` (source = 'backfill')
 *
 * @throws if the participant has no valid token or the date range is invalid.
 * @throws {GarminTokenRevokedError} if the token is permanently revoked.
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

  // --- Resolve pseudonym_id for health data storage ---
  const supabase = getSupabaseAdmin();
  const { data: pseudonymRow } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id', participantId)
    .maybeSingle();

  if (!pseudonymRow?.pseudonym_id) {
    throw new Error(`No pseudonym found for participant ${participantId}`);
  }
  const pseudonymId = pseudonymRow.pseudonym_id;

  // --- Create GarminClient (handles token refresh + 401 retry) ---
  const client = new GarminClient(participantId);

  // --- Fetch from Garmin ---
  const startEpoch = dateToEpoch(startDate);
  // End of the end_date day (23:59:59 UTC) to be inclusive
  const endEpoch = dateToEpoch(endDate) + 86_399;

  // Apply rate-limit delay before making the API call
  await sleep(RATE_LIMIT_DELAY_MS);

  let summaries: GarminDailySummary[];
  try {
    summaries = await fetchDailiesFromGarmin(client, startEpoch, endEpoch);
  } catch (err) {
    // Re-throw specific errors directly so the caller can handle them
    if (err instanceof GarminTokenRevokedError) {
      throw err;
    }
    if (err instanceof GarminBackfillConflictError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch data from Garmin: ${message}`);
  }

  // --- Handle async backfill (Garmin returned 202 / empty) ---
  // The Garmin backfill endpoint is asynchronous for the Push model: it
  // returns 202 Accepted and queues the data for delivery via webhook.
  // If summaries is empty AND no error was thrown, the request was accepted.
  if (summaries.length === 0) {
    console.log('[GARMIN_PULL] Backfill accepted (async) — data will arrive via webhook', {
      participantId,
      startDate,
      endDate,
    });

    return {
      participantId,
      startDate,
      endDate,
      daysRequested: days,
      daysImported: 0,
      daysFailed: 0,
      daysSkipped: 0,
      errors: [],
      durationMs: Date.now() - startMs,
      asyncSubmitted: true,
    };
  }

  // --- Upsert into database (data returned inline — Ping/Pull model) ---
  const { imported, failed, skipped, errors } = await upsertDailies(
    pseudonymId,
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
