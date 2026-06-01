import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";
import { hashParticipantId } from "@/lib/pseudonym-crypto";
import { computeWeeklyFlagFromMetrics, type Metric, type WeeklyFlag } from "@/lib/flags/rules";
import { DEFAULT_GENERATE_WRAPPER, DEFAULT_OLGA_HTML_BASE_TEMPLATE } from "@/lib/weekly-reports/template-defaults";

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

type DataCompleteness = {
  weekEnding: string;
  calendarDaysPresent: number;
  calendarDaysExpected: number;
  sleepNightsPresent: number;
  sleepNightsExpected: number;
  presentByMetric: {
    body_battery_start_days: number;
    stress_days: number;
    rhr_days: number;
    sleep_duration_nights: number;
    sleep_score_nights: number;
    waso_nights: number;
    hrv_nights: number;
  };
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripLeadingBadgeRepeat(params: { badgeText: string; badgeLabel: string; badgeIcon: string }): string {
  const raw = params.badgeText.trim();
  if (!raw) return raw;

  // Common bad pattern: badge summary starts with the badge label/icon again.
  // Example: "High Strain 🔴. Sleep was..."
  const patterns = [
    `${params.badgeLabel} ${params.badgeIcon}`,
    `${params.badgeLabel}${params.badgeIcon}`,
    params.badgeLabel,
    params.badgeIcon,
  ]
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const re = new RegExp(`^(?:${patterns.join("|")})\\s*[:\\-—–]?\\s*`, "i");
  const next = raw.replace(re, "").trim();
  if (next.length > 0) return next;

  // If the entire summary was just a duplicate badge label/icon, replace it with a
  // neutral one-sentence summary starter (without repeating the label again).
  return "Your weekly status reflects the broader pattern across stress, sleep, and recovery this week.";
}

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function list7DaysEnding(weekEnding: string): string[] {
  return Array.from({ length: 7 }, (_, i) => ymdAddDays(weekEnding, -6 + i));
}

type SeriesPoint = { date: string; value: number | null };

function buildSeries7Days(params: {
  metrics: Metric[];
  weekEnding: string;
  getValue: (m: Metric) => number | null;
}): SeriesPoint[] {
  const days = list7DaysEnding(params.weekEnding);
  const byDate = new Map(params.metrics.map((m) => [m.metric_date, m]));
  return days.map((d) => {
    const m = byDate.get(d);
    return { date: d, value: m ? (params.getValue(m) ?? null) : null };
  });
}

function fmtShortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

function renderSparklineSvg(params: {
  points: SeriesPoint[];
  width?: number;
  height?: number;
  stroke?: string;
}): string {
  const width = params.width ?? 860;
  const height = params.height ?? 170;
  const padX = 18;
  const padY = 18;

  const vals = params.points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) {
    return `<div style="padding:12px 0;color:#64748b;font-size:13px">Not enough data to graph this week.</div>`;
  }

  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(1, maxV - minV);
  const lo = Math.max(0, minV - range * 0.12);
  const hi = maxV + range * 0.12;

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i: number) => padX + (innerW * i) / Math.max(1, params.points.length - 1);
  const yFor = (v: number) => padY + innerH * (1 - (v - lo) / Math.max(1e-6, hi - lo));

  // Build path, skipping nulls (breaks the line on missing values).
  const pathParts: string[] = [];
  let started = false;
  params.points.forEach((p, i) => {
    const v = p.value;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      started = false;
      return;
    }
    const x = xFor(i);
    const y = yFor(v);
    if (!started) {
      pathParts.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
      started = true;
    } else {
      pathParts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  });

  const stroke = params.stroke ?? "#0f766e";
  const grid = [0.25, 0.5, 0.75]
    .map((t) => {
      const y = padY + innerH * t;
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(15,23,42,0.08)" stroke-width="1" />`;
    })
    .join("");

  const labels = params.points
    .map((p, i) => {
      if (i !== 0 && i !== params.points.length - 1) return "";
      const x = xFor(i);
      const anchor = i === 0 ? "start" : "end";
      return `<text x="${x}" y="${height - 6}" text-anchor="${anchor}" font-size="11" fill="#64748b">${escapeHtml(fmtShortDate(p.date))}</text>`;
    })
    .join("");

  return `
<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly trend">
  <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.75)" />
  ${grid}
  <path d="${pathParts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  ${labels}
</svg>
`.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceGraphSlot(params: {
  html: string;
  slotKeys: readonly string[];
  svg: string;
}): { html: string; replaced: boolean } {
  // Match variants like:
  // - class="graph-slot"
  // - class="graph-slot something"
  // - class='graph-slot'
  // - data-graph="sleep_score" or data-graph='sleep score'
  const keyAlternation = params.slotKeys.map(escapeRegex).join("|");
  const re = new RegExp(
    `(<div[^>]*class=(["'])[^\\"']*\\bgraph-slot\\b[^\\2]*\\2[^>]*data-graph=(["'])(?:${keyAlternation})\\3[^>]*>)([\\s\\S]*?)(<\\/div>)`,
    "i"
  );

  if (!re.test(params.html)) return { html: params.html, replaced: false };

  const next = params.html.replace(re, (_m, p1: string, _q1: string, _q2: string, _inner: string, pEnd: string) => {
    return `${p1}${params.svg}${pEnd}`;
  });
  return { html: next, replaced: true };
}

