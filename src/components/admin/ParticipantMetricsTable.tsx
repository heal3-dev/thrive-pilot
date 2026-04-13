"use client";

import { useRef, useCallback, useEffect } from "react";
import type { WeeklyFlag, WeeklyMetricKey, WeeklyMetricResult } from "@/lib/flags/rules";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type ParticipantMetric = {
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

type ParticipantMetricsTableProps = {
  metrics: ParticipantMetric[];
  weeklyFlag?: WeeklyFlag | null;
  edgePadding?: "none" | "sm" | "md" | "lg";
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  className?: string;
};

function emojiForColor(color: WeeklyMetricResult["color"] | WeeklyFlag["finalColor"]): string {
  if (color === "green") return "🟢";
  if (color === "yellow") return "🟡";
  if (color === "orange") return "🟠";
  if (color === "red") return "🔴";
  // no_data / insufficient_baseline_data
  return "⚪";
}

function hrvCvPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return (stdev / mean) * 100;
}

const METRIC_LABEL: Record<WeeklyMetricKey, string> = {
  body_battery: "Body Battery",
  stress: "Stress",
  rhr: "RHR",
  sleep_duration: "Sleep Duration",
  sleep_score: "Sleep Score",
  waso: "WASO",
  hrv: "HRV",
  hrv_stability: "HRV Stability",
};

const METRIC_WINDOW: Record<WeeklyMetricKey, string> = {
  body_battery: "Last 7 calendar dates ending on week end (Body Battery Start/morning proxy).",
  stress: "Last 7 calendar dates ending on week end.",
  rhr: "Last 7 calendar dates ending on week end.",
  sleep_duration: "Most recent 7 valid sleep nights with duration data (not necessarily last 7 dates).",
  sleep_score: "Most recent 7 valid sleep nights with score data (not necessarily last 7 dates).",
  waso: "Most recent 7 valid sleep nights with WASO (awake minutes) data (not necessarily last 7 dates).",
  hrv: "Most recent 7 valid sleep nights with HRV data (not necessarily last 7 dates).",
  hrv_stability: "Most recent 7 valid sleep nights with HRV data (not necessarily last 7 dates).",
};

function statusLabel(color: WeeklyMetricResult["color"]): string {
  if (color === "green") return "Green";
  if (color === "yellow") return "Yellow";
  if (color === "orange") return "Orange";
  if (color === "red") return "Red";
  if (color === "insufficient_baseline_data") return "Insufficient baseline history";
  return "Not enough valid data";
}

function metricMeaning(metric: WeeklyMetricKey): string {
  switch (metric) {
    case "body_battery":
      return 'Uses Body Battery Start (morning) only. Display format: Start→Low→End (e.g., "81→40→75"). Second line shows net charged/drained (e.g., "+41 / -6").';
    case "stress":
      return "Uses average stress level.";
    case "rhr":
      return "Uses resting heart rate compared to personal baseline (median of most recent 10 valid days, excluding the evaluation window).";
    case "sleep_duration":
      return "Uses sleep duration (hours).";
    case "sleep_score":
      return "Uses Garmin sleep score.";
    case "waso":
      return "Uses WASO = awake_seconds / 60 (minutes).";
    case "hrv":
      return "Uses nightly average HRV compared to personal baseline (median of most recent 7 valid nights, minimum 5, excluding the evaluation window).";
    case "hrv_stability":
      return "Uses HRV stability = coefficient of variation (CV%) across 7 nights.";
  }
}

function metricThresholdHint(metric: WeeklyMetricKey): string {
  switch (metric) {
    case "stress":
      return "Quick ranges: 🟢 ≤50, 🟡/🟠 51–75, 🔴 ≥76 (7-day rules apply).";
    case "sleep_score":
      return "Quick ranges: 🟢 ≥80, 🟡/🟠 60–79, 🔴 <60 (7-night rules apply).";
    case "waso":
      return "Quick ranges: 🟢 <30m, 🟡 30–60m, 🟠/🔴 >60m (7-night rules apply).";
    case "hrv_stability":
      return "Quick ranges: 🟢 <10%, 🟡 10–12%, 🟠 12–15%, 🔴 >15% (7-night rules apply).";
    default:
      return "Uses 7-day/7-night rules per spec.";
  }
}

function tooltipForMetric(metric: WeeklyMetricKey, color: WeeklyMetricResult["color"]): string {
  const base = `${METRIC_LABEL[metric]} — weekly status: ${statusLabel(color)} ${emojiForColor(color)}.`;
  const window = METRIC_WINDOW[metric];
  const meaning = metricMeaning(metric);
  const hint = metricThresholdHint(metric);

  if (color === "insufficient_baseline_data") {
    const req =
      metric === "hrv"
        ? "Baseline required: ≥5 valid baseline nights before this week."
        : metric === "rhr"
        ? "Baseline required: ≥5 valid baseline days before this week."
        : "Baseline required: enough recent history.";
    return `${base} ${meaning} ${window} ${req}`;
  }
  if (color === "no_data") {
    return `${base} ${meaning} ${window} We need enough recent valid days/nights with data to compute this status.`;
  }
  return `${base} ${meaning} ${window} ${hint}`;
}

const COL_WIDTHS_PCT = [
  11, // Date
  15, // Body Battery
  10, // Stress
  8, // RHR
  14, // Sleep Duration
  12, // Sleep Score
  9, // WASO
  10, // HRV
  11, // HRV Stability
] as const;

