"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useDashboard } from "@/app/dashboard/layout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DEFAULT_GENERATE_WRAPPER, DEFAULT_MASTER_RULES, DEFAULT_OLGA_HTML_BASE_TEMPLATE, DEFAULT_REVISE_WRAPPER } from "@/lib/weekly-reports/template-defaults";

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

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type TemplateKey = "master_rules" | "revise_wrapper" | "generate_wrapper" | "html_base_template";
type TemplateRow = {
  id: string;
  key: TemplateKey;
  content: string;
  version: number;
  updated_at: string;
};

const TEMPLATE_KEYS: TemplateKey[] = [
  "master_rules",
  "revise_wrapper",
  "generate_wrapper",
  "html_base_template",
];

const TEMPLATE_LABELS: Record<TemplateKey, { title: string; hint: string }> = {
  master_rules: {
    title: "Master rules",
    hint: "Paste Olga’s comprehensive Thrive Weekly Report instructions here (tone, structure, badge labels, fixed closing line).",
  },
  revise_wrapper: {
    title: "Revise wrapper",
    hint: "Instructions for revising an existing draft using admin feedback. This is applied together with Master rules.",
  },
  generate_wrapper: {
    title: "Generate wrapper",
    hint: "Instructions for generating a new draft (not wired yet). Stored now so we can add generation later without reshaping the UI.",
  },
  html_base_template: {
    title: "HTML base template",
    hint: "Branded HTML template (full document). This is used as the starting point for new drafts and preview rendering.",
  },
};

