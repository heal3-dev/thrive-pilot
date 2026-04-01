"use client";

import { useRef, useCallback, useEffect } from "react";

type ParticipantMetric = {
  id: string;
  metric_date: string;
  resting_heart_rate: number | null;
  average_stress_level: number | null;
  sleep_duration_seconds: number | null;
  sleep_score: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_most_recent: number | null;
  body_battery_start: number | null;
  body_battery_lowest: number | null;
  hrv_last_night_average: number | null;
  hrv_last_night_5_min_high: number | null;
};

type ParticipantMetricsTableProps = {
  metrics: ParticipantMetric[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  className?: string;
};

export function ParticipantMetricsTable({
  metrics,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  emptyMessage = "No metrics found.",
  className,
}: ParticipantMetricsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <div ref={scrollRef} className="overflow-x-auto max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm text-left min-w-[700px]">
          <thead className="text-slate-500 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Sleep</th>
              <th className="px-5 py-3 font-medium">Stress</th>
              <th className="px-5 py-3 font-medium">HRV</th>
              <th className="px-5 py-3 font-medium">RHR</th>
              <th className="px-5 py-3 font-medium">Body Battery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {metrics.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 text-slate-900 font-medium">{m.metric_date}</td>
                <td className="px-5 py-3 text-slate-600">
                  {m.sleep_duration_seconds ? `${(m.sleep_duration_seconds / 3600).toFixed(1)}h` : "-"}
                  {m.sleep_score != null && <span className="ml-1 text-xs text-slate-400">({m.sleep_score})</span>}
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {m.average_stress_level != null && m.average_stress_level >= 0 ? m.average_stress_level : "-"}
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {m.hrv_last_night_average != null ? m.hrv_last_night_average : "-"}
                  {m.hrv_last_night_5_min_high != null && (
                    <span className="ml-1 text-xs text-slate-400">(peak {m.hrv_last_night_5_min_high})</span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-600">{m.resting_heart_rate ?? "-"}</td>
                <td className="px-5 py-3 text-slate-600">
                  {m.body_battery_most_recent != null ||
                  m.body_battery_start != null ||
                  m.body_battery_lowest != null ? (
                    <>
                      <span className="font-medium text-slate-800">
                        {m.body_battery_start ?? "—"}
                      </span>
                      <span className="text-xs text-slate-400"> / </span>
                      <span className="font-medium text-slate-800">
                        {m.body_battery_lowest ?? "—"}
                      </span>
                      <span className="text-xs text-slate-400"> / </span>
                      <span className="font-medium text-slate-800">
                        {m.body_battery_most_recent ?? "—"}
                      </span>
                      {(m.body_battery_charged != null || m.body_battery_drained != null) && (
                        <span className="ml-1 text-xs text-slate-400">
                          (+{m.body_battery_charged ?? 0} / -{m.body_battery_drained ?? 0})
                        </span>
                      )}
                    </>
                  ) : m.body_battery_charged != null || m.body_battery_drained != null ? (
                    `+${m.body_battery_charged ?? 0} / -${m.body_battery_drained ?? 0}`
                  ) : "-"}
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
