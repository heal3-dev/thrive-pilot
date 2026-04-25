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
import { hashParticipantId } from '@/lib/pseudonym-crypto';
import {
  type GarminDailySummary,
  type GarminSleepSummary,
  type GarminHrvSummary,
  type GarminStressDetailSummary,
  mapSummaryToMetrics,
  mapSleepToMetrics,
  mapHrvToMetrics,
  mapStressToMetrics,
} from '@/lib/garmin/webhook';
import { GarminClient, GarminBackfillConflictError } from '@/lib/garmin/garmin-client';
import { GarminTokenRevokedError } from '@/lib/garmin/token-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKFILL_DAILIES_PATH = '/wellness-api/rest/backfill/dailies';
const BACKFILL_SLEEPS_PATH = '/wellness-api/rest/backfill/sleeps';
const BACKFILL_HRV_PATH = '/wellness-api/rest/backfill/hrv';
const BACKFILL_STRESS_DETAILS_PATH = '/wellness-api/rest/backfill/stressDetails';
const BACKFILL_STRESS_FALLBACK_PATH = '/wellness-api/rest/backfill/stress';

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
  /** Breakdown of results by data type. */
  sleeps?: { imported: number; failed: number; skipped: number; asyncSubmitted?: boolean };
  hrv?: { imported: number; failed: number; skipped: number; asyncSubmitted?: boolean };
  stress?: { imported: number; failed: number; skipped: number; asyncSubmitted?: boolean };
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

function isGarminNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Garmin API error: 404\b/.test(err.message);
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

  console.warn('[GARMIN_PULL] Unexpected dailies response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}

/**
 * Call the Garmin Backfill Sleeps endpoint and return the array of sleep
 * summaries.  Uses GarminClient which handles 401 auto-retry.
 */
async function fetchSleepsFromGarmin(
  client: GarminClient,
  startEpoch: number,
  endEpoch: number,
): Promise<GarminSleepSummary[]> {
  const data = await client.get<GarminSleepSummary[] | { sleeps: GarminSleepSummary[] }>(
    BACKFILL_SLEEPS_PATH,
    {
      params: {
        summaryStartTimeInSeconds: String(startEpoch),
        summaryEndTimeInSeconds: String(endEpoch),
      },
    },
  );

  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { sleeps?: GarminSleepSummary[] }).sleeps)) {
    return (data as { sleeps: GarminSleepSummary[] }).sleeps;
  }

  console.warn('[GARMIN_PULL] Unexpected sleeps response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}

/**
 * Call the Garmin Backfill HRV endpoint and return the array of HRV summaries.
 */
async function fetchHrvFromGarmin(
  client: GarminClient,
  startEpoch: number,
  endEpoch: number,
): Promise<GarminHrvSummary[]> {
  const data = await client.get<GarminHrvSummary[] | { hrv: GarminHrvSummary[] }>(
    BACKFILL_HRV_PATH,
    {
      params: {
        summaryStartTimeInSeconds: String(startEpoch),
        summaryEndTimeInSeconds: String(endEpoch),
      },
    },
  );

  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { hrv?: GarminHrvSummary[] }).hrv)) {
    return (data as { hrv: GarminHrvSummary[] }).hrv;
  }

  console.warn('[GARMIN_PULL] Unexpected HRV response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}

/**
 * Call the Garmin Backfill Stress Details endpoint and return the array of stress detail
 * summaries (which include body battery time series).
 *
 * Garmin's documentation/partners have used slightly different endpoint names over time,
 * so we try the canonical path first and fall back if Garmin responds 404.
 */
async function fetchStressDetailsFromGarmin(
  client: GarminClient,
  startEpoch: number,
  endEpoch: number,
): Promise<GarminStressDetailSummary[]> {
  const candidates = [BACKFILL_STRESS_DETAILS_PATH, BACKFILL_STRESS_FALLBACK_PATH];

  let lastErr: unknown = null;
  for (const path of candidates) {
    try {
      const data = await client.get<
        GarminStressDetailSummary[] | { stressDetails: GarminStressDetailSummary[] } | null
      >(path, {
        params: {
          summaryStartTimeInSeconds: String(startEpoch),
          summaryEndTimeInSeconds: String(endEpoch),
        },
      });

      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (data && Array.isArray((data as { stressDetails?: GarminStressDetailSummary[] }).stressDetails)) {
        return (data as { stressDetails: GarminStressDetailSummary[] }).stressDetails;
      }

      console.warn('[GARMIN_PULL] Unexpected stressDetails response shape:', JSON.stringify(data).slice(0, 200));
      return [];
    } catch (err) {
      lastErr = err;
      if (path === BACKFILL_STRESS_DETAILS_PATH && isGarminNotFoundError(err)) {
        console.warn('[GARMIN_PULL] stressDetails endpoint not found; trying fallback path');
        continue;
      }
      throw err;
    }
  }

  // Should be unreachable, but keep TypeScript happy.
  if (lastErr) throw lastErr;
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

/**
 * Upsert a batch of sleep summaries into `garmin_metrics`.
 */
async function upsertSleeps(
  pseudonymId: string,
  summaries: GarminSleepSummary[],
): Promise<{ imported: number; failed: number; skipped: number; errors: string[] }> {
  const supabase = getSupabaseAdmin();
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const summary of summaries) {
    if (summary.privacyProtected) {
      skipped++;
      continue;
    }

    const validation = summary.validation ?? '';
    if (validation.includes('TENTATIVE')) {
      skipped++;
      continue;
    }

    try {
      const metricsRow = mapSleepToMetrics(summary, pseudonymId);
      const { error: upsertError } = await supabase
        .from('garmin_metrics')
        .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

      if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);
      imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push(`sleep ${summary.calendarDate}: ${message}`);
    }
  }

  return { imported, failed, skipped, errors };
}

