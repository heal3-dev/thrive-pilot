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

type ParticipantStatus = "pending" | "approved";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

function formatParticipantLabel(p: ParticipantMini): string {
  return p.name?.trim() || p.email?.trim() || p.phone_number?.trim() || "Unnamed participant";
}

function defaultMarkdown(name: string) {
  return `## Weekly check-in\n\nHi ${name},\n\nHere’s your weekly check-in based on the last 7 days.\n\n### Highlights\n- **Sleep**: ...\n- **Stress**: ...\n- **Body Battery**: ...\n- **HRV**: ...\n\n### One thing to try this week\n- ...\n\nIf you'd like to talk through anything, just reply to this message.\n`;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  const [markdownByParticipant, setMarkdownByParticipant] = useState<Record<string, string>>({});
  const markdown = selectedParticipant ? markdownByParticipant[selectedParticipant.id] ?? "" : "";

  const [statusByParticipant, setStatusByParticipant] = useState<Record<string, ParticipantStatus>>({});
  const selectedStatus: ParticipantStatus =
    (selectedParticipant ? statusByParticipant[selectedParticipant.id] : undefined) ?? "pending";

  const approvedCount = useMemo(
    () => Object.values(statusByParticipant).filter((s) => s === "approved").length,
    [statusByParticipant]
  );

  const [chatByParticipant, setChatByParticipant] = useState<Record<string, ChatMessage[]>>({});
  const chat = selectedParticipant ? chatByParticipant[selectedParticipant.id] ?? [] : [];
  const [feedbackInput, setFeedbackInput] = useState("");
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) router.replace("/dashboard");
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
        setSelectedParticipantId((prev) => prev || rows[0]?.id || "");
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
    // Initialize selected participant draft once.
    setMarkdownByParticipant((prev) => {
      if (prev[selectedParticipant.id]) return prev;
      return {
        ...prev,
        [selectedParticipant.id]: defaultMarkdown(selectedParticipant.name?.trim() || "there"),
      };
    });
  }, [selectedParticipant]);

  if (!isAdmin) return null;

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-clash text-2xl font-bold text-slate-900">Weekly Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Draft in Markdown, preview, and approve.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard")}
            className="border-slate-300"
          >
            Back
          </Button>
          <Button
            onClick={() => {
              // UI-only placeholder for now.
              alert("Batch send (mock). Next step: enqueue weekly reports to email_jobs.");
            }}
            disabled={approvedCount === 0}
            className="bg-teal-500 hover:bg-teal-600 text-white"
          >
            Send approved ({approvedCount})
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">{loadError}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-white rounded-2xl border-2 border-slate-100 overflow-hidden flex">
        {/* Left: participants */}
        <div className="w-72 border-r-2 border-slate-100 flex flex-col min-h-0">
          <div className="p-4 border-b-2 border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Participants</h2>
                <p className="text-xs text-slate-500 mt-0.5">{participants.length} total</p>
              </div>
              {approvedCount > 0 ? (
                <span className="inline-flex min-w-8 h-7 px-2 bg-teal-500 text-white text-sm font-bold rounded-full items-center justify-center">
                  {approvedCount}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-slate-500">Loading…</div>
            ) : participants.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No participants.</div>
            ) : (
              participants.map((p) => {
                const status = statusByParticipant[p.id] ?? "pending";
                const selected = p.id === selectedParticipantId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedParticipantId(p.id)}
                    className={`w-full px-4 py-3 text-left border-b border-slate-50 transition-colors ${
                      selected ? "bg-teal-50 border-l-4 border-l-teal-500" : "hover:bg-slate-50 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {formatParticipantLabel(p)}
                        </p>
                        <p className="text-[11px] font-semibold uppercase tracking-wide mt-1">
                          <span
                            className={
                              status === "approved"
                                ? "text-emerald-600"
                                : "text-amber-600"
                            }
                          >
                            {status}
                          </span>
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: main */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Top summary bar */}
          <div className="p-4 border-b-2 border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {selectedParticipant ? formatParticipantLabel(selectedParticipant) : "Select a participant"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Status:{" "}
                  <span className={selectedStatus === "approved" ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                    {selectedStatus === "approved" ? "Approved" : "Awaiting approval"}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!selectedParticipant) return;
                    setStatusByParticipant((prev) => ({
                      ...prev,
                      [selectedParticipant.id]: (prev[selectedParticipant.id] ?? "pending") === "approved" ? "pending" : "approved",
                    }));
                  }}
                  disabled={!selectedParticipant}
                  className="border-slate-300"
                >
                  {selectedStatus === "approved" ? "Mark Pending" : "Approve"}
                </Button>
              </div>
            </div>
          </div>

          {/* Content columns */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* Draft preview */}
            <div className="min-h-0 border-b-2 lg:border-b-0 lg:border-r-2 border-slate-100 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Current AI draft</p>
                <Button
                  onClick={() => {
                    if (!selectedParticipant) return;
                    setMarkdownByParticipant((prev) => ({
                      ...prev,
                      [selectedParticipant.id]: defaultMarkdown(selectedParticipant.name?.trim() || "there"),
                    }));
                  }}
                  disabled={!selectedParticipant}
                  className="bg-slate-900 hover:bg-slate-800 text-white"
                  size="sm"
                >
                  Regenerate (mock)
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-slate-900">
                <div className="max-w-2xl mx-auto rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
                  {markdown.trim().length === 0 ? (
                    <p className="text-sm text-slate-500">No draft yet.</p>
                  ) : (
                    <div className="prose prose-slate prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Editor + chat */}
            <div className="min-h-0 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Editor & AI chat</p>
                <span className="text-xs text-slate-500">{markdown.length} chars</span>
              </div>

              <div className="flex-1 min-h-0 grid grid-rows-[0.9fr_1.1fr]">
                {/* Markdown editor */}
                <div className="p-4 border-b-2 border-slate-100 min-h-0 flex flex-col">
                  <textarea
                    value={markdown}
                    onChange={(e) => {
                      if (!selectedParticipant) return;
                      const v = e.target.value;
                      setMarkdownByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: v }));
                      setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "pending" }));
                    }}
                    placeholder="Edit the draft in Markdown..."
                    disabled={!selectedParticipant}
                    className="flex-1 min-h-0 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300 resize-none disabled:opacity-50"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Editing marks the report as pending.
                  </p>
                </div>

                {/* Chat */}
                <div className="p-4 min-h-0 flex flex-col">
                  {feedbackError && (
                    <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-sm text-red-700 font-semibold">{feedbackError}</p>
                    </div>
                  )}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {chat.map((m) => (
                      <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            m.role === "user"
                              ? "bg-teal-500 text-white rounded-br-md"
                              : "bg-white border border-slate-200 text-slate-900 rounded-bl-md"
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {chat.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">
                        Tip: send feedback like “make it more encouraging” to update the draft.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex gap-2 items-center">
                    <input
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      placeholder="Add feedback for the AI…"
                      disabled={!selectedParticipant || isSendingFeedback}
                      className="flex-1 h-10 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300 disabled:opacity-50"
                    />
                    <Button
                      onClick={async () => {
                        if (!selectedParticipant) return;
                        const text = feedbackInput.trim();
                        if (!text) return;
                        setFeedbackError(null);
                        setIsSendingFeedback(true);
                        setFeedbackInput("");

                        const userMsg: ChatMessage = { id: createId("user"), role: "user", content: text };
                        setChatByParticipant((prev) => ({
                          ...prev,
                          [selectedParticipant.id]: [...(prev[selectedParticipant.id] ?? []), userMsg],
                        }));

                        try {
                          const { data: sessionData } = await supabase.auth.getSession();
                          const token = sessionData?.session?.access_token;
                          if (!token) throw new Error("Authentication required");

                          const participantLabel = formatParticipantLabel(selectedParticipant);
                          const res = await fetch("/api/admin/weekly-reports/chat", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${token}`,
                            },
                            body: JSON.stringify({
                              participantLabel,
                              currentMarkdown: markdownByParticipant[selectedParticipant.id] ?? "",
                              feedback: text,
                            }),
                          });

                          if (!res.ok) {
                            const j = await res.json().catch(() => ({} as any));
                            throw new Error(j?.error || "Failed to generate update");
                          }

                          const j = (await res.json()) as { assistantMessage: string; updatedMarkdown: string };
                          const assistantMsg: ChatMessage = {
                            id: createId("ai"),
                            role: "assistant",
                            content: j.assistantMessage || "Updated the draft based on your feedback.",
                          };

                          setChatByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: [...(prev[selectedParticipant.id] ?? []), assistantMsg],
                          }));

                          setMarkdownByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: j.updatedMarkdown ?? prev[selectedParticipant.id] ?? "",
                          }));
                          setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "pending" }));
                        } catch (e) {
                          setFeedbackError(e instanceof Error ? e.message : "Failed to send feedback");
                        } finally {
                          setIsSendingFeedback(false);
                        }
                      }}
                      disabled={!selectedParticipant || isSendingFeedback || feedbackInput.trim().length === 0}
                      className="bg-teal-500 hover:bg-teal-600 text-white"
                    >
                      {isSendingFeedback ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

