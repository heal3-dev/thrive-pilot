/**
 * Demo Data for Flagging Rules Showcase
 *
 * Hardcoded dummy participants with 33 days of metrics each,
 * crafted to trigger specific flag scenarios.  Used in demo mode
 * to prove the flagging rules work without touching the database.
 */

import { type Metric, computeWeeklyFlagFromMetrics, type WeeklyFlag } from '@/lib/flags/rules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoParticipant {
  id: string;
  name: string;
  email: string;
  garmin_user_id: string;
  garmin_connected_at: string;
  is_connected: boolean;
  garmin_connected: boolean;
  is_active: boolean;
  phone_number: string;
  weekly_flag: WeeklyFlag | null;
  metrics: Metric[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function makeMetric(
  daysBack: number,
  overrides: Partial<Omit<Metric, 'id' | 'metric_date'>>,
): Metric {
  const derivedMostRecent =
    overrides.body_battery_most_recent !== undefined
      ? overrides.body_battery_most_recent
      : null;

  return {
    id: `demo-metric-${daysBack}-${Math.random().toString(36).slice(2, 8)}`,
    metric_date: daysAgo(daysBack),
    resting_heart_rate: null,
    average_stress_level: null,
    sleep_duration_seconds: null,
    sleep_score: null,
    awake_seconds: null,
    body_battery_charged: null,
    body_battery_drained: null,
    body_battery_start: derivedMostRecent,
    body_battery_lowest: derivedMostRecent,
    body_battery_most_recent: null,
    hrv_last_night_average: null,
    hrv_last_night_5_min_high: null,
    ...overrides,
  };
}

/** Generate 33 days of "normal" baseline data with customizable defaults. */
function generateBaseline(defaults: Partial<Omit<Metric, 'id' | 'metric_date'>>): Metric[] {
  const withWASO = { awake_seconds: 1200, ...defaults }; // default 20 min awake (good WASO)
  return Array.from({ length: 33 }, (_, i) => makeMetric(i, withWASO));
}

// ---------------------------------------------------------------------------
// Scenario Generators
// ---------------------------------------------------------------------------

/** Alex M. — LOW_HRV: baseline HRV ~45ms, last 3 days drop to 34ms (24% below) */
function alexMetrics(): Metric[] {
  const metrics = generateBaseline({
    hrv_last_night_average: 45,
    hrv_last_night_5_min_high: 68,
    resting_heart_rate: 60,
    average_stress_level: 35,
    sleep_duration_seconds: 27000, // 7.5h
    sleep_score: 80,
    body_battery_most_recent: 55,
    body_battery_charged: 45,
    body_battery_drained: -30,
  });
  // Override recent 3 days with low HRV
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      hrv_last_night_average: 34,
      hrv_last_night_5_min_high: 48,
      resting_heart_rate: 62,
      average_stress_level: 42,
      sleep_duration_seconds: 25200,
      sleep_score: 72,
      body_battery_most_recent: 40,
      body_battery_charged: 35,
      body_battery_drained: -28,
    });
  }
  return metrics;
}

/** Jordan K. — HIGH_RHR: baseline RHR ~62bpm, last 3 days spike to 75bpm (21% above) */
function jordanMetrics(): Metric[] {
  const metrics = generateBaseline({
    resting_heart_rate: 62,
    hrv_last_night_average: 42,
    hrv_last_night_5_min_high: 65,
    average_stress_level: 38,
    sleep_duration_seconds: 26400, // 7.3h
    sleep_score: 78,
    body_battery_most_recent: 50,
    body_battery_charged: 40,
    body_battery_drained: -32,
  });
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      resting_heart_rate: 75,
      hrv_last_night_average: 38,
      hrv_last_night_5_min_high: 55,
      average_stress_level: 52,
      sleep_duration_seconds: 23400, // 6.5h
      sleep_score: 65,
      body_battery_most_recent: 35,
      body_battery_charged: 30,
      body_battery_drained: -38,
    });
  }
  return metrics;
}

/** Sam R. — LOW_SLEEP: last 3 days all under 5 hours */
function samMetrics(): Metric[] {
  const metrics = generateBaseline({
    sleep_duration_seconds: 27000, // 7.5h
    sleep_score: 82,
    resting_heart_rate: 58,
    hrv_last_night_average: 48,
    hrv_last_night_5_min_high: 72,
    average_stress_level: 30,
    body_battery_most_recent: 60,
    body_battery_charged: 50,
    body_battery_drained: -25,
  });
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      sleep_duration_seconds: 16200 + i * 600, // 4.5h, 4.7h, 4.8h
      sleep_score: 38 + i * 3,
      resting_heart_rate: 63,
      hrv_last_night_average: 40,
      hrv_last_night_5_min_high: 58,
      average_stress_level: 48,
      body_battery_most_recent: 30,
      body_battery_charged: 25,
      body_battery_drained: -35,
    });
  }
  return metrics;
}

