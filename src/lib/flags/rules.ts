// ---------------------------------------------------------------------------
// Baseline-Relative Flagging Rules
//
// Compares a participant's most recent metrics against their individual
// 30-day rolling average baseline.  If they have < 7 days of history we
// fall back to population defaults.
//
// Baseline window: days 4–33 (excludes the 3 most recent evaluation days).
// Evaluation window: the most recent 2–3 days (depending on the rule).
// ---------------------------------------------------------------------------

export type FlagType =
  | 'LOW_HRV'
  | 'HIGH_RHR'
  | 'LOW_SLEEP'
  | 'LOW_SLEEP_SCORE'
  | 'HIGH_STRESS'
  | 'LOW_BODY_BATTERY'
  | 'NO_DATA';

export type Flag = {
  type: FlagType;
  message: string;
  severity: 'warning' | 'alert' | 'info';
};

export type Metric = {
  id: string;
  metric_date: string;
  resting_heart_rate: number | null;
  average_stress_level: number | null;
  sleep_duration_seconds: number | null;
  sleep_score: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_most_recent: number | null;
  hrv_last_night_average: number | null;
  hrv_last_night_5_min_high: number | null;
};

// ---------------------------------------------------------------------------
// Population defaults (used when < 7 days of individual history)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  hrv: 40,           // ms
  rhr: 65,           // bpm
  sleepSeconds: 25200, // 7 hours
  sleepScore: 75,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the mean of non-null numbers.  Returns null if the array is empty.
 */
function mean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Check if the last N evaluation values are ALL at or beyond the threshold.
 * `direction` controls whether we check "below" or "above".
 * Null values break the consecutive streak.
 */
function consecutiveBreached(
  evalValues: (number | null)[],
  threshold: number,
  direction: 'below' | 'above',
  requiredConsecutive: number,
): boolean {
  // evalValues are sorted most-recent first
  let streak = 0;
  for (const v of evalValues) {
    if (v === null) break;
    const breached =
      direction === 'below' ? v < threshold : v > threshold;
    if (!breached) break;
    streak++;
    if (streak >= requiredConsecutive) return true;
  }
  return false;
}

/**
 * Compute the individual baseline for a given field.
 *
 * baseline = mean(days 4..33) — the 30-day rolling average excluding the
 * 3 most recent evaluation days.
 *
 * If fewer than 7 non-null baseline values exist, returns the population
 * default for that metric.
 */
function computeBaseline(
  sortedMetrics: Metric[],
  field: keyof Metric,
  populationDefault: number,
): number {
  // Days index 3..32 (0-based) = days 4..33 in 1-based terms
  const baselineSlice = sortedMetrics.slice(3, 33);
  const values = baselineSlice.map((m) => m[field] as number | null);
  const avg = mean(values);
  const validCount = values.filter((v) => v !== null).length;

  if (avg === null || validCount < 7) {
    return populationDefault;
  }
  return avg;
}

// ---------------------------------------------------------------------------
// Main flag calculation
// ---------------------------------------------------------------------------

/**
 * Calculate flags for a participant based on recent metrics.
 *
 * @param metrics Array of metrics, ideally the last 33 days sorted by date
 *   descending (most recent first).  The function will re-sort if needed.
 */
