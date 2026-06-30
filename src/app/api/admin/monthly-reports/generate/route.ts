import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";
import { hashParticipantId } from "@/lib/pseudonym-crypto";
import { computeWeeklyFlagFromMetrics, type Metric, type WeeklyFlag } from "@/lib/flags/rules";
import {
  DEFAULT_MONTHLY_GENERATE_WRAPPER,
  DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE,
} from "@/lib/weekly-reports/template-defaults";

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
  monthEnding: string;
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

type SeriesPoint = { date: string; value: number | null };

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function expectedBadgeExplanationLine(badgeLabel: string): string {
  const label = badgeLabel.trim().toLowerCase();
  if (label === "mostly stable") {
    return "Your body is recovering well from stress. Keep doing what’s working.";
  }
  if (label === "mild strain") {
    return "Your system is feeling a bit taxed. Keep an eye on rest, recovery, and stress.";
  }
  if (label === "strain emerging") {
    return "Your system may be struggling to keep up. Recovery is slipping and stress may be building.";
  }
  if (label === "high strain") {
    return "Your system is having a hard time bouncing back. Consider focusing on rest, recovery, and reducing stress.";
  }
  return "Keep an eye on rest, recovery, and stress.";
}

function stripLeadingBadgeRepeat(params: { badgeText: string; badgeLabel: string; badgeIcon: string }): string {
  const raw = params.badgeText.trim();
  if (!raw) return raw;

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
  return raw.replace(re, "").trim();
}

function badgeExplanationLine(params: { badgeLabel: string; badgeIcon: string; badgeText: string }): string {
  const candidate = (params.badgeText ?? "").trim();
  if (candidate.length > 0) {
    const stripped = stripLeadingBadgeRepeat({
      badgeText: candidate,
      badgeLabel: params.badgeLabel,
      badgeIcon: params.badgeIcon,
    });
    if (stripped.length > 0) return stripped;
  }
  return expectedBadgeExplanationLine(params.badgeLabel);
}

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function list28DaysEnding(monthEnding: string): string[] {
  return Array.from({ length: 28 }, (_, i) => ymdAddDays(monthEnding, -27 + i));
}