/** Chris P. — LOW_SLEEP_SCORE + HIGH_STRESS (compound): sleep score drops 25%+ AND stress >= 76 for 3 days */
function chrisMetrics(): Metric[] {
  const metrics = generateBaseline({
    sleep_score: 82,
    sleep_duration_seconds: 25200, // 7h
    average_stress_level: 40,
    resting_heart_rate: 64,
    hrv_last_night_average: 40,
    hrv_last_night_5_min_high: 62,
    body_battery_most_recent: 45,
    body_battery_charged: 38,
    body_battery_drained: -30,
  });
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      sleep_score: 55 + i * 2, // 55, 57, 59 — well below 80% of 82 (65.6)
      sleep_duration_seconds: 21600, // 6h — not low enough for LOW_SLEEP absolute
      average_stress_level: 78 + i, // 78, 79, 80 — all >= 76
      resting_heart_rate: 68,
      hrv_last_night_average: 35,
      hrv_last_night_5_min_high: 52,
      body_battery_most_recent: 28,
      body_battery_charged: 22,
      body_battery_drained: -42,
    });
  }
  return metrics;
}

/** Morgan T. — LOW_BODY_BATTERY: body battery below 25 for 3 consecutive days */
function morganMetrics(): Metric[] {
  const metrics = generateBaseline({
    body_battery_most_recent: 55,
    body_battery_charged: 45,
    body_battery_drained: -28,
    resting_heart_rate: 66,
    hrv_last_night_average: 38,
    hrv_last_night_5_min_high: 58,
    average_stress_level: 45,
    sleep_duration_seconds: 24000, // 6.7h
    sleep_score: 70,
  });
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      body_battery_most_recent: 18 + i * 2, // 18, 20, 22 — all < 25
      body_battery_charged: 15,
      body_battery_drained: -48,
      resting_heart_rate: 70,
      hrv_last_night_average: 34,
      hrv_last_night_5_min_high: 50,
      average_stress_level: 58,
      sleep_duration_seconds: 21000, // 5.8h
      sleep_score: 58,
    });
  }
  return metrics;
}

/** Riley D. — HIGH_STRESS only: stress >= 76 for 3 consecutive days, everything else normal */
function rileyMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 35,
    resting_heart_rate: 60,
    hrv_last_night_average: 46,
    hrv_last_night_5_min_high: 70,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 85,
    body_battery_most_recent: 65,
    body_battery_charged: 55,
    body_battery_drained: -22,
  });
  for (let i = 0; i < 3; i++) {
    metrics[i] = makeMetric(i, {
      average_stress_level: 78 + i * 2, // 78, 80, 82 — all >= 76
      resting_heart_rate: 61,
      hrv_last_night_average: 44,
      hrv_last_night_5_min_high: 67,
      sleep_duration_seconds: 27000,
      sleep_score: 80,
      body_battery_most_recent: 50,
      body_battery_charged: 42,
      body_battery_drained: -35,
    });
  }
  return metrics;
}

/** Casey S. — MISSING_STRESS_DAY: one calendar day stress is null → Stress returns no_data (⚪, 0 pts) */
function caseyMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 35,
    resting_heart_rate: 60,
    hrv_last_night_average: 46,
    hrv_last_night_5_min_high: 70,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 85,
    body_battery_most_recent: 65,
    body_battery_charged: 55,
    body_battery_drained: -22,
  });

  // Make stress missing on one of the last 7 calendar dates (but keep other fields present).
  metrics[3] = { ...metrics[3], average_stress_level: null };

  return metrics;
}

