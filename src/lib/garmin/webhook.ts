/**
 * Garmin Webhook Utilities
 *
 * Handles signature verification and daily/sleep/HRV processing
 * for the Garmin Health API push (webhook) model.
 *
 * Privacy: All health tables use pseudonym_id (not participant_id)
 * to decouple PII from health data.  The mapping lives in
 * participant_pseudonyms and is only accessible via service_role.
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hashParticipantId } from '@/lib/pseudonym-crypto';
import * as Sentry from "@sentry/nextjs";
import { markGarminIngestionSuccess } from '@/lib/garmin/connection-health';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single daily summary object sent by Garmin in the webhook payload.
 *
 * Field names match the official Garmin Health API "ClientDaily" schema.
 * See: https://developer.garmin.com/gc-developer-program/health-api/
 */
export interface GarminDailySummary {
  userId: string;
  userAccessToken?: string;
  summaryId: string;
  calendarDate: string; // "YYYY-MM-DD"
  activityType?: string;

  // Timing
  startTimeInSeconds?: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds?: number;

  // Activity
  steps?: number;
  stepsGoal?: number;
  distanceInMeters?: number;
  activeTimeInSeconds?: number;
  floorsClimbed?: number;
  floorsClimbedGoal?: number;
  moderateIntensityDurationInSeconds?: number;
  vigorousIntensityDurationInSeconds?: number;
  intensityDurationGoalInSeconds?: number;

  // Wheelchair pushes
  pushes?: number;
  pushesGoal?: number;
  pushDistanceInMeters?: number;

  // Calories
  activeKilocalories?: number;
  bmrKilocalories?: number;
  totalKilocalories?: number;

  // Heart rate
  restingHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  minHeartRateInBeatsPerMinute?: number;
  averageHeartRateInBeatsPerMinute?: number;

  // Stress
  averageStressLevel?: number;
  maxStressLevel?: number;
  stressDurationInSeconds?: number;
  restStressDurationInSeconds?: number;
  activityStressDurationInSeconds?: number;
  lowStressDurationInSeconds?: number;
  mediumStressDurationInSeconds?: number;
  highStressDurationInSeconds?: number;
  stressQualifier?: string;

  // Body Battery (daily charged/drained values)
  bodyBatteryChargedValue?: number;
  bodyBatteryDrainedValue?: number;

  // Privacy
  privacyProtected?: boolean;

  // Allow additional fields
  [key: string]: unknown;
}

