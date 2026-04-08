import type { WeeklyFlag, WeeklyMetricKey, WeeklyMetricResult } from "@/lib/flags/rules";

function emojiForColor(color: WeeklyMetricResult["color"] | WeeklyFlag["finalColor"]): string {
  if (color === "green") return "🟢";
  if (color === "yellow") return "🟡";
  if (color === "orange") return "🟠";
  if (color === "red") return "🔴";
  return "⚪";
}

function labelForMetric(metric: WeeklyMetricKey): string {
  switch (metric) {
    case "body_battery":
      return "Body Battery";
    case "stress":
      return "Stress";
    case "rhr":
      return "RHR";
    case "sleep_duration":
      return "Sleep Duration";
    case "sleep_score":
      return "Sleep Score";
    case "waso":
      return "WASO";
    case "hrv":
      return "HRV";
    case "hrv_stability":
      return "HRV Stability";
  }
}

function colorLabel(color: WeeklyMetricResult["color"]): string {
  if (color === "green") return "Green";
  if (color === "yellow") return "Yellow";
  if (color === "orange") return "Orange";
  if (color === "red") return "Red";
  if (color === "insufficient_baseline_data") return "Insufficient baseline history";
  return "Not enough valid data";
}

function metricOrder(): WeeklyMetricKey[] {
  return [
    "body_battery",
    "stress",
    "rhr",
    "sleep_duration",
    "sleep_score",
    "waso",
    "hrv",
    "hrv_stability",
  ];
}

export function weeklyCompositeTooltip(wf: WeeklyFlag): string {
  const lines: string[] = [];

  const metricValues = Object.values(wf.metrics);
  const available = metricValues.filter(
    (r) => r.color === "green" || r.color === "yellow" || r.color === "orange" || r.color === "red"
  );
  const earnedPoints = available.reduce((sum, r) => sum + r.points, 0);
  const maxPossiblePoints = available.length * 3;

  lines.push(
    `Weekly composite: final ${wf.finalColor.toUpperCase()} ${emojiForColor(wf.finalColor)} (base ${wf.baseColor.toUpperCase()}, override ${wf.overrideApplied}).`
  );
  lines.push(
    `Score: ${wf.weeklyScore}/24 (normalized by available metrics: earned ${earnedPoints}/${maxPossiblePoints || 0} from ${available.length}/8 metrics).`
  );
  lines.push(`Points: 🟢=0, 🟡=1, 🟠=2, 🔴=3; ⚪ metrics are excluded from normalization.`);
  lines.push(`Base thresholds: 0–4 🟢, 5–8 🟡, 9–13 🟠, 14+ 🔴.`);
  lines.push(
    `Windows: calendar-day metrics use the last 7 calendar dates; sleep-based metrics use the most recent 7 valid nights (not necessarily last 7 dates).`
  );
  lines.push(
    `Baselines: HRV uses median of most recent 7 valid nights (min 5), excluding evaluation window; RHR uses median of most recent 10 valid days (min 5), excluding evaluation window. Missing baseline → ⚪.`
  );
  lines.push(
    `Overrides (primary metrics = WASO, Stress, HRV Stability):`
  );
  lines.push(
    `- Force 🔴 if: (1) ≥2 primary 🔴, OR (2) 1 primary 🔴 + ≥4 total 🟠/🔴, OR (3) ≥5 total 🔴.`
  );
  lines.push(
    `- Force 🟠 if: (1) ≥2 primary 🟠/🔴, OR (2) 1 primary 🔴 + ≥2 additional 🟠/🔴, OR (3) ≥5 total 🟠/🔴.`
  );

  lines.push(``);
  lines.push(`Metric breakdown:`);

  for (const k of metricOrder()) {
    const m = wf.metrics[k];
    lines.push(
      `- ${labelForMetric(k)}: ${colorLabel(m.color)} ${emojiForColor(m.color)} (${m.points} pts)`
    );
  }

  return lines.join("\n");
}