/** Blair B. — INSUFFICIENT_HRV_BASELINE: HRV has 7 valid nights but baseline <14 days → insufficient_baseline_data (⚪, 0 pts) */
function blairMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 28,
    resting_heart_rate: 58,
    hrv_last_night_average: null, // we'll set selectively
    hrv_last_night_5_min_high: 75,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 88,
    body_battery_most_recent: 70,
    body_battery_charged: 60,
    body_battery_drained: -20,
  });

  // Ensure last 7 nights have HRV values so HRV/HRV Stability can be evaluated.
  for (let i = 0; i < 7; i++) {
    metrics[i] = { ...metrics[i], hrv_last_night_average: 45, hrv_last_night_5_min_high: 68 };
  }

  // Baseline window for HRV is (evalStart-28 ... evalStart-1), where evalStart is oldest of the 7 eval nights.
  // With weekEnding=today, evalStart ~ 6 days ago, so baseline is daysBack 7..34.
  // Keep <14 baseline HRV days by nulling most of that window.
  for (let i = 7; i <= 34; i++) {
    const keep = i === 7 || i === 9 || i === 11 || i === 13 || i === 15 || i === 17 || i === 19 || i === 21 || i === 23 || i === 25; // 10 days
    metrics[i] = {
      ...metrics[i],
      hrv_last_night_average: keep ? 46 : null,
      hrv_last_night_5_min_high: keep ? 70 : null,
    };
  }

  return metrics;
}

/** Renee O. — OVERRIDE_RED: ≥2 primary metrics are red (Stress + WASO) → force weekly 🔴 */
function reneeMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 35,
    resting_heart_rate: 60,
    hrv_last_night_average: 48,
    hrv_last_night_5_min_high: 72,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 88,
    awake_seconds: 900, // 15 min
    body_battery_most_recent: 70,
  });

  // Stress 🔴: ≥76 for ≥3 days
  for (let i = 0; i < 3; i++) {
    metrics[i] = { ...metrics[i], average_stress_level: 80 };
  }

  // WASO 🔴: >90 min for ≥2 nights
  metrics[1] = { ...metrics[1], awake_seconds: 6000 }; // 100 min
  metrics[4] = { ...metrics[4], awake_seconds: 7200 }; // 120 min

  return metrics;
}

/** Sid G. — SLEEP_SCORE_GATED_ORANGE: 2 poor nights (<60) but no additional recovery flag → Sleep Score 🟠 */
function sidMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 35, // keep primaries green
    resting_heart_rate: 60,
    hrv_last_night_average: 48,
    hrv_last_night_5_min_high: 72,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 88,
    awake_seconds: 900, // 15 min
    body_battery_most_recent: 70,
  });

  // 2 nights <60
  metrics[0] = { ...metrics[0], sleep_score: 55 };
  metrics[3] = { ...metrics[3], sleep_score: 58 };
  return metrics;
}

/** Sasha G. — SLEEP_SCORE_GATED_RED: same as Sid but with Stress 🟠/🔴 present → Sleep Score 🔴 */
function sashaMetrics(): Metric[] {
  const metrics = sidMetrics();
  // Make Stress 🟠: 51–75 for ≥4 days within 5 days
  for (let i = 0; i < 5; i++) {
    metrics[i] = {
      ...metrics[i],
      average_stress_level: i === 0 ? 60 : i === 1 ? 62 : i === 2 ? 64 : i === 3 ? 66 : 68,
    };
  }
  return metrics;
}

/** Hari V. — HRV_20PCT_ORANGE: baseline 50, 4 nights at 40 (exactly 20% below) → HRV 🟠 (not 🔴) */
function hariMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 30,
    resting_heart_rate: 58,
    hrv_last_night_average: 50, // baseline ~50
    hrv_last_night_5_min_high: 75,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 88,
    awake_seconds: 900,
    body_battery_most_recent: 70,
  });

  // 4 of last 7 nights exactly 20% below (50 → 40)
  for (const i of [0, 1, 2, 3]) {
    metrics[i] = { ...metrics[i], hrv_last_night_average: 40, hrv_last_night_5_min_high: 60 };
  }
  return metrics;
}

/** Dana S. — SLEEP_DURATION_RED: <6h for 6 of 7 nights → Sleep Duration 🔴 */
function danaMetrics(): Metric[] {
  const metrics = generateBaseline({
    average_stress_level: 30,
    resting_heart_rate: 58,
    hrv_last_night_average: 50,
    hrv_last_night_5_min_high: 75,
    sleep_duration_seconds: 28800, // default 8h
    sleep_score: 88,
    awake_seconds: 900,
    body_battery_most_recent: 70,
  });

  // 6 nights under 6h (e.g., 5.8h)
  for (let i = 0; i < 6; i++) {
    metrics[i] = { ...metrics[i], sleep_duration_seconds: 5.8 * 3600 };
  }
  return metrics;
}

/** Taylor W. — HEALTHY: stable metrics within normal range, no flags */
function taylorMetrics(): Metric[] {
  return generateBaseline({
    resting_heart_rate: 58,
    hrv_last_night_average: 50,
    hrv_last_night_5_min_high: 75,
    average_stress_level: 28,
    sleep_duration_seconds: 28800, // 8h
    sleep_score: 88,
    body_battery_most_recent: 70,
    body_battery_charged: 60,
    body_battery_drained: -20,
  });
}

