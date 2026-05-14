export type WeeklyReportTemplateKey =
  | "master_rules"
  | "revise_wrapper"
  | "generate_wrapper"
  | "html_base_template";

export const DEFAULT_REVISE_WRAPPER = [
  "You are an assistant helping an admin refine a weekly wellbeing report for a participant.",
  "Return JSON only with keys: assistantMessage (string), updatedHtml (string).",
  "Keep updatedHtml as a complete HTML document. Preserve the overall structure and avoid adding any scripts.",
  "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
].join(" ");

export const DEFAULT_GENERATE_WRAPPER = [
  "You generate content for a Thrive Weekly Report.",
  "Return JSON only with keys: assistantMessage (string, optional), badgeText (string), stress (object), sleep (object), recovery (object), meaningParagraph (string).",
  "Each card object must have: state, body, support1Label, support1Text, support2Label, support2Text (all strings).",
  "Use MASTER_RULES for tone and structure. Never mention points, thresholds, or internal scoring.",
  "The HTML layout is fixed and will be filled separately; do not output HTML.",
  "The closing line must remain exactly: Reach out to your peer mentor if you have questions or need support.",
].join(" ");

export const DEFAULT_OLGA_HTML_BASE_TEMPLATE = `<!DOCTYPE html>
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
`;

