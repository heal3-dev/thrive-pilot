export type Flag = {
  type: 'LOW_SLEEP' | 'HIGH_STRESS' | 'NO_DATA';
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

/**
 * Calculate flags for a participant based on recent metrics.
 *
 * Rules:
 * 1. NO_DATA: less than 1 entry in the last 3 days (or empty array).
 *    (Actually, if we fetch "last 3 days" and get 0, it's NO_DATA).
 * 2. LOW_SLEEP: Sleep < 5 hours (18000s) for 3 consecutive days.
 * 3. HIGH_STRESS: Stress > 80 for 3 consecutive days.
 *
 * @param metrics The metrics array, sorted by date descending (implied).
 */
export function calculateFlags(metrics: Metric[]): Flag[] {
  const flags: Flag[] = [];

  // Sort just in case (descending date)
  const sortedMetrics = [...metrics].sort((a, b) => 
    new Date(b.metric_date).getTime() - new Date(a.metric_date).getTime()
  );

  // 1. NO DATA CHECK
  // If we have fewer than 1 metrics in the input (assuming input is "recent metrics")
  // Or if the most recent metric is older than 3 days?
  // Let's assume the caller passes the last 3-4 days of data specifically.
  if (sortedMetrics.length === 0) {
    flags.push({
      type: 'NO_DATA',
      message: 'No data received recently',
      severity: 'info',
    });
    // Can't check other rules if no data
    return flags;
  }

  // Check recency: if the latest metric is older than 3 days
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
  }

  // 2. LOW SLEEP (Last 3 entries must be < 5 hours)
  // We need at least 3 entries to trigger "for 3 consecutive days"
  if (sortedMetrics.length >= 3) {
    const last3 = sortedMetrics.slice(0, 3);
    const lowSleep = last3.every(m => (m.sleep_duration_seconds ?? 0) < 18000); // 5 hours
    if (lowSleep) {
      flags.push({
        type: 'LOW_SLEEP',
        message: 'Sleep < 5h for last 3 days',
        severity: 'alert',
      });
    }

    // 3. HIGH STRESS (Last 3 entries > 80)
    const highStress = last3.every(m => (m.average_stress_level ?? 0) > 80);
    if (highStress) {
      flags.push({
        type: 'HIGH_STRESS',
        message: 'Stress > 80 for last 3 days',
        severity: 'alert',
      });
    }
  }

  return flags;
}
