/**
 * Garmin Webhook Utilities
 *
 * Handles signature verification and daily-summary processing
 * for the Garmin Health API push (webhook) model.
 *
 * Garmin signs every webhook request with an HMAC-SHA1 of the raw
 * body using the OAuth consumer secret.  We verify this to prevent
 * spoofing.
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

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

/** Top-level webhook payload from Garmin. */
export interface GarminWebhookPayload {
  dailies?: GarminDailySummary[];
  sleeps?: GarminSleepSummary[];
  hrv?: GarminHrvSummary[];
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
// Daily Summary Processing
// ---------------------------------------------------------------------------

/**
 * Map a Garmin daily summary to our `garmin_metrics` column format.
 *
 * Exported so the backfill/pull logic can reuse the same mapping.
 */
export function mapSummaryToMetrics(
  summary: GarminDailySummary,
  participantId: string
) {
  return {
    participant_id: participantId,
    metric_date: summary.calendarDate,

    // Activity
    steps: summary.steps ?? null,
    steps_goal: summary.stepsGoal ?? null,
    distance_meters: summary.distanceInMeters ?? null,
    active_time_seconds: summary.activeTimeInSeconds ?? null,
    duration_seconds: summary.durationInSeconds ?? null,
    floors_climbed: summary.floorsClimbed ?? null,
    intensity_minutes_moderate: summary.moderateIntensityDurationInSeconds ?? null,
    intensity_minutes_vigorous: summary.vigorousIntensityDurationInSeconds ?? null,

    // Calories
    active_calories: summary.activeKilocalories ?? null,
    bmr_calories: summary.bmrKilocalories ?? null,
    total_calories:
      summary.totalKilocalories ?? (
        ((summary.activeKilocalories ?? 0) + (summary.bmrKilocalories ?? 0)) || null
      ),

    // Heart rate
    resting_heart_rate: summary.restingHeartRateInBeatsPerMinute ?? null,
    max_heart_rate: summary.maxHeartRateInBeatsPerMinute ?? null,
    min_heart_rate: summary.minHeartRateInBeatsPerMinute ?? null,
    average_heart_rate: summary.averageHeartRateInBeatsPerMinute ?? null,

    // Stress
    average_stress_level: summary.averageStressLevel ?? null,
    max_stress_level: summary.maxStressLevel ?? null,
    stress_qualifier: summary.stressQualifier ?? null,
    stress_duration_seconds: summary.stressDurationInSeconds ?? null,
    rest_stress_duration_seconds: summary.restStressDurationInSeconds ?? null,
    activity_stress_duration_seconds: summary.activityStressDurationInSeconds ?? null,
    low_stress_duration_seconds: summary.lowStressDurationInSeconds ?? null,
    medium_stress_duration_seconds: summary.mediumStressDurationInSeconds ?? null,
    high_stress_duration_seconds: summary.highStressDurationInSeconds ?? null,

    // Body Battery (charged/drained from dailies)
    body_battery_charged: summary.bodyBatteryChargedValue ?? null,
    body_battery_drained: summary.bodyBatteryDrainedValue ?? null,

    // Raw data for debugging
    raw_data: summary,

    // Timestamps
    updated_at: new Date().toISOString(),
  };
}

/**
 * Process a single Garmin daily summary:
 *   1. Look up participant by garmin_user_id
 *   2. Upsert into garmin_metrics
 *   3. Log result to ingestion_logs
 *
 * Returns a processing result for the caller.
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

  // Skip privacy-protected summaries
  if (summary.privacyProtected) {
    result.status = 'skipped';
    result.error = 'Privacy-protected summary';
    return result;
  }

  try {
    // 1. Resolve Garmin userId → participant_id
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

    // 2. Upsert into garmin_metrics
    const metricsRow = mapSummaryToMetrics(summary, participant.id);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, {
        onConflict: 'participant_id,metric_date',
      });

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    result.status = 'success';

    // 3. Log success
    await supabase.from('ingestion_logs').insert({
      participant_id: participant.id,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processDailySummary error:', {
      summaryId: summary.summaryId,
      userId: summary.userId,
      error: message,
    });

    // Log failure
    if (result.participantId) {
      await supabase.from('ingestion_logs').insert({
        participant_id: result.participantId,
        status: 'failed',
        error_message: message,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'webhook',
      });
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
  participantId: string,
) {
  return {
    participant_id: participantId,
    metric_date: summary.calendarDate,

    // Sleep totals
    sleep_duration_seconds: summary.durationInSeconds ?? null,
    sleep_score: summary.overallSleepScore?.value ?? null,
    sleep_score_qualifier: summary.overallSleepScore?.qualifierKey ?? null,

    // Sleep breakdown
    deep_sleep_seconds: summary.deepSleepDurationInSeconds ?? null,
    light_sleep_seconds: summary.lightSleepDurationInSeconds ?? null,
    rem_sleep_seconds: summary.remSleepInSeconds ?? null,
    awake_seconds: summary.awakeDurationInSeconds ?? null,

    // Metadata
    sleep_validation: summary.validation ?? null,
    sleep_start_time: summary.startTimeInSeconds
      ? new Date(summary.startTimeInSeconds * 1000).toISOString()
      : null,

    // NOTE: Do NOT set raw_data here — it would overwrite the dailies payload.
    // raw_data is owned by the dailies endpoint only.

    updated_at: new Date().toISOString(),
  };
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

  // Prefer finalized sleep records over tentative ones
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

    const metricsRow = mapSleepToMetrics(summary, participant.id);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, { onConflict: 'participant_id,metric_date' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    result.status = 'success';

    await supabase.from('ingestion_logs').insert({
      participant_id: participant.id,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook-sleeps',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processSleepSummary error:', {
      summaryId: summary.summaryId,
      userId: summary.userId,
      error: message,
    });

    if (result.participantId) {
      await supabase.from('ingestion_logs').insert({
        participant_id: result.participantId,
        status: 'failed',
        error_message: message,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'webhook-sleeps',
      });
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
 * official ClientHRVSummary schema.  The full time-series is stored in raw_data.
 */
export function mapHrvToMetrics(
  summary: GarminHrvSummary,
  participantId: string,
) {
  return {
    participant_id: participantId,
    metric_date: summary.calendarDate,

    hrv_last_night_average: summary.lastNightAvg ?? null,
    hrv_last_night_5_min_high: summary.lastNight5MinHigh ?? null,

    updated_at: new Date().toISOString(),
  };
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

    const metricsRow = mapHrvToMetrics(summary, participant.id);

    const { error: upsertError } = await supabase
      .from('garmin_metrics')
      .upsert(metricsRow, { onConflict: 'participant_id,metric_date' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    result.status = 'success';

    await supabase.from('ingestion_logs').insert({
      participant_id: participant.id,
      status: 'success',
      metrics_imported: 1,
      duration_ms: Date.now() - startMs,
      date_processed: summary.calendarDate,
      source: 'webhook-hrv',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.error = message;
    console.error('[GARMIN_WEBHOOK] processHrvSummary error:', {
      summaryId: summary.summaryId,
      userId: summary.userId,
      error: message,
    });

    if (result.participantId) {
      await supabase.from('ingestion_logs').insert({
        participant_id: result.participantId,
        status: 'failed',
        error_message: message,
        duration_ms: Date.now() - startMs,
        date_processed: summary.calendarDate,
        source: 'webhook-hrv',
      });
    }
  }

  return result;
}
