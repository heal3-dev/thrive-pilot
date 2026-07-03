"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useDashboard } from "@/app/dashboard/layout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { BackButton } from "@/components/ui/back-button";
import { DEFAULT_GENERATE_WRAPPER, DEFAULT_MASTER_RULES, DEFAULT_OLGA_HTML_BASE_TEMPLATE, DEFAULT_REVISE_WRAPPER } from "@/lib/weekly-reports/template-defaults";

type ParticipantMini = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  weekly_report_sms_enabled?: boolean;
  weekly_report_email_enabled?: boolean;
};

type ParticipantStatus = "draft" | "approved" | "queued" | "sent" | "failed";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type WeeklyReportMeta = {
  reportId: string;
  participantLabel: string;
  weekEnding: string;
  weekRange: string;
  badgeLabel: string;
  badgeIcon: string;
};

type EditableCard = {
  title: string;
  state: string;
  body: string;
  support1Label: string;
  support1Text: string;
  support2Label: string;
  support2Text: string;
};

type EditableReportContent = {
  badgeText: string;
  cards: [EditableCard, EditableCard, EditableCard];
  meaningParagraph: string;
  hasSupportBoxes: boolean;
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
  "generate_wrapper",
  "revise_wrapper",
  "html_base_template",
];

const TEMPLATE_LABELS: Record<TemplateKey, { title: string; hint: string }> = {
  master_rules: {
    title: "Master Prompt",
    hint: "Comprehensive Thrive Weekly Report instructions here (tone, structure, badge labels, fixed closing line).",
  },
  revise_wrapper: {
    title: "Revise Prompt",
    hint: "Instructions for revising an existing draft using admin feedback. This is applied together with Master Prompt.",
  },
  generate_wrapper: {
    title: "Generate Prompt",
    hint: "Instructions for generating a new draft from metrics. Applied together with Master Prompt. Should return JSON only (no HTML).",
  },
  html_base_template: {
    title: "HTML Template",
    hint: "Branded HTML template (full document). This is used as the starting point for new drafts and preview rendering.",
  },
};

const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  master_rules: DEFAULT_MASTER_RULES,
  revise_wrapper: DEFAULT_REVISE_WRAPPER,
  generate_wrapper: DEFAULT_GENERATE_WRAPPER,
  html_base_template: DEFAULT_OLGA_HTML_BASE_TEMPLATE,
};

function formatUpdatedAtUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Use fixed locale + UTC to avoid SSR/client hydration mismatches.
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
}

interface WeeklyReportMini {
  id: string;
  participant_id: string;
  week_ending: string;
  week_range: string;
  badge_label: string;
  badge_icon: string;
  status: "draft" | "approved" | "queued" | "sent" | "failed";
  email_job_id: string | null;
  sms_message_id: string | null;
  sms_sent_at: string | null;
  sms_last_error: string | null;
  email_jobs?: {
    status: string;
    last_error: string | null;
  }[] | null;
  updated_at?: string;
}

type DisplayStatus = {
  status: string;
  label: string;
  colorClass: string;
  errorMsg?: string | null;
};

function getDisplayStatus(
  status: ParticipantStatus,
  report: WeeklyReportMini | null | undefined
): DisplayStatus {
  if (status === "draft") {
    return { status: "draft", label: "Draft", colorClass: "text-amber-700 font-semibold" };
  }
  if (status === "approved") {
    return { status: "approved", label: "Approved", colorClass: "text-emerald-600 font-semibold" };
  }

  if (!report) {
    if (status === "queued") {
      return { status: "queued", label: "Queued", colorClass: "text-teal-700 font-semibold" };
    }
    if (status === "failed") {
      return { status: "failed", label: "Failed", colorClass: "text-red-700 font-semibold" };
    }
    return { status: "sent", label: "Sent", colorClass: "text-emerald-700 font-semibold" };
  }

  const emailJobsObj = Array.isArray(report.email_jobs) ? report.email_jobs[0] : report.email_jobs;
  const emailSent = report.email_job_id && emailJobsObj?.status === "sent";
  const smsSent = report.sms_message_id && report.sms_sent_at && !report.sms_last_error;

  const emailFailed = report.email_job_id && emailJobsObj?.status === "failed";
  const smsFailed = report.sms_message_id && report.sms_last_error;

  const emailQueued = report.email_job_id && (emailJobsObj?.status === "pending" || emailJobsObj?.status === "sending");

  if (emailSent && smsSent) {
    return { status: "email_sms_sent", label: "Email & SMS Sent", colorClass: "text-emerald-700 font-semibold" };
  }
  if (emailSent && smsFailed) {
    return { status: "email_sent_sms_failed", label: "Email Sent, SMS Failed", colorClass: "text-rose-700 font-semibold", errorMsg: `SMS failed: ${report.sms_last_error}` };
  }
  if (smsSent && emailFailed) {
    return { status: "sms_sent_email_failed", label: "SMS Sent, Email Failed", colorClass: "text-rose-700 font-semibold", errorMsg: `Email failed: ${emailJobsObj?.last_error || "Unknown error"}` };
  }
  if (smsSent && emailQueued) {
    return { status: "sms_sent_email_queued", label: "SMS Sent, Email Queued", colorClass: "text-teal-700 font-semibold" };
  }
  if (emailSent) {
    return { status: "email_sent", label: "Email Sent", colorClass: "text-teal-700 font-semibold" };
  }
  if (smsSent) {
    return { status: "sms_sent", label: "SMS Sent", colorClass: "text-cyan-700 font-semibold" };
  }
  if (emailFailed && smsFailed) {
    return { status: "both_failed", label: "Both Failed", colorClass: "text-red-700 font-semibold", errorMsg: `Email: ${emailJobsObj?.last_error || "error"} | SMS: ${report.sms_last_error}` };
  }
  if (emailFailed) {
    return { status: "email_failed", label: "Email Failed", colorClass: "text-red-700 font-semibold", errorMsg: emailJobsObj?.last_error || "Unknown error" };
  }
  if (smsFailed) {
    return { status: "sms_failed", label: "SMS Failed", colorClass: "text-red-700 font-semibold", errorMsg: report.sms_last_error };
  }
  if (emailQueued) {
    return { status: "email_queued", label: "Email Queued", colorClass: "text-teal-600 font-semibold" };
  }

  if (status === "queued") return { status: "queued", label: "Queued", colorClass: "text-teal-700 font-semibold" };
  if (status === "failed") return { status: "failed", label: "Failed", colorClass: "text-red-700 font-semibold" };
  if (status === "sent") return { status: "sent", label: "Sent", colorClass: "text-emerald-700 font-semibold" };

  return { status: "draft", label: "Draft", colorClass: "text-amber-700 font-semibold" };
}

