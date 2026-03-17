export type Flag = {
  type:
    | 'LOW_SLEEP'
    | 'HIGH_STRESS'
    | 'NO_DATA'
    | 'HRV_LOW'
    | 'RHR_HIGH'
    | 'SLEEP_SCORE_LOW'
    | 'BODY_BATTERY_LOW';
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

// Population defaults if individual baseline is unavailable
const DEFAULT_BASELINE = {
  hrv: 40,
  rhr: 65,
  sleep_duration: 25200, // 7 hours
  sleep_score: 75,
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates a participant's individual baseline using a 30-day rolling average
 * (excluding the most recent 3 days which are the evaluation window).
 * If there is not enough data, falls back to population defaults.
 */
export function calculateBaseline(metrics: Metric[]) {
  // metrics are expected to be sorted descending by date, so days 3-32 (0-indexed) are the 30 days prior to the 3-day eval window.
  const baselineValues = metrics.slice(3, 33);

  const hrvValues = baselineValues.map(m => m.hrv_last_night_average).filter((v): v is number => v !== null);
  const rhrValues = baselineValues.map(m => m.resting_heart_rate).filter((v): v is number => v !== null);
  const sleepDurValues = baselineValues.map(m => m.sleep_duration_seconds).filter((v): v is number => v !== null);
  const sleepScoreValues = baselineValues.map(m => m.sleep_score).filter((v): v is number => v !== null);

  return {
    hrv: average(hrvValues) ?? DEFAULT_BASELINE.hrv,
    rhr: average(rhrValues) ?? DEFAULT_BASELINE.rhr,
    sleep_duration: average(sleepDurValues) ?? DEFAULT_BASELINE.sleep_duration,
    sleep_score: average(sleepScoreValues) ?? DEFAULT_BASELINE.sleep_score,
  };
}

/**
 * Helper to check if AT LEAST `minConsecutive` consecutive days in the `evalWindow` meet a specific condition.
 * evalWindow is sorted descending by date (0 is newest, 1 is older, etc).
 */
function hasConsecutiveCondition(evalWindow: Metric[], minConsecutive: number, condition: (m: Metric) => boolean): boolean {
  if (evalWindow.length < minConsecutive) return false;

  let maxStreak = 0;
  let currentStreak = 0;

  // Iterate oldest to newest to think about it chronologically, or just count consecutive true values
  for (let i = evalWindow.length - 1; i >= 0; i--) {
    if (condition(evalWindow[i])) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak >= minConsecutive;
}

/**
 * Calculate flags for a participant based on recent metrics.
 *
 * Rules:
 * 1. NO_DATA: > 3 days without data.
 * 2. HRV_LOW: HRV ≥ 15% below baseline for 2–3 consecutive days.
 * 3. RHR_HIGH: RHR ≥ 15% above baseline for 2–3 consecutive days.
 * 4. SLEEP_LOW: Sleep < 6h OR ≥ 30% below baseline for 2–3 consecutive days.
 * 5. SLEEP_SCORE_LOW: Sleep Score ≥ 20% below baseline for 2–3 consecutive days.
 * 6. STRESS_HIGH: Stress ≥ 76 for 3 consecutive days.
 * 7. BODY_BATTERY_LOW: Body Battery < 25 for 2–3 consecutive days.
 *
 * @param metrics The metrics array, sorted by date descending.
 */
export function calculateFlags(metrics: Metric[]): Flag[] {
  const flags: Flag[] = [];

  // Sort descending by date just to be safe
  const sortedMetrics = [...metrics].sort((a, b) =>
    new Date(b.metric_date).getTime() - new Date(a.metric_date).getTime()
  );

  if (sortedMetrics.length === 0) {
    flags.push({
      type: 'NO_DATA',
      message: 'No data received recently',
      severity: 'info',
    });
    return flags;
  }

  // 1. NO DATA CHECK (Last metric is > 3 days old)
  const latestDate = new Date(sortedMetrics[0].metric_date);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - latestDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays > 3) {
    flags.push({
      type: 'NO_DATA',
      message: `No data since ${sortedMetrics[0].metric_date}`,
      severity: 'warning',
    });
    // If we have very stale data, maybe we shouldn't compute other flags, but let's compute them for the time window anyway.
  }

  // Next rules require an evaluation window of up to 3 days
  const evalWindow = sortedMetrics.slice(0, 3);
  if (evalWindow.length >= 2) { // Need at least 2 days for consecutive checks
    const baseline = calculateBaseline(sortedMetrics);

    // 2. HRV_LOW: 15-20% below baseline for 2-3 consecutive days
    const hrvThreshold = baseline.hrv * 0.85;
    if (hasConsecutiveCondition(evalWindow, 2, m => m.hrv_last_night_average !== null && m.hrv_last_night_average <= hrvThreshold)) {
      flags.push({
        type: 'HRV_LOW',
        message: `HRV ≥ 15% below baseline for 2+ days`,
        severity: 'alert',
      });
    }

    // 3. RHR_HIGH: 15-20% above baseline for 2-3 consecutive days
    const rhrThreshold = baseline.rhr * 1.15;
    if (hasConsecutiveCondition(evalWindow, 2, m => m.resting_heart_rate !== null && m.resting_heart_rate >= rhrThreshold)) {
      flags.push({
        type: 'RHR_HIGH',
        message: `RHR ≥ 15% above baseline for 2+ days`,
        severity: 'alert',
      });
    }

    // 4. SLEEP_LOW: less than 6 hours OR 30% below baseline for 2-3 consecutive days
    const sleepDurThreshold = baseline.sleep_duration * 0.70;
    const sixHoursSeconds = 21600;
    if (hasConsecutiveCondition(evalWindow, 2, m => m.sleep_duration_seconds !== null && (m.sleep_duration_seconds < sixHoursSeconds || m.sleep_duration_seconds <= sleepDurThreshold))) {
      flags.push({
        type: 'LOW_SLEEP',
        message: 'Sleep < 6h or 30% below baseline for 2+ days',
        severity: 'alert',
      });
    }

    // 5. SLEEP_SCORE_LOW: 20% below baseline for 2-3 consecutive days
    const sleepScoreThreshold = baseline.sleep_score * 0.80;
    if (hasConsecutiveCondition(evalWindow, 2, m => m.sleep_score !== null && m.sleep_score <= sleepScoreThreshold)) {
      flags.push({
        type: 'SLEEP_SCORE_LOW',
        message: 'Sleep score ≥ 20% below baseline for 2+ days',
        severity: 'warning', // Warning per requirements (implied by typical UI)
      });
    }

    // 6. STRESS_HIGH: 76 or higher for 3 consecutive days
    if (hasConsecutiveCondition(evalWindow, 3, m => m.average_stress_level !== null && m.average_stress_level >= 76)) {
      flags.push({
        type: 'HIGH_STRESS',
        message: 'Stress ≥ 76 for 3 consecutive days',
        severity: 'alert',
      });
    }

    // 7. BODY_BATTERY_LOW: below 25 for 2-3 consecutive days
    if (hasConsecutiveCondition(evalWindow, 2, m => m.body_battery_most_recent !== null && m.body_battery_most_recent < 25)) {
      flags.push({
        type: 'BODY_BATTERY_LOW',
        message: 'Body Battery < 25 for 2+ days',
        severity: 'warning',
      });
    }
  }

  return flags;
}