// ---------------------------------------------------------------------------
// Metric generators keyed by participant ID
// ---------------------------------------------------------------------------

const METRIC_GENERATORS: Record<string, () => Metric[]> = {
  'demo-alex': alexMetrics,
  'demo-jordan': jordanMetrics,
  'demo-sam': samMetrics,
  'demo-chris': chrisMetrics,
  'demo-morgan': morganMetrics,
  'demo-riley': rileyMetrics,
  'demo-casey': caseyMetrics,
  'demo-blair': blairMetrics,
  'demo-renee': reneeMetrics,
  'demo-sid': sidMetrics,
  'demo-sasha': sashaMetrics,
  'demo-hari': hariMetrics,
  'demo-dana': danaMetrics,
  'demo-taylor': taylorMetrics,
};

export function getDemoMetrics(participantId: string): Metric[] {
  const generator = METRIC_GENERATORS[participantId];
  return generator ? generator() : [];
}

export function getDemoWeeklyFlag(participantId: string): WeeklyFlag | null {
  const metrics = getDemoMetrics(participantId);
  if (!metrics.length) return null;
  const weekEnding = new Date().toISOString().slice(0, 10);
  return computeWeeklyFlagFromMetrics(metrics, weekEnding);
}

// ---------------------------------------------------------------------------
// Demo Participants
// ---------------------------------------------------------------------------

function buildDemoParticipants(): DemoParticipant[] {
  const raw: { id: string; name: string; email: string; phone: string }[] = [
    { id: 'demo-alex', name: 'Alex M.', email: 'alex.m@heal-3.com', phone: '+1 (403) 555-0101' },
    { id: 'demo-jordan', name: 'Jordan K.', email: 'jordan.k@heal-3.com', phone: '+1 (403) 555-0102' },
    { id: 'demo-sam', name: 'Sam R.', email: 'sam.r@heal-3.com', phone: '+1 (403) 555-0103' },
    { id: 'demo-chris', name: 'Chris P.', email: 'chris.p@heal-3.com', phone: '+1 (403) 555-0104' },
    { id: 'demo-morgan', name: 'Morgan T.', email: 'morgan.t@heal-3.com', phone: '+1 (403) 555-0105' },
    { id: 'demo-riley', name: 'Riley D.', email: 'riley.d@heal-3.com', phone: '+1 (403) 555-0106' },
    { id: 'demo-casey', name: 'Casey S. (Missing Stress Day)', email: 'casey.s@heal-3.com', phone: '+1 (403) 555-0108' },
    { id: 'demo-blair', name: 'Blair B. (HRV Baseline Building)', email: 'blair.b@heal-3.com', phone: '+1 (403) 555-0109' },
    { id: 'demo-renee', name: 'Renee O. (Override → RED)', email: 'renee.o@heal-3.com', phone: '+1 (403) 555-0110' },
    { id: 'demo-sid', name: 'Sid G. (Sleep Score gated 🟠)', email: 'sid.g@heal-3.com', phone: '+1 (403) 555-0111' },
    { id: 'demo-sasha', name: 'Sasha G. (Sleep Score gated 🔴)', email: 'sasha.g@heal-3.com', phone: '+1 (403) 555-0112' },
    { id: 'demo-hari', name: 'Hari V. (HRV 20% → 🟠)', email: 'hari.v@heal-3.com', phone: '+1 (403) 555-0113' },
    { id: 'demo-dana', name: 'Dana S. (Sleep Duration 🔴)', email: 'dana.s@heal-3.com', phone: '+1 (403) 555-0114' },
    { id: 'demo-taylor', name: 'Taylor W.', email: 'taylor.w@heal-3.com', phone: '+1 (403) 555-0107' },
  ];

  return raw.map((p) => {
    const metrics = getDemoMetrics(p.id);
    const weekEnding = new Date().toISOString().slice(0, 10);
    const weekly_flag = metrics.length ? computeWeeklyFlagFromMetrics(metrics, weekEnding) : null;
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      phone_number: p.phone,
      garmin_user_id: `demo-garmin-${p.id}`,
      garmin_connected_at: daysAgo(45),
      is_connected: true,
      garmin_connected: true,
      is_active: true,
      weekly_flag,
      metrics,
    };
  });
}

export const DEMO_PARTICIPANTS = buildDemoParticipants();

export function getDemoParticipant(id: string): DemoParticipant | undefined {
  return DEMO_PARTICIPANTS.find((p) => p.id === id);
}