export function calculateFlags(metrics: Metric[]): Flag[] {
  const flags: Flag[] = [];

  // Sort descending by date (most recent first)
  const sorted = [...metrics].sort(
    (a, b) =>
      new Date(b.metric_date).getTime() - new Date(a.metric_date).getTime(),
  );

  // ── NO DATA CHECK ──────────────────────────────────────────────────────
  if (sorted.length === 0) {
    flags.push({
      type: 'NO_DATA',
      message: 'No data received recently',
      severity: 'info',
    });
    return flags;
  }

  const latestDate = new Date(sorted[0].metric_date);
  const now = new Date();
  const diffDays = Math.ceil(
    Math.abs(now.getTime() - latestDate.getTime()) / 86_400_000,
  );
  if (diffDays > 3) {
    flags.push({
      type: 'NO_DATA',
      message: `No data since ${sorted[0].metric_date}`,
      severity: 'warning',
    });
  }

  // Need at least 2 recent days to evaluate any consecutive-day rule
  if (sorted.length < 2) return flags;

  // ── EVALUATION WINDOWS ─────────────────────────────────────────────────
  // Most recent 3 days for evaluation (some rules use 2, stress uses 3)
  const eval3 = sorted.slice(0, 3);

  // ── BASELINES ──────────────────────────────────────────────────────────
  const hrvBaseline = computeBaseline(sorted, 'hrv_last_night_average', DEFAULTS.hrv);
  const rhrBaseline = computeBaseline(sorted, 'resting_heart_rate', DEFAULTS.rhr);
  const sleepBaseline = computeBaseline(sorted, 'sleep_duration_seconds', DEFAULTS.sleepSeconds);
  const sleepScoreBaseline = computeBaseline(sorted, 'sleep_score', DEFAULTS.sleepScore);

  // ── 1. LOW HRV: 15% below baseline for 2+ consecutive days ────────────
  const hrvThreshold = hrvBaseline * 0.85;
  const hrvValues = eval3.map((m) => m.hrv_last_night_average);
  if (consecutiveBreached(hrvValues, hrvThreshold, 'below', 2)) {
    flags.push({
      type: 'LOW_HRV',
      message: `HRV below baseline (${Math.round(hrvBaseline)} ms) for 2+ days`,
      severity: 'alert',
    });
  }

  // ── 2. HIGH RHR: 15% above baseline for 2+ consecutive days ───────────
  const rhrThreshold = rhrBaseline * 1.15;
  const rhrValues = eval3.map((m) => m.resting_heart_rate);
  if (consecutiveBreached(rhrValues, rhrThreshold, 'above', 2)) {
    flags.push({
      type: 'HIGH_RHR',
      message: `RHR above baseline (${Math.round(rhrBaseline)} bpm) for 2+ days`,
      severity: 'alert',
    });
  }

  // ── 3. LOW SLEEP: <6h for 2+ days OR 30% below baseline for 2+ days ──
  const sleepAbsThreshold = 21600; // 6 hours in seconds
  const sleepBaselineThreshold = sleepBaseline * 0.70;
  const sleepValues = eval3.map((m) => m.sleep_duration_seconds);

  const lowSleepAbsolute = consecutiveBreached(sleepValues, sleepAbsThreshold, 'below', 2);
  const lowSleepBaseline = consecutiveBreached(sleepValues, sleepBaselineThreshold, 'below', 2);

  if (lowSleepAbsolute) {
    flags.push({
      type: 'LOW_SLEEP',
      message: 'Sleep < 6h for 2+ days',
      severity: 'alert',
    });
  } else if (lowSleepBaseline) {
    const baselineHours = (sleepBaseline / 3600).toFixed(1);
    flags.push({
      type: 'LOW_SLEEP',
      message: `Sleep 30%+ below baseline (${baselineHours}h) for 2+ days`,
      severity: 'alert',
    });
  }

  // ── 4. LOW SLEEP SCORE: 20% below baseline for 2+ consecutive days ────
  const sleepScoreThreshold = sleepScoreBaseline * 0.80;
  const sleepScoreValues = eval3.map((m) => m.sleep_score);
  if (consecutiveBreached(sleepScoreValues, sleepScoreThreshold, 'below', 2)) {
    flags.push({
      type: 'LOW_SLEEP_SCORE',
      message: `Sleep score below baseline (${Math.round(sleepScoreBaseline)}) for 2+ days`,
      severity: 'warning',
    });
  }

  // ── 5. HIGH STRESS: ≥76 for 3 consecutive days ────────────────────────
  // This is an absolute threshold (not baseline-relative)
  if (sorted.length >= 3) {
    const stressValues = eval3.map((m) => m.average_stress_level);
    if (consecutiveBreached(stressValues, 76, 'above', 3)) {
      flags.push({
        type: 'HIGH_STRESS',
        message: 'Stress ≥ 76 for 3+ days',
        severity: 'alert',
      });
    }
  }

  // ── 6. LOW BODY BATTERY: <25 for 2+ consecutive days ──────────────────
  // Absolute threshold (not baseline-relative)
  const bbValues = eval3.map((m) => m.body_battery_most_recent);
  if (consecutiveBreached(bbValues, 25, 'below', 2)) {
    flags.push({
      type: 'LOW_BODY_BATTERY',
      message: 'Body battery < 25 for 2+ days',
      severity: 'warning',
    });
  }

  return flags;
}