function buildSeries28Days(params: {
  metrics: Metric[];
  monthEnding: string;
  getValue: (m: Metric) => number | null;
}): SeriesPoint[] {
  const days = list28DaysEnding(params.monthEnding);
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
  fixedMin?: number;
  fixedMax?: number;
}): string {
  const width = params.width ?? 860;
  const height = params.height ?? 170;
  const padX = 18;
  const padY = 18;

  const vals = params.points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) {
    return `<div style="padding:12px 0;color:#64748b;font-size:13px">Not enough data to graph this month.</div>`;
  }

  const lo = params.fixedMin ?? Math.max(0, Math.min(...vals) - Math.max(1, Math.max(...vals) - Math.min(...vals)) * 0.12);
  const hi = params.fixedMax ?? (Math.max(...vals) + Math.max(1, Math.max(...vals) - Math.min(...vals)) * 0.12);

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i: number) => padX + (innerW * i) / Math.max(1, params.points.length - 1);
  const yFor = (v: number) => padY + innerH * (1 - (v - lo) / Math.max(1e-6, hi - lo));

  const segments: { x: number; y: number }[][] = [];
  let currentSegment: { x: number; y: number }[] = [];

  params.points.forEach((p, i) => {
    const v = p.value;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }
      currentSegment = [];
      return;
    }
    currentSegment.push({ x: xFor(i), y: yFor(v) });
  });
  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }

  const stroke = params.stroke ?? "#0f766e";
  let fillColor = "rgba(20, 184, 166, 0.14)";
  if (stroke.toLowerCase() === "#e11d48") fillColor = "rgba(225, 29, 72, 0.12)";
  else if (stroke.toLowerCase() === "#2563eb") fillColor = "rgba(37, 99, 235, 0.12)";
  else if (stroke.toLowerCase() === "#0f766e") fillColor = "rgba(15, 118, 110, 0.12)";

  const bottomY = height - padY;
  const paths: string[] = [];

  segments.forEach((pts) => {
    const n = pts.length;
    if (n === 2) {
      const linePath = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)} ${pts[1].y.toFixed(2)}`;
      const areaPath = `${linePath} L ${pts[1].x.toFixed(2)} ${bottomY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${bottomY.toFixed(2)} Z`;
      paths.push(`
        <path d="${areaPath}" fill="${fillColor}" />
        <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      `);
      return;
    }

    const h: number[] = [];
    const s: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      h.push(pts[i+1].x - pts[i].x);
      s.push((pts[i+1].y - pts[i].y) / h[i]);
    }

    const d: number[] = [];
    d.push(s[0]);
    for (let i = 1; i < n - 1; i++) {
      if (s[i-1] * s[i] <= 0) {
        d.push(0);
      } else {
        const sum = h[i-1] + h[i];
        d.push((3 * sum) / ((sum + h[i]) / s[i-1] + (sum + h[i-1]) / s[i]));
      }
    }
    d.push(s[s.length - 1]);

    let linePath = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const cp1x = pts[i].x + h[i] / 3;
      const cp1y = pts[i].y + (h[i] * d[i]) / 3;
      const cp2x = pts[i+1].x - h[i] / 3;
      const cp2y = pts[i+1].y - (h[i] * d[i+1]) / 3;

      linePath += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${pts[i+1].x.toFixed(2)} ${pts[i+1].y.toFixed(2)}`;
    }

    const areaPath = `${linePath} L ${pts[n - 1].x.toFixed(2)} ${bottomY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${bottomY.toFixed(2)} Z`;
    paths.push(`
      <path d="${areaPath}" fill="${fillColor}" />
      <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    `);
  });

  const grid = [0.25, 0.5, 0.75]
    .map((t) => {
      const y = padY + innerH * t;
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(15,23,42,0.06)" stroke-width="1" />`;
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
<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monthly trend">
  <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.75)" />
  ${grid}
  ${paths.join("")}
  ${labels}
</svg>
`.trim();
}

function computeCompleteness(metrics: Metric[], monthEnding: string): DataCompleteness {
  const days = list28DaysEnding(monthEnding);
  const byDate = new Map(metrics.map((m) => [m.metric_date, m]));

  const presentBodyBattery = days.filter((d) => (byDate.get(d)?.body_battery_start ?? null) != null).length;
  const presentStress = days.filter((d) => (byDate.get(d)?.average_stress_level ?? null) != null).length;
  const presentRhr = days.filter((d) => (byDate.get(d)?.resting_heart_rate ?? null) != null).length;

  const calPresentAny = days.filter((d) => {
    const m = byDate.get(d);
    return Boolean(m && (m.body_battery_start != null || m.average_stress_level != null || m.resting_heart_rate != null));
  }).length;

  const nights = metrics
    .filter((m) => m.metric_date <= monthEnding)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, 28);

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
    monthEnding,
    calendarDaysPresent: calPresentAny,
    calendarDaysExpected: 28,
    sleepNightsPresent: nightsPresentAny,
    sleepNightsExpected: 28,
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

function formatMonthRange(monthEnding: string): string {
  const end = new Date(`${monthEnding}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
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

function fillMonthlyOlgaTemplate(params: {
  baseHtml: string;
  participantName: string;
  monthRange: string;
  badgeLabel: string;
  badgeIcon: string;
  content: GeneratedContent;
  graphs: {
    stress: SeriesPoint[];
    sleepScore: SeriesPoint[];
    bodyBattery: SeriesPoint[];
  };
  userAverages: {
    average_stress_level: number | null;
    sleep_score: number | null;
    body_battery_start: number | null;
  };
  groupAverages: {
    average_stress_level: number | null;
    sleep_score: number | null;
    body_battery_start: number | null;
  };
}): string {
  const safeName = escapeHtml(params.participantName);
  const safeRange = escapeHtml(params.monthRange);

  let html = params.baseHtml;

  // Replace averages placeholders
  html = html.replace(/\{\{USER_STRESS_AVG\}\}/g, params.userAverages.average_stress_level != null ? String(params.userAverages.average_stress_level) : "\u2014");
  html = html.replace(/\{\{GROUP_STRESS_AVG\}\}/g, params.groupAverages.average_stress_level != null ? String(params.groupAverages.average_stress_level) : "\u2014");
  html = html.replace(/\{\{USER_SLEEP_AVG\}\}/g, params.userAverages.sleep_score != null ? String(params.userAverages.sleep_score) : "\u2014");
  html = html.replace(/\{\{GROUP_SLEEP_AVG\}\}/g, params.groupAverages.sleep_score != null ? String(params.groupAverages.sleep_score) : "\u2014");
  html = html.replace(/\{\{USER_RECOVERY_AVG\}\}/g, params.userAverages.body_battery_start != null ? String(params.userAverages.body_battery_start) : "\u2014");
  html = html.replace(/\{\{GROUP_RECOVERY_AVG\}\}/g, params.groupAverages.body_battery_start != null ? String(params.groupAverages.body_battery_start) : "\u2014");

  // Top section
  html = replaceFirst(html, /(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, safeName);
  html = replaceFirst(html, /(<p\s+class="sub"[^>]*>)([\s\S]*?)(<\/p>)/i, safeRange);
  html = replaceFirst(html, /(<div\s+class="icon"[^>]*>)([\s\S]*?)(<\/div>)/i, escapeHtml(params.badgeIcon));
  html = replaceFirst(html, /(<p\s+class="badge-title"[^>]*>)([\s\S]*?)(<\/p>)/i, escapeHtml(params.badgeLabel));
  html = replaceFirst(
    html,
    /(<p\s+class="badge-text"[^>]*>)([\s\S]*?)(<\/p>)/i,
    escapeHtml(badgeExplanationLine({ badgeLabel: params.badgeLabel, badgeIcon: params.badgeIcon, badgeText: params.content.badgeText }))
  );

  // Cards (Stress, Sleep, Recovery)
  const cards = params.content;
  const cardContents: Array<{ c: CardContent }> = [{ c: cards.stress }, { c: cards.sleep }, { c: cards.recovery }];
  const graphByIdx = [
    {
      title: "Stress",
      points: params.graphs.stress,
      stroke: "#e11d48",
      slot: "stress",
    },
    {
      title: "Sleep score",
      points: params.graphs.sleepScore,
      stroke: "#2563eb",
      slot: "sleep_score",
    },
    {
      title: "Body battery",
      points: params.graphs.bodyBattery,
      stroke: "#0f766e",
      slot: "body_battery",
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

      const svg = renderSparklineSvg({ points: g.points, stroke: g.stroke, fixedMin: 0, fixedMax: 100 });
      const slotRe = new RegExp(
        `(<div\\s+class="graph-slot"[^>]*data-graph="${g.slot}"[^>]*>)([\\s\\S]*?)(<\\/div>)`,
        "i"
      );

      if (slotRe.test(s)) {
        s = replaceFirst(s, slotRe, svg);
        s = s.replace(
          /(<div\s+class="graph-range"[^>]*>)([\s\S]*?)(<\/div>)/i,
          (_m, p1: string, _p2: string, p3: string) => `${p1}${escapeHtml(params.monthRange)}${p3}`
        );
        return s;
      }

      // Fallback
      const fallbackGraphHtml = `
<div class="graph" style="margin-top:16px">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px">
    <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;font-weight:800">
      ${escapeHtml(g.title)}
    </div>
    <div style="font-size:11px;color:#64748b;font-weight:600">${escapeHtml(params.monthRange)}</div>
  </div>
  ${svg}
</div>
      `.trim();

      s = s.replace(/<div\s+class="support"[^>]*>[\s\S]*?<\/div>/i, fallbackGraphHtml);
      return s;
    });
    html = replaceAllNth(html, sectionRe, updatedSections);
  }

  html = html.replace(/(<section\s+class="meaning"[\s\S]*?<h2[^>]*>[\s\S]*?<\/h2>)([\s\S]*?)(<\/section>)/i, (m) => {
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

  const todayYmd = new Date().toISOString().slice(0, 10);

  const { data: latestRow, error: latestErr } = await admin
    .from("garmin_metrics")
    .select("metric_date")
    .eq("pseudonym_id", pseudonymId)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    return NextResponse.json({ error: "Failed to fetch latest metric date" }, { status: 500 });
  }

  const monthEnding =
    (latestRow && typeof (latestRow as unknown as { metric_date?: unknown }).metric_date === "string"
      ? ((latestRow as unknown as { metric_date: string }).metric_date as string)
      : todayYmd) || todayYmd;

  // Pull 40 days to calculate a stable weekly flag for the final week of the month.
  const since = ymdAddDays(monthEnding, -40);
  const { data: rows, error: metricsError } = await admin
    .from("garmin_metrics")
    .select(
      "id, metric_date, resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, body_battery_charged, body_battery_drained, body_battery_start, body_battery_highest, body_battery_lowest, body_battery_most_recent, hrv_last_night_average, hrv_last_night_5_min_high"
    )
    .eq("pseudonym_id", pseudonymId)
    .gte("metric_date", since)
    .lte("metric_date", monthEnding)
    .order("metric_date", { ascending: false });

  if (metricsError) {
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No health data available for participant" }, { status: 400 });
  }

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

  const weeklyFlag = computeWeeklyFlagFromMetrics(typed, monthEnding);
  const monthRange = formatMonthRange(monthEnding);
  const badge = badgeFromFinalColor(weeklyFlag.finalColor);
  const completeness = computeCompleteness(typed, monthEnding);

  const hasAnyRecent = completeness.calendarDaysPresent > 0 || completeness.sleepNightsPresent > 0;
  if (!hasAnyRecent) {
    return NextResponse.json(
      {
        error: "No recent health data in the last 28 days",
        monthEnding,
        monthRange,
        completeness,
      },
      { status: 422 }
    );
  }

  // Calculate database group averages for active participants this month (28 days)
  const since28Days = ymdAddDays(monthEnding, -27);
  const { data: groupMetrics, error: groupErr } = await admin
    .from("garmin_metrics")
    .select("resting_heart_rate, average_stress_level, sleep_duration_seconds, sleep_score, awake_seconds, hrv_last_night_average, body_battery_highest, body_battery_start")
    .gte("metric_date", since28Days)
    .lte("metric_date", monthEnding);

  const avgFn = (vals: number[]) => vals.length > 0 ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : null;
  const groupMetricsRaw = groupMetrics ?? [];
  const groupAverages = {
    average_stress_level: avgFn(groupMetricsRaw.map(m => m.average_stress_level).filter((v): v is number => v != null)),
    resting_heart_rate: avgFn(groupMetricsRaw.map(m => m.resting_heart_rate).filter((v): v is number => v != null)),
    sleep_duration_seconds: avgFn(groupMetricsRaw.map(m => m.sleep_duration_seconds).filter((v): v is number => v != null)),
    sleep_score: avgFn(groupMetricsRaw.map(m => m.sleep_score).filter((v): v is number => v != null)),
    awake_seconds: avgFn(groupMetricsRaw.map(m => m.awake_seconds).filter((v): v is number => v != null)),
    hrv_last_night_average: avgFn(groupMetricsRaw.map(m => m.hrv_last_night_average).filter((v): v is number => v != null)),
    body_battery_start: avgFn(groupMetricsRaw.map(m => {
      const mm = m as unknown as { body_battery_highest?: number | null; body_battery_start?: number | null };
      return mm.body_battery_highest ?? mm.body_battery_start ?? null;
    }).filter((v): v is number => v != null)),
  };

  const monthMetrics = typed.filter(m => m.metric_date >= since28Days && m.metric_date <= monthEnding);
  const userAverages = {
    average_stress_level: avgFn(monthMetrics.map(m => (m as unknown as { average_stress_level?: number | null }).average_stress_level ?? null).filter((v): v is number => v != null)),
    sleep_score: avgFn(monthMetrics.map(m => (m as unknown as { sleep_score?: number | null }).sleep_score ?? null).filter((v): v is number => v != null)),
    body_battery_start: avgFn(monthMetrics.map(m => (m as unknown as { body_battery_start?: number | null }).body_battery_start ?? null).filter((v): v is number => v != null)),
  };

  // Load templates
  let masterRules = "";
  let generateWrapper = "";
  let baseHtml = "";
  try {
    const { data, error } = await admin
      .from("weekly_report_templates")
      .select("key, content")
      .eq("is_active", true)
      .in("key", ["monthly_master_rules", "monthly_generate_wrapper", "monthly_html_base_template"]);
    if (!error && data) {
      for (const row of data as unknown as TemplateRow[]) {
        if (row?.key === "monthly_master_rules" && typeof row?.content === "string") masterRules = row.content;
        if (row?.key === "monthly_generate_wrapper" && typeof row?.content === "string") generateWrapper = row.content;
        if (row?.key === "monthly_html_base_template" && typeof row?.content === "string") baseHtml = row.content;
      }
    }
  } catch {
    // ignore
  }

  if (!baseHtml || baseHtml.trim().length === 0) baseHtml = DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE;

  const system = [
    masterRules?.trim() ? `MASTER_RULES:\n${masterRules.trim()}` : "",
    `GENERATION_INSTRUCTIONS:\n${(generateWrapper?.trim() || DEFAULT_MONTHLY_GENERATE_WRAPPER).trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Participant's metrics for the last 28 days (sliced and then sorted chronologically for the LLM)
  const metricWindow = typed
    .filter((m) => m.metric_date <= monthEnding)
    .sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))
    .slice(0, 28);
  metricWindow.sort((a, b) => (a.metric_date > b.metric_date ? 1 : -1));

  const user = [
    `Participant: ${participantLabel}`,
    `Month ending: ${monthEnding}`,
    `Month range (display): ${monthRange}`,
    `Badge (must use one of the approved labels): ${badge.label} ${badge.icon}`,
    "",
    "DATA_COMPLETENESS_JSON:",
    JSON.stringify(completeness, null, 2),
    "",
    "WEEKLY_FLAG_JSON (computed state from final week of the month):",
    JSON.stringify(weeklyFlag, null, 2),
    "",
    "RAW_METRICS_RECENT_JSON (chronological list of metric records for participant):",
    JSON.stringify(metricWindow, null, 2),
    "",
    "GROUP_AVERAGES_28_DAYS (benchmarks for comparison):",
    JSON.stringify(groupAverages, null, 2),
    "",
    "USER_MONTHLY_AVERAGES (participant averages this month):",
    JSON.stringify(userAverages, null, 2),
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

  function asString(v: unknown): string {
    if (typeof v === "string") return v;
    if (v == null) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  }

  function severityRank(color: string | null | undefined): number {
    const c = String(color ?? "").toLowerCase();
    if (c === "red") return 4;
    if (c === "orange") return 3;
    if (c === "yellow") return 2;
    if (c === "green") return 1;
    return 0;
  }

  function stateForColor(color: string | null | undefined): string {
    const c = String(color ?? "").toLowerCase();
    if (c === "green") return "Mostly Stable 🟢";
    if (c === "yellow") return "Mild Strain 🟡";
    if (c === "orange") return "Strain Emerging 🟠";
    if (c === "red") return "High Strain 🔴";
    return "Mixed signals ⚪";
  }

  function coerceCard(v: unknown, fallbackState: string): CardContent {
    const o = (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}) as Record<string, unknown>;
    return {
      state: asString(o.state).trim() || fallbackState,
      body: asString(o.body),
      support1Label: asString(o.support1Label),
      support1Text: asString(o.support1Text),
      support2Label: asString(o.support2Label),
      support2Text: asString(o.support2Text),
    };
  }

  const o = (typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}) as Record<string, unknown>;
  const stressColor = weeklyFlag.metrics.stress?.color ?? null;
  const sleepColor = (() => {
    const colors = [
      weeklyFlag.metrics.sleep_duration?.color,
      weeklyFlag.metrics.sleep_score?.color,
      weeklyFlag.metrics.waso?.color,
    ];
    return colors.sort((a, b) => severityRank(b) - severityRank(a))[0] ?? null;
  })();
  const recoveryColor = (() => {
    const colors = [
      weeklyFlag.metrics.body_battery?.color,
      weeklyFlag.metrics.hrv?.color,
      weeklyFlag.metrics.hrv_stability?.color,
      weeklyFlag.metrics.rhr?.color,
    ];
    return colors.sort((a, b) => severityRank(b) - severityRank(a))[0] ?? null;
  })();

  parsed = {
    badgeText:
      asString(o.badgeText).trim() ||
      `This month you flagged ${badge.label} ${badge.icon}.`,
    stress: coerceCard(o.stress, stateForColor(stressColor)),
    sleep: coerceCard(o.sleep, stateForColor(sleepColor)),
    recovery: coerceCard(o.recovery, stateForColor(recoveryColor)),
    meaningParagraph:
      asString(o.meaningParagraph).trim() ||
      "This month shows a few mixed signals across stress, sleep, and recovery. Consider small, consistent routines and listen to your body.",
    assistantMessage: asString(o.assistantMessage),
  };

  const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "Generated the monthly report draft.";

  const graphs = {
    stress: buildSeries28Days({
      metrics: typed,
      monthEnding,
      getValue: (m) => (m.average_stress_level != null ? Number(m.average_stress_level) : null),
    }),
    sleepScore: buildSeries28Days({
      metrics: typed,
      monthEnding,
      getValue: (m) =>
        m.sleep_duration_seconds != null && m.sleep_score != null ? Number(m.sleep_score) : null,
    }),
    bodyBattery: buildSeries28Days({
      metrics: typed,
      monthEnding,
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

  const firstNameStr = participantLabel.trim().split(/\s+/)[0] || participantLabel.trim();
  const outreachText = [
    `Hi ${firstNameStr}, this month your Thrive monthly report (${monthRange}) shows that you flagged ${badge.label} ${badge.icon}.`,
    drivers.length > 0 ? `This is mainly due to ${drivers.join(" and ")}.` : "This is mainly due to a few mixed signals across sleep and recovery.",
    "Let us know if you have any questions after you’ve reviewed the report.",
  ].join(" ");

  const updatedHtml = fillMonthlyOlgaTemplate({
    baseHtml,
    participantName: participant.name?.trim() || participantLabel,
    monthRange,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    content: parsed,
    graphs,
    userAverages,
    groupAverages,
  });

  const { data: savedReport, error: saveErr } = await admin
    .from("monthly_reports")
    .upsert(
      {
        participant_id: payload.participantId,
        month_ending: monthEnding,
        month_range: monthRange,
        badge_label: badge.label,
        badge_icon: badge.icon,
        html: updatedHtml,
        outreach_text: outreachText,
        status: "draft",
        approved_at: null,
        queued_at: null,
        sent_at: null,
        last_error: null,
        email_job_id: null,
        sms_message_id: null,
        sms_sent_at: null,
        sms_last_error: null,
      },
      { onConflict: "participant_id,month_ending" }
    )
    .select("id, status")
    .maybeSingle();

  if (saveErr) {
    return NextResponse.json({ error: `Failed to save monthly report draft: ${saveErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    reportId: savedReport?.id ?? null,
    reportStatus: savedReport?.status ?? "draft",
    participantLabel,
    monthEnding,
    monthRange,
    badgeLabel: badge.label,
    badgeIcon: badge.icon,
    weeklyFlag,
    completeness,
    assistantMessage,
    updatedHtml,
    outreachText,
  });
}
