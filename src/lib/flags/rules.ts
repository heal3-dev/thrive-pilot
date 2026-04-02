export type Metric = {
  id: string;
  metric_date: string;
  resting_heart_rate: number | null;
  average_stress_level: number | null;
  sleep_duration_seconds: number | null;
  sleep_score: number | null;
  awake_seconds?: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_start: number | null;
  body_battery_lowest: number | null;
  body_battery_most_recent: number | null;
  hrv_last_night_average: number | null;
  hrv_last_night_5_min_high: number | null;
};

export type WeeklyColor = 'green' | 'yellow' | 'orange' | 'red';
export type WeeklyMetricKey =
  | 'body_battery'
  | 'stress'
  | 'sleep_duration'
  | 'sleep_score'
  | 'waso'
  | 'hrv'
  | 'rhr'
  | 'hrv_stability';

export type WeeklyMetricResult = {
  metric: WeeklyMetricKey;
  color: WeeklyColor | 'no_data' | 'insufficient_baseline_data';
  points: 0 | 1 | 2 | 3;
  details?: Record<string, unknown>;
};

export type WeeklyFlag = {
  weekEnding: string; // YYYY-MM-DD
  weeklyScore: number; // sum(points), max=24
  baseColor: WeeklyColor;
  finalColor: WeeklyColor;
  overrideApplied: 'none' | 'force_orange' | 'force_red';
  metrics: Record<WeeklyMetricKey, WeeklyMetricResult>;
};

const POINTS: Record<WeeklyColor, 0 | 1 | 2 | 3> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

function ymdToDate(ymd: string): Date {
  // Ensure UTC midnight for consistent date math.
  return new Date(`${ymd}T00:00:00.000Z`);
}

function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return dateToYmd(d);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function maxConsecutive<T>(arr: T[], predicate: (v: T) => boolean): number {
  let best = 0;
  let current = 0;
  for (const v of arr) {
    if (predicate(v)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function maxWindowCount<T>(arr: T[], windowSize: number, predicate: (v: T) => boolean): number {
  if (windowSize <= 0) return 0;
  let best = 0;
  for (let start = 0; start <= arr.length - windowSize; start++) {
    let c = 0;
    for (let i = start; i < start + windowSize; i++) {
      if (predicate(arr[i])) c += 1;
    }
    best = Math.max(best, c);
  }
  return best;
}

function asCalendarWindow(
  metrics: Metric[],
  weekEnding: string,
): { dates: string[]; byDate: Map<string, Metric> } {
  const byDate = new Map<string, Metric>();
  for (const m of metrics) byDate.set(m.metric_date, m);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekEnding, -6 + i));
  return { dates, byDate };
}

function takeLastValidNightRows(
  metrics: Metric[],
  weekEnding: string,
  n = 7,
  isValid: (m: Metric) => boolean,
): Metric[] {
  const rows = metrics
    .filter((m) => m.metric_date <= weekEnding && isValid(m))
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1));
  return rows.slice(0, n);
}

function takeLastValidNights<T>(
  metrics: Metric[],
  weekEnding: string,
  getValue: (m: Metric) => T | null | undefined,
  n = 7,
): (T | null)[] {
  const rows = takeLastValidNightRows(metrics, weekEnding, n, (m) => getValue(m) != null);
  const vals = rows.map((m) => (getValue(m) as T));
  return vals.length === n ? vals : [];
}

function takeLastValidDays<T>(
  metrics: Metric[],
  weekEnding: string,
  getValue: (m: Metric) => T | null | undefined,
  n = 7,
): { dates: string[]; values: T[] } {
  const rows = metrics
    .filter((m) => m.metric_date <= weekEnding && getValue(m) != null)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, n);

  if (rows.length !== n) return { dates: [], values: [] };
  return { dates: rows.map((r) => r.metric_date), values: rows.map((r) => getValue(r) as T) };
}