/** A single sleep summary sent by Garmin in the HEALTH - Sleeps webhook. */
export interface GarminSleepSummary {
  userId: string;
  userAccessToken?: string;
  summaryId: string;
  calendarDate: string; // "YYYY-MM-DD"
  startTimeInSeconds?: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds?: number;
  unmeasurableSleepInSeconds?: number;
  deepSleepDurationInSeconds?: number;
  lightSleepDurationInSeconds?: number;
  remSleepInSeconds?: number;
  awakeDurationInSeconds?: number;
  validation?: string; // ENHANCED_FINAL, AUTO_FINAL, etc.
  overallSleepScore?: { value?: number; qualifierKey?: string };
  sleepScores?: Record<string, { qualifierKey?: string }>;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

/**
 * A single HRV summary sent by Garmin in the HEALTH - HRV Summary webhook.
 *
 * Field names match the official Garmin Health API "ClientHRVSummary" schema.
 */
export interface GarminHrvSummary {
  userId: string;
  summaryId: string;
  calendarDate: string; // "YYYY-MM-DD"
  startTimeInSeconds?: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds?: number;
  lastNightAvg?: number;
  lastNight5MinHigh?: number;
  hrvValues?: Record<string, number>;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

/**
 * A single stress detail summary sent by Garmin in the HEALTH - Stress webhook.
 *
 * We only extract body battery values from this payload.
 * The full stress time-series is stored in raw_data for potential future use.
 */
export interface GarminStressDetailSummary {
  userId: string;
  summaryId?: string;
  calendarDate: string;
  startTimeInSeconds?: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds?: number;
  timeOffsetBodyBatteryValues?: Record<string, number>;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

/** Top-level webhook payload from Garmin. */
export interface GarminWebhookPayload {
  dailies?: GarminDailySummary[];
  sleeps?: GarminSleepSummary[];
  hrv?: GarminHrvSummary[];
  stressDetails?: GarminStressDetailSummary[];
}

/** Result of processing a single summary. */
export interface ProcessingResult {
  summaryId: string;
  userId: string;
  calendarDate: string;
  participantId: string | null;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

/**
 * Verify the Garmin webhook signature.
 *
 * Garmin computes HMAC-SHA1 of the raw request body using the OAuth
 * consumer secret and sends it in the `Signature` header (hex-encoded).
 *
 * @param rawBody - The raw request body as a string
 * @param signature - Value of the `Signature` header
 * @returns true if the signature is valid
 */
export function verifyGarminSignature(
  rawBody: string,
  signature: string
): boolean {
  const secret = process.env.GARMIN_CLIENT_SECRET;
  if (!secret) {
    throw new Error('GARMIN_CLIENT_SECRET is required for webhook signature verification');
  }

  const computed = crypto
    .createHmac('sha1', secret)
    .update(rawBody)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(computed, 'hex')
    );
  } catch {
    // Buffers might differ in length if signature is malformed
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pseudonym resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a participant_id to its pseudonym_id from the mapping table.
 * Uses HMAC hash for lookup -- participant_id is never stored in plaintext.
 * Returns null if no mapping exists.
 */
async function resolvePseudonymId(participantId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const hash = hashParticipantId(participantId);
  const { data, error } = await supabase
    .from('participant_pseudonyms')
    .select('pseudonym_id')
    .eq('participant_id_hash', hash)
    .maybeSingle();

  if (error) {
    console.error('[PSEUDONYM] Lookup failed:', error.message);
    return null;
  }

  return data?.pseudonym_id ?? null;
}

// ---------------------------------------------------------------------------
// Raw record storage (append-only, pseudonymized)
// ---------------------------------------------------------------------------

type RawTable =
  | 'garmin_raw_dailies'
  | 'garmin_raw_sleeps'
  | 'garmin_raw_hrv'
  | 'garmin_raw_stress';

/**
 * Sanitize a webhook payload before storage: strip OAuth tokens and other
 * sensitive fields that should never be persisted.
 */
function sanitizePayload(
  summary: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...summary };
  delete sanitized.userAccessToken;
  return sanitized;
}

/**
 * Insert a raw webhook payload into the appropriate append-only table.
 * Uses pseudonym_id (not participant_id) for PIPEDA compliance.
 * Strips sensitive fields (userAccessToken) before storage.
 * Failures are logged but never block the main processing flow.
 */
async function insertRawRecord(
  table: RawTable,
  pseudonymId: string | null,
  garminUserId: string,
  summary: { summaryId?: string; calendarDate?: string; [key: string]: unknown },
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(table).insert({
      pseudonym_id: pseudonymId,
      garmin_user_id: garminUserId,
      summary_id: summary.summaryId ?? null,
      calendar_date: summary.calendarDate ?? null,
      raw_data: sanitizePayload(summary),
    });
    if (error) {
      console.error(`[RAW_INSERT] Failed to insert into ${table}:`, error.message);
    }
  } catch (err) {
    console.error(`[RAW_INSERT] Unexpected error inserting into ${table}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Daily Summary Processing
// ---------------------------------------------------------------------------

/**
 * Map a Garmin daily summary to our `garmin_metrics` column format.
 *
 * Uses pseudonym_id (not participant_id) for PIPEDA compliance.
 * Exported so the backfill/pull logic can reuse the same mapping.
 */
export function mapSummaryToMetrics(
  summary: GarminDailySummary,
  pseudonymId: string
) {
  // Webhooks can send multiple partial "daily" updates throughout the day.
  // To keep garmin_metrics fresh without regressing, only write fields that are
  // present in this payload (avoid overwriting previously-known values with null).
  const row: Record<string, unknown> = {
    pseudonym_id: pseudonymId,
    metric_date: summary.calendarDate,
    updated_at: new Date().toISOString(),
  };

  const setIfDefined = (key: string, value: unknown) => {
    if (value !== undefined) row[key] = value;
  };

  // Activity
  setIfDefined("steps", summary.steps);
  setIfDefined("steps_goal", summary.stepsGoal);
  setIfDefined("distance_meters", summary.distanceInMeters);
  setIfDefined("active_time_seconds", summary.activeTimeInSeconds);
  setIfDefined("duration_seconds", summary.durationInSeconds);
  setIfDefined("floors_climbed", summary.floorsClimbed);
  setIfDefined("intensity_minutes_moderate", summary.moderateIntensityDurationInSeconds);
  setIfDefined("intensity_minutes_vigorous", summary.vigorousIntensityDurationInSeconds);

  // Calories
  setIfDefined("active_calories", summary.activeKilocalories);
  setIfDefined("bmr_calories", summary.bmrKilocalories);
  if (summary.totalKilocalories !== undefined) {
    setIfDefined("total_calories", summary.totalKilocalories);
  } else if (summary.activeKilocalories !== undefined || summary.bmrKilocalories !== undefined) {
    const total = (summary.activeKilocalories ?? 0) + (summary.bmrKilocalories ?? 0);
    setIfDefined("total_calories", total);
  }

  // Heart rate
  setIfDefined("resting_heart_rate", summary.restingHeartRateInBeatsPerMinute);
  setIfDefined("max_heart_rate", summary.maxHeartRateInBeatsPerMinute);
  setIfDefined("min_heart_rate", summary.minHeartRateInBeatsPerMinute);
  setIfDefined("average_heart_rate", summary.averageHeartRateInBeatsPerMinute);

  // Stress
  setIfDefined("average_stress_level", summary.averageStressLevel);
  setIfDefined("max_stress_level", summary.maxStressLevel);
  setIfDefined("stress_qualifier", summary.stressQualifier);
  setIfDefined("stress_duration_seconds", summary.stressDurationInSeconds);
  setIfDefined("rest_stress_duration_seconds", summary.restStressDurationInSeconds);
  setIfDefined("activity_stress_duration_seconds", summary.activityStressDurationInSeconds);
  setIfDefined("low_stress_duration_seconds", summary.lowStressDurationInSeconds);
  setIfDefined("medium_stress_duration_seconds", summary.mediumStressDurationInSeconds);
  setIfDefined("high_stress_duration_seconds", summary.highStressDurationInSeconds);

  // Body Battery (charged/drained from dailies)
  setIfDefined("body_battery_charged", summary.bodyBatteryChargedValue);
  setIfDefined("body_battery_drained", summary.bodyBatteryDrainedValue);

  return row;
}

/**
 * Process a single Garmin daily summary:
 *   1. Look up participant by garmin_user_id
 *   2. Resolve pseudonym_id for health data storage
 *   3. Insert raw record (pseudonymized)
 *   4. Upsert extracted fields into garmin_metrics (pseudonymized)
 *   5. Log result to ingestion_logs (pseudonymized)
 */
export async function processDailySummary(
  summary: GarminDailySummary
): Promise<ProcessingResult> {
  const startMs = Date.now();
  const supabase = getSupabaseAdmin();

  const result: ProcessingResult = {
    summaryId: summary.summaryId,
    userId: summary.userId,
    calendarDate: summary.calendarDate,
    participantId: null,
    status: 'failed',
  };

  if (summary.privacyProtected) {
    result.status = 'skipped';
    result.error = 'Privacy-protected summary';
    return result;
  }

  try {
    // 1. Resolve Garmin userId → participant_id (PII zone lookup)
    const { data: participant, error: lookupError } = await supabase
      .from('participants')
      .select('id')
      .eq('garmin_user_id', summary.userId)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Participant lookup failed: ${lookupError.message}`);
    }