export default function WeeklyReportsPage() {
  const router = useRouter();
  const { mentor } = useDashboard();
  const isAdmin = mentor.role === "admin";

  const [participants, setParticipants] = useState<ParticipantMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [participantSearchQuery, setParticipantSearchQuery] = useState("");
  const filteredParticipants = useMemo(() => {
    const q = participantSearchQuery.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      if (name.includes(q)) return true;
      // Helpful fallback: allow searching by email/phone too (same behavior as other admin pages).
      const email = (p.email ?? "").toLowerCase();
      const phone = (p.phone_number ?? "").toLowerCase();
      return email.includes(q) || phone.includes(q);
    });
  }, [participantSearchQuery, participants]);

  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("");
  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === selectedParticipantId) ?? null,
    [participants, selectedParticipantId]
  );

  const [htmlByParticipant, setHtmlByParticipant] = useState<Record<string, string>>({});
  const html = selectedParticipant ? htmlByParticipant[selectedParticipant.id] ?? "" : "";
  const [outreachByParticipant, setOutreachByParticipant] = useState<Record<string, string>>({});
  const outreachText = selectedParticipant ? outreachByParticipant[selectedParticipant.id] ?? "" : "";
  const [shareUrlByParticipant, setShareUrlByParticipant] = useState<Record<string, string>>({});
  const [shareReportIdByParticipant, setShareReportIdByParticipant] = useState<Record<string, string>>({});
  const shareUrl = selectedParticipant ? shareUrlByParticipant[selectedParticipant.id] ?? "" : "";
  const [metaByParticipant, setMetaByParticipant] = useState<Record<string, WeeklyReportMeta>>({});
  const selectedMeta = selectedParticipant ? metaByParticipant[selectedParticipant.id] ?? null : null;
  const [completenessByParticipant, setCompletenessByParticipant] = useState<
    Record<string, { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number }>
  >({});
  const selectedCompleteness = selectedParticipant ? completenessByParticipant[selectedParticipant.id] : null;
  const [dataStatusByParticipant, setDataStatusByParticipant] = useState<
    Record<string, { canGenerate: boolean; reason: string | null }>
  >({});
  const selectedDataStatus = selectedParticipant ? dataStatusByParticipant[selectedParticipant.id] : null;
  const hasSelectedDraft = Boolean(selectedParticipant && (htmlByParticipant[selectedParticipant.id] ?? "").trim().length > 0);

  const [statusByParticipant, setStatusByParticipant] = useState<Record<string, ParticipantStatus>>({});
  const [reportsByParticipant, setReportsByParticipant] = useState<Record<string, WeeklyReportMini>>({});

  const selectedStatus: ParticipantStatus =
    (selectedParticipant ? statusByParticipant[selectedParticipant.id] : undefined) ?? "draft";

  const emailApprovedCount = useMemo(() => {
    return Object.values(reportsByParticipant).filter((r) => {
      const currentUiStatus = statusByParticipant[r.participant_id] ?? r.status;
      const part = participants.find((p) => p.id === r.participant_id);
      const emailEnabled = part?.weekly_report_email_enabled !== false;
      return currentUiStatus !== "draft" && r.email_job_id === null && emailEnabled;
    }).length;
  }, [reportsByParticipant, statusByParticipant, participants]);

  const smsApprovedCount = useMemo(() => {
    return Object.values(reportsByParticipant).filter((r) => {
      const currentUiStatus = statusByParticipant[r.participant_id] ?? r.status;
      const part = participants.find((p) => p.id === r.participant_id);
      const smsEnabled = part?.weekly_report_sms_enabled !== false;
      return currentUiStatus !== "draft" && r.sms_message_id === null && smsEnabled;
    }).length;
  }, [reportsByParticipant, statusByParticipant, participants]);

  const totalApprovedCount = useMemo(() => {
    return Object.values(reportsByParticipant).filter((r) => {
      const currentUiStatus = statusByParticipant[r.participant_id] ?? r.status;
      if (currentUiStatus === "draft") return false;
      const part = participants.find((p) => p.id === r.participant_id);
      const emailEnabled = part?.weekly_report_email_enabled !== false;
      const smsEnabled = part?.weekly_report_sms_enabled !== false;
      return (r.email_job_id === null && emailEnabled) || (r.sms_message_id === null && smsEnabled);
    }).length;
  }, [reportsByParticipant, statusByParticipant, participants]);

  const approvedEmailReportIds = useMemo(() => {
    return Object.values(reportsByParticipant)
      .filter((r) => {
        const currentUiStatus = statusByParticipant[r.participant_id] ?? r.status;
        const part = participants.find((p) => p.id === r.participant_id);
        const emailEnabled = part?.weekly_report_email_enabled !== false;
        return currentUiStatus !== "draft" && r.email_job_id === null && emailEnabled;
      })
      .map((r) => r.id);
  }, [reportsByParticipant, statusByParticipant, participants]);

  const approvedSmsReportIds = useMemo(() => {
    return Object.values(reportsByParticipant)
      .filter((r) => {
        const currentUiStatus = statusByParticipant[r.participant_id] ?? r.status;
        const part = participants.find((p) => p.id === r.participant_id);
        const smsEnabled = part?.weekly_report_sms_enabled !== false;
        return currentUiStatus !== "draft" && r.sms_message_id === null && smsEnabled;
      })
      .map((r) => r.id);
  }, [reportsByParticipant, statusByParticipant, participants]);

  const [chatByParticipant, setChatByParticipant] = useState<Record<string, ChatMessage[]>>({});
  const chat = selectedParticipant ? chatByParticipant[selectedParticipant.id] ?? [] : [];
  const [feedbackInput, setFeedbackInput] = useState("");
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [outreachCopied, setOutreachCopied] = useState(false);
  const feedbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isSendingApproved, setIsSendingApproved] = useState(false);
  const lastSavedHtmlRef = useRef<Record<string, string>>({});
  const [isSendApprovedOpen, setIsSendApprovedOpen] = useState(false);
  const [sendPreview, setSendPreview] = useState<null | {
    toEnqueue: Array<{ reportId: string; participantId: string; toEmail: string; participantName: string; weekRange: string }>;
    alreadyQueued: Array<{ reportId: string; participantId: string; weekRange: string }>;
  }>(null);
  const [selectedSendReportIds, setSelectedSendReportIds] = useState<Record<string, boolean>>({});

  const [isSendSmsOpen, setIsSendSmsOpen] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [smsPreview, setSmsPreview] = useState<null | {
    toSend: Array<{ reportId: string; participantId: string; participantName: string; toPhone: string; weekRange: string; shareUrl: string; expiresAt: string }>;
  }>(null);
  const [selectedSmsReportIds, setSelectedSmsReportIds] = useState<Record<string, boolean>>({});

  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("master_rules");
  const [templatesByKey, setTemplatesByKey] = useState<Partial<Record<TemplateKey, TemplateRow>>>({});
  const [templateDraftByKey, setTemplateDraftByKey] = useState<Partial<Record<TemplateKey, string>>>({});
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false);
  const [templatesSaveNotice, setTemplatesSaveNotice] = useState<string | null>(null);
  const templatesSaveNoticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (templatesSaveNoticeTimeoutRef.current) {
        window.clearTimeout(templatesSaveNoticeTimeoutRef.current);
        templatesSaveNoticeTimeoutRef.current = null;
      }
    };
  }, []);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const contentColumnsRef = useRef<HTMLDivElement | null>(null);
  const editorChatRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const PREVIEW_BASE_WIDTH = 980;
  const PREVIEW_BASE_HEIGHT = 1500;

  const autoGeneratedRef = useRef<Set<string>>(new Set());

  const LAYOUT_STORAGE_KEY = "weeklyReportsLayout.v1";
  const [participantsWidthPx, setParticipantsWidthPx] = useState(240); // ~w-60
  const [editorWidthPx, setEditorWidthPx] = useState(420); // right column width on lg+
  const [editorHeightPx, setEditorHeightPx] = useState(240); // top editor height
  const [isDragging, setIsDragging] = useState(false);

  const participantsWidthPxRef = useRef(participantsWidthPx);
  const editorWidthPxRef = useRef(editorWidthPx);
  const editorHeightPxRef = useRef(editorHeightPx);

  useEffect(() => {
    participantsWidthPxRef.current = participantsWidthPx;
  }, [participantsWidthPx]);
  useEffect(() => {
    editorWidthPxRef.current = editorWidthPx;
  }, [editorWidthPx]);
  useEffect(() => {
    editorHeightPxRef.current = editorHeightPx;
  }, [editorHeightPx]);

  const currentTemplateDraft = templateDraftByKey[templateKey] ?? "";
  const currentTemplateRow = templatesByKey[templateKey];

  const formatReportTitleLine = useCallback((meta: WeeklyReportMeta) => {
    return `Thrive Weekly Report ${meta.participantLabel} ${meta.weekRange} ${meta.badgeLabel} ${meta.badgeIcon}.`;
  }, []);

  const buildOutreachText = useCallback((meta: WeeklyReportMeta) => {
    const first = meta.participantLabel.trim().split(/\s+/)[0] || meta.participantLabel.trim();
    return [
      `Hi ${first}, this week your Thrive weekly report (${meta.weekRange}) shows that you flagged ${meta.badgeLabel} ${meta.badgeIcon}.`,
      "Let us know if you have any questions after you’ve reviewed the report.",
    ].join(" ");
  }, []);

  const composedOutreachText = useMemo(() => {
    if (!selectedMeta) return "";
    const rawBase = (outreachText.trim().length > 0 ? outreachText : buildOutreachText(selectedMeta)).trim();
    // Outreach text is cached per-participant in UI state; ensure the visible week range always matches the selected report.
    const base = rawBase.replace(
      /\b(Thrive\s+weekly\s+report)\s*\(([^)]*)\)/i,
      `$1 (${selectedMeta.weekRange})`
    );
    if (!shareUrl.trim()) return base;
    return `${base}\n\nWeekly report: ${shareUrl.trim()}`;
  }, [buildOutreachText, outreachText, selectedMeta, shareUrl]);

  useEffect(() => {
    let cancelled = false;
    async function ensureShareUrl() {
      if (!selectedParticipant || !selectedMeta?.reportId) return;
      const pid = selectedParticipant.id;
      if (shareUrlByParticipant[pid] && shareReportIdByParticipant[pid] === selectedMeta.reportId) return;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/admin/weekly-reports/share", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reportId: selectedMeta.reportId }),
        });
        const j = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) return;
        const tok =
          j && typeof j === "object" && "token" in j && typeof (j as { token?: unknown }).token === "string"
            ? (j as { token: string }).token
            : null;
        if (!tok) return;
        const origin =
          typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
        if (!origin) return;

        const url = `${origin}/r/w/${encodeURIComponent(tok)}`;
        if (cancelled) return;
        setShareUrlByParticipant((prev) => ({ ...prev, [pid]: url }));
        setShareReportIdByParticipant((prev) => ({ ...prev, [pid]: selectedMeta.reportId }));
      } catch {
        // ignore
      }
    }
    void ensureShareUrl();
    return () => {
      cancelled = true;
    };
  }, [selectedMeta?.reportId, selectedParticipant, shareReportIdByParticipant, shareUrlByParticipant]);

  const getEditableContent = useCallback((html: string): EditableReportContent | null => {
    if (!html.trim()) return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const badgeText = doc.querySelector(".badge-text")?.textContent ?? "";

      const sections = Array.from(doc.querySelectorAll("section.card")).slice(0, 3);
      const defaultTitles = ["STRESS", "SLEEP", "RECOVERY"] as const;
      const hasSupportBoxes = sections.some((s) => Boolean(s.querySelector(".support")));
      const cards = sections.map((section, idx) => {
        const title = (section.querySelector("h3")?.textContent ?? defaultTitles[idx] ?? `CARD ${idx + 1}`).trim();
        const state = section.querySelector(".state")?.textContent ?? "";
        const body = section.querySelector(".body")?.textContent ?? "";
        const labels = Array.from(section.querySelectorAll(".support-label")).map((n) => n.textContent ?? "");
        const texts = Array.from(section.querySelectorAll(".support-text")).map((n) => n.textContent ?? "");
        return {
          title,
          state,
          body,
          support1Label: labels[0] ?? "",
          support1Text: texts[0] ?? "",
          support2Label: labels[1] ?? "",
          support2Text: texts[1] ?? "",
        };
      });

      const meaning = doc.querySelector("section.meaning");
      const meaningParagraph =
        Array.from(meaning?.querySelectorAll("p") ?? []).find((p) => !p.classList.contains("footer-line"))?.textContent ?? "";

      if (cards.length < 3) return null;

      return {
        badgeText,
        cards: [cards[0]!, cards[1]!, cards[2]!] as [EditableCard, EditableCard, EditableCard],
        meaningParagraph,
        hasSupportBoxes,
      };
    } catch {
      return null;
    }
  }, []);

  const mutateHtml = useCallback((html: string, mutator: (doc: Document) => void): string => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      mutator(doc);
      const serialized = doc.documentElement?.outerHTML ?? html;
      const hasDoctype = /^\s*<!doctype/i.test(html);
      return hasDoctype ? `<!DOCTYPE html>\n${serialized}` : serialized;
    } catch {
      return html;
    }
  }, []);

  const updateSelectedHtml = useCallback(
    (mutator: (doc: Document) => void) => {
      if (!selectedParticipant) return;
      const current = htmlByParticipant[selectedParticipant.id] ?? "";
      if (!current.trim()) return;
      const next = mutateHtml(current, mutator);
      setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: next }));
      setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "draft" }));
    },
    [htmlByParticipant, mutateHtml, selectedParticipant]
  );

  const editable = useMemo(() => getEditableContent(html), [getEditableContent, html]);

  const autosizeFeedback = useCallback(() => {
    const el = feedbackTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const max = 140;
    const next = Math.min(max, el.scrollHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        participantsWidthPx: number;
        editorWidthPx: number;
        editorHeightPx: number;
      }>;
      // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
      queueMicrotask(() => {
        if (typeof parsed.participantsWidthPx === "number" && Number.isFinite(parsed.participantsWidthPx)) {
          setParticipantsWidthPx(parsed.participantsWidthPx);
        }
        if (typeof parsed.editorWidthPx === "number" && Number.isFinite(parsed.editorWidthPx)) {
          setEditorWidthPx(parsed.editorWidthPx);
        }
        if (typeof parsed.editorHeightPx === "number" && Number.isFinite(parsed.editorHeightPx)) {
          setEditorHeightPx(parsed.editorHeightPx);
        }
      });
    } catch {
      // ignore
    }
  }, []);

  const persistLayout = useCallback((next?: { participantsWidthPx?: number; editorWidthPx?: number; editorHeightPx?: number }) => {
    try {
      const current = {
        participantsWidthPx: participantsWidthPxRef.current,
        editorWidthPx: editorWidthPxRef.current,
        editorHeightPx: editorHeightPxRef.current,
        ...(next ?? {}),
      };
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
  }, []);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const startDragCol = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, kind: "participants" | "editorWidth") => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      setIsDragging(true);

      const startParticipants = participantsWidthPx;
      const startEditorWidth = editorWidthPx;
      const contentW = contentColumnsRef.current?.getBoundingClientRect().width ?? 0;
      const SPLITTER = 6;
      const MIN_PARTICIPANTS = 200;
      const MAX_PARTICIPANTS = 480;
      const MIN_EDITOR = 360;
      const MIN_PREVIEW = 360;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (kind === "participants") {
          const next = clamp(startParticipants + dx, MIN_PARTICIPANTS, MAX_PARTICIPANTS);
          setParticipantsWidthPx(next);
          return;
        }
        const maxEditor = contentW > 0 ? Math.max(MIN_EDITOR, contentW - MIN_PREVIEW - SPLITTER) : 680;
        const next = clamp(startEditorWidth - dx, MIN_EDITOR, maxEditor);
        setEditorWidthPx(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setIsDragging(false);
        persistLayout();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [participantsWidthPx, editorWidthPx, persistLayout]
  );

  const startDragRow = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      setIsDragging(true);
      const startEditorH = editorHeightPx;
      const containerH = editorChatRef.current?.getBoundingClientRect().height ?? 0;
      const SPLITTER = 6;
      const MIN_EDITOR = 160;
      const MIN_CHAT = 160;
      const maxEditor = containerH > 0 ? Math.max(MIN_EDITOR, containerH - MIN_CHAT - SPLITTER) : 520;

      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        const next = clamp(startEditorH + dy, MIN_EDITOR, maxEditor);
        setEditorHeightPx(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setIsDragging(false);
        persistLayout();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editorHeightPx, persistLayout]
  );

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
          .select("id, name, email, phone_number, weekly_report_sms_enabled, weekly_report_email_enabled")
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
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      void loadTemplates(false);
    });
  }, [isAdmin, loadTemplates]);

  const refreshApprovedCount = useCallback(async () => {
    // Computed dynamically from reportsByParticipant state
    return Promise.resolve();
  }, []);

  const refreshParticipantStatuses = useCallback(async () => {
    try {
      if (participants.length === 0) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;

      const ids = participants.map((p) => p.id);
      const chunkSize = 150;
      const merged: Record<string, WeeklyReportMini> = {};
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const res = await fetch("/api/admin/weekly-reports/list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ participantIds: chunk }),
        });
        if (!res.ok) continue;
        const j = (await res.json().catch(() => null)) as unknown;
        const map =
          j && typeof j === "object" && "latestByParticipant" in j
            ? (j as { latestByParticipant?: unknown }).latestByParticipant
            : null;
        if (map && typeof map === "object") Object.assign(merged, map as Record<string, WeeklyReportMini>);
      }

      setReportsByParticipant((prev) => {
        const next = { ...prev };
        for (const [pid, row] of Object.entries(merged)) {
          if (!row || typeof row !== "object") continue;
          const activeReportId = metaByParticipant[pid]?.reportId;
          if (!activeReportId || row.id === activeReportId) {
            next[pid] = row;
          }
        }
        return next;
      });

      setStatusByParticipant((prev) => {
        const next = { ...prev };
        for (const [pid, row] of Object.entries(merged)) {
          if (!row || typeof row !== "object") continue;
          const activeReportId = metaByParticipant[pid]?.reportId;
          if (!activeReportId || row.id === activeReportId) {
            const s = row.status;
            const status: ParticipantStatus =
              s === "approved" || s === "queued" || s === "sent" || s === "failed" || s === "draft" ? s : "draft";
            next[pid] = status;
          }
        }
        return next;
      });

      // Also refresh approvedCount to stay in sync.
      await refreshApprovedCount();
    } catch {
      // ignore
    }
  }, [participants, refreshApprovedCount, metaByParticipant]);

  useEffect(() => {
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      void refreshApprovedCount();
    });
  }, [refreshApprovedCount]);

  useEffect(() => {
    // Avoid triggering `react-hooks/set-state-in-effect` by deferring.
    queueMicrotask(() => {
      void refreshParticipantStatuses();
    });
  }, [refreshParticipantStatuses]);

  useEffect(() => {
    if (!selectedParticipant || !selectedMeta) return;
    const pid = selectedParticipant.id;
    const currentHtml = (html ?? "").trim();
    if (!currentHtml) return;
    if (lastSavedHtmlRef.current[pid] === currentHtml) return;

    const handle = window.setTimeout(async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/admin/weekly-reports/report", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            participantId: pid,
            weekEnding: selectedMeta.weekEnding,
            weekRange: selectedMeta.weekRange,
            badgeLabel: selectedMeta.badgeLabel,
            badgeIcon: selectedMeta.badgeIcon,
            html: currentHtml,
          }),
        });
        if (!res.ok) return;

        lastSavedHtmlRef.current[pid] = currentHtml;
        setStatusByParticipant((prev) => ({ ...prev, [pid]: "draft" }));
        void refreshApprovedCount();
      } catch {
        // ignore
      }
    }, 800);

    return () => window.clearTimeout(handle);
  }, [
    refreshApprovedCount,
    selectedMeta,
    selectedParticipant,
    html,
  ]);

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

        // First, load the most recent saved report if it exists (avoid unnecessary OpenAI calls).
        const existingRes = await fetch(`/api/admin/weekly-reports/report?participantId=${encodeURIComponent(p.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (existingRes.ok) {
          const existingJson = (await existingRes.json().catch(() => null)) as unknown;
          const report =
            existingJson && typeof existingJson === "object" && "report" in existingJson
              ? (existingJson as { report?: unknown }).report
              : null;
          if (report && typeof report === "object") {
            const r = report as Record<string, unknown>;
            const html = typeof r.html === "string" ? r.html : "";
            if (html.trim().length > 0) {
              setHtmlByParticipant((prev) => ({ ...prev, [p.id]: html }));
              lastSavedHtmlRef.current[p.id] = html.trim();

              const weekRange = typeof r.week_range === "string" ? r.week_range : null;
              const badgeLabel = typeof r.badge_label === "string" ? r.badge_label : null;
              const badgeIcon = typeof r.badge_icon === "string" ? r.badge_icon : null;
              const weekEnding = typeof r.week_ending === "string" ? r.week_ending : "";
              const reportId = typeof r.id === "string" ? r.id : "";
              if (weekRange && badgeLabel && badgeIcon) {
              setMetaByParticipant((prev) => ({
                ...prev,
                [p.id]: {
                  reportId,
                  participantLabel: formatParticipantLabel(p),
                  weekEnding,
                  weekRange,
                  badgeLabel,
                  badgeIcon,
                },
              }));
            }

              const statusRaw = typeof r.status === "string" ? r.status : "draft";
              const status: ParticipantStatus =
                statusRaw === "approved" || statusRaw === "queued" || statusRaw === "sent" || statusRaw === "failed"
                  ? statusRaw
                  : "draft";
              setStatusByParticipant((prev) => ({ ...prev, [p.id]: status }));
              autoGeneratedRef.current.add(p.id);
              return;
            }
          }
        }

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
          participantLabel?: string;
          weekEnding?: string;
          weekRange?: string;
          badgeLabel?: string;
          badgeIcon?: string;
          outreachText?: string;
          reportId?: string | null;
          reportStatus?: string;
          completeness?: { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number };
        };
        if (cancelled) return;

        setHtmlByParticipant((prev) => ({ ...prev, [p.id]: j.updatedHtml ?? "" }));
        lastSavedHtmlRef.current[p.id] = (j.updatedHtml ?? "").trim();
        setStatusByParticipant((prev) => ({ ...prev, [p.id]: "draft" }));
        if (typeof j.outreachText === "string" && j.outreachText.trim().length > 0) {
          setOutreachByParticipant((prev) => ({ ...prev, [p.id]: j.outreachText!.trim() }));
        }
        if (j.weekRange && j.badgeLabel && j.badgeIcon && j.reportId) {
          const weekRange = j.weekRange;
          const badgeLabel = j.badgeLabel;
          const badgeIcon = j.badgeIcon;
          setMetaByParticipant((prev) => ({
            ...prev,
            [p.id]: {
              reportId: j.reportId || "",
              participantLabel: j.participantLabel || formatParticipantLabel(p),
              weekEnding: j.weekEnding || "",
              weekRange,
              badgeLabel,
              badgeIcon,
            },
          }));
        }
        if (j.completeness) {
          setCompletenessByParticipant((prev) => ({ ...prev, [p.id]: j.completeness! }));
        }

        const nextMeta =
          j.reportId && j.weekRange && j.badgeLabel && j.badgeIcon
            ? ({
                reportId: j.reportId,
                participantLabel: j.participantLabel || formatParticipantLabel(p),
                weekEnding: j.weekEnding || "",
                weekRange: j.weekRange,
                badgeLabel: j.badgeLabel,
                badgeIcon: j.badgeIcon,
              } as WeeklyReportMeta)
            : null;

        const assistantMsg: ChatMessage = {
          id: createId("gen"),
          role: "assistant",
          content: nextMeta ? formatReportTitleLine(nextMeta) : "Generated the weekly report draft.",
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
    formatReportTitleLine,
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
        <div className="flex items-center gap-4">
          <BackButton onClick={() => router.push("/dashboard")} className="border-slate-300" />
          <h1 className="text-lg font-bold text-slate-800">Weekly Reports</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/weekly-reports/demo")}
            className="border-slate-300"
          >
            Demo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsTemplatesOpen(true)}
            className="border-slate-300"
          >
            Templates
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              setIsSendApprovedOpen(true);
              setSendPreview(null);
              setSelectedSendReportIds({});
              setIsSendingApproved(true);
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData?.session?.access_token;
                if (!token) throw new Error("Authentication required");
                const res = await fetch("/api/admin/weekly-reports/send-approved", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ dryRun: true, reportIds: approvedEmailReportIds }),
                });
                const j = (await res.json().catch(() => null)) as unknown;
                if (!res.ok) {
                  const msg =
                    j && typeof j === "object" && "error" in j && typeof (j as { error?: unknown }).error === "string"
                      ? (j as { error: string }).error
                      : "Failed to preview approved sends";
                  throw new Error(msg);
                }
                const getArray = (key: "toEnqueue" | "alreadyQueued"): unknown[] => {
                  if (!j || typeof j !== "object" || !(key in j)) return [];
                  const v = (j as Record<string, unknown>)[key];
                  return Array.isArray(v) ? v : [];
                };
                const toEnqueue = getArray("toEnqueue");
                const alreadyQueued = getArray("alreadyQueued");
                const preview = {
                  toEnqueue: toEnqueue as Array<{ reportId: string; participantId: string; toEmail: string; participantName: string; weekRange: string }>,
                  alreadyQueued: alreadyQueued as Array<{ reportId: string; participantId: string; weekRange: string }>,
                };
                setSendPreview(preview);
                const initial: Record<string, boolean> = {};
                for (const it of preview.toEnqueue) initial[it.reportId] = true;
                setSelectedSendReportIds(initial);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Failed to preview approved sends");
                setIsSendApprovedOpen(false);
              } finally {
                setIsSendingApproved(false);
              }
            }}
            disabled={emailApprovedCount === 0}
            className="bg-teal-500 hover:bg-teal-600 text-white"
          >
            {isSendingApproved ? "Sending…" : `Send Email (${emailApprovedCount})`}
          </Button>

          <Button
            size="sm"
            onClick={async () => {
              setIsSendSmsOpen(true);
              setSmsPreview(null);
              setSelectedSmsReportIds({});
              setIsSendingSms(true);
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData?.session?.access_token;
                if (!token) throw new Error("Authentication required");
                const res = await fetch("/api/admin/weekly-reports/send-approved-sms", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ dryRun: true, reportIds: approvedSmsReportIds }),
                });
                const j = (await res.json().catch(() => null)) as unknown;
                if (!res.ok) {
                  const msg =
                    j && typeof j === "object" && "error" in j && typeof (j as { error?: unknown }).error === "string"
                      ? (j as { error: string }).error
                      : "Failed to preview SMS sends";
                  throw new Error(msg);
                }

                const list =
                  j && typeof j === "object" && "preview" in j && Array.isArray((j as { preview?: unknown }).preview)
                    ? ((j as { preview: unknown[] }).preview as Array<{
                        reportId: string;
                        participantId: string;
                        participantName: string;
                        toPhone: string;
                        weekRange: string;
                        shareUrl: string;
                        expiresAt: string;
                      }>)
                    : [];

                const preview = { toSend: list };
                setSmsPreview(preview);
                const initial: Record<string, boolean> = {};
                for (const it of preview.toSend) initial[it.reportId] = true;
                setSelectedSmsReportIds(initial);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Failed to preview SMS sends");
                setIsSendSmsOpen(false);
              } finally {
                setIsSendingSms(false);
              }
            }}
            disabled={smsApprovedCount === 0}
            className="bg-teal-500 hover:bg-teal-600 text-white"
          >
            {isSendingSms ? "Sending…" : `Send SMS (${smsApprovedCount})`}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={isSendApprovedOpen}
        onClose={() => setIsSendApprovedOpen(false)}
        title="Send approved reports"
        subtitle="Confirm who will be queued for sending."
        size="lg"
      >
        <div className="space-y-4">
          {!sendPreview ? (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">Loading preview…</div>
          ) : (
            <>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-900">
                  Will enqueue:{" "}
                  {Object.values(selectedSendReportIds).filter(Boolean).length} / {sendPreview.toEnqueue.length}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Skipped (already enqueued): {sendPreview.alreadyQueued.length}
                </p>
              </div>

              <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {sendPreview.toEnqueue.length === 0 ? (
                  <div className="p-4 text-sm text-slate-600">No approved reports ready to enqueue.</div>
                ) : (
                  sendPreview.toEnqueue.map((it) => (
                    <label key={it.reportId} className="flex items-start gap-3 px-4 py-3 border-b border-slate-100">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(selectedSendReportIds[it.reportId])}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedSendReportIds((prev) => ({ ...prev, [it.reportId]: checked }));
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{it.participantName}</p>
                        <p className="text-xs text-slate-500 truncate">{it.toEmail}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{it.weekRange}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>

              {sendPreview.alreadyQueued.length > 0 ? (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 space-y-2">
                  <p>
                    <span className="font-semibold">Skipped (already enqueued):</span> {sendPreview.alreadyQueued.length}
                  </p>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" className="border-slate-300" size="sm" onClick={() => setIsSendApprovedOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-teal-500 hover:bg-teal-600 text-white"
                  disabled={Object.values(selectedSendReportIds).filter(Boolean).length === 0 || isSendingApproved}
                  onClick={async () => {
                    setIsSendingApproved(true);
                    try {
                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData?.session?.access_token;
                      if (!token) throw new Error("Authentication required");
                      const reportIds = Object.entries(selectedSendReportIds)
                        .filter(([, v]) => v)
                        .map(([k]) => k);
                      const res = await fetch("/api/admin/weekly-reports/send-approved", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ reportIds }),
                      });
                      const j = (await res.json().catch(() => null)) as unknown;
                      if (!res.ok) {
                        const msg =
                          j && typeof j === "object" && "error" in j && typeof (j as { error?: unknown }).error === "string"
                            ? (j as { error: string }).error
                            : "Failed to enqueue approved reports";
                        throw new Error(msg);
                      }
                      const enq =
                        j && typeof j === "object" && "enqueued" in j && typeof (j as { enqueued?: unknown }).enqueued === "number"
                          ? (j as { enqueued: number }).enqueued
                          : 0;
                      alert(`Enqueued ${enq} reports.`);
                      setIsSendApprovedOpen(false);
                      await refreshParticipantStatuses();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to enqueue approved reports");
                    } finally {
                      setIsSendingApproved(false);
                    }
                  }}
                >
                  {isSendingApproved ? "Enqueueing…" : "Confirm & enqueue"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isSendSmsOpen}
        onClose={() => setIsSendSmsOpen(false)}
        title="Send approved reports (SMS)"
        subtitle="Confirm who will receive an SMS with a report link."
        size="lg"
      >
        <div className="space-y-4">
          {!smsPreview ? (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">Loading preview…</div>
          ) : (
            <>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-900">
                  Will send: {Object.values(selectedSmsReportIds).filter(Boolean).length} / {smsPreview.toSend.length}
                </p>
                <p className="text-xs text-slate-500 mt-1">Links expire after 7 days.</p>
              </div>

              <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {smsPreview.toSend.length === 0 ? (
                  <div className="p-4 text-sm text-slate-600">No approved reports ready to send via SMS.</div>
                ) : (
                  smsPreview.toSend.map((it) => (
                    <label key={it.reportId} className="flex items-start gap-3 px-4 py-3 border-b border-slate-100">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(selectedSmsReportIds[it.reportId])}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedSmsReportIds((prev) => ({ ...prev, [it.reportId]: checked }));
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{it.participantName}</p>
                        <p className="text-xs text-slate-500 truncate">{it.toPhone}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{it.weekRange}</p>
                        <p className="text-[11px] text-slate-400 mt-1 truncate">{it.shareUrl}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-slate-300 shrink-0"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(it.shareUrl);
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        Copy link
                      </Button>
                    </label>
                  ))
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" className="border-slate-300" size="sm" onClick={() => setIsSendSmsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-teal-500 hover:bg-teal-600 text-white"
                  disabled={Object.values(selectedSmsReportIds).filter(Boolean).length === 0 || isSendingSms}
                  onClick={async () => {
                    setIsSendingSms(true);
                    try {
                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData?.session?.access_token;
                      if (!token) throw new Error("Authentication required");
                      const reportIds = Object.entries(selectedSmsReportIds)
                        .filter(([, v]) => v)
                        .map(([k]) => k);
                      const res = await fetch("/api/admin/weekly-reports/send-approved-sms", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ reportIds }),
                      });
                      const j = (await res.json().catch(() => null)) as unknown;
                      if (!res.ok) {
                        const msg =
                          j && typeof j === "object" && "error" in j && typeof (j as { error?: unknown }).error === "string"
                            ? (j as { error: string }).error
                            : "Failed to send SMS";
                        throw new Error(msg);
                      }
                      const sent =
                        j && typeof j === "object" && "sent" in j && typeof (j as { sent?: unknown }).sent === "number"
                          ? (j as { sent: number }).sent
                          : 0;
                      alert(`Sent ${sent} SMS messages.`);
                      setIsSendSmsOpen(false);
                      await refreshParticipantStatuses();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to send SMS");
                    } finally {
                      setIsSendingSms(false);
                    }
                  }}
                >
                  {isSendingSms ? "Sending…" : "Confirm & send"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        title="Weekly Report Templates"
        subtitle="Edit the active prompt templates used by generation/revision. Changes apply immediately to new chat revisions."
        size="4xl"
        resizable
        closeOnBackdropClick={false}
        className="max-w-[96vw] md:max-w-5xl lg:max-w-6xl h-[88vh]"
        bodyClassName="p-4 sm:p-6"
      >
        <div className="flex flex-col gap-4 h-full min-h-0">
          {templatesError ? (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm font-semibold text-red-700">{templatesError}</p>
            </div>
          ) : null}
          {templatesSaveNotice ? (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800">{templatesSaveNotice}</p>
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
                  Active version: v{currentTemplateRow.version} · Updated {formatUpdatedAtUtc(currentTemplateRow.updated_at)} UTC
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
            className="w-full flex-1 min-h-0 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
          />

          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white border-t border-slate-100 flex items-center justify-between gap-3">
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
                  size="sm"
                >
                  Seed default
                </Button>
              ) : null}
              <Button
                onClick={async () => {
                  const content = (templateDraftByKey[templateKey] ?? "").trimEnd();
                  if (content.trim().length === 0) {
                    setTemplatesError("Template content cannot be empty.");
                    return;
                  }
                  setTemplatesError(null);
                  setTemplatesSaveNotice(null);
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

                    setTemplatesSaveNotice("Saved.");
                    if (templatesSaveNoticeTimeoutRef.current) {
                      window.clearTimeout(templatesSaveNoticeTimeoutRef.current);
                    }
                    templatesSaveNoticeTimeoutRef.current = window.setTimeout(() => {
                      setTemplatesSaveNotice(null);
                      templatesSaveNoticeTimeoutRef.current = null;
                    }, 1400);
                  } catch (e) {
                    setTemplatesError(e instanceof Error ? e.message : "Failed to save template");
                  } finally {
                    setIsSavingTemplate(false);
                  }
                }}
                disabled={isSavingTemplate}
                className="bg-teal-500 hover:bg-teal-600 text-white"
                size="sm"
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

      <div
        className="flex-1 min-h-0 bg-white rounded-2xl border-2 border-slate-100 overflow-hidden grid"
        style={{ gridTemplateColumns: `${Math.round(participantsWidthPx)}px 6px minmax(0, 1fr)` }}
      >
        {/* Left: participants */}
        <div className="border-r-0 border-slate-100 flex flex-col min-h-0">
          <div className="p-4 border-b-2 border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Participants</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {participantSearchQuery.trim().length > 0 ? `${filteredParticipants.length} of ${participants.length}` : `${participants.length}`}{" "}
                  total
                </p>
              </div>
               {totalApprovedCount > 0 ? (
                <span className="inline-flex min-w-8 h-7 px-2 bg-teal-500 text-white text-sm font-bold rounded-full items-center justify-center">
                  {totalApprovedCount}
                </span>
              ) : null}
            </div>
 
            <div className="mt-3">
              <Input
                value={participantSearchQuery}
                onChange={(e) => setParticipantSearchQuery(e.target.value)}
                placeholder="Search participants…"
                className="h-8 text-xs placeholder:text-xs"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-slate-500">Loading…</div>
            ) : participants.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No participants.</div>
            ) : filteredParticipants.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No participants match your search.</div>
            ) : (
              filteredParticipants.map((p) => {
                const status: ParticipantStatus = statusByParticipant[p.id] ?? "draft";
                const display = getDisplayStatus(status, reportsByParticipant[p.id]);
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
                          <span className={display.colorClass} title={display.errorMsg || undefined}>
                            {display.label}
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

        <div
          onPointerDown={(e) => startDragCol(e, "participants")}
          className={`bg-slate-100 hover:bg-slate-200 transition-colors cursor-col-resize touch-none select-none ${
            isDragging ? "bg-slate-200" : ""
          }`}
          title="Drag to resize"
        />

        {/* Right: main */}
        <div className="min-w-0 flex flex-col min-h-0">
          {/* Top summary bar */}
          <div className="p-4 border-b-2 border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 truncate leading-tight">
                  {selectedParticipant ? formatParticipantLabel(selectedParticipant) : "Select a participant"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Status:{" "}
                  <span
                    className={(() => {
                      const display = getDisplayStatus(selectedStatus, selectedParticipant ? reportsByParticipant[selectedParticipant.id] : null);
                      return display.colorClass;
                    })()}
                    title={(() => {
                      const display = getDisplayStatus(selectedStatus, selectedParticipant ? reportsByParticipant[selectedParticipant.id] : null);
                      return display.errorMsg || undefined;
                    })()}
                  >
                    {(() => {
                      const display = getDisplayStatus(selectedStatus, selectedParticipant ? reportsByParticipant[selectedParticipant.id] : null);
                      return display.label;
                    })()}
                  </span>
                </p>
                {selectedParticipant && (
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                    <span className="font-medium">Send via:</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedParticipant.weekly_report_email_enabled !== false}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          try {
                            const { data: sessionData } = await supabase.auth.getSession();
                            const token = sessionData?.session?.access_token;
                            if (!token) throw new Error("Authentication required");
                            const res = await fetch(`/api/admin/participants/${selectedParticipant.id}`, {
                              method: "PATCH",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ weekly_report_email_enabled: checked }),
                            });
                            if (!res.ok) throw new Error("Failed to update preference");
                            setParticipants((prev) =>
                              prev.map((p) =>
                                p.id === selectedParticipant.id
                                  ? { ...p, weekly_report_email_enabled: checked }
                                  : p
                              )
                            );
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "Failed to update preference");
                          }
                        }}
                      />
                      Email
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedParticipant.weekly_report_sms_enabled !== false}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          try {
                            const { data: sessionData } = await supabase.auth.getSession();
                            const token = sessionData?.session?.access_token;
                            if (!token) throw new Error("Authentication required");
                            const res = await fetch(`/api/admin/participants/${selectedParticipant.id}`, {
                              method: "PATCH",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ weekly_report_sms_enabled: checked }),
                            });
                            if (!res.ok) throw new Error("Failed to update preference");
                            setParticipants((prev) =>
                              prev.map((p) =>
                                p.id === selectedParticipant.id
                                  ? { ...p, weekly_report_sms_enabled: checked }
                                  : p
                              )
                            );
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "Failed to update preference");
                          }
                        }}
                      />
                      SMS
                    </label>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!selectedParticipant || !selectedMeta) return;
                    try {
                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData?.session?.access_token;
                      if (!token) throw new Error("Authentication required");

                      const nextStatus: ParticipantStatus =
                        selectedStatus === "approved" || selectedStatus === "sent" ? "draft" : "approved";
                      const res = await fetch("/api/admin/weekly-reports/report/approve", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                          participantId: selectedParticipant.id,
                          weekEnding: selectedMeta.weekEnding,
                          status: nextStatus === "approved" ? "approved" : "draft",
                        }),
                      });
                      const j = (await res.json().catch(() => null)) as unknown;
                      if (!res.ok) {
                        const msg =
                          j && typeof j === "object" && "error" in j && typeof (j as { error?: unknown }).error === "string"
                            ? (j as { error: string }).error
                            : "Failed to update status";
                        throw new Error(msg);
                      }
                      const statusRaw = (() => {
                        if (!j || typeof j !== "object" || !("report" in j)) return nextStatus;
                        const r = (j as { report?: unknown }).report;
                        if (!r || typeof r !== "object" || !("status" in r)) return nextStatus;
                        const s = (r as { status?: unknown }).status;
                        return typeof s === "string" ? s : nextStatus;
                      })();
                      const normalized: ParticipantStatus =
                        statusRaw === "approved" || statusRaw === "queued" || statusRaw === "sent" || statusRaw === "failed"
                          ? statusRaw
                          : "draft";
                      setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: normalized }));
                      // Re-fetch reportsByParticipant so Send Email / Send SMS counts update.
                      await refreshParticipantStatuses();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed to update status");
                    }
                  }}
                  disabled={!selectedParticipant || !selectedMeta || selectedStatus === "queued"}
                  size="sm"
                  className="border-slate-300"
                >
                  {selectedStatus === "approved" || selectedStatus === "sent" ? "Mark Draft" : "Approve"}
                </Button>
              </div>
            </div>
          </div>

          {/* Content columns */}
          <div
            ref={contentColumnsRef}
            className="flex-1 min-h-0 grid grid-cols-1 lg:[grid-template-columns:minmax(0,1fr)_6px_var(--wr-editor-width)] gap-0"
            style={
              {
                "--wr-editor-width": `${Math.round(editorWidthPx)}px`,
              } as React.CSSProperties
            }
          >
            {/* HTML preview */}
            <div className="min-h-0 border-b-2 lg:border-b-0 lg:border-r-0 border-slate-100 flex flex-col">
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

                        const participantLabel = formatParticipantLabel(selectedParticipant);

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
                          participantLabel?: string;
                          weekEnding?: string;
                          weekRange?: string;
                          badgeLabel?: string;
                          badgeIcon?: string;
                          outreachText?: string;
                          reportId?: string | null;
                          completeness?: { calendarDaysPresent: number; calendarDaysExpected: number; sleepNightsPresent: number; sleepNightsExpected: number };
                        };
                        const updatedHtml = j.updatedHtml ?? "";

                        setHtmlByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: updatedHtml }));
                        lastSavedHtmlRef.current[selectedParticipant.id] = updatedHtml.trim();
                        setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "draft" }));
                        if (typeof j.outreachText === "string" && j.outreachText.trim().length > 0) {
                          setOutreachByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: j.outreachText!.trim() }));
                        }
                        if (j.weekRange && j.badgeLabel && j.badgeIcon && j.reportId) {
                          const weekRange = j.weekRange;
                          const badgeLabel = j.badgeLabel;
                          const badgeIcon = j.badgeIcon;
                          setMetaByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: {
                              reportId: j.reportId || "",
                              participantLabel: j.participantLabel || participantLabel,
                              weekEnding: j.weekEnding || "",
                              weekRange,
                              badgeLabel,
                              badgeIcon,
                            },
                          }));
                        }
                        if (j.completeness) {
                          setCompletenessByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: j.completeness! }));
                        }

                        const nextMeta =
                          j.reportId && j.weekRange && j.badgeLabel && j.badgeIcon
                            ? ({
                                reportId: j.reportId,
                                participantLabel: j.participantLabel || participantLabel,
                                weekEnding: j.weekEnding || "",
                                weekRange: j.weekRange,
                                badgeLabel: j.badgeLabel,
                                badgeIcon: j.badgeIcon,
                              } as WeeklyReportMeta)
                            : null;

                        const assistantMsg: ChatMessage = {
                          id: createId("gen"),
                          role: "assistant",
                          content: nextMeta ? formatReportTitleLine(nextMeta) : "Generated the weekly report draft.",
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
                    {isGenerating ? "Generating…" : hasSelectedDraft ? "Regenerate" : "Generate from data"}
                  </Button>
                </div>
              </div>
              <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 bg-white">
                {selectedMeta ? (
                  <div className="mb-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900">Outreach text (copy/paste)</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-slate-300"
                          onClick={async () => {
                            try {
                              const text = composedOutreachText;
                              await navigator.clipboard.writeText(text);
                              setOutreachCopied(true);
                              window.setTimeout(() => setOutreachCopied(false), 1200);
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          {outreachCopied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      value={composedOutreachText}
                      className="mt-3 w-full min-h-[124px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 resize-none"
                    />
                  </div>
                ) : null}
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
                          style={{
                            width: PREVIEW_BASE_WIDTH,
                            height: PREVIEW_BASE_HEIGHT,
                            background: "white",
                            pointerEvents: isDragging ? "none" : "auto",
                          }}
                          srcDoc={html}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              onPointerDown={(e) => startDragCol(e, "editorWidth")}
              className={`bg-slate-100 hover:bg-slate-200 transition-colors cursor-col-resize touch-none select-none ${
                isDragging ? "bg-slate-200" : ""
              } hidden lg:block`}
              title="Drag to resize"
            />

            {/* Editor + chat */}
            <div ref={editorChatRef} className="min-h-0 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Report content & chat</p>
                <span className="text-xs text-slate-500">{html.length} chars</span>
              </div>

              <div
                className="flex-1 min-h-0 grid"
                style={{ gridTemplateRows: `${Math.round(editorHeightPx)}px 6px minmax(0, 1fr)` }}
              >
                {/* Content editor */}
                <div className="p-4 border-b-0 border-slate-100 min-h-0 flex flex-col">
                  {!selectedParticipant ? (
                    <div className="flex-1 min-h-0 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                      Select a participant to edit report content.
                    </div>
                  ) : !editable ? (
                    <div className="flex-1 min-h-0 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      Generate a report to edit its content.
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y space-y-4 pr-1">
                      <div>
                        <p className="text-xs font-bold text-slate-900">Badge summary sentence</p>
                        <textarea
                          value={editable.badgeText}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSelectedHtml((doc) => {
                              const el = doc.querySelector(".badge-text");
                              if (el) el.textContent = v;
                            });
                          }}
                          className="mt-2 w-full min-h-[64px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
                        />
                      </div>

                      {editable.cards.map((card, idx) => (
                        <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-bold text-slate-900">{card.title}</p>

                          <div className="mt-3 grid grid-cols-1 gap-3">
                            <div>
                              <p className="text-[11px] font-semibold text-slate-600">State label</p>
                              <input
                                value={card.state}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateSelectedHtml((doc) => {
                                    const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                    const el = section?.querySelector(".state");
                                    if (el) el.textContent = v;
                                  });
                                }}
                                className="mt-1 w-full h-9 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300"
                              />
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold text-slate-600">Main paragraph</p>
                              <textarea
                                value={card.body}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateSelectedHtml((doc) => {
                                    const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                    const el = section?.querySelector(".body");
                                    if (el) el.textContent = v;
                                  });
                                }}
                                className="mt-1 w-full min-h-[72px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
                              />
                            </div>

                            {editable.hasSupportBoxes ? (
                              <div className="grid grid-cols-1 gap-3">
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600">Support box 1 label</p>
                                  <input
                                    value={card.support1Label}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      updateSelectedHtml((doc) => {
                                        const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                        const labels = Array.from(section?.querySelectorAll(".support-label") ?? []);
                                        if (labels[0]) labels[0].textContent = v;
                                      });
                                    }}
                                    className="mt-1 w-full h-9 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300"
                                  />
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600">Support box 1 text</p>
                                  <textarea
                                    value={card.support1Text}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      updateSelectedHtml((doc) => {
                                        const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                        const texts = Array.from(section?.querySelectorAll(".support-text") ?? []);
                                        if (texts[0]) texts[0].textContent = v;
                                      });
                                    }}
                                    className="mt-1 w-full min-h-[56px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
                                  />
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600">Support box 2 label</p>
                                  <input
                                    value={card.support2Label}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      updateSelectedHtml((doc) => {
                                        const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                        const labels = Array.from(section?.querySelectorAll(".support-label") ?? []);
                                        if (labels[1]) labels[1].textContent = v;
                                      });
                                    }}
                                    className="mt-1 w-full h-9 rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300"
                                  />
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600">Support box 2 text</p>
                                  <textarea
                                    value={card.support2Text}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      updateSelectedHtml((doc) => {
                                        const section = Array.from(doc.querySelectorAll("section.card"))[idx];
                                        const texts = Array.from(section?.querySelectorAll(".support-text") ?? []);
                                        if (texts[1]) texts[1].textContent = v;
                                      });
                                    }}
                                    className="mt-1 w-full min-h-[56px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                This template uses graphs in place of support boxes.
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      <div>
                        <p className="text-xs font-bold text-slate-900">What this may mean</p>
                        <textarea
                          value={editable.meaningParagraph}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSelectedHtml((doc) => {
                              const meaning = doc.querySelector("section.meaning");
                              const p = Array.from(meaning?.querySelectorAll("p") ?? []).find((pp) => !pp.classList.contains("footer-line"));
                              if (p) p.textContent = v;
                            });
                          }}
                          className="mt-2 w-full min-h-[96px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-300 resize-none"
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-slate-500 mt-2">Editing marks the report as pending.</p>
                </div>

                <div
                  onPointerDown={startDragRow}
                  className={`bg-slate-100 hover:bg-slate-200 transition-colors cursor-row-resize touch-none select-none ${
                    isDragging ? "bg-slate-200" : ""
                  }`}
                  title="Drag to resize"
                />

                {/* Chat */}
                <div className="p-4 h-full min-h-0 flex flex-col">
                  {feedbackError && (
                    <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-sm text-red-700 font-semibold">{feedbackError}</p>
                    </div>
                  )}
                  <div
                    ref={chatScrollRef}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
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
                    <textarea
                      ref={feedbackTextareaRef}
                      value={feedbackInput}
                      onChange={(e) => {
                        setFeedbackInput(e.target.value);
                        // allow the DOM to update first
                        window.requestAnimationFrame(() => autosizeFeedback());
                      }}
                      placeholder="Add feedback for the AI…"
                      disabled={!selectedParticipant || isSendingFeedback}
                      rows={1}
                      className="flex-1 min-h-10 max-h-36 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-300 disabled:opacity-50 resize-none overflow-y-auto"
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
                            content:
                              typeof j.assistantMessage === "string" && j.assistantMessage.trim().length > 0
                                ? j.assistantMessage.trim().slice(0, 180)
                                : "Got it — updated the report draft.",
                          };

                          setChatByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: [...(prev[selectedParticipant.id] ?? []), assistantMsg],
                          }));

                          // Keep the latest assistant reply visible.
                          window.requestAnimationFrame(() => {
                            const el = chatScrollRef.current;
                            if (!el) return;
                            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                          });

                          setHtmlByParticipant((prev) => ({
                            ...prev,
                            [selectedParticipant.id]: j.updatedHtml ?? prev[selectedParticipant.id] ?? "",
                          }));
                          setStatusByParticipant((prev) => ({ ...prev, [selectedParticipant.id]: "draft" }));
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