function getBaselineMedian(
  metrics: Metric[],
  baselineStart: string,
  baselineEnd: string,
  getValue: (m: Metric) => number | null | undefined,
): { status: 'ok'; baseline: number } | { status: 'insufficient_baseline_data'; baseline: null } {
  const vals = metrics
    .filter((m) => m.metric_date >= baselineStart && m.metric_date <= baselineEnd)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .map(getValue)
    .filter((v): v is number => v != null);

  const mostRecent21 = vals.slice(0, 21);
  if (mostRecent21.length < 14) {
    return { status: 'insufficient_baseline_data', baseline: null };
  }
  return { status: 'ok', baseline: median(mostRecent21) ?? mostRecent21[Math.floor(mostRecent21.length / 2)] };
}

function classifyBodyBattery(
  startValsOldestToNewest: (number | null)[],
  additionalPrimaryFlag: boolean,
): WeeklyMetricResult {
  // Per docs screenshot: Body Battery uses morning Start values only.
  // Valid day: body_battery_start IS NOT NULL.
  // If we have too few days, treat as not enough data (do not penalize score).
  if (startValsOldestToNewest.length !== 7 || startValsOldestToNewest.some((v) => v == null)) {
    return { metric: "body_battery", color: "no_data", points: 0 };
  }

  const startVals = startValsOldestToNewest as number[]; // oldest -> newest for streak checks
  const inRange = (lo: number, hi: number) => (v: number) => v >= lo && v <= hi;
  const le = (x: number) => (v: number) => v <= x;
  const ge = (x: number) => (v: number) => v >= x;

  // RED
  if (
    maxConsecutive(startVals, le(25)) >= 3 ||
    (additionalPrimaryFlag && startVals.filter(le(35)).length >= 4)
  ) {
    return { metric: "body_battery", color: "red", points: POINTS.red };
  }

  // ORANGE
  if (
    maxConsecutive(startVals, inRange(26, 50)) >= 5 ||
    maxConsecutive(startVals, le(35)) >= 4
  ) {
    return { metric: "body_battery", color: "orange", points: POINTS.orange };
  }

  // YELLOW (docs excerpt: 26–50 for ≥3 days within 5 days)
  const lastWindow = startVals.slice(-5);
  if (lastWindow.filter(inRange(26, 50)).length >= 3) {
    return { metric: "body_battery", color: "yellow", points: POINTS.yellow };
  }

  // GREEN (docs excerpt: >51 most days)
  const greenDays = startVals.filter(ge(51)).length;
  const mostDaysThreshold = Math.ceil(startVals.length * 0.6);
  if (greenDays >= mostDaysThreshold) {
    return { metric: "body_battery", color: "green", points: POINTS.green };
  }

  // Default: Yellow if neither Green nor higher severity triggered.
  return { metric: "body_battery", color: "yellow", points: POINTS.yellow };
}

function classifyStress(
  stressVals: (number | null)[],
  additionalRecoveryFlag: boolean,
): WeeklyMetricResult {
  if (stressVals.length !== 7) return { metric: 'stress', color: 'no_data', points: 0 };
  if (stressVals.some((v) => v == null)) return { metric: 'stress', color: 'no_data', points: 0 };

  const isOrangeBand = (v: number | null) => v != null && v >= 51 && v <= 75;
  const isRed = (v: number | null) => v != null && v >= 76;

  const red = stressVals.filter(isRed).length >= 3 || (stressVals.filter(isRed).length >= 2 && additionalRecoveryFlag);
  if (red) return { metric: 'stress', color: 'red', points: POINTS.red };

  const orange = maxWindowCount(stressVals, 5, isOrangeBand) >= 4 || stressVals.filter(isRed).length >= 2;
  if (orange) return { metric: 'stress', color: 'orange', points: POINTS.orange };

  const yellow = maxWindowCount(stressVals, 5, isOrangeBand) >= 2;
  if (yellow) return { metric: 'stress', color: 'yellow', points: POINTS.yellow };

  return { metric: 'stress', color: 'green', points: POINTS.green };
}

