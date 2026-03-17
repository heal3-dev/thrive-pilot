
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useDashboard } from "@/app/dashboard/layout";
import { BackButton } from "@/components/ui/back-button";
import { ParticipantMetricsTable } from "@/components/admin/ParticipantMetricsTable";
import { getDemoParticipant } from "@/lib/demo-data";

type Participant = {
  id: string;
  name: string | null;
  email: string;
  garmin_user_id: string | null;
  garmin_connected_at: string | null;
  is_connected?: boolean;
};

type Metric = {
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

type Flag = {
  type: 'LOW_HRV' | 'HIGH_RHR' | 'LOW_SLEEP' | 'LOW_SLEEP_SCORE' | 'HIGH_STRESS' | 'LOW_BODY_BATTERY' | 'NO_DATA';
  message: string;
  severity: 'warning' | 'alert' | 'info';
};

export default function ParticipantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { mentor } = useDashboard();
  const id = params.id as string;

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setFlags(demo.flags);
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

        const detailsEndpoint =
          mentor.role === "admin"
            ? `/api/admin/participants/${id}`
            : `/api/mentor/participants/${id}/metrics`;

        const res = await fetch(detailsEndpoint, {
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
        setFlags(json.flags || []);
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
  }, [id, mentor.role]);

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
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <BackButton onClick={() => router.back()} />
        <div className="text-right">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center justify-end gap-3">
            {participant.name || participant.email}
            {flags.map((flag, idx) => (
              <span 
                key={idx}
                className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-medium border ${
                  flag.severity === 'alert' 
                    ? 'bg-red-50 text-red-700 border-red-200' 
                    : flag.severity === 'warning'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
                title={flag.message}
              >
                {flag.message}
              </span>
            ))}
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
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-semibold text-slate-800">Recent Daily Metrics</h3>
          <span className="text-xs text-slate-400">Last 30 entries</span>
        </div>

        <ParticipantMetricsTable
          metrics={metrics}
          emptyMessage={`No metrics found.${participant.garmin_user_id ? " Wait for daily sync." : ""}`}
        />
      </div>
    </div>
  );
}
