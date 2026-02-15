
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type Participant = {
  id: string;
  name: string | null;
  email: string;
  garmin_user_id: string | null;
  garmin_connected_at: string | null;
};

type Metric = {
  id: string;
  metric_date: string;
  steps: number | null;
  resting_heart_rate: number | null;
  average_stress_level: number | null;
  sleep_duration_seconds: number | null;
};

export default function ParticipantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // 1. Fetch Participant
      const { data: pData, error: pError } = await supabase
        .from("participants")
        .select("id, name, email, garmin_user_id, garmin_connected_at")
        .eq("id", id)
        .single();

      if (pError) {
        console.error("Error fetching participant:", pError);
        setIsLoading(false);
        return;
      }

      setParticipant(pData);

      // 2. Fetch Metrics (Last 30 days)
      const { data: mData, error: mError } = await supabase
        .from("garmin_metrics")
        .select("id, metric_date, steps, resting_heart_rate, average_stress_level, sleep_duration_seconds")
        .eq("participant_id", id)
        .order("metric_date", { ascending: false })
        .limit(30);

      if (mError) {
        console.error("Error fetching metrics:", mError);
      } else {
        setMetrics(mData || []);
      }

      setIsLoading(false);
    }

    if (id) {
      fetchData();
    }
  }, [id]);

  if (isLoading) {
    return <div className="p-8">Loading details...</div>;
  }

  if (!participant) {
    return <div className="p-8">Participant not found.</div>;
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            ← Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {participant.name || participant.email}
            </h1>
            <p className="text-slate-500 text-sm">
              Garmin Status:{" "}
              {participant.garmin_user_id ? (
                <span className="text-teal-600 font-medium">Connected</span>
              ) : (
                <span className="text-slate-400">Not Connected</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-semibold text-slate-800">Recent Daily Metrics</h3>
          <span className="text-xs text-slate-400">Last 30 entries</span>
        </div>
        
        {metrics.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No metrics found. {(participant.garmin_user_id) && "Wait for daily sync."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-slate-500 bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Steps</th>
                  <th className="px-6 py-3 font-medium">RHR (bpm)</th>
                  <th className="px-6 py-3 font-medium">Stress (avg)</th>
                  <th className="px-6 py-3 font-medium">Sleep (hrs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 text-slate-900 font-medium">
                      {m.metric_date}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {m.steps?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {m.resting_heart_rate ?? "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {m.average_stress_level ?? "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {m.sleep_duration_seconds
                        ? (m.sleep_duration_seconds / 3600).toFixed(1)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