function classifySleepDuration(hours: number[],): WeeklyMetricResult {
  if (hours.length !== 7) return { metric: 'sleep_duration', color: 'no_data', points: 0 };
  const lt = (x: number) => (v: number) => v < x;
  const between = (lo: number, hi: number) => (v: number) => v >= lo && v <= hi;
  const gte = (x: number) => (v: number) => v >= x;

  const red = hours.filter(lt(5.0)).length >= 3 || hours.filter(lt(6.0)).length >= 6;
  if (red) return { metric: 'sleep_duration', color: 'red', points: POINTS.red };

  const orange = hours.filter(lt(6.0)).length >= 3 || hours.filter(lt(5.5)).length >= 2;
  if (orange) return { metric: 'sleep_duration', color: 'orange', points: POINTS.orange };

  const yellow = hours.filter(between(6.0, 6.9)).length >= 4 || hours.filter(lt(6.0)).length >= 2;
  if (yellow) return { metric: 'sleep_duration', color: 'yellow', points: POINTS.yellow };

  const green = hours.filter(gte(7.0)).length >= 5;
  return { metric: 'sleep_duration', color: green ? 'green' : 'yellow', points: green ? POINTS.green : POINTS.yellow };
}

function classifySleepScore(
  scores: number[],
  additionalRecoveryFlag: boolean,
): WeeklyMetricResult {
  if (scores.length !== 7) return { metric: 'sleep_score', color: 'no_data', points: 0 };
  // Evaluate worst-first to avoid "green masking" when severe nights exist.
  const poor = scores.filter((s) => s < 60).length;
  const fair = scores.filter((s) => s >= 60 && s <= 79).length;
  const good = scores.filter((s) => s >= 80 && s <= 100).length;

  const red = poor >= 3 || (poor >= 2 && additionalRecoveryFlag);
  if (red) return { metric: 'sleep_score', color: 'red', points: POINTS.red };

  const orange = fair >= 6 || poor >= 2;
  if (orange) return { metric: 'sleep_score', color: 'orange', points: POINTS.orange };

  const yellow = fair >= 4;
  if (yellow) return { metric: 'sleep_score', color: 'yellow', points: POINTS.yellow };

  const green = good >= 5;
  return { metric: 'sleep_score', color: green ? 'green' : 'yellow', points: green ? POINTS.green : POINTS.yellow };
}

function classifyWASO(minutes: number[]): WeeklyMetricResult {
  if (minutes.length !== 7) return { metric: 'waso', color: 'no_data', points: 0 };
  const red = minutes.filter((m) => m > 60).length >= 3 || minutes.filter((m) => m > 90).length >= 2;
  if (red) return { metric: 'waso', color: 'red', points: POINTS.red };

  const orange = minutes.filter((m) => m > 60).length >= 2 || minutes.filter((m) => m >= 30 && m <= 60).length >= 5;
  if (orange) return { metric: 'waso', color: 'orange', points: POINTS.orange };

  const yellow = minutes.filter((m) => m >= 30 && m <= 60).length >= 3;
  if (yellow) return { metric: 'waso', color: 'yellow', points: POINTS.yellow };

  const green = minutes.filter((m) => m < 30).length >= 5;
  return { metric: 'waso', color: green ? 'green' : 'yellow', points: green ? POINTS.green : POINTS.yellow };
}

