"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDashboard } from "@/app/dashboard/layout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type ParticipantMini = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
};

function formatParticipantLabel(p: ParticipantMini): string {
  return p.name?.trim() || p.email?.trim() || p.phone_number?.trim() || "Unnamed participant";
}

function defaultMarkdown(name: string) {
  return `## Weekly check-in\n\nHi ${name},\n\nHere’s your weekly check-in based on the last 7 days.\n\n### Highlights\n- **Sleep**: ...\n- **Stress**: ...\n- **Body Battery**: ...\n- **HRV**: ...\n\n### One thing to try this week\n- ...\n\nIf you'd like to talk through anything, just reply to this message.\n`;
}

export default function WeeklyReportsPage() {
  const router = useRouter();
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  const [participants, setParticipants] = useState<ParticipantMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("");
  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === selectedParticipantId) ?? null,
    [participants, selectedParticipantId]
  );

  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [isAdmin, router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const { data, error } = await supabase
          .from("participants")
          .select("id, name, email, phone_number")
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        if (cancelled) return;
        const rows = (data ?? []) as ParticipantMini[];
        setParticipants(rows);
        const firstId = rows[0]?.id ?? "";
        setSelectedParticipantId((prev) => prev || firstId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load participants";
        if (!cancelled) setLoadError(msg);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedParticipant) return;
    // Initialize markdown on first selection only.
    setMarkdown((prev) => prev || defaultMarkdown(selectedParticipant.name?.trim() || "there"));
  }, [selectedParticipant]);

  if (!isAdmin) return null;

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-clash text-2xl font-bold text-slate-900">Weekly Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Draft in Markdown, preview the final email body, and iterate.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Back to Dashboard
        </Button>
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">{loadError}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Controls */}
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 flex flex-col gap-4 min-h-0">
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase">Participant</label>
            <select
              value={selectedParticipantId}
              onChange={(e) => {
                setSelectedParticipantId(e.target.value);
                setMarkdown("");
              }}
              disabled={isLoading || participants.length === 0}
              className="mt-2 w-full h-10 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300 disabled:opacity-50"
            >
              {participants.length === 0 ? (
                <option value="">No participants</option>
              ) : (
                participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatParticipantLabel(p)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">Workflow (preview)</p>
            <p className="text-xs text-slate-600 mt-1">
              Generate → edit Markdown → preview → approve → enqueue email.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() =>
                setMarkdown(defaultMarkdown(selectedParticipant?.name?.trim() || "there"))
              }
              disabled={!selectedParticipant}
              className="bg-teal-500 hover:bg-teal-600 text-white"
            >
              Generate Draft (mock)
            </Button>
            <Button
              variant="outline"
              onClick={() => setMarkdown("")}
              disabled={!markdown}
            >
              Clear
            </Button>
          </div>

          <div className="text-xs text-slate-500 leading-5">
            This is a UI preview only. Next step will wire generation + approvals to `email_jobs`.
          </div>
        </div>

        {/* Editor */}
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 flex flex-col min-h-0 lg:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900">Markdown</h2>
            <span className="text-xs text-slate-500">{markdown.length} chars</span>
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="Write report content in Markdown..."
            className="flex-1 min-h-0 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
          />
        </div>

        {/* Preview */}
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 flex flex-col min-h-0 lg:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-900">Preview</h2>
            <span className="text-xs text-slate-500">Email body</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
            {markdown.trim().length === 0 ? (
              <p className="text-sm text-slate-400">Nothing to preview yet.</p>
            ) : (
              <div className="text-sm text-slate-900 leading-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