function computeCompleteness(metrics: Metric[], weekEnding: string): DataCompleteness {
  const days = list7DaysEnding(weekEnding);
  const byDate = new Map(metrics.map((m) => [m.metric_date, m]));

  const presentBodyBattery = days.filter((d) => (byDate.get(d)?.body_battery_start ?? null) != null).length;
  const presentStress = days.filter((d) => (byDate.get(d)?.average_stress_level ?? null) != null).length;
  const presentRhr = days.filter((d) => (byDate.get(d)?.resting_heart_rate ?? null) != null).length;

  const calPresentAny = days.filter((d) => {
    const m = byDate.get(d);
    return Boolean(m && (m.body_battery_start != null || m.average_stress_level != null || m.resting_heart_rate != null));
  }).length;

  const nights = metrics
    .filter((m) => m.metric_date <= weekEnding)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, 7);

  const presentSleepDur = nights.filter((m) => m.sleep_duration_seconds != null).length;
  const presentSleepScore = nights.filter((m) => m.sleep_duration_seconds != null && m.sleep_score != null).length;
  const presentWaso = nights.filter((m) => m.sleep_duration_seconds != null && m.awake_seconds != null).length;
  const presentHrv = nights.filter((m) => m.hrv_last_night_average != null).length;

  const nightsPresentAny = nights.filter((m) => {
    return Boolean(
      m.sleep_duration_seconds != null ||
        m.sleep_score != null ||
        m.awake_seconds != null ||
        m.hrv_last_night_average != null
    );
  }).length;

  return {
    weekEnding,
    calendarDaysPresent: calPresentAny,
    calendarDaysExpected: 7,
    sleepNightsPresent: nightsPresentAny,
    sleepNightsExpected: 7,
    presentByMetric: {
      body_battery_start_days: presentBodyBattery,
      stress_days: presentStress,
      rhr_days: presentRhr,
      sleep_duration_nights: presentSleepDur,
      sleep_score_nights: presentSleepScore,
      waso_nights: presentWaso,
      hrv_nights: presentHrv,
    },
  };
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

function titleCaseStateLabel(input: string): string {
  const s = input.trim();
  if (!s) return s;
  const cap = (w: string) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w);
  if (s.includes("-") && !s.includes(" ")) {
    return s
      .split("-")
      .map((p) => cap(p))
      .join("-");
  }
  return s
    .split(/\s+/)
    .map((p) => cap(p))
    .join(" ");
}

function normalizeCardStateLabel(input: string): string {
  const s = input.trim();
  if (!s) return s;
  // Some model outputs use raw severity color words for card state (e.g. "Green").
  // Olga's framework prefers interpretive labels; map color-only states to approved badge labels.
  const m = /^(green|yellow|orange|red)\b[^\w]*$/i.exec(s);
  if (!m) return s;
  switch (m[1]!.toLowerCase()) {
    case "green":
      return "Mostly Stable 🟢";
    case "yellow":
      return "Mild Strain 🟡";
    case "orange":
      return "Strain Emerging 🟠";
    case "red":
      return "High Strain 🔴";
    default:
      return s;
  }
}