function classifyHRV(
  hrvVals: number[],
  additionalRecoveryFlag: boolean,
  baselineStatus: { status: 'ok'; baseline: number } | { status: 'insufficient_baseline_data'; baseline: null },
): WeeklyMetricResult {
  if (hrvVals.length !== 7) return { metric: 'hrv', color: 'no_data', points: 0 };
  if (baselineStatus.status !== 'ok') {
    return { metric: 'hrv', color: 'insufficient_baseline_data', points: 0 };
  }
  const baseline = baselineStatus.baseline;
  const pctBelow = hrvVals.map((v) => ((baseline - v) / baseline) * 100);
  const below10to15 = pctBelow.filter((p) => p >= 10 && p < 15).length;
  const below15to20 = pctBelow.filter((p) => p >= 15 && p <= 20).length; // 15–20% maps to Orange
  const below20plus = pctBelow.filter((p) => p > 20).length; // strictly >20% maps to Red
  const below15plus = pctBelow.filter((p) => p > 15).length; // strictly >15% for "with additional recovery flag"

  const red = below20plus >= 4 || (additionalRecoveryFlag && below15plus >= 5);
  if (red) return { metric: 'hrv', color: 'red', points: POINTS.red };

  const orange = below15to20 >= 4;
  if (orange) return { metric: 'hrv', color: 'orange', points: POINTS.orange };

  const yellow = below10to15 >= 3;
  if (yellow) return { metric: 'hrv', color: 'yellow', points: POINTS.yellow };

  const within10 = pctBelow.filter((p) => p < 10).length;
  const green = within10 >= 5; // within 10% on most nights
  return { metric: 'hrv', color: green ? 'green' : 'yellow', points: green ? POINTS.green : POINTS.yellow };
}

function classifyRHR(
  rhrVals: (number | null)[],
  baselineStatus: { status: 'ok'; baseline: number } | { status: 'insufficient_baseline_data'; baseline: null },
  additionalRecoveryFlag: boolean,
): WeeklyMetricResult {
  if (rhrVals.length !== 7) return { metric: 'rhr', color: 'no_data', points: 0 };
  if (rhrVals.some((v) => v == null)) return { metric: 'rhr', color: 'no_data', points: 0 };
  if (baselineStatus.status !== 'ok') {
    return { metric: 'rhr', color: 'insufficient_baseline_data', points: 0 };
  }
  const baseline = baselineStatus.baseline;
  const deltas = rhrVals.map((v) => (v == null ? null : v - baseline));
  const inBand = (lo: number, hi: number) => (d: number | null) => d != null && d >= lo && d <= hi;
  const ge = (x: number) => (d: number | null) => d != null && d >= x;

  const red = deltas.filter(ge(10)).length >= 3 || (deltas.filter(ge(7)).length >= 4 && additionalRecoveryFlag);
  if (red) return { metric: 'rhr', color: 'red', points: POINTS.red };

  const orange = deltas.filter(inBand(7, 9)).length >= 4;
  if (orange) return { metric: 'rhr', color: 'orange', points: POINTS.orange };

  const yellow = maxWindowCount(deltas, 5, inBand(4, 6)) >= 3;
  if (yellow) return { metric: 'rhr', color: 'yellow', points: POINTS.yellow };

  const green = deltas.filter(inBand(0, 3)).length >= 4;
  return { metric: 'rhr', color: green ? 'green' : 'yellow', points: green ? POINTS.green : POINTS.yellow };
}

function classifyHRVStability(
  hrvVals: number[],
  additionalRecoveryFlag: boolean,
): WeeklyMetricResult {
  if (hrvVals.length !== 7) return { metric: 'hrv_stability', color: 'no_data', points: 0 };
  const mean = hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length;
  if (mean <= 0) return { metric: 'hrv_stability', color: 'no_data', points: 0 };
  const variance = hrvVals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / hrvVals.length;
  const stdev = Math.sqrt(variance);
  const cv = (stdev / mean) * 100;

  const red = cv > 15 || (cv > 12 && additionalRecoveryFlag);
  if (red) return { metric: 'hrv_stability', color: 'red', points: POINTS.red, details: { cv } };

  const orange = cv > 12 && cv <= 15;
  if (orange) return { metric: 'hrv_stability', color: 'orange', points: POINTS.orange, details: { cv } };

  const yellow = cv >= 10 && cv <= 12;
  if (yellow) return { metric: 'hrv_stability', color: 'yellow', points: POINTS.yellow, details: { cv } };

  return { metric: 'hrv_stability', color: 'green', points: POINTS.green, details: { cv } };
}

