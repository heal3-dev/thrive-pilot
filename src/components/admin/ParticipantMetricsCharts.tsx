"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import type { Metric, WeeklyFlag, WeeklyMetricKey } from "@/lib/flags/rules";

type RangeDays = 7 | 14 | 30;
type ViewMetricKey = WeeklyMetricKey;

type Props = {
  metrics: Metric[];
  weeklyFlag?: WeeklyFlag | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

type Point = { date: string; value: number | null };

const METRIC_LABEL: Record<ViewMetricKey, string> = {
  body_battery: "Body Battery",
  stress: "Stress",
  rhr: "RHR",
  sleep_duration: "Sleep Duration",
  sleep_score: "Sleep Score",
  waso: "WASO",
  hrv: "HRV",
  hrv_stability: "HRV Stability",
};

function ymdToDate(ymd: string): Date {
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

function hrvCvPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return (stdev / mean) * 100;
}

function formatValue(metric: ViewMetricKey, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (metric === "sleep_duration") return `${v.toFixed(1)}h`;
  if (metric === "waso") return `${Math.round(v)}m`;
  if (metric === "hrv_stability") return `${v.toFixed(1)}%`;
  return `${Math.round(v)}`;
}

function resolveValueForMetric(metric: ViewMetricKey, row: Metric, allMetricsDesc: Metric[]): number | null {
  switch (metric) {
    case "body_battery":
      return row.body_battery_start ?? null;
    case "stress":
      return row.average_stress_level ?? null;
    case "rhr":
      return row.resting_heart_rate ?? null;
    case "sleep_duration":
      return row.sleep_duration_seconds != null ? row.sleep_duration_seconds / 3600 : null;
    case "sleep_score":
      return row.sleep_score ?? null;
    case "waso":
      return row.awake_seconds != null ? row.awake_seconds / 60 : null;
    case "hrv":
      return row.hrv_last_night_average ?? null;
    case "hrv_stability": {
      // Best-effort: CV% across the most recent 7 valid HRV nights at/older than this row's date.
      const vals: number[] = [];
      for (const m of allMetricsDesc) {
        if (m.metric_date > row.metric_date) continue;
        if (m.hrv_last_night_average != null) vals.push(m.hrv_last_night_average);
        if (vals.length >= 7) break;
      }
      if (vals.length < 7) return null;
      return hrvCvPercent(vals);
    }
  }
}

function bestLatestDate(metrics: Metric[]): string | null {
  let best: string | null = null;
  for (const m of metrics) {
    if (!m.metric_date) continue;
    if (best == null || m.metric_date > best) best = m.metric_date;
  }
  return best;
}

function buildWindow(
  metricsByDate: Map<string, Metric>,
  allMetricsDesc: Metric[],
  metric: ViewMetricKey,
  latestDate: string,
  rangeDays: RangeDays,
): Point[] {
  const points: Point[] = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const date = addDaysYmd(latestDate, -i);
    const row = metricsByDate.get(date);
    const value = row ? resolveValueForMetric(metric, row, allMetricsDesc) : null;
    points.push({ date, value });
  }
  return points;
}

export function ParticipantMetricsCharts({ metrics, weeklyFlag, hasMore, isLoadingMore, onLoadMore }: Props) {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [metricKey, setMetricKey] = useState<ViewMetricKey>("body_battery");

  const metricsDesc = useMemo(() => {
    return [...metrics].sort((a, b) => (a.metric_date < b.metric_date ? 1 : a.metric_date > b.metric_date ? -1 : 0));
  }, [metrics]);

  const metricsByDate = useMemo(() => {
    const m = new Map<string, Metric>();
    for (const row of metrics) {
      if (row.metric_date && !m.has(row.metric_date)) m.set(row.metric_date, row);
    }
    return m;
  }, [metrics]);

  const latestDate = useMemo(() => bestLatestDate(metrics) ?? null, [metrics]);

  const earliestNeededDate = useMemo(() => {
    if (!latestDate) return null;
    return addDaysYmd(latestDate, -(rangeDays - 1));
  }, [latestDate, rangeDays]);

  const oldestLoadedDate = useMemo(() => {
    let oldest: string | null = null;
    for (const row of metrics) {
      if (!row.metric_date) continue;
      if (oldest == null || row.metric_date < oldest) oldest = row.metric_date;
    }
    return oldest;
  }, [metrics]);

  // Best-effort: auto-fetch more rows when chart range needs older data.
  useEffect(() => {
    if (!latestDate || !earliestNeededDate) return;
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    if (!oldestLoadedDate) return;
    if (oldestLoadedDate > earliestNeededDate) onLoadMore();
  }, [earliestNeededDate, hasMore, isLoadingMore, latestDate, oldestLoadedDate, onLoadMore]);

  const points = useMemo(() => {
    if (!latestDate) return [];
    return buildWindow(metricsByDate, metricsDesc, metricKey, latestDate, rangeDays);
  }, [latestDate, metricsByDate, metricsDesc, metricKey, rangeDays]);

  const hasAnyValue = useMemo(() => points.some((p) => p.value != null), [points]);

  const metricPills: ViewMetricKey[] = useMemo(
    () => ["body_battery", "stress", "rhr", "sleep_duration", "sleep_score", "waso", "hrv", "hrv_stability"],
    [],
  );

  const statusEmoji = (k: WeeklyMetricKey): string | null => {
    const c = weeklyFlag?.metrics?.[k]?.color;
    if (!c) return null;
    if (c === "green") return "🟢";
    if (c === "yellow") return "🟡";
    if (c === "orange") return "🟠";
    if (c === "red") return "🔴";
    return "⚪";
  };

  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Range</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([7, 14, 30] as const).map((d) => {
              const active = rangeDays === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRangeDays(d)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                    active ? "bg-slate-200 text-slate-900 shadow-inner" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {d}D
                </button>
              );
            })}
          </div>
        </div>

        {isLoadingMore ? (
          <div className="text-xs font-semibold text-slate-500">Loading more history…</div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">Metric</span>
        <div className="flex-1 overflow-x-auto">
          <div className="inline-flex gap-2 pr-1">
            {metricPills.map((k) => {
              const active = metricKey === k;
              const emoji = statusEmoji(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMetricKey(k)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                    active
                      ? "bg-slate-200 border-slate-300 text-slate-900 shadow-inner"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {METRIC_LABEL[k]}
                  {emoji ? <span className="text-xs">{emoji}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!latestDate ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          No metrics available yet.
        </div>
      ) : !hasAnyValue ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          No data for this metric in the last {rangeDays} days.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.10)",
                  }}
                  formatter={(value: unknown) => {
                    const v = typeof value === "number" ? value : null;
                    return [formatValue(metricKey, v), METRIC_LABEL[metricKey]];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  fill="rgba(20, 184, 166, 0.18)"
                  connectNulls={false}
                  isAnimationActive={true}
                  animationDuration={650}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Showing {rangeDays} days ending {latestDate}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onLoadMore?.()}
              disabled={!hasMore || isLoadingMore}
            >
              Load more
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

