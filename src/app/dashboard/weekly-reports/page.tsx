"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useDashboard } from "@/app/dashboard/layout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

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
  master_rules: "",
  revise_wrapper: [
    "You are an assistant helping an admin refine a weekly wellbeing report for a participant.",
    "Return JSON only with keys: assistantMessage (string), updatedHtml (string).",
    "Keep updatedHtml as a complete HTML document. Preserve the overall structure and avoid adding any scripts.",
    "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
  ].join(" "),
  generate_wrapper: "TODO: Add generation instructions when we wire /generate.",
  html_base_template: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Thrive Weekly Report - Deanna</title>
  <style>
    :root{
      --page:#fffdf7;
      --text:#0f172a;
      --muted:#64748b;
      --card:#fff4cc;
      --card-border:#f2e2a1;
      --card-icon:#ffeaa3;
      --panel:#ffffff;
      --panel-border:#e2e8f0;
      --badge-bg:#ffedd5;
      --badge-border:#fdba74;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background:var(--page);
      color:var(--text);
      padding:32px 24px;
    }
    .wrap{max-width:980px;margin:0 auto}
    .eyebrow{
      font-size:12px;
      letter-spacing:.28em;
      text-transform:uppercase;
      color:#64748b;
      font-weight:700;
      margin-bottom:14px;
    }
    h1{
      font-size:48px;
      line-height:1.05;
      margin:0 0 8px;
      font-weight:650;
    }
    .sub{
      font-size:20px;
      color:#475569;
      margin:0 0 20px;
    }
    .badge{
      display:inline-flex;
      gap:14px;
      align-items:flex-start;
      background:#fef3c7;
      border:1px solid #fcd34d;
      border-radius:18px;
      padding:16px 18px;
      box-shadow:0 8px 20px rgba(15,23,42,.06);
      max-width:760px;
    }
    .badge .icon{font-size:28px;line-height:1}
    .badge-title{font-size:24px;font-weight:650;margin:0 0 6px}
    .badge-text{font-size:15px;color:#475569;margin:0;line-height:1.6}
    .section-title{
      font-size:36px;
      line-height:1.15;
      margin:42px 0 18px;
      font-weight:650;
    }
    .card{
      background:var(--card);
      border:1px solid var(--card-border);
      border-radius:30px;
      box-shadow:0 12px 30px rgba(0,0,0,.05);
      padding:28px 30px;
      margin:0 0 24px;
    }
    .card-grid{
      display:grid;
      grid-template-columns:110px 1fr;
      gap:24px;
      align-items:start;
    }
    .icon-circle{
      width:96px;height:96px;border-radius:999px;
      display:flex;align-items:center;justify-content:center;
      background:var(--card-icon);
      font-size:56px;
      box-shadow: inset 0 2px 6px rgba(0,0,0,.06);
      margin-top:4px;
    }
    .card h3{
      font-size:32px;
      margin:0 0 8px;
      line-height:1.1;
      font-weight:650;
    }
    .card-sub{
      font-size:19px;
      color:#475569;
      margin:0 0 14px;
    }
    .state{
      display:inline-block;
      background:rgba(255,255,255,.6);
      border:1px solid rgba(255,255,255,.8);
      border-radius:16px;
      padding:10px 16px;
      font-size:22px;
      font-weight:650;
      margin-bottom:18px;
    }
    .body{
      font-size:18px;
      line-height:1.8;
      margin:0 0 18px;
      color:#1f2937;
      max-width:760px;
    }
    .support{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:18px;
      margin-top:8px;
    }
    .support-box{
      background:rgba(255,255,255,.45);
      border:1px solid rgba(255,255,255,.55);
      border-radius:18px;
      padding:18px;
    }
    .support-label{
      font-size:12px;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#64748b;
      font-weight:700;
      margin:0 0 8px;
    }
    .support-text{
      font-size:17px;
      line-height:1.7;
      margin:0;
      color:#1f2937;
    }
    .meaning{
      background:var(--panel);
      border:1px solid var(--panel-border);
      border-radius:28px;
      box-shadow:0 6px 18px rgba(15,23,42,.04);
      padding:28px 30px;
      margin-top:8px;
    }
    .meaning h2{
      font-size:34px;
      line-height:1.15;
      margin:0 0 14px;
      font-weight:650;
    }
    .meaning p{
      font-size:18px;
      line-height:1.8;
      color:#334155;
      margin:0;
      max-width:820px;
    }
    .footer-line{
      margin-top:18px !important;
      font-weight:600;
      color:#0f172a !important;
    }
    @media print{
      body{padding:18px}
      .card,.meaning,.badge{break-inside:avoid}
    }
    @media (max-width: 720px){
      body{padding:20px 14px}
      h1{font-size:38px}
      .sub{font-size:18px}
      .section-title{font-size:30px}
      .card-grid{grid-template-columns:1fr}
      .icon-circle{margin:0 auto}
      .support{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">Thrive Weekly Report</div>
    <h1>Deanna</h1>
    <p class="sub">April 25 – May 1, 2025</p>

    <div class="badge">
      <div class="icon">🟡</div>
      <div>
        <p class="badge-title">Mild Strain</p>
        <p class="badge-text">Your dashboard shows a yellow weekly score, with some mild strain showing up mainly through uneven sleep and less steady recovery.</p>
      </div>
    </div>

    <h2 class="section-title">How your week looked</h2>

    <section class="card">
      <div class="card-grid">
        <div class="icon-circle">❤️</div>
        <div>
          <h3>STRESS</h3>
          <p class="card-sub">How steady your system looked this week</p>
          <div class="state">Low to Moderate</div>
          <p class="body">Your week looked fairly steady overall. Daily stress stayed mostly in a manageable range, with no strong sign that stress was the main issue this week.</p>
          <div class="support">
            <div class="support-box">
              <p class="support-label">Daily pattern</p>
              <p class="support-text">Most days looked moderate, with a calmer finish to the week.</p>
            </div>
            <div class="support-box">
              <p class="support-label">What stood out</p>
              <p class="support-text">Stress did not appear to be the biggest concern compared with the rest of the week.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-grid">
        <div class="icon-circle">🌙</div>
        <div>
          <h3>SLEEP</h3>
          <p class="card-sub">How much and how well your body rested overnight</p>
          <div class="state">Mixed</div>
          <p class="body">Sleep looked uneven this week. Several nights were solid, but one clearly short night and a low sleep score in the middle of the week stood out and likely made it harder to feel fully settled.</p>
          <div class="support">
            <div class="support-box">
              <p class="support-label">Sleep amount</p>
              <p class="support-text">Most nights were around a workable range, but one much shorter night interrupted the pattern.</p>
            </div>
            <div class="support-box">
              <p class="support-label">Sleep quality</p>
              <p class="support-text">Sleep quality improved again by the end of the week after a rougher stretch midweek.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-grid">
        <div class="icon-circle">🔋</div>
        <div>
          <h3>RECOVERY</h3>
          <p class="card-sub">How well your body recharged across the week</p>
          <div class="state">Partial</div>
          <p class="body">Recovery looked only partly consistent this week. While some days showed decent recharge, your system did not stay as settled across the full week, which is the main area to watch.</p>
          <div class="support">
            <div class="support-box">
              <p class="support-label">Recharge pattern</p>
              <p class="support-text">You had some stronger recovery days, especially near the end of the week.</p>
            </div>
            <div class="support-box">
              <p class="support-label">Main watch area</p>
              <p class="support-text">Recovery steadiness looked less consistent across the week, suggesting your body had to work harder to stay balanced.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="meaning">
      <h2>What this may mean</h2>
      <p>This week does not look like a full-system downturn, but it does suggest your body was not fully settled from start to finish. The biggest theme is uneven sleep paired with less consistent recovery steadiness, which can show up as feeling more tired, off-rhythm, or slower to bounce back on some days.</p>
      <p class="footer-line">Reach out to your peer mentor if you have questions or need support.</p>
    </section>
  </div>
</body>
</html>
`,
};

function formatWeekRangeFromNow(): string {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
  const fmtYear = new Intl.DateTimeFormat(undefined, { year: "numeric" });
  const startText = fmt.format(start);
  const endText = fmt.format(end);
  const yearText = fmtYear.format(end);
  return `${startText} – ${endText}, ${yearText}`;
}

function injectNameAndRange(html: string, params: { name: string; weekRange: string }) {
  const safeName = params.name.trim() || "Participant";
  const safeRange = params.weekRange.trim() || "";
  let next = html;
  next = next.replace(/<title>\s*Thrive Weekly Report\s*-\s*.*?<\/title>/i, `<title>Thrive Weekly Report - ${safeName}</title>`);
  next = next.replace(/<h1>\s*.*?<\/h1>/i, `<h1>${safeName}</h1>`);
  if (safeRange) {
    next = next.replace(/<p class="sub">\s*.*?<\/p>/i, `<p class="sub">${safeRange}</p>`);
  }
  return next;
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

  const [htmlByParticipant, setHtmlByParticipant] = useState<Record<string, string>>({});
  const html = selectedParticipant ? htmlByParticipant[selectedParticipant.id] ?? "" : "";

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

  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("master_rules");
  const [templatesByKey, setTemplatesByKey] = useState<Partial<Record<TemplateKey, TemplateRow>>>({});
  const [templateDraftByKey, setTemplateDraftByKey] = useState<Partial<Record<TemplateKey, string>>>({});
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false);

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
    // Initialize selected participant draft once.
    setHtmlByParticipant((prev) => {
      if (prev[selectedParticipant.id]) return prev;
      const base =
        templatesByKey.html_base_template?.content ??
        templateDraftByKey.html_base_template ??
        DEFAULT_TEMPLATES.html_base_template;
      const injected = injectNameAndRange(base, {
        name: selectedParticipant.name?.trim() || "there",
        weekRange: formatWeekRangeFromNow(),
      });
      return { ...prev, [selectedParticipant.id]: injected };
    });
  }, [
    selectedParticipant,
    templateDraftByKey.html_base_template,
    templatesByKey.html_base_template?.content,
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
            {/* HTML preview */}
            <div className="min-h-0 border-b-2 lg:border-b-0 lg:border-r-2 border-slate-100 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Preview</p>
                <Button
                  onClick={() => {
                    if (!selectedParticipant) return;
                    const base =
                      templatesByKey.html_base_template?.content ??
                      templateDraftByKey.html_base_template ??
                      DEFAULT_TEMPLATES.html_base_template;
                    const injected = injectNameAndRange(base, {
                      name: selectedParticipant.name?.trim() || "there",
                      weekRange: formatWeekRangeFromNow(),
                    });
                    setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: injected }));
                    setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "pending" }));
                  }}
                  disabled={!selectedParticipant}
                  className="bg-teal-500 hover:bg-teal-600 text-white"
                  size="sm"
                >
                  Reset to template
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-white">
                {html.trim().length === 0 ? (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
                    No HTML draft yet.
                  </div>
                ) : (
                  <div className="w-full rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                    <iframe
                      title="Weekly report preview"
                      sandbox=""
                      className="w-full h-[calc(100vh-280px)] min-h-[520px] bg-white"
                      srcDoc={html}
                    />
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