function baseColorFromScore(score: number): WeeklyColor {
  if (score <= 4) return 'green';
  if (score <= 8) return 'yellow';
  if (score <= 13) return 'orange';
  return 'red';
}

function applyOverrides(
  baseColor: WeeklyColor,
  metricColors: Record<WeeklyMetricKey, WeeklyMetricResult['color']>,
): { finalColor: WeeklyColor; overrideApplied: WeeklyFlag['overrideApplied'] } {
  if (baseColor === 'red') return { finalColor: 'red', overrideApplied: 'none' };

  const isOrangeRed = (c: WeeklyMetricResult['color']) => c === 'orange' || c === 'red';
  const isRed = (c: WeeklyMetricResult['color']) => c === 'red';
  const primaries: WeeklyMetricKey[] = ['waso', 'stress', 'hrv_stability'];

  const totalOrangeRed = (Object.values(metricColors)).filter(isOrangeRed).length;
  const totalRed = (Object.values(metricColors)).filter(isRed).length;
  const primaryOrangeRed = primaries.map((k) => metricColors[k]).filter(isOrangeRed).length;
  const primaryRed = primaries.map((k) => metricColors[k]).filter(isRed).length;

  // Force RED
  if (
    primaryRed >= 2 ||
    (primaryRed >= 1 && totalOrangeRed >= 4) ||
    totalRed >= 5
  ) {
    return { finalColor: 'red', overrideApplied: 'force_red' };
  }

  // Force ORANGE
  if (
    primaryOrangeRed >= 2 ||
    (primaryRed >= 1 && (totalOrangeRed - 1) >= 2) ||
    totalOrangeRed >= 5
  ) {
    return { finalColor: baseColor === 'green' ? 'orange' : baseColor, overrideApplied: 'force_orange' };
  }

  return { finalColor: baseColor, overrideApplied: 'none' };
}

/**
 * Compute the 7-day weekly flag (per-metric colors + composite) from raw metrics.
 *
 * - Calendar days window (last 7 days ending `weekEnding`): Body Battery, Stress, RHR
 * - Sleep nights window (most recent 7 valid nights <= `weekEnding`): Sleep Duration, Sleep Score, WASO, HRV, HRV Stability
 * - HRV/RHR baseline: median of most recent 21 valid days in prior 28 days, excluding current week; "insufficient_baseline_data" if <14 valid days.
 */