/**
 * Upsert a batch of HRV summaries into `garmin_metrics`.
 */
async function upsertHrv(
  pseudonymId: string,
  summaries: GarminHrvSummary[],
): Promise<{ imported: number; failed: number; skipped: number; errors: string[] }> {
  const supabase = getSupabaseAdmin();
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const summary of summaries) {
    if (summary.privacyProtected) {
      skipped++;
      continue;
    }

    try {
      const metricsRow = mapHrvToMetrics(summary, pseudonymId);
      const { error: upsertError } = await supabase
        .from('garmin_metrics')
        .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

      if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);
      imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push(`hrv ${summary.calendarDate}: ${message}`);
    }
  }

  return { imported, failed, skipped, errors };
}

/**
 * Upsert a batch of stress detail summaries into `garmin_metrics`.
 *
 * Also stores the full payload in `garmin_raw_stress` as an audit trail.
 */
async function upsertStressDetails(
  pseudonymId: string,
  summaries: GarminStressDetailSummary[],
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
        source: 'backfill-stress',
      });
      continue;
    }

    // Skip if no body battery time series in this summary
    if (!summary.timeOffsetBodyBatteryValues || Object.keys(summary.timeOffsetBodyBatteryValues).length === 0) {
      skipped++;
      await supabase.from('ingestion_logs').insert({
        pseudonym_id: pseudonymId,
        status: 'skipped',
        error_message: 'No body battery data in stress summary',
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill-stress',
      });
      continue;
    }

    try {
      // Store raw payload (append-only) for audit/debugging
      const { error: rawError } = await supabase.from('garmin_raw_stress').insert({
        pseudonym_id: pseudonymId,
        garmin_user_id: summary.userId,
        summary_id: summary.summaryId ?? null,
        calendar_date: summary.calendarDate,
        raw_data: summary,
      });
      if (rawError) {
        throw new Error(`Raw insert failed: ${rawError.message}`);
      }

      const metricsRow = mapStressToMetrics(summary, pseudonymId);
      const { error: upsertError } = await supabase
        .from('garmin_metrics')
        .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

      if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

      imported++;

      await supabase.from('ingestion_logs').insert({
        pseudonym_id: pseudonymId,
        status: 'success',
        metrics_imported: 1,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill-stress',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push(`stress ${summary.calendarDate}: ${message}`);

      await supabase.from('ingestion_logs').insert({
        pseudonym_id: pseudonymId,
        status: 'failed',
        error_message: message,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'backfill-stress',
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

  // --- Resolve pseudonym_id via HMAC hash ---
  const supabase = getSupabaseAdmin();
  const hash = hashParticipantId(participantId);
  const { data: pseudonymRow } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', hash)
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

  // --- Fetch dailies from Garmin ---
  let dailySummaries: GarminDailySummary[] = [];
  let dailiesAsync = false;
  try {
    dailySummaries = await fetchDailiesFromGarmin(client, startEpoch, endEpoch);
    if (dailySummaries.length === 0) dailiesAsync = true;
  } catch (err) {
    // Re-throw specific errors directly so the caller can handle them
    if (err instanceof GarminTokenRevokedError) throw err;
    if (err instanceof GarminBackfillConflictError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch dailies from Garmin: ${message}`);
  }

  // --- Fetch sleeps from Garmin ---
  let sleepSummaries: GarminSleepSummary[] = [];
  let sleepsAsync = false;
  try {
    await sleep(RATE_LIMIT_DELAY_MS);
    sleepSummaries = await fetchSleepsFromGarmin(client, startEpoch, endEpoch);
    if (sleepSummaries.length === 0) sleepsAsync = true;
  } catch (err) {
    // Sleep backfill failure is non-blocking
    if (err instanceof GarminBackfillConflictError) {
      console.warn('[GARMIN_PULL] Sleeps backfill conflict (cooldown):', err.message);
      sleepsAsync = true;
    } else {
      console.error('[GARMIN_PULL] Failed to fetch sleeps:', err instanceof Error ? err.message : err);
    }
  }

  // --- Fetch HRV from Garmin ---
  let hrvSummaries: GarminHrvSummary[] = [];
  let hrvAsync = false;
  try {
    await sleep(RATE_LIMIT_DELAY_MS);
    hrvSummaries = await fetchHrvFromGarmin(client, startEpoch, endEpoch);
    if (hrvSummaries.length === 0) hrvAsync = true;
  } catch (err) {
    // HRV backfill failure is non-blocking
    if (err instanceof GarminBackfillConflictError) {
      console.warn('[GARMIN_PULL] HRV backfill conflict (cooldown):', err.message);
      hrvAsync = true;
    } else {
      console.error('[GARMIN_PULL] Failed to fetch HRV:', err instanceof Error ? err.message : err);
    }
  }

  // --- Fetch stressDetails from Garmin ---
  let stressSummaries: GarminStressDetailSummary[] = [];
  let stressAsync = false;
  try {
    await sleep(RATE_LIMIT_DELAY_MS);
    stressSummaries = await fetchStressDetailsFromGarmin(client, startEpoch, endEpoch);
    if (stressSummaries.length === 0) stressAsync = true;
  } catch (err) {
    // Stress backfill failure is non-blocking
    if (err instanceof GarminBackfillConflictError) {
      console.warn('[GARMIN_PULL] Stress backfill conflict (cooldown):', err.message);
      stressAsync = true;
    } else {
      console.error('[GARMIN_PULL] Failed to fetch stressDetails:', err instanceof Error ? err.message : err);
    }
  }

  const allAsync = dailiesAsync && sleepsAsync && hrvAsync && stressAsync;

  // --- Handle fully async backfill ---
  if (allAsync && dailySummaries.length === 0 && sleepSummaries.length === 0 && hrvSummaries.length === 0 && stressSummaries.length === 0) {
    console.log('[GARMIN_PULL] All backfills accepted async — data will arrive via webhooks', {
      participantId, startDate, endDate,
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
      sleeps: { imported: 0, failed: 0, skipped: 0, asyncSubmitted: true },
      hrv: { imported: 0, failed: 0, skipped: 0, asyncSubmitted: true },
      stress: { imported: 0, failed: 0, skipped: 0, asyncSubmitted: true },
    };
  }

  // --- Upsert into database ---
  const dailyResult = dailySummaries.length > 0
    ? await upsertDailies(pseudonymId, dailySummaries)
    : { imported: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const sleepResult = sleepSummaries.length > 0
    ? await upsertSleeps(pseudonymId, sleepSummaries)
    : { imported: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const hrvResult = hrvSummaries.length > 0
    ? await upsertHrv(pseudonymId, hrvSummaries)
    : { imported: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const stressResult = stressSummaries.length > 0
    ? await upsertStressDetails(pseudonymId, stressSummaries)
    : { imported: 0, failed: 0, skipped: 0, errors: [] as string[] };

  const allErrors = [...dailyResult.errors, ...sleepResult.errors, ...hrvResult.errors, ...stressResult.errors];

  console.log('[GARMIN_PULL] Backfill complete:', {
    participantId,
    dailies: `${dailyResult.imported} imported, ${dailyResult.failed} failed`,
    sleeps: sleepsAsync ? 'async' : `${sleepResult.imported} imported, ${sleepResult.failed} failed`,
    hrv: hrvAsync ? 'async' : `${hrvResult.imported} imported, ${hrvResult.failed} failed`,
    stress: stressAsync ? 'async' : `${stressResult.imported} imported, ${stressResult.failed} failed`,
  });

  return {
    participantId,
    startDate,
    endDate,
    daysRequested: days,
    daysImported: dailyResult.imported,
    daysFailed: dailyResult.failed,
    daysSkipped: dailyResult.skipped,
    errors: allErrors,
    durationMs: Date.now() - startMs,
    asyncSubmitted: dailiesAsync,
    sleeps: {
      imported: sleepResult.imported,
      failed: sleepResult.failed,
      skipped: sleepResult.skipped,
      asyncSubmitted: sleepsAsync,
    },
    hrv: {
      imported: hrvResult.imported,
      failed: hrvResult.failed,
      skipped: hrvResult.skipped,
      asyncSubmitted: hrvAsync,
    },
    stress: {
      imported: stressResult.imported,
      failed: stressResult.failed,
      skipped: stressResult.skipped,
      asyncSubmitted: stressAsync,
    },
  };
}