function fillOlgaTemplate(params: {
  baseHtml: string;
  participantName: string;
  weekRange: string;
  badgeLabel: string;
  badgeIcon: string;
  content: GeneratedContent;
  graphs: {
    stress: SeriesPoint[];
    sleepScore: SeriesPoint[];
    bodyBattery: SeriesPoint[];
  };
}): string {
  const safeName = escapeHtml(params.participantName);
  const safeRange = escapeHtml(params.weekRange);

  let html = params.baseHtml;

  // Top section
  html = replaceFirst(html, /(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, safeName);
  html = replaceFirst(html, /(<p\s+class="sub"[^>]*>)([\s\S]*?)(<\/p>)/i, safeRange);
  html = replaceFirst(html, /(<div\s+class="icon"[^>]*>)([\s\S]*?)(<\/div>)/i, escapeHtml(params.badgeIcon));
  html = replaceFirst(html, /(<p\s+class="badge-title"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(params.badgeLabel));
  html = replaceFirst(
    html,
    /(<p\s+class="badge-text"[^>]*>)([\s\S]*?)(<\/p>)/i,
    escapeHtml(stripLeadingBadgeRepeat({ badgeText: params.content.badgeText, badgeLabel: params.badgeLabel, badgeIcon: params.badgeIcon }))
  );

  // Cards (exactly 3, in order: Stress, Sleep, Recovery)
  const cards = params.content;
  const cardContents: Array<{ c: CardContent }> = [{ c: cards.stress }, { c: cards.sleep }, { c: cards.recovery }];
  const graphByIdx = [
    {
      title: "Stress",
      points: params.graphs.stress,
      stroke: "#e11d48",
      slot: "stress",
      slotKeys: ["stress"],
    },
    {
      title: "Sleep score",
      points: params.graphs.sleepScore,
      stroke: "#2563eb",
      slot: "sleep_score",
      slotKeys: ["sleep_score", "sleep score", "sleep", "sleepScore"],
    },
    {
      title: "Body battery",
      points: params.graphs.bodyBattery,
      stroke: "#0f766e",
      slot: "body_battery",
      slotKeys: ["body_battery", "body battery", "bodybattery", "recovery"],
    },
  ] as const;

  const sectionRe = /<section\s+class="card"[^>]*>[\s\S]*?<\/section>/gi;
  const sections = html.match(sectionRe) ?? [];
  if (sections.length >= 3) {
    const updatedSections = sections.map((section, idx) => {
      if (idx >= 3) return section;
      const cc = cardContents[idx]!.c;
      const g = graphByIdx[idx]!;
      let s = section;
      s = replaceFirst(
        s,
        /(<div\s+class="state"[^>]*>)([\s\S]*?)(<\/div>)/i,
        escapeHtml(titleCaseStateLabel(normalizeCardStateLabel(cc.state)))
      );
      s = replaceFirst(s, /(<p\s+class="body"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(cc.body));

      // Preferred: fill graph placeholder inside the template.
      const svg = renderSparklineSvg({ points: g.points, stroke: g.stroke });
      const filled = replaceGraphSlot({ html: s, slotKeys: g.slotKeys, svg });
      if (filled.replaced) {
        s = filled.html;
        // Also replace the visible date range in the graph head if present.
        s = s.replace(
          /(<div\s+class="graph-range"[^>]*>)([\s\S]*?)(<\/div>)/i,
          (_m, p1: string, _p2: string, p3: string) => `${p1}${escapeHtml(params.weekRange)}${p3}`
        );
        return s;
      }

      // Back-compat: old templates had two "support boxes" — replace that block with the graph.
      const fallbackGraphHtml = `
<div class="graph" style="margin-top:16px">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px">
    <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;font-weight:800">
      ${escapeHtml(g.title)}
    </div>
    <div style="font-size:11px;color:#64748b;font-weight:600">${escapeHtml(params.weekRange)}</div>
  </div>
  ${svg}
</div>
      `.trim();

      s = s.replace(/<div\s+class="support"[^>]*>[\s\S]*?<\/div>/i, fallbackGraphHtml);
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

  const latestMetricDate = (rows[0] as unknown as { metric_date?: string }).metric_date ?? todayYmd;
  // Use a consistent window: end on "yesterday (UTC)" when possible, but never after the latest available metric date.
  const defaultWeekEnding = ymdAddDays(todayYmd, -1);
  const weekEnding = minYmd(latestMetricDate, defaultWeekEnding);

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
  const completeness = computeCompleteness(typed, weekEnding);

  const hasAnyRecent = completeness.calendarDaysPresent > 0 || completeness.sleepNightsPresent > 0;
  if (!hasAnyRecent) {
    return NextResponse.json(
      {
        error: "No recent health data in the last 7 days",
        weekEnding,
        weekRange,
        completeness,
      },
      { status: 422 }
    );
  }

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

  if (!baseHtml || baseHtml.trim().length === 0) baseHtml = DEFAULT_OLGA_HTML_BASE_TEMPLATE;

  const system = [
    masterRules?.trim() ? `MASTER_RULES:\n${masterRules.trim()}` : "",
    `GENERATION_INSTRUCTIONS:\n${(generateWrapper?.trim() || DEFAULT_GENERATE_WRAPPER).trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Provide a raw values snapshot to help the model produce dynamic, specific copy.
  const metricWindow = typed
    .filter((m) => m.metric_date <= weekEnding)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, 14); // most recent days/nights for concrete language

  const user = [
    `Participant: ${participantLabel}`,
    `Week ending: ${weekEnding}`,
    `Week range (display): ${weekRange}`,
    `Badge (must use one of the approved labels): ${badge.label} ${badge.icon}`,
    "",
    "DATA_COMPLETENESS_JSON:",
    JSON.stringify(completeness, null, 2),
    "",
    "WEEKLY_FLAG_JSON:",
    JSON.stringify(weeklyFlag, null, 2),
    "",
    "RAW_METRICS_RECENT_JSON (most recent rows):",
    JSON.stringify(metricWindow, null, 2),
    "",
    "IMPORTANT:",
    "- Use the weekly_flag metrics colors to drive your narrative.",
    "- Stress card should reflect stress metric; Sleep card should reflect sleep duration/score/WASO; Recovery card should reflect body battery + HRV + HRV stability + RHR where relevant.",
  ].join("\n");

  const model = process.env.OPENAI_WEEKLY_REPORT_MODEL ?? "gpt-5.4-nano-2026-03-17";
  async function callWithModel(modelName: string) {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  }

  let res = await callWithModel(model);
  if (!res.ok && res.status === 404 && model !== "gpt-4o-mini") {
    // Graceful fallback if the configured model slug is invalid/unavailable.
    res = await callWithModel("gpt-4o-mini");
  }

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

  const graphs = {
    stress: buildSeries7Days({
      metrics: typed,
      weekEnding,
      getValue: (m) => (m.average_stress_level != null ? Number(m.average_stress_level) : null),
    }),
    sleepScore: buildSeries7Days({
      metrics: typed,
      weekEnding,
      getValue: (m) =>
        m.sleep_duration_seconds != null && m.sleep_score != null ? Number(m.sleep_score) : null,
    }),
    bodyBattery: buildSeries7Days({
      metrics: typed,
      weekEnding,
      getValue: (m) => (m.body_battery_start != null ? Number(m.body_battery_start) : null),
    }),
  };

  const primaryDrivers = Object.values(weeklyFlag.metrics)
    .filter((m) => m.color === "red" || m.color === "orange")
    .sort((a, b) => b.points - a.points);

  const driverPhrase = (metric: WeeklyFlag["metrics"][keyof WeeklyFlag["metrics"]]["metric"]): string | null => {
    switch (metric) {
      case "sleep_score":
        return "low sleep score";
      case "sleep_duration":
        return "shorter sleep";
      case "stress":
        return "higher stress levels";
      case "body_battery":
        return "lower recovery (body battery)";
      case "waso":
        return "more time awake overnight";
      case "hrv":
        return "lower HRV";
      case "hrv_stability":
        return "less steady recovery (HRV stability)";
      case "rhr":
        return "higher resting heart rate";
      default:
        return null;
    }
  };

  const drivers = Array.from(
    new Set(primaryDrivers.map((d) => driverPhrase(d.metric)).filter((x): x is string => Boolean(x)))
  ).slice(0, 2);

  const firstName = participantLabel.trim().split(/\s+/)[0] || participantLabel.trim();
  const outreachText = [
    `Hi ${firstName}, this week your Thrive weekly report (${weekRange}) shows that you flagged ${badge.label} ${badge.icon}.`,
    drivers.length > 0 ? `This is mainly due to ${drivers.join(" and ")}.` : "This is mainly due to a few mixed signals across sleep and recovery.",
    "Let us know if you have any questions after you’ve reviewed the report.",
  ].join(" ");

  const updatedHtml = fillOlgaTemplate({
    baseHtml,
    participantName: participant.name?.trim() || participantLabel,
    weekRange,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    content: parsed,
    graphs,
  });

  // Persist the draft for approval/sending.
  const { data: savedReport, error: saveErr } = await admin
    .from("weekly_reports")
    .upsert(
      {
        participant_id: payload.participantId,
        week_ending: weekEnding,
        week_range: weekRange,
        badge_label: badge.label,
        badge_icon: badge.icon,
        html: updatedHtml,
        status: "draft",
        approved_at: null,
        queued_at: null,
        sent_at: null,
        last_error: null,
        email_job_id: null,
      },
      { onConflict: "participant_id,week_ending" }
    )
    .select("id, status")
    .maybeSingle();

  if (saveErr) {
    return NextResponse.json({ error: `Failed to save weekly report draft: ${saveErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    reportId: savedReport?.id ?? null,
    reportStatus: savedReport?.status ?? "draft",
    participantLabel,
    weekEnding,
    weekRange,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    weeklyFlag,
    completeness,
    assistantMessage,
    updatedHtml,
    outreachText,
  });
}