export function computeWeeklyFlagFromMetrics(metrics: Metric[], weekEnding: string): WeeklyFlag {
  const sorted = [...metrics].sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1));

  // Calendar-day metrics: use the LAST 7 calendar dates ending `weekEnding`.
  // If any day is missing or null for a calendar metric, we mark that metric as no_data.
  const { dates: calDates, byDate } = asCalendarWindow(sorted, weekEnding);
  const bbStarts = calDates.map((d) => (byDate.get(d)?.body_battery_start ?? null));
  const stress7 = calDates.map((d) => (byDate.get(d)?.average_stress_level ?? null));
  const rhr7 = calDates.map((d) => (byDate.get(d)?.resting_heart_rate ?? null));

  const sleepDuration7 = takeLastValidNights(sorted, weekEnding, (m) => m.sleep_duration_seconds).map((s) => (s == null ? null : Number(s))) as number[];
  const sleepScore7 = takeLastValidNights(sorted, weekEnding, (m) => m.sleep_score).map((s) => (s == null ? null : Number(s))) as number[];
  const wasoMinutes7 = takeLastValidNights(sorted, weekEnding, (m) => (m.awake_seconds ?? null)).map((s) => (s == null ? null : Number(s) / 60)) as number[];
  const hrvRows = takeLastValidNightRows(sorted, weekEnding, 7, (m) => m.hrv_last_night_average != null);
  const hrv7 = hrvRows.length === 7 ? hrvRows.map((m) => Number(m.hrv_last_night_average)) : [];

  // Baselines should exclude the evaluation window. Use the oldest evaluation day/night as the anchor.
  const rhrEvalStart = addDaysYmd(weekEnding, -6);
  const hrvEvalStart = hrvRows.length === 7 ? hrvRows[hrvRows.length - 1].metric_date : addDaysYmd(weekEnding, -6);

  const rhrBaseline = getBaselineMedian(
    sorted,
    addDaysYmd(rhrEvalStart, -28),
    addDaysYmd(rhrEvalStart, -1),
    (m) => m.resting_heart_rate,
  );
  const hrvBaseline = getBaselineMedian(
    sorted,
    addDaysYmd(hrvEvalStart, -28),
    addDaysYmd(hrvEvalStart, -1),
    (m) => m.hrv_last_night_average,
  );

  // Primary metrics first (iterative so "additional recovery flag" clauses can look at other primaries)
  const wasoRes = classifyWASO(wasoMinutes7.length === 7 ? (wasoMinutes7 as unknown as number[]) : []);
  const prelimHrvStab = classifyHRVStability(hrv7.length === 7 ? (hrv7 as unknown as number[]) : [], false);

  const addForStress = wasoRes.color === 'orange' || wasoRes.color === 'red' || prelimHrvStab.color === 'orange' || prelimHrvStab.color === 'red';
  const stressRes = classifyStress(stress7 as unknown as (number | null)[], addForStress);

  const addForHrvStab = wasoRes.color === 'orange' || wasoRes.color === 'red' || stressRes.color === 'orange' || stressRes.color === 'red';
  const hrvStabRes = classifyHRVStability(hrv7.length === 7 ? (hrv7 as unknown as number[]) : [], addForHrvStab);

  const additionalPrimary = (wasoRes.color === 'orange' || wasoRes.color === 'red') ||
    (stressRes.color === 'orange' || stressRes.color === 'red') ||
    (hrvStabRes.color === 'orange' || hrvStabRes.color === 'red');

  const bodyBatteryRes = classifyBodyBattery(bbStarts, additionalPrimary);
  const sleepDurationHours = (sleepDuration7.length === 7 ? (sleepDuration7 as unknown as number[]) : []).map((s) => s / 3600);
  const sleepDurRes = classifySleepDuration(sleepDurationHours);
  const sleepScoreRes = classifySleepScore(sleepScore7.length === 7 ? (sleepScore7 as unknown as number[]) : [], additionalPrimary);
  const hrvRes = classifyHRV(hrv7.length === 7 ? (hrv7 as unknown as number[]) : [], additionalPrimary, hrvBaseline);
  const rhrRes = classifyRHR(rhr7 as unknown as (number | null)[], rhrBaseline, additionalPrimary);

  const metricsRes: Record<WeeklyMetricKey, WeeklyMetricResult> = {
    body_battery: bodyBatteryRes,
    stress: stressRes,
    sleep_duration: sleepDurRes,
    sleep_score: sleepScoreRes,
    waso: wasoRes,
    hrv: hrvRes,
    rhr: rhrRes,
    hrv_stability: hrvStabRes,
  };

  const weeklyScore = (Object.values(metricsRes)).reduce((sum, r) => sum + r.points, 0);
  const baseColor = baseColorFromScore(weeklyScore);
  const metricColors = Object.fromEntries(Object.entries(metricsRes).map(([k, v]) => [k, v.color])) as Record<WeeklyMetricKey, WeeklyMetricResult['color']>;
  const { finalColor, overrideApplied } = applyOverrides(baseColor, metricColors);

  return {
    weekEnding,
    weeklyScore,
    baseColor,
    finalColor,
    overrideApplied,
    metrics: metricsRes,
  };
}
