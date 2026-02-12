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

/** A single daily summary object sent by Garmin in the webhook payload. */
export interface GarminDailySummary {
  userId: string;
  userAccessToken: string;
  summaryId: string;
  calendarDate: string; // "YYYY-MM-DD"

  // Activity
  steps?: number;
  distanceInMeters?: number;
  activeTimeInSeconds?: number;
  floorsClimbed?: number;
  moderateIntensityDurationInSeconds?: number;
  vigorousIntensityDurationInSeconds?: number;

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
  lowStressDurationInSeconds?: number;
  mediumStressDurationInSeconds?: number;
  highStressDurationInSeconds?: number;

  // Sleep
  sleepDurationInSeconds?: number;
  sleepScoreQualifier?: string;
  overallSleepScore?: { value?: number };

  // Body Battery
  bodyBatteryHighestValue?: number;
  bodyBatteryLowestValue?: number;
  bodyBatteryMostRecentValue?: number;

  // SpO2
  averageSpo2Value?: number;
  lowestSpo2Value?: number;

  // Respiration
  avgWakingRespirationValue?: number;
  highestRespirationValue?: number;
  lowestRespirationValue?: number;

  // Privacy
  privacyProtected?: boolean;

  // Allow additional fields
  [key: string]: unknown;
}

/** Top-level webhook payload from Garmin. */
export interface GarminWebhookPayload {
  dailies: GarminDailySummary[];
}

/** Result of processing a single daily summary. */
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
 */
function mapSummaryToMetrics(
  summary: GarminDailySummary,
  participantId: string
) {
  return {
    participant_id: participantId,
    metric_date: summary.calendarDate,

    // Activity
    steps: summary.steps ?? null,
    distance_meters: summary.distanceInMeters ?? null,
    active_time_seconds: summary.activeTimeInSeconds ?? null,
    floors_climbed: summary.floorsClimbed ?? null,
    intensity_minutes_moderate: summary.moderateIntensityDurationInSeconds ?? null,
    intensity_minutes_vigorous: summary.vigorousIntensityDurationInSeconds ?? null,

    // Calories
    active_calories: summary.activeKilocalories ?? null,
    bmr_calories: summary.bmrKilocalories ?? null,
    total_calories: summary.totalKilocalories ?? null,

    // Heart rate
    resting_heart_rate: summary.restingHeartRateInBeatsPerMinute ?? null,
    max_heart_rate: summary.maxHeartRateInBeatsPerMinute ?? null,
    min_heart_rate: summary.minHeartRateInBeatsPerMinute ?? null,
    average_heart_rate: summary.averageHeartRateInBeatsPerMinute ?? null,

    // Stress
    average_stress_level: summary.averageStressLevel ?? null,
    max_stress_level: summary.maxStressLevel ?? null,
    stress_duration_seconds: summary.stressDurationInSeconds ?? null,
    rest_stress_duration_seconds: summary.restStressDurationInSeconds ?? null,
    low_stress_duration_seconds: summary.lowStressDurationInSeconds ?? null,
    medium_stress_duration_seconds: summary.mediumStressDurationInSeconds ?? null,
    high_stress_duration_seconds: summary.highStressDurationInSeconds ?? null,

    // Sleep
    sleep_duration_seconds: summary.sleepDurationInSeconds ?? null,
    sleep_score: summary.overallSleepScore?.value ?? null,

    // Body Battery
    body_battery_highest: summary.bodyBatteryHighestValue ?? null,
    body_battery_lowest: summary.bodyBatteryLowestValue ?? null,
    body_battery_most_recent: summary.bodyBatteryMostRecentValue ?? null,

    // SpO2
    spo2_average: summary.averageSpo2Value ?? null,
    spo2_lowest: summary.lowestSpo2Value ?? null,

    // Respiration
    avg_waking_respiration: summary.avgWakingRespirationValue ?? null,
    highest_respiration: summary.highestRespirationValue ?? null,
    lowest_respiration: summary.lowestRespirationValue ?? null,

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
