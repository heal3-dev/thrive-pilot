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

  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(1, maxV - minV);
  const lo = Math.max(0, minV - range * 0.12);
  const hi = maxV + range * 0.12;

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i: number) => padX + (innerW * i) / Math.max(1, points.length - 1);
  const yFor = (v: number) => padY + innerH * (1 - (v - lo) / Math.max(1e-6, hi - lo));

  const pathParts: string[] = [];
  let started = false;
  points.forEach((p, i) => {
    if (typeof p.value !== "number" || !Number.isFinite(p.value)) {
      started = false;
      return;
    }
    const x = xFor(i);
    const y = yFor(p.value);
    if (!started) {
      pathParts.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
      started = true;
    } else {
      pathParts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  });

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
  <path d="${pathParts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
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
    `<p class="badge-text">This is a demo preview of the Thrive Weekly Report template (layout + graphs), using sample data.</p>`
  );
  html = html.replace(/(<div class="graph-range">)([\s\S]*?)(<\/div>)/gi, `$1${escapeHtml(weekRange)}$3`);

  html = replaceGraphSlot(html, "stress", stress);
  html = replaceGraphSlot(html, "sleep_score", sleepScore);
  html = replaceGraphSlot(html, "body_battery", bodyBattery);

  return html;
}