export function ParticipantMetricsTable({
  metrics,
  weeklyFlag,
  edgePadding = "none",
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  emptyMessage = "No metrics found.",
  className,
}: ParticipantMetricsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const edgeStartPad =
    edgePadding === "lg"
      ? "pl-6"
      : edgePadding === "md"
      ? "pl-4"
      : edgePadding === "sm"
      ? "pl-3"
      : "pl-2";

  const edgeEndPad =
    edgePadding === "lg"
      ? "pr-6"
      : edgePadding === "md"
      ? "pr-4"
      : edgePadding === "sm"
      ? "pr-3"
      : "pr-2";

  // Precompute a rolling 7-night HRV CV for each row (best-effort; '-' if <7 nights).
  const hrvCvByRowIdx: (number | null)[] = metrics.map((_, idx) => {
    const vals: number[] = [];
    for (let j = idx; j < metrics.length && vals.length < 7; j++) {
      const v = metrics[j].hrv_last_night_average;
      if (v != null) vals.push(v);
    }
    if (vals.length < 7) return null;
    return hrvCvPercent(vals);
  });

  const headerIndicator = (metric: WeeklyMetricKey) => {
    const c = weeklyFlag?.metrics?.[metric]?.color;
    if (!c) return null;
    const tip = tooltipForMetric(metric, c);
    return (
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-1 cursor-help" aria-label={tip}>
              {emojiForColor(c)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {tip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasMore || isLoadingMore || !onLoadMore) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Trigger when within 100px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-slate-500">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="font-medium">Loading metrics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (metrics.length === 0) {
    return (
      <div className={className}>
        <div className="p-8 text-center text-slate-500">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        className="overflow-x-auto max-h-[70vh] overflow-y-auto"
      >
        <table className="w-full table-fixed text-sm text-left">
          <colgroup>
            {COL_WIDTHS_PCT.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead className="text-slate-500 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
            <tr>
              <th className={`py-2.5 pr-2 font-medium whitespace-nowrap ${edgeStartPad}`}>Date</th>
              <th className="px-2 py-2.5 pr-1 font-medium whitespace-nowrap">
                Body Battery {headerIndicator("body_battery")}
              </th>
              <th className="px-2 py-2.5 pl-1 font-medium whitespace-nowrap">
                Stress {headerIndicator("stress")}
              </th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                RHR {headerIndicator("rhr")}
              </th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                Sleep Duration {headerIndicator("sleep_duration")}
              </th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                Sleep Score {headerIndicator("sleep_score")}
              </th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                WASO {headerIndicator("waso")}
              </th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                HRV {headerIndicator("hrv")}
              </th>
              <th className={`py-2.5 pl-2 font-medium whitespace-nowrap ${edgeEndPad}`}>
                HRV Stability {headerIndicator("hrv_stability")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {metrics.map((m, idx) => (
              <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                <td className={`py-2.5 pr-2 text-slate-900 font-medium whitespace-nowrap ${edgeStartPad}`}>{m.metric_date}</td>
                <td className="px-2 py-2.5 pr-1 text-slate-600">
                  {m.body_battery_start != null || m.body_battery_lowest != null || m.body_battery_most_recent != null ? (
                    <div className="flex flex-col">
                      <span className="tabular-nums">
                        {(m.body_battery_start ?? "—")}
                        <span className="text-slate-400">→</span>
                        {(m.body_battery_lowest ?? "—")}
                        <span className="text-slate-400">→</span>
                        {(m.body_battery_most_recent ?? "—")}
                      </span>
                      {(m.body_battery_charged != null || m.body_battery_drained != null) && (
                        <span className="text-xs text-slate-400 tabular-nums">
                          (+{m.body_battery_charged ?? 0} / -{Math.abs(m.body_battery_drained ?? 0)})
                        </span>
                      )}
                    </div>
                  ) : m.body_battery_charged != null || m.body_battery_drained != null ? (
                    <span className="tabular-nums">
                      +{m.body_battery_charged ?? 0} / -{Math.abs(m.body_battery_drained ?? 0)}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-2.5 pl-1 text-slate-600 tabular-nums">
                  {m.average_stress_level != null && m.average_stress_level >= 0 ? m.average_stress_level : "-"}
                </td>
                <td className="px-2 py-2.5 text-slate-600 tabular-nums">{m.resting_heart_rate ?? "-"}</td>
                <td className="px-2 py-2.5 text-slate-600 tabular-nums">
                  {m.sleep_duration_seconds ? `${(m.sleep_duration_seconds / 3600).toFixed(1)}h` : "-"}
                </td>
                <td className="px-2 py-2.5 text-slate-600 tabular-nums">{m.sleep_score ?? "-"}</td>
                <td className="px-2 py-2.5 text-slate-600 tabular-nums">
                  {m.sleep_duration_seconds != null && m.awake_seconds != null
                    ? `${Math.round(m.awake_seconds / 60)}m`
                    : "-"}
                </td>
                <td className="px-2 py-2.5 text-slate-600 tabular-nums">
                  <div className="flex flex-col">
                    <span>{m.hrv_last_night_average != null ? m.hrv_last_night_average : "-"}</span>
                    {m.hrv_last_night_5_min_high != null && (
                      <span className="text-xs text-slate-400">peak {m.hrv_last_night_5_min_high}</span>
                    )}
                  </div>
                </td>
              <td className={`py-2.5 pl-2 text-slate-600 tabular-nums ${edgeEndPad}`}>
                  {hrvCvByRowIdx[idx] != null ? `${hrvCvByRowIdx[idx]!.toFixed(1)}%` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Loading more indicator */}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-4 border-t border-slate-100">
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading more...
            </div>
          </div>
        )}

        {/* All loaded indicator */}
        {!hasMore && metrics.length > 0 && !isLoadingMore && (
          <div className="flex items-center justify-center py-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">All {metrics.length} entries loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}