const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  master_rules: DEFAULT_MASTER_RULES,
  revise_wrapper: DEFAULT_REVISE_WRAPPER,
  generate_wrapper: DEFAULT_GENERATE_WRAPPER,
  html_base_template: DEFAULT_OLGA_HTML_BASE_TEMPLATE,
};

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

  const [htmlByParticipant, setHtmlByParticipant] = useState<Record<string, string>>({});
  const html = selectedParticipant ? htmlByParticipant[selectedParticipant.id] ?? "" : "";
  const [completenessByParticipant, setCompletenessByParticipant] = useState<
    Record<string, { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number }>
  >({});
  const selectedCompleteness = selectedParticipant ? completenessByParticipant[selectedParticipant.id] : null;
  const [dataStatusByParticipant, setDataStatusByParticipant] = useState<
    Record<string, { canGenerate: boolean; reason: string | null }>
  >({});
  const selectedDataStatus = selectedParticipant ? dataStatusByParticipant[selectedParticipant.id] : null;

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
  const [isGenerating, setIsGenerating] = useState(false);

  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("master_rules");
  const [templatesByKey, setTemplatesByKey] = useState<Partial<Record<TemplateKey, TemplateRow>>>({});
  const [templateDraftByKey, setTemplateDraftByKey] = useState<Partial<Record<TemplateKey, string>>>({});
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const PREVIEW_BASE_WIDTH = 980;
  const PREVIEW_BASE_HEIGHT = 1500;

  const autoGeneratedRef = useRef<Set<string>>(new Set());

  const currentTemplateDraft = templateDraftByKey[templateKey] ?? "";
  const currentTemplateRow = templatesByKey[templateKey];

  useEffect(() => {
    if (!isAdmin) router.replace("/dashboard");
  }, [isAdmin, router]);

  const loadTemplates = useCallback(
    async (force: boolean) => {
      if (!isAdmin) return;
      if (hasLoadedTemplates && !force) return;
      setTemplatesError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error("Authentication required");

        const res = await fetch(`/api/admin/weekly-reports/templates?keys=${encodeURIComponent(TEMPLATE_KEYS.join(","))}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as unknown;
          const msg =
            typeof j === "object" &&
            j !== null &&
            "error" in j &&
            typeof (j as { error?: unknown }).error === "string"
              ? (j as { error: string }).error
              : null;
          throw new Error(msg || "Failed to load templates");
        }

        const j = (await res.json()) as { templates: TemplateRow[] };

        const nextByKey: Partial<Record<TemplateKey, TemplateRow>> = {};
        for (const t of j.templates ?? []) {
          nextByKey[t.key] = t;
        }
        setTemplatesByKey(nextByKey);

        setTemplateDraftByKey((prev) => {
          const next = { ...prev };
          for (const k of TEMPLATE_KEYS) {
            const fromDb = nextByKey[k]?.content;
            next[k] = typeof fromDb === "string" ? fromDb : (next[k] ?? DEFAULT_TEMPLATES[k]);
          }
          return next;
        });

        setHasLoadedTemplates(true);
      } catch (e) {
        setTemplatesError(e instanceof Error ? e.message : "Failed to load templates");
      }
    },
    [hasLoadedTemplates, isAdmin]
  );

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      if (!width) return;
      const next = Math.min(1, Math.max(0.4, (width - 8) / PREVIEW_BASE_WIDTH));
      setPreviewScale(Math.round(next * 1000) / 1000);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    void loadTemplates(false);
  }, [isAdmin, loadTemplates]);

  useEffect(() => {
    if (!selectedParticipant) return;
    let cancelled = false;

    async function ensureGenerated() {
      const p = selectedParticipant;
      if (!p) return;
      // If we already have a draft for this participant, don't auto-generate again.
      if (autoGeneratedRef.current.has(p.id)) return;
      if (htmlByParticipant[p.id]?.trim()) {
        autoGeneratedRef.current.add(p.id);
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error("Authentication required");

        const statusUrl = `/api/admin/weekly-reports/data-status?participantId=${encodeURIComponent(p.id)}`;
        const statusRes = await fetch(statusUrl, { headers: { Authorization: `Bearer ${token}` } });

        if (!statusRes.ok) {
          const j = (await statusRes.json().catch(() => null)) as unknown;
          const msg =
            typeof j === "object" &&
            j !== null &&
            "error" in j &&
            typeof (j as { error?: unknown }).error === "string"
              ? (j as { error: string }).error
              : null;
          throw new Error(msg || "Failed to check participant data status");
        }

        const statusJson = (await statusRes.json()) as {
          canGenerate: boolean;
          reason: string | null;
          completeness?: { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number };
        };
        if (cancelled) return;
        setDataStatusByParticipant((prev) => ({
          ...prev,
          [p.id]: { canGenerate: Boolean(statusJson.canGenerate), reason: statusJson.reason ?? null },
        }));
        if (statusJson.completeness) {
          setCompletenessByParticipant((prev) => ({ ...prev, [p.id]: statusJson.completeness! }));
        }

        if (!statusJson.canGenerate) {
          // Don't auto-generate; show the alert instead.
          setFeedbackError(statusJson.reason || "Cannot generate report yet");
          setHtmlByParticipant((prev) => ({ ...prev, [p.id]: "" }));
          autoGeneratedRef.current.add(p.id);
          return;
        }

        setFeedbackError(null);
        setIsGenerating(true);

        const res = await fetch("/api/admin/weekly-reports/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ participantId: p.id }),
        });

        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as unknown;
          const msg =
            typeof j === "object" &&
            j !== null &&
            "error" in j &&
            typeof (j as { error?: unknown }).error === "string"
              ? (j as { error: string }).error
              : null;
          throw new Error(msg || "Failed to generate weekly report");
        }

        const j = (await res.json()) as {
          updatedHtml: string;
          assistantMessage?: string;
          completeness?: { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number };
        };
        if (cancelled) return;

        setHtmlByParticipant((prev) => ({ ...prev, [p.id]: j.updatedHtml ?? "" }));
        setStatusByParticipant((prev) => ({ ...prev, [p.id]: "pending" }));
        if (j.completeness) {
          setCompletenessByParticipant((prev) => ({ ...prev, [p.id]: j.completeness! }));
        }

        const assistantMsg: ChatMessage = {
          id: createId("gen"),
          role: "assistant",
          content: j.assistantMessage || "Generated the weekly report draft from this week’s data.",
        };
        setChatByParticipant((prev) => ({
          ...prev,
          [p.id]: [...(prev[p.id] ?? []), assistantMsg],
        }));

        autoGeneratedRef.current.add(p.id);
      } catch (e) {
        autoGeneratedRef.current.add(p.id);
        if (!cancelled) setFeedbackError(e instanceof Error ? e.message : "Failed to generate report");
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    }

    void ensureGenerated();
    return () => {
      cancelled = true;
    };
  }, [
    selectedParticipant,
    templateDraftByKey.html_base_template,
    templatesByKey.html_base_template?.content,
    htmlByParticipant,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function refreshOnOpen() {
      if (!isTemplatesOpen) return;
      await loadTemplates(true);
      if (!cancelled) setHasLoadedTemplates(true);
    }
    void refreshOnOpen();
    return () => {
      cancelled = true;
    };
  }, [isTemplatesOpen, loadTemplates]);

  if (!isAdmin) return null;

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-clash text-2xl font-bold text-slate-900">Weekly Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Draft in HTML, preview, and approve.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsTemplatesOpen(true)}
            className="border-slate-300"
          >
            Templates
          </Button>
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

      <Modal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        title="Weekly Report Templates"
        subtitle="Edit the active prompt templates used by generation/revision. Changes apply immediately to new chat revisions."
        size="2xl"
      >
        <div className="space-y-4">
          {templatesError ? (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm font-semibold text-red-700">{templatesError}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {TEMPLATE_KEYS.map((k) => {
              const selected = k === templateKey;
              return (
                <button
                  key={k}
                  onClick={() => setTemplateKey(k)}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                    selected
                      ? "bg-teal-50 border-teal-200 text-teal-900"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  type="button"
                >
                  {TEMPLATE_LABELS[k].title}
                </button>
              );
            })}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">{TEMPLATE_LABELS[templateKey].title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{TEMPLATE_LABELS[templateKey].hint}</p>
              {currentTemplateRow ? (
                <p className="text-[11px] text-slate-400 mt-1">
                  Active version: v{currentTemplateRow.version} · Updated {new Date(currentTemplateRow.updated_at).toLocaleString()}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 mt-1">
                  Not saved yet — using local default until you save.
                </p>
              )}
            </div>
            <span className="text-xs text-slate-500 shrink-0">
              {(currentTemplateDraft ?? "").length} chars
            </span>
          </div>

          <textarea
            value={currentTemplateDraft}
            onChange={(e) => {
              const v = e.target.value;
              setTemplateDraftByKey((prev) => ({ ...prev, [templateKey]: v }));
            }}
            placeholder="Enter template content…"
            className="w-full min-h-[360px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-300 resize-y"
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Saving creates a new active version for this template key.
            </p>
            <div className="flex items-center gap-2">
              {!currentTemplateRow && (templateKey === "html_base_template" || templateKey === "master_rules") ? (
                <Button
                  variant="outline"
                  onClick={async () => {
                    setTemplatesError(null);
                    setIsSavingTemplate(true);
                    try {
                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData?.session?.access_token;
                      if (!token) throw new Error("Authentication required");

                      const res = await fetch("/api/admin/weekly-reports/templates/seed", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ keys: [templateKey] }),
                      });
                      if (!res.ok) {
                        const j = (await res.json().catch(() => null)) as unknown;
                        const msg =
                          typeof j === "object" &&
                          j !== null &&
                          "error" in j &&
                          typeof (j as { error?: unknown }).error === "string"
                            ? (j as { error: string }).error
                            : null;
                        throw new Error(msg || "Failed to seed template");
                      }

                      await loadTemplates(true);
                    } catch (e) {
                      setTemplatesError(e instanceof Error ? e.message : "Failed to seed template");
                    } finally {
                      setIsSavingTemplate(false);
                    }
                  }}
                  disabled={isSavingTemplate}
                  className="border-slate-300"
                >
                  Seed default
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  setTemplateDraftByKey((prev) => ({ ...prev, [templateKey]: DEFAULT_TEMPLATES[templateKey] }));
                }}
                disabled={isSavingTemplate}
                className="border-slate-300"
              >
                Reset to default
              </Button>
              <Button
                onClick={async () => {
                  const content = (templateDraftByKey[templateKey] ?? "").trimEnd();
                  if (content.trim().length === 0) {
                    setTemplatesError("Template content cannot be empty.");
                    return;
                  }
                  setTemplatesError(null);
                  setIsSavingTemplate(true);
                  try {
                    const { data: sessionData } = await supabase.auth.getSession();
                    const token = sessionData?.session?.access_token;
                    if (!token) throw new Error("Authentication required");

                    const res = await fetch("/api/admin/weekly-reports/templates", {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({ key: templateKey, content }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => null)) as unknown;
                      const msg =
                        typeof j === "object" &&
                        j !== null &&
                        "error" in j &&
                        typeof (j as { error?: unknown }).error === "string"
                          ? (j as { error: string }).error
                          : null;
                      throw new Error(msg || "Failed to save template");
                    }
                    const j = (await res.json()) as { template: TemplateRow };
                    setTemplatesByKey((prev) => ({ ...prev, [templateKey]: j.template }));
                    setTemplateDraftByKey((prev) => ({ ...prev, [templateKey]: j.template.content }));
                  } catch (e) {
                    setTemplatesError(e instanceof Error ? e.message : "Failed to save template");
                  } finally {
                    setIsSavingTemplate(false);
                  }
                }}
                disabled={isSavingTemplate}
                className="bg-teal-500 hover:bg-teal-600 text-white"
              >
                {isSavingTemplate ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">{loadError}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-white rounded-2xl border-2 border-slate-100 overflow-hidden flex">
        {/* Left: participants */}
        <div className="w-60 border-r-2 border-slate-100 flex flex-col min-h-0">
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
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-0">
            {/* HTML preview */}
            <div className="min-h-0 border-b-2 lg:border-b-0 lg:border-r-2 border-slate-100 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Preview</p>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={async () => {
                      if (!selectedParticipant) return;
                      setFeedbackError(null);
                      setIsGenerating(true);
                      try {
                        const { data: sessionData } = await supabase.auth.getSession();
                        const token = sessionData?.session?.access_token;
                        if (!token) throw new Error("Authentication required");

                        // Cheap status check first; avoid calling OpenAI for unconnected/no-data participants.
                        const statusRes = await fetch(
                          `/api/admin/weekly-reports/data-status?participantId=${encodeURIComponent(selectedParticipant.id)}`,
                          { headers: { Authorization: `Bearer ${token}` } }
                        );
                        if (statusRes.ok) {
                          const statusJson = (await statusRes.json()) as { canGenerate: boolean; reason: string | null };
                          setDataStatusByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: { canGenerate: Boolean(statusJson.canGenerate), reason: statusJson.reason ?? null },
                          }));
                          if (!statusJson.canGenerate) {
                            setFeedbackError(statusJson.reason || "Cannot generate report yet");
                            setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "" }));
                            return;
                          }
                        }

                        const res = await fetch("/api/admin/weekly-reports/generate", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({ participantId: selectedParticipant.id }),
                        });
                        if (!res.ok) {
                          const j = (await res.json().catch(() => null)) as unknown;
                          const msg =
                            typeof j === "object" &&
                            j !== null &&
                            "error" in j &&
                            typeof (j as { error?: unknown }).error === "string"
                              ? (j as { error: string }).error
                              : null;
                          throw new Error(msg || "Failed to generate weekly report");
                        }

                        const j = (await res.json()) as {
                          updatedHtml: string;
                          assistantMessage?: string;
                          completeness?: { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number };
                        };
                        const updatedHtml = j.updatedHtml ?? "";

                        setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: updatedHtml }));
                        setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "pending" }));
                        if (j.completeness) {
                          setCompletenessByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: j.completeness! }));
                        }

                        const assistantMsg: ChatMessage = {
                          id: createId("gen"),
                          role: "assistant",
                          content: j.assistantMessage || "Generated the weekly report draft from this week’s data.",
                        };
                        setChatByParticipant((prev) => ({
                          ...prev,
                          [selectedParticipant.id]: [...(prev[selectedParticipant.id] ?? []), assistantMsg],
                        }));
                      } catch (e) {
                        setFeedbackError(e instanceof Error ? e.message : "Failed to generate report");
                      } finally {
                        setIsGenerating(false);
                      }
                    }}
                    disabled={!selectedParticipant || isGenerating}
                    className="bg-teal-500 hover:bg-teal-600 text-white"
                    size="sm"
                  >
                    {isGenerating ? "Generating…" : "Generate from data"}
                  </Button>
                </div>
              </div>
              <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 bg-white">
                {selectedCompleteness &&
                (selectedCompleteness.calendarDaysPresent < selectedCompleteness.calendarDaysExpected ||
                  selectedCompleteness.sleepNightsPresent < selectedCompleteness.sleepNightsExpected) ? (
                  <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-xs font-semibold text-amber-900">
                      Incomplete data: {selectedCompleteness.calendarDaysPresent}/{selectedCompleteness.calendarDaysExpected} days,{" "}
                      {selectedCompleteness.sleepNightsPresent}/{selectedCompleteness.sleepNightsExpected} nights available.
                    </p>
                  </div>
                ) : null}
                {!html.trim() && selectedDataStatus && selectedDataStatus.reason ? (
                  <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200">
                    <p className="text-xs font-semibold text-red-700">{selectedDataStatus.reason}</p>
                  </div>
                ) : null}
                {html.trim().length === 0 ? (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
                    {selectedDataStatus?.reason ? "Cannot generate report yet." : "No HTML draft yet."}
                  </div>
                ) : (
                  <div className="w-full rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                    <div
                      className="mx-auto"
                      style={{
                        width: Math.round(PREVIEW_BASE_WIDTH * previewScale),
                        height: Math.round(PREVIEW_BASE_HEIGHT * previewScale),
                      }}
                    >
                      <div
                        style={{
                          width: PREVIEW_BASE_WIDTH,
                          height: PREVIEW_BASE_HEIGHT,
                          transform: `scale(${previewScale})`,
                          transformOrigin: "top left",
                        }}
                      >
                        <iframe
                          title="Weekly report preview"
                          sandbox=""
                          style={{ width: PREVIEW_BASE_WIDTH, height: PREVIEW_BASE_HEIGHT, background: "white" }}
                          srcDoc={html}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Editor + chat */}
            <div className="min-h-0 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">HTML editor & chat</p>
                <span className="text-xs text-slate-500">{html.length} chars</span>
              </div>

              <div className="flex-1 min-h-0 grid grid-rows-2">
                {/* HTML editor */}
                <div className="p-4 border-b-2 border-slate-100 min-h-0 flex flex-col">
                  <textarea
                    value={html}
                    onChange={(e) => {
                      if (!selectedParticipant) return;
                      const v = e.target.value;
                      setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: v }));
                      setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "pending" }));
                    }}
                    placeholder="Edit the report HTML..."
                    disabled={!selectedParticipant}
                    className="flex-1 min-h-0 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-300 resize-none disabled:opacity-50"
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
                    {chat.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Add feedback like “make it more encouraging” to update the HTML draft.
                      </p>
                    ) : (
                      chat.map((m) => (
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
                      ))
                    )}
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
                              currentHtml: htmlByParticipant[selectedParticipant.id] ?? "",
                              feedback: text,
                            }),
                          });

                          if (!res.ok) {
                            const j = (await res.json().catch(() => null)) as unknown;
                            const msg =
                              typeof j === "object" &&
                              j !== null &&
                              "error" in j &&
                              typeof (j as { error?: unknown }).error === "string"
                                ? (j as { error: string }).error
                                : null;
                            throw new Error(msg || "Failed to generate update");
                          }

                          const j = (await res.json()) as { assistantMessage: string; updatedHtml: string };
                          const assistantMsg: ChatMessage = {
                            id: createId("ai"),
                            role: "assistant",
                            content: j.assistantMessage || "Updated the draft based on your feedback.",
                          };

                          setChatByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: [...(prev[selectedParticipant.id] ?? []), assistantMsg],
                          }));

                          setHtmlByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: j.updatedHtml ?? prev[selectedParticipant.id] ?? "",
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

