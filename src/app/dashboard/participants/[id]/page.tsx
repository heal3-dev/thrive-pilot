
"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useDashboard } from "@/app/dashboard/layout";
import { BackButton } from "@/components/ui/back-button";
import { ParticipantMetricsTable } from "@/components/admin/ParticipantMetricsTable";
import { getDemoParticipant } from "@/lib/demo-data";
import { type Metric, type WeeklyFlag } from "@/lib/flags/rules";
import { weeklyCompositeTooltip } from "@/lib/flags/weekly-tooltips";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const PAGE_SIZE = 30;

type Participant = {
  id: string;
  name: string | null;
  email: string;
  garmin_user_id: string | null;
  garmin_connected_at: string | null;
  is_connected?: boolean;
};

export default function ParticipantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { mentor } = useDashboard();
  const id = params.id as string;

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [weeklyFlag, setWeeklyFlag] = useState<WeeklyFlag | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getEndpoint = useCallback(
    (offset: number) => {
      const base =
        mentor.role === "admin"
          ? `/api/admin/participants/${id}`
          : `/api/mentor/participants/${id}/metrics`;
      return `${base}?offset=${offset}&limit=${PAGE_SIZE}`;
    },
    [id, mentor.role]
  );

  // Initial load
  useEffect(() => {
    // Handle demo participants (no API call needed)
    if (id.startsWith('demo-')) {
      const demo = getDemoParticipant(id);
      if (demo) {
        setParticipant({
          id: demo.id,
          name: demo.name,
          email: demo.email,
          garmin_user_id: demo.garmin_user_id,
          garmin_connected_at: demo.garmin_connected_at,
          is_connected: true,
        });
        setMetrics(demo.metrics);
        setWeeklyFlag(demo.weekly_flag);
      } else {
        setError("Demo participant not found");
      }
      setIsLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) {
          setError("Not authenticated");
          setIsLoading(false);
          return;
        }

        const res = await fetch(getEndpoint(0), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          if (res.status === 404) {
            setError("Participant not found");
          } else {
            try {
              const errJson = await res.json();
              setError(errJson.error || `Failed to load details (${res.status})`);
            } catch {
              setError(`Failed to load details (${res.status})`);
            }
          }
          setIsLoading(false);
          return;
        }

        const json = await res.json();
        setParticipant({
          ...json.participant,
          is_connected: json.is_connected
        });
        setMetrics(json.metrics);
        setWeeklyFlag(json.weekly_flag || null);
        setHasMore(json.pagination?.hasMore ?? false);
      } catch (err) {
        console.error("Error loading details:", err);
        setError("An error occurred");
      } finally {
        setIsLoading(false);
      }
    }

    if (id) {
      fetchData();
    }
  }, [id, mentor.role, getEndpoint]);

  // Load more handler
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || id.startsWith('demo-')) return;
    setIsLoadingMore(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch(getEndpoint(metrics.length), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return;

      const json = await res.json();
      setMetrics(prev => [...prev, ...json.metrics]);
      setHasMore(json.pagination?.hasMore ?? false);
    } catch (err) {
      console.error("Error loading more metrics:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, id, metrics.length, getEndpoint]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-medium">Loading details...</span>
        </div>
      </div>
    );
  }

  if (error || !participant) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <BackButton onClick={() => router.back()} className="mb-4" />
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <p className="text-red-600 font-medium">{error || "Participant not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <BackButton onClick={() => router.back()} />
        <div className="text-right">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center justify-end gap-3">
            {participant.name || participant.email}
            {weeklyFlag && (
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-semibold border cursor-help ${
                        weeklyFlag.finalColor === "red"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : weeklyFlag.finalColor === "orange"
                          ? "bg-orange-50 text-orange-700 border-orange-200"
                          : weeklyFlag.finalColor === "yellow"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      Weekly{" "}
                      {weeklyFlag.finalColor === "green"
                        ? "🟢"
                        : weeklyFlag.finalColor === "yellow"
                        ? "🟡"
                        : weeklyFlag.finalColor === "orange"
                        ? "🟠"
                        : "🔴"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    {weeklyCompositeTooltip(weeklyFlag)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </h1>
          <p className="text-slate-500 text-sm">
            Garmin Status:{" "}
            {participant.is_connected ? (
              <span className="text-teal-600 font-medium">Connected</span>
            ) : (
              <span className="text-slate-400">Not Connected</span>
            )}
          </p>
        </div>
      </div>

      {/* Metrics Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Daily Metrics</h3>
        </div>

        <ParticipantMetricsTable
          metrics={metrics}
          weeklyFlag={weeklyFlag}
          edgePadding="lg"
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          emptyMessage={`No metrics found.${participant.garmin_user_id ? " Wait for daily sync." : ""}`}
        />
      </div>
    </div>
  );
}
