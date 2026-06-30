import { DEFAULT_OLGA_HTML_BASE_TEMPLATE } from "./template-defaults";

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Point = { label: string; value: number | null };

function renderSparklineSvg(points: Point[], stroke: string): string {
  const width = 860;
  const height = 170;
  const padX = 18;
  const padY = 18;

  const vals = points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) return `<div style="padding:12px 0;color:#64748b;font-size:13px">Not enough data to graph.</div>`;

  // Demo charts also use fixed 0-100 scale to match dashboard behavior.
  const lo = 0;
  const hi = 100;

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i: number) => padX + (innerW * i) / Math.max(1, points.length - 1);
  const yFor = (v: number) => padY + innerH * (1 - (v - lo) / Math.max(1e-6, hi - lo));

  const segments: { x: number; y: number }[][] = [];
  let currentSegment: { x: number; y: number }[] = [];

  points.forEach((p, i) => {
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

  const labels = points
    .map((p, i) => {
      if (i !== 0 && i !== points.length - 1) return "";
      const x = xFor(i);
      const anchor = i === 0 ? "start" : "end";
      return `<text x="${x}" y="${height - 6}" text-anchor="${anchor}" font-size="11" fill="#64748b">${escapeHtml(p.label)}</text>`;
    })
    .join("");

  return `
<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly trend">
  <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.75)" />
  ${grid}
  ${paths.join("")}
  ${labels}
</svg>
`.trim();
}

function replaceGraphSlot(html: string, key: string, inner: string): string {
  const re = new RegExp(
    `(<div[^>]*class=(["'])[^\\"']*\\bgraph-slot\\b[^\\2]*\\2[^>]*data-graph=(["'])${key}\\3[^>]*>)([\\s\\S]*?)(<\\/div>)`,
    "i"
  );
  return html.replace(re, (_m, p1: string, _q1: string, _q2: string, _old: string, pEnd: string) => `${p1}${inner}${pEnd}`);
}

export function buildWeeklyReportDemoHtml(): string {
  const weekRange = "April 25 – May 1, 2025";

  const stress = renderSparklineSvg(
    [
      { label: "Apr 25", value: 42 },
      { label: "Apr 26", value: 55 },
      { label: "Apr 27", value: 61 },
      { label: "Apr 28", value: 49 },
      { label: "Apr 29", value: 58 },
      { label: "Apr 30", value: 46 },
      { label: "May 1", value: 40 },
    ],
    "#e11d48"
  );

  const sleepScore = renderSparklineSvg(
    [
      { label: "Apr 25", value: 78 },
      { label: "Apr 26", value: 64 },
      { label: "Apr 27", value: 59 },
      { label: "Apr 28", value: 70 },
      { label: "Apr 29", value: 73 },
      { label: "Apr 30", value: 76 },
      { label: "May 1", value: 81 },
    ],
    "#2563eb"
  );

  const bodyBattery = renderSparklineSvg(
    [
      { label: "Apr 25", value: 62 },
      { label: "Apr 26", value: 58 },
      { label: "Apr 27", value: 44 },
      { label: "Apr 28", value: 51 },
      { label: "Apr 29", value: 56 },
      { label: "Apr 30", value: 60 },
      { label: "May 1", value: 66 },
    ],
    "#0f766e"
  );

  let html = DEFAULT_OLGA_HTML_BASE_TEMPLATE;
  // Make it obviously a demo.
  html = html.replace(/<h1>[\s\S]*?<\/h1>/i, "<h1>Demo Participant</h1>");
  html = html.replace(/<p class="sub">[\s\S]*?<\/p>/i, `<p class="sub">${escapeHtml(weekRange)}</p>`);
  html = html.replace(/<p class="badge-title">[\s\S]*?<\/p>/i, `<p class="badge-title">Mild Strain</p>`);
  html = html.replace(
    /<p class="badge-text">[\s\S]*?<\/p>/i,
    `<p class="badge-text">Your system is feeling a bit taxed. Keep an eye on rest, recovery, and stress.</p>`
  );
  html = html.replace(/(<div class="graph-range">)([\s\S]*?)(<\/div>)/gi, `$1${escapeHtml(weekRange)}$3`);

  html = html.replace(/\{\{USER_STRESS_AVG\}\}/g, "48.2");
  html = html.replace(/\{\{GROUP_STRESS_AVG\}\}/g, "42.5");
  html = html.replace(/\{\{USER_SLEEP_AVG\}\}/g, "71.4");
  html = html.replace(/\{\{GROUP_SLEEP_AVG\}\}/g, "74.8");
  html = html.replace(/\{\{USER_RECOVERY_AVG\}\}/g, "56.3");
  html = html.replace(/\{\{GROUP_RECOVERY_AVG\}\}/g, "62.1");

  html = replaceGraphSlot(html, "stress", stress);
  html = replaceGraphSlot(html, "sleep_score", sleepScore);
  html = replaceGraphSlot(html, "body_battery", bodyBattery);

  return html;
}

import { DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE } from "./template-defaults";

export function buildMonthlyReportDemoHtml(): string {
  const monthRange = "April 1 – April 28, 2025";

  // Create 28 days of mock points
  const stressPoints = Array.from({ length: 28 }, (_, i) => ({
    label: i === 0 ? "Apr 1" : i === 27 ? "Apr 28" : "",
    value: Math.round(35 + Math.sin(i / 2) * 15 + Math.cos(i / 5) * 5),
  }));

  const sleepPoints = Array.from({ length: 28 }, (_, i) => ({
    label: i === 0 ? "Apr 1" : i === 27 ? "Apr 28" : "",
    value: Math.round(72 + Math.cos(i / 3) * 10 + Math.sin(i / 6) * 4),
  }));

  const bbPoints = Array.from({ length: 28 }, (_, i) => ({
    label: i === 0 ? "Apr 1" : i === 27 ? "Apr 28" : "",
    value: Math.round(55 + Math.sin(i / 4) * 12 + Math.cos(i / 7) * 6),
  }));

  const stress = renderSparklineSvg(stressPoints, "#e11d48");
  const sleepScore = renderSparklineSvg(sleepPoints, "#2563eb");
  const bodyBattery = renderSparklineSvg(bbPoints, "#0f766e");

  let html = DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE;
  html = html.replace(/<h1>[\s\S]*?<\/h1>/i, "<h1>Demo Participant</h1>");
  html = html.replace(/<p class="sub">[\s\S]*?<\/p>/i, `<p class="sub">${escapeHtml(monthRange)}</p>`);
  html = html.replace(/<p class="badge-title">[\s\S]*?<\/p>/i, `<p class="badge-title">Mild Strain</p>`);
  html = html.replace(
    /<p class="badge-text">[\s\S]*?<\/p>/i,
    `<p class="badge-text">Your system is feeling a bit taxed. Keep an eye on rest, recovery, and stress.</p>`
  );
  html = html.replace(/(<div class="graph-range">)([\s\S]*?)(<\/div>)/gi, `$1${escapeHtml(monthRange)}$3`);

  html = html.replace(/\{\{USER_STRESS_AVG\}\}/g, "44.6");
  html = html.replace(/\{\{GROUP_STRESS_AVG\}\}/g, "41.9");
  html = html.replace(/\{\{USER_SLEEP_AVG\}\}/g, "73.2");
  html = html.replace(/\{\{GROUP_SLEEP_AVG\}\}/g, "75.1");
  html = html.replace(/\{\{USER_RECOVERY_AVG\}\}/g, "58.4");
  html = html.replace(/\{\{GROUP_RECOVERY_AVG\}\}/g, "61.3");

  html = replaceGraphSlot(html, "stress", stress);
  html = replaceGraphSlot(html, "sleep_score", sleepScore);
  html = replaceGraphSlot(html, "body_battery", bodyBattery);

  return html;
}