    if (!participant) {
      result.status = 'skipped';
      result.error = `No participant found for Garmin userId ${summary.userId}`;
      return result;
    }

    result.participantId = participant.id;

    // 2. Resolve pseudonym_id (the only ID stored in health tables)
    const pseudonymId = await resolvePseudonymId(participant.id);
    if (!pseudonymId) {
      throw new Error(`No pseudonym found for participant ${participant.id}`);
    }

    // 3. Store raw payload (append-only, pseudonymized, tokens stripped)
    await insertRawRecord('garmin_raw_dailies', pseudonymId, summary.userId, summary);

    // 4. Upsert into garmin_metrics (pseudonymized)
    const metricsRow = mapSummaryToMetrics(summary, pseudonymId);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, {
        onConflict: 'pseudonym_id,metric_date',
      });

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    result.status = 'success';

    // 5. Log success (pseudonymized)
    await supabase.from('ingestion_logs').insert({
      pseudonym_id: pseudonymId,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook',
    });

    await markGarminIngestionSuccess({
      pseudonymId,
      calendarDate: summary.calendarDate,
      source: 'webhook-dailies',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processDailySummary error:', {
      summaryId: summary.summaryId,
      error: message,
    });
    
    Sentry.captureException(error, {
      extra: {
        summaryId: summary.summaryId,
        userId: summary.userId,
        calendarDate: summary.calendarDate,
        processor: 'processDailySummary'
      }
    });

