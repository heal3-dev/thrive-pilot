import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";
import { hashParticipantId } from "@/lib/pseudonym-crypto";
import { computeWeeklyFlagFromMetrics, type Metric, type WeeklyFlag } from "@/lib/flags/rules";

const requestSchema = z.object({
  participantId: z.string().uuid(),
});

type TemplateRow = { key: string; content: string };
type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type CardContent = {
  state: string;
  body: string;
  support1Label: string;
  support1Text: string;
  support2Label: string;
  support2Text: string;
};

type GeneratedContent = {
  badgeText: string;
  stress: CardContent;
  sleep: CardContent;
  recovery: CardContent;
  meaningParagraph: string;
  assistantMessage?: string;
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(weekEnding: string): string {
  const end = new Date(`${weekEnding}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
  const startText = fmt.format(start);
  const endText = fmt.format(end);
  const yearText = new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(end);
  return `${startText} – ${endText}, ${yearText}`;
}

function badgeFromFinalColor(color: WeeklyFlag["finalColor"]): { label: string; icon: string } {
  switch (color) {
    case "green":
      return { label: "Mostly Stable", icon: "🟢" };
    case "yellow":
      return { label: "Mild Strain", icon: "🟡" };
    case "orange":
      return { label: "Strain Emerging", icon: "🟠" };
    case "red":
      return { label: "High Strain", icon: "🔴" };
  }
}

function replaceFirst(html: string, re: RegExp, inner: string): string {
  return html.replace(re, (_m, p1, _p2, p3) => `${p1}${inner}${p3}`);
}

function replaceAllNth(html: string, re: RegExp, replacements: string[]): string {
  let i = 0;
  return html.replace(re, (m) => {
    const next = i < replacements.length ? replacements[i] : m;
    i += 1;
    return next;
  });
}

function fillOlgaTemplate(params: {
  baseHtml: string;
  participantName: string;
  weekRange: string;
  badgeLabel: string;
  badgeIcon: string;
  content: GeneratedContent;
}): string {
  const safeName = escapeHtml(params.participantName);
  const safeRange = escapeHtml(params.weekRange);

  let html = params.baseHtml;

  // Top section
  html = replaceFirst(html, /(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, safeName);
  html = replaceFirst(html, /(<p\s+class="sub"[^>]*>)([\s\S]*?)(<\/p>)/i, safeRange);
  html = replaceFirst(html, /(<div\s+class="icon"[^>]*>)([\s\S]*?)(<\/div>)/i, escapeHtml(params.badgeIcon));
  html = replaceFirst(html, /(<p\s+class="badge-title"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(params.badgeLabel));
  html = replaceFirst(html, /(<p\s+class="badge-text"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(params.content.badgeText));

  // Cards (exactly 3, in order: Stress, Sleep, Recovery)
  const cards = params.content;
  const cardContents: Array<{ c: CardContent }> = [{ c: cards.stress }, { c: cards.sleep }, { c: cards.recovery }];

  const sectionRe = /<section\s+class="card"[^>]*>[\s\S]*?<\/section>/gi;
  const sections = html.match(sectionRe) ?? [];
  if (sections.length >= 3) {
    const updatedSections = sections.map((section, idx) => {
      if (idx >= 3) return section;
      const cc = cardContents[idx]!.c;
      let s = section;
      s = replaceFirst(s, /(<div\s+class="state"[^>]*>)([\s\S]*?)(<\/div>)/i, escapeHtml(cc.state));
      s = replaceFirst(s, /(<p\s+class="body"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(cc.body));

      // Two support boxes: label + text each, in order
      const labels: string[] = [cc.support1Label, cc.support2Label].map((x) => `${escapeHtml(x)}`);
      const texts: string[] = [cc.support1Text, cc.support2Text].map((x) => `${escapeHtml(x)}`);

      s = replaceAllNth(
        s,
        /<p\s+class="support-label"[^>]*>[\s\S]*?<\/p>/gi,
        labels.map((x) => `<p class="support-label">${x}</p>`)
      );
      s = replaceAllNth(
        s,
        /<p\s+class="support-text"[^>]*>[\s\S]*?<\/p>/gi,
        texts.map((x) => `<p class="support-text">${x}</p>`)
      );
      return s;
    });
    html = replaceAllNth(html, sectionRe, updatedSections);
  }

  // Meaning section: replace the first paragraph only; keep the fixed closing line intact.
  html = html.replace(/(<section\s+class="meaning"[\s\S]*?<h2[^>]*>[\s\S]*?<\/h2>)([\s\S]*?)(<\/section>)/i, (m) => {
    // Replace the first <p> after the <h2>.
    const replaced = m.replace(/(<h2[^>]*>[\s\S]*?<\/h2>\s*<p[^>]*>)([\s\S]*?)(<\/p>)/i, (_m2, p1, _p2, p3) => {
      return `${p1}${escapeHtml(params.content.meaningParagraph)}${p3}`;
    });
    return replaced;
  });

  return html;
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = guard.admin;

  const { data: participant, error: participantError } = await admin
    .from("participants")
    .select("id, name, email, phone_number")
    .eq("id", payload.participantId)
    .maybeSingle();

  if (participantError) {
    return NextResponse.json({ error: "Failed to fetch participant" }, { status: 500 });
  }
  if (!participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  const participantLabel =
    participant.name?.trim() || participant.email?.trim() || participant.phone_number?.trim() || "Participant";

  const participantIdHash = hashParticipantId(payload.participantId);
  const { data: pseudonymRow, error: pseudonymError } = await admin
    .from("participant_pseudonyms")
    .select("pseudonym_id")
    .eq("participant_id_hash", participantIdHash)
    .maybeSingle();

  if (pseudonymError) {
    return NextResponse.json({ error: "Failed to fetch participant mapping" }, { status: 500 });
  }
  const pseudonymId = pseudonymRow?.pseudonym_id;
  if (!pseudonymId) {
    return NextResponse.json({ error: "Participant is not connected (no health data yet)" }, { status: 400 });
  }

  // Pull enough history to compute a stable weekly flag (baselines + last 7 days).
  const todayYmd = new Date().toISOString().slice(0, 10);
  const since = ymdAddDays(todayYmd, -40);
  const { data: rows, error: metricsError } = await admin
    .from("garmin_metrics")
    .select(
      "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
    )
    .eq("pseudonym_id", pseudonymId)
    .gte("metric_date", since)
    .lte("metric_date", todayYmd)
    .order("metric_date", { ascending: false });

  if (metricsError) {
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No health data available for participant" }, { status: 400 });
  }

  const weekEnding = (rows[0] as unknown as { metric_date?: string }).metric_date ?? todayYmd;

  const typed: Metric[] = (rows ?? []).map((m) => {
    const mm = m as unknown as {
      body_battery_start?: number | null;
      body_battery_highest?: number | null;
      awake_seconds?: number | null;
    };
    return {
      id: (m as unknown as { id: string }).id,
      metric_date: (m as unknown as { metric_date: string }).metric_date,
      resting_heart_rate: (m as unknown as { resting_heart_rate: number | null }).resting_heart_rate ?? null,
      average_stress_level: (m as unknown as { average_stress_level: number | null }).average_stress_level ?? null,
      sleep_duration_seconds: (m as unknown as { sleep_duration_seconds: number | null }).sleep_duration_seconds ?? null,
      sleep_score: (m as unknown as { sleep_score: number | null }).sleep_score ?? null,
      awake_seconds: mm.awake_seconds ?? null,
      body_battery_charged: (m as unknown as { body_battery_charged: number | null }).body_battery_charged ?? null,
      body_battery_drained: (m as unknown as { body_battery_drained: number | null }).body_battery_drained ?? null,
      body_battery_start: (mm.body_battery_highest ?? mm.body_battery_start ?? null) as number | null,
      body_battery_lowest: (m as unknown as { body_battery_lowest: number | null }).body_battery_lowest ?? null,
      body_battery_most_recent: (m as unknown as { body_battery_most_recent: number | null }).body_battery_most_recent ?? null,
      hrv_last_night_average: (m as unknown as { hrv_last_night_average: number | null }).hrv_last_night_average ?? null,
      hrv_last_night_5_min_high: (m as unknown as { hrv_last_night_5_min_high: number | null }).hrv_last_night_5_min_high ?? null,
    };
  });

  const weeklyFlag = computeWeeklyFlagFromMetrics(typed, weekEnding);
  const weekRange = formatWeekRange(weekEnding);
  const badge = badgeFromFinalColor(weeklyFlag.finalColor);

  // Load templates
  let masterRules = "";
  let generateWrapper = "";
  let baseHtml = "";
  try {
    const { data, error } = await admin
      .from("weekly_report_templates")
      .select("key, content")
      .eq("is_active", true)
      .in("key", ["master_rules", "generate_wrapper", "html_base_template"]);
    if (!error && data) {
      for (const row of data as unknown as TemplateRow[]) {
        if (row?.key === "master_rules" && typeof row?.content === "string") masterRules = row.content;
        if (row?.key === "generate_wrapper" && typeof row?.content === "string") generateWrapper = row.content;
        if (row?.key === "html_base_template" && typeof row?.content === "string") baseHtml = row.content;
      }
    }
  } catch {
    // fall back below
  }

  if (!baseHtml || baseHtml.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing html_base_template. Set it in Weekly Reports → Templates first." },
      { status: 400 }
    );
  }

  const defaultGenerateWrapper = [
    "You generate content for a Thrive Weekly Report.",
    "Return JSON only with keys: assistantMessage (string, optional), badgeText (string), stress (object), sleep (object), recovery (object), meaningParagraph (string).",
    "Each card object must have: state, body, support1Label, support1Text, support2Label, support2Text (all strings).",
    "Use MASTER_RULES for tone and structure. Never mention points, thresholds, or internal scoring.",
    "The HTML layout is fixed and will be filled separately; do not output HTML.",
    "The closing line must remain exactly: Reach out to your peer mentor if you have questions or need support.",
  ].join(" ");

  const system = [
    masterRules?.trim() ? `MASTER_RULES:\n${masterRules.trim()}` : "",
    `GENERATION_INSTRUCTIONS:\n${(generateWrapper?.trim() || defaultGenerateWrapper).trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Participant: ${participantLabel}`,
    `Week ending: ${weekEnding}`,
    `Week range (display): ${weekRange}`,
    `Badge (must use one of the approved labels): ${badge.label} ${badge.icon}`,
    "",
    "WEEKLY_FLAG_JSON:",
    JSON.stringify(weeklyFlag, null, 2),
    "",
    "IMPORTANT:",
    "- Use the weekly_flag metrics colors to drive your narrative.",
    "- Stress card should reflect stress metric; Sleep card should reflect sleep duration/score/WASO; Recovery card should reflect body battery + HRV + HRV stability + RHR where relevant.",
  ].join("\n");

  const model = process.env.OPENAI_WEEKLY_REPORT_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `OpenAI request failed (${res.status})`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  const json = (await res.json().catch(() => null)) as OpenAIChatResponse | null;
  const content = json?.choices?.[0]?.message?.content ?? "";
  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "OpenAI returned empty response" }, { status: 502 });
  }

  let parsed: GeneratedContent & { [k: string]: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json(
      { error: "OpenAI returned non-JSON content", detail: escapeHtml(content).slice(0, 500) },
      { status: 502 }
    );
  }

  // Minimal shape validation (server-side) to avoid injecting undefined.
  const isCard = (v: unknown): v is CardContent =>
    typeof v === "object" &&
    v !== null &&
    ["state", "body", "support1Label", "support1Text", "support2Label", "support2Text"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "string"
    );

  if (typeof parsed.badgeText !== "string" || !isCard(parsed.stress) || !isCard(parsed.sleep) || !isCard(parsed.recovery) || typeof parsed.meaningParagraph !== "string") {
    return NextResponse.json(
      { error: "OpenAI returned invalid JSON shape (missing required fields)" },
      { status: 502 }
    );
  }

  const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "Generated the weekly report draft.";
  const updatedHtml = fillOlgaTemplate({
    baseHtml,
    participantName: participant.name?.trim() || participantLabel,
    weekRange,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    content: parsed,
  });

  return NextResponse.json({
    participantLabel,
    weekEnding,
    weekRange,
    weeklyFlag,
    assistantMessage,
    updatedHtml,
  });
}

