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