    if (result.participantId) {
      const pId = await resolvePseudonymId(result.participantId);
      if (pId) {
        await supabase.from('ingestion_logs').insert({
          pseudonym_id: pId,
          status: 'failed',
          error_message: message,
          duration_ms: Date.now() - startMs,
          date_processed: summary.calendarDate,
          source: 'webhook',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sleep Summary Processing
// ---------------------------------------------------------------------------

/**
 * Map a Garmin sleep summary to garmin_metrics columns.
 * Sleep data is merged into the same row as daily data (keyed by date).
 */
export function mapSleepToMetrics(
  summary: GarminSleepSummary,
  pseudonymId: string,
) {
  const row: Record<string, unknown> = {
    pseudonym_id: pseudonymId,
    metric_date: summary.calendarDate,
    updated_at: new Date().toISOString(),
  };

  const setIfDefined = (key: string, value: unknown) => {
    if (value !== undefined) row[key] = value;
  };

  // Only write sleep-derived metrics when the core sleep record is present.
  // This prevents partial/incomplete payloads from populating WASO (awake_seconds)
  // while leaving duration/score missing (which biases continuity "too good").
  const hasCoreSleep =
    summary.durationInSeconds !== undefined && summary.durationInSeconds != null && summary.durationInSeconds > 0;

  if (hasCoreSleep) {
    // Sleep totals
    setIfDefined("sleep_duration_seconds", summary.durationInSeconds);
    setIfDefined("sleep_score", summary.overallSleepScore?.value);
    setIfDefined("sleep_score_qualifier", summary.overallSleepScore?.qualifierKey);

    // Sleep breakdown
    setIfDefined("deep_sleep_seconds", summary.deepSleepDurationInSeconds);
    setIfDefined("light_sleep_seconds", summary.lightSleepDurationInSeconds);
    setIfDefined("rem_sleep_seconds", summary.remSleepInSeconds);
    setIfDefined("awake_seconds", summary.awakeDurationInSeconds);
  }

  // Metadata
  setIfDefined("sleep_validation", summary.validation);
  if (summary.startTimeInSeconds !== undefined) {
    setIfDefined("sleep_start_time", new Date(summary.startTimeInSeconds * 1000).toISOString());
  }

  return row;
}

/**
 * Process a single Garmin sleep summary.
 * Merges sleep data into the garmin_metrics row for the same calendar date.
 */
export async function processSleepSummary(
  summary: GarminSleepSummary,
): Promise<ProcessingResult> {
  const startMs = Date.now();
  const supabase = getSupabaseAdmin();

  const result: ProcessingResult = {
    summaryId: summary.summaryId,
    userId: summary.userId,
    calendarDate: summary.calendarDate,
    participantId: null,
    status: 'failed',
  };

  if (summary.privacyProtected) {
    result.status = 'skipped';
    result.error = 'Privacy-protected summary';
    return result;
  }

  const validation = summary.validation ?? '';
  if (validation.includes('TENTATIVE')) {
    result.status = 'skipped';
    result.error = `Skipping tentative sleep record (${validation})`;
    return result;
  }

  try {
    const { data: participant, error: lookupError } = await supabase
      .from('participants')
      .select('id')
      .eq('garmin_user_id', summary.userId)
      .maybeSingle();

    if (lookupError) throw new Error(`Participant lookup failed: ${lookupError.message}`);

    if (!participant) {
      result.status = 'skipped';
      result.error = `No participant found for Garmin userId ${summary.userId}`;
      return result;
    }

    result.participantId = participant.id;

    const pseudonymId = await resolvePseudonymId(participant.id);
    if (!pseudonymId) {
      throw new Error(`No pseudonym found for participant ${participant.id}`);
    }

    await insertRawRecord('garmin_raw_sleeps', pseudonymId, summary.userId, summary);

    const metricsRow = mapSleepToMetrics(summary, pseudonymId);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    result.status = 'success';

    await supabase.from('ingestion_logs').insert({
      pseudonym_id: pseudonymId,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook-sleeps',
    });

    await markGarminIngestionSuccess({
      pseudonymId,
      calendarDate: summary.calendarDate,
      source: 'webhook-sleeps',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processSleepSummary error:', {
      summaryId: summary.summaryId,
      error: message,
    });
    
    Sentry.captureException(error, {
      extra: {
        summaryId: summary.summaryId,
        userId: summary.userId,
        calendarDate: summary.calendarDate,
        processor: 'processSleepSummary'
      }
    });

    if (result.participantId) {
      const pId = await resolvePseudonymId(result.participantId);
      if (pId) {
        await supabase.from('ingestion_logs').insert({
          pseudonym_id: pId,
          status: 'failed',
          error_message: message,
          duration_ms: Date.now() - startMs,
          date_processed: summary.calendarDate,
          source: 'webhook-sleeps',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// HRV Summary Processing
// ---------------------------------------------------------------------------

/**
 * Map a Garmin HRV summary to garmin_metrics columns.
 *
 * Only `lastNightAvg` and `lastNight5MinHigh` are scalar values in the
 * official ClientHRVSummary schema.
 */
export function mapHrvToMetrics(
  summary: GarminHrvSummary,
  pseudonymId: string,
) {
  const row: Record<string, unknown> = {
    pseudonym_id: pseudonymId,
    metric_date: summary.calendarDate,
    updated_at: new Date().toISOString(),
  };

  if (summary.lastNightAvg !== undefined) row.hrv_last_night_average = summary.lastNightAvg;
  if (summary.lastNight5MinHigh !== undefined) row.hrv_last_night_5_min_high = summary.lastNight5MinHigh;

  return row;
}

/**
 * Process a single Garmin HRV summary.
 */
export async function processHrvSummary(
  summary: GarminHrvSummary,
): Promise<ProcessingResult> {
  const startMs = Date.now();
  const supabase = getSupabaseAdmin();

  const result: ProcessingResult = {
    summaryId: summary.summaryId ?? `hrv-${summary.calendarDate}`,
    userId: summary.userId,
    calendarDate: summary.calendarDate,
    participantId: null,
    status: 'failed',
  };

  if (summary.privacyProtected) {
    result.status = 'skipped';
    result.error = 'Privacy-protected summary';
    return result;
  }

  try {
    const { data: participant, error: lookupError } = await supabase
      .from('participants')
      .select('id')
      .eq('garmin_user_id', summary.userId)
      .maybeSingle();

    if (lookupError) throw new Error(`Participant lookup failed: ${lookupError.message}`);

    if (!participant) {
      result.status = 'skipped';
      result.error = `No participant found for Garmin userId ${summary.userId}`;
      return result;
    }

    result.participantId = participant.id;

    const pseudonymId = await resolvePseudonymId(participant.id);
    if (!pseudonymId) {
      throw new Error(`No pseudonym found for participant ${participant.id}`);
    }

    await insertRawRecord('garmin_raw_hrv', pseudonymId, summary.userId, summary);

    const metricsRow = mapHrvToMetrics(summary, pseudonymId);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    result.status = 'success';

    await supabase.from('ingestion_logs').insert({
      pseudonym_id: pseudonymId,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook-hrv',
    });

    await markGarminIngestionSuccess({
      pseudonymId,
      calendarDate: summary.calendarDate,
      source: 'webhook-hrv',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processHrvSummary error:', {
      summaryId: summary.summaryId,
      error: message,
    });
    
    Sentry.captureException(error, {
      extra: {
        summaryId: summary.summaryId,
        userId: summary.userId,
        calendarDate: summary.calendarDate,
        processor: 'processHrvSummary'
      }
    });

    if (result.participantId) {
      const pId = await resolvePseudonymId(result.participantId);
      if (pId) {
        await supabase.from('ingestion_logs').insert({
          pseudonym_id: pId,
          status: 'failed',
          error_message: message,
          duration_ms: Date.now() - startMs,
          date_processed: summary.calendarDate,
          source: 'webhook-hrv',
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Stress Detail Processing (Body Battery score extraction)
// ---------------------------------------------------------------------------

/**
 * Extract the most recent body battery score from a stress detail summary.
 * TimeOffsetBodyBatteryValues is a map of offset→value; the highest offset
 * is the most recent reading.
 */
function extractBodyBatteryScore(
  values: Record<string, number> | undefined,
): { mostRecent: number | null; highest: number | null; lowest: number | null; start: number | null } {
  if (!values || Object.keys(values).length === 0) {
    return { mostRecent: null, highest: null, lowest: null, start: null };
  }

  const entries = Object.entries(values)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);

  const allValues = entries.map(([, v]) => v);
  const mostRecent = entries[entries.length - 1][1];
  const highest = Math.max(...allValues);
  const lowest = Math.min(...allValues);

  // "Start" in our weekly model is the morning value. For Body Battery, the
  // daily peak is the best proxy for that morning start (it typically occurs
  // after overnight recovery). Using the first sample of the day can be
  // misleading if the series begins before recovery has peaked.
  const start = highest;

  return { mostRecent, highest, lowest, start };
}

/**
 * Map a Garmin stress detail summary to garmin_metrics body battery columns.
 */
export function mapStressToMetrics(
  summary: GarminStressDetailSummary,
  pseudonymId: string,
) {
  const bb = extractBodyBatteryScore(summary.timeOffsetBodyBatteryValues);

  return {
    pseudonym_id: pseudonymId,
    metric_date: summary.calendarDate,

    body_battery_most_recent: bb.mostRecent,
    body_battery_highest: bb.highest,
    body_battery_lowest: bb.lowest,
    body_battery_start: bb.start,
    body_battery_time_offset_values: summary.timeOffsetBodyBatteryValues ?? null,

    updated_at: new Date().toISOString(),
  };
}

/**
 * Process a single Garmin stress detail summary.
 * Extracts body battery score and merges into garmin_metrics.
 */
export async function processStressDetailSummary(
  summary: GarminStressDetailSummary,
): Promise<ProcessingResult> {
  const startMs = Date.now();
  const supabase = getSupabaseAdmin();

  const result: ProcessingResult = {
    summaryId: summary.summaryId ?? `stress-${summary.calendarDate}`,
    userId: summary.userId,
    calendarDate: summary.calendarDate,
    participantId: null,
    status: 'failed',
  };

  if (summary.privacyProtected) {
    result.status = 'skipped';
    result.error = 'Privacy-protected summary';
    return result;
  }

  // Skip if no body battery data in this summary
  if (!summary.timeOffsetBodyBatteryValues ||
      Object.keys(summary.timeOffsetBodyBatteryValues).length === 0) {
    result.status = 'skipped';
    result.error = 'No body battery data in stress summary';
    return result;
  }

  try {
    const { data: participant, error: lookupError } = await supabase
      .from('participants')
      .select('id')
      .eq('garmin_user_id', summary.userId)
      .maybeSingle();

    if (lookupError) throw new Error(`Participant lookup failed: ${lookupError.message}`);

    if (!participant) {
      result.status = 'skipped';
      result.error = `No participant found for Garmin userId ${summary.userId}`;
      return result;
    }

    result.participantId = participant.id;

    const pseudonymId = await resolvePseudonymId(participant.id);
    if (!pseudonymId) {
      throw new Error(`No pseudonym found for participant ${participant.id}`);
    }

    await insertRawRecord('garmin_raw_stress', pseudonymId, summary.userId, summary);

    const metricsRow = mapStressToMetrics(summary, pseudonymId);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, { onConflict: 'pseudonym_id,metric_date' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    result.status = 'success';

    await supabase.from('ingestion_logs').insert({
      pseudonym_id: pseudonymId,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook-stress',
    });

    await markGarminIngestionSuccess({
      pseudonymId,
      calendarDate: summary.calendarDate,
      source: 'webhook-stress',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processStressDetailSummary error:', {
      summaryId: summary.summaryId,
      error: message,
    });
    
    Sentry.captureException(error, {
      extra: {
        summaryId: summary.summaryId,
        userId: summary.userId,
        calendarDate: summary.calendarDate,
        processor: 'processStressDetailSummary'
      }
    });

    if (result.participantId) {
      const pId = await resolvePseudonymId(result.participantId);
      if (pId) {
        await supabase.from('ingestion_logs').insert({
          pseudonym_id: pId,
          status: 'failed',
          error_message: message,
          duration_ms: Date.now() - startMs,
          date_processed: summary.calendarDate,
          source: 'webhook-stress',
        });
      }
    }
  }

  return result;
}
