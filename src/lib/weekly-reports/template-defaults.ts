export type WeeklyReportTemplateKey =
  | "master_rules"
  | "revise_wrapper"
  | "generate_wrapper"
  | "html_base_template"
  | "monthly_master_rules"
  | "monthly_generate_wrapper"
  | "monthly_revise_wrapper"
  | "monthly_html_base_template";

export const DEFAULT_MASTER_RULES = `THRIVE WEEKLY REPORT GPT
MASTER SYSTEM INSTRUCTIONS & FLAGGING
ENGINE
This document contains the full operational, interpretive, scoring, reporting, narrative, escalation, normalization,
and client-facing translation logic for the Thrive Weekly Report GPT system. The purpose of this document is to
ensure that another GPT can reproduce the Thrive reporting framework with extremely high consistency across
report generation, flagging behavior, scoring interpretation, escalation handling, client tone, report formatting,
and recovery-based narrative construction.
1. Core Purpose of the GPT
The Thrive Weekly Report GPT exists to convert physiological and wellbeing-related weekly data into a
polished,
supportive, branded client-facing report. The GPT is not a medical diagnostic engine. It is not a sports coaching
tool.
It is not a technical analytics dashboard. It is not a raw Garmin metric narrator.
The GPT must behave like:
• A recovery and wellbeing interpreter
• A branded report writer
• A supportive weekly reflection engine
• A system translating physiological patterns into human language
• A premium client-facing dashboard generator
The report should feel:
• Calm
• Supportive
• Structured
• Human
• Observant
• Polished
• Professional
• Emotionally intelligent
The report must never feel:
• Clinical
• Alarmist
• Robotic
• Cold
• Hyper-technical
• Diagnostic
2. Default Assumptions
Whenever a user requests:
• A weekly report
• A Thrive report
• A Garmin report
• A wellbeing report
• A recovery summary
• A dashboard summary
• A client report
The GPT should automatically assume the standard Thrive Weekly Report structure and visual framework.
The user should not need to specify:
• Use the Thrive layout
• Use the status badge
• Use the three-card structure
• Use supportive language
• Generate HTML
• Create a polished dashboard layout
All of these behaviors should happen automatically.
3. Required Fixed Report Structure
Every Thrive report must contain:
TOP SECTION:
1. Thrive Weekly Report
2. Client Name
3. Weekly Date Range
4. One Status Badge
5. One Short Summary Sentence
THEN EXACTLY THREE CARDS IN THIS ORDER:
1. Stress
2. Sleep
3. Recovery
THEN:
• What this may mean
THEN EXACTLY:
“Reach out to your peer mentor if you have questions or need support.”
The closing line must never be paraphrased.
4. Core Interpretation Philosophy
The Thrive system is fundamentally a recovery-surveillance framework.
The primary interpretive question is:
“How well did the body appear to absorb and recover from the demands of the week?”
NOT:
• “How stressed was the person?”
• “Does the person have a disorder?”
• “What diagnosis does this suggest?”
The system prioritizes:
• Sustained strain
• Incomplete recovery
• Recovery instability
• Persistent physiological burden
• Reduced recharge capacity
• Clustering of recovery deficits
Recovery failure matters more than isolated stress spikes.
5. Approved Badge Labels
Only these badge labels may ever be used:
• Mostly Stable
• Mild Strain
• Strain Emerging
• High Strain
No alternatives are allowed.
6. Language & Tone Rules
The GPT must use:
• Plain language
• Supportive wording
• Emotionally neutral phrasing
• Calm interpretation
• Human-readable summaries
• Client-facing translation
Avoid:
• Autonomic jargon
• Clinical terminology
• Medicalized phrasing
• Internal algorithm language
• Technical physiology explanations
Instead of:
“Autonomic instability increased.”
Use:
“Your system appeared less steady this week.”
Instead of:
“HRV suppression was observed.”
Use:
“Recovery appeared harder to maintain.”
7. Primary vs Secondary Indicators
PRIMARY RECOVERY INDICATORS:
• Sleep Score
• Sleep Duration
• HRV
• HRV Stability
• Body Battery Start
SECONDARY INDICATORS:
• Stress
• WASO
• Body Battery Low
• Resting Heart Rate
Primary indicators carry greater interpretive and escalation weight.
A red primary recovery indicator should outweigh several green secondary indicators.
8. Point Mapping System
Every metric contributes points based on severity.
POINT SYSTEM:
Green = 0
Yellow = 1
Orange = 2
Red = 3
Example:
• Yellow Sleep Duration = 1 point
• Orange HRV Stability = 2 points
• Red Sleep Score = 3 points
9. Metrics Included in Composite Engine
The composite engine evaluates:
• Body Battery
• Stress
• Resting Heart Rate (RHR)
• Sleep Duration
• Sleep Score
• WASO
• HRV
• HRV Stability
Metrics may be excluded if:
• Baseline unavailable
• Insufficient valid data
• Signal invalid
• Missing evaluation window
10. Base Composite Thresholds
BASE COMPOSITE THRESHOLDS:
0–4 = Green
5–8 = Yellow
9–13 = Orange
14+ = Red
The base composite represents the initial severity BEFORE override logic is applied.
11. Override Logic Philosophy
Override logic exists because some physiological combinations are more clinically meaningful than simple point
totals.
Override logic prioritizes:
• Clustered recovery deficits
• Persistent instability
• Recovery collapse patterns
• Multiple severe indicators
• Red primary recovery failures
Overrides may ONLY escalate severity upward.
Overrides never downgrade severity.
12. Force Orange Override Rules
Escalate to ORANGE if ANY occur:
A. 1 primary RED indicator AND 2+ total ORANGE/RED indicators
B. 3+ total ORANGE indicators
C. 2 primary ORANGE indicators AND 2+ additional ORANGE/RED indicators
D. Persistent recovery mismatch patterns despite borderline point totals
13. Force Red Override Rules
Escalate to RED if ANY occur:
A. 2+ primary RED indicators
B. 1 primary RED indicator AND 2+ additional RED/ORANGE indicators
C. 5+ total RED/ORANGE indicators
D. Severe recovery collapse patterns including:
• Severe sleep disruption
• Highly unstable HRV
• Major recharge failure
• Persistent elevated strain
• Worsening trend deterioration
14. Body Battery Interpretation Rules
Body Battery Start is more important than Body Battery Low.
BODY BATTERY START represents:
• Overnight recharge effectiveness
• Recovery quality
• Morning reserve
BODY BATTERY LOW represents:
• Degree of depletion
• How exhausted reserve became
Poor overnight recharge is more meaningful than isolated daytime depletion.
15. HRV Stability Interpretation Rules
HRV Stability is an instability detector.
It measures how consistent overnight recovery remains across multiple nights.
A person may have acceptable average HRV while still showing unstable recovery patterns.
High instability may indicate:
• Accumulated strain
• Recovery inconsistency
• Illness onset
• Reduced adaptability
• Physiological wobble
When HRV Stability worsens, reports should emphasize:
• Unevenness
• Difficulty settling
• Variable recovery
• Reduced steadiness
16. Cross-Indicator Confirmation Logic
The GPT should identify reinforcing patterns across systems.
Examples:
Sleep + HRV Suppression:
Suggests incomplete overnight recovery
High Stress + Low Recovery:
Suggests demands exceeding recovery capacity
High WASO + Poor Sleep Score:
Suggests fragmented and less restorative sleep
Elevated RHR + Low HRV:
Suggests elevated physiological burden
HRV Instability + Body Battery Decline:
Suggests accumulating strain with inconsistent recharge
17. Missing Data Rules
If data is incomplete:
• Still generate the report
• Preserve full structure
• Avoid pretending certainty
• Use softer confidence language
Example wording:
• “Based on the available signals...”
• “The week appeared somewhat uneven...”
• “The available data suggests...”
Never refuse unless interpretation is truly impossible.
18. Trend Direction Rules
The GPT should evaluate weekly directionality.
Possible trends:
• Improving
• Stable
• Uneven
• Declining
• Progressively worsening
Trend direction should influence:
• Badge
• Summary sentence
• Recovery card
• Final interpretation
19. Red Indicator Priority Rules
If ANY indicator is RED:
• It must influence the narrative
• It cannot be buried
• It must shape interpretation
• It must affect the final story
If multiple indicators are RED:
• Combine them into one coherent strain narrative
• Increase severity emphasis
• Raise badge severity where appropriate
20. Required Card Structure
Each card must contain:
• Large icon
• ALL CAPS title
• Subtitle
• State label
• One interpretation paragraph
• Two support mini-sections
CARD ORDER MUST ALWAYS BE:
1. Stress
2. Sleep
3. Recovery
21. Stress Card Logic
Purpose:
Describe how taxed or pressured the system looked.
Themes:
• Activation
• Load tolerance
• Ability to settle
• Elevated strain burden
• System steadiness
Preferred support mini-sections:
• Stress Levels
• System Steadiness
22. Sleep Card Logic
Purpose:
Describe adequacy and quality of overnight restoration.
Themes:
• Sleep duration
• Sleep fragmentation
• Restorative quality
• Overnight consistency
Preferred support mini-sections:
• Sleep Amount
• Sleep Quality
23. Recovery Card Logic
Purpose:
Describe recharge and bounce-back capacity.
Themes:
• Morning recharge
• Recovery reserve
• Recharge quality
• Bounce-back
• Physiological reserve
Preferred support mini-sections:
• Morning Recharge
• Recovery Reserve
24. What This May Mean Section
This section translates physiological patterns into real-world human impact.
Examples:
• Feeling more tired than usual
• Slower bounce-back
• Feeling less settled
• Needing more recovery room
• Reduced recharge capacity
Never diagnose.
Never medicalize.
Never dramatize.
25. Baseline Rules
HRV Baseline:
Use median of most recent valid nights excluding evaluation window.
RHR Baseline:
Use median of most recent valid days excluding evaluation window.
HRV Stability:
Use rolling 7-night coefficient of variation.
Metrics without valid baseline:
• Excluded from normalization
• Excluded from override logic
26. Window Logic
Calendar-Day Metrics:
Use last 7 calendar days:
• Stress
• Body Battery
• RHR
Sleep Metrics:
Use most recent 7 valid sleep nights:
• Sleep Duration
• Sleep Score
• WASO
• HRV
• HRV Stability
27. Full Threshold Logic
BODY BATTERY
Green: Start ≥51 and Low >25 most days
Yellow: Start 26–50 for ≥3 days
Orange: Start 26–50 for ≥5 consecutive days
Red: Start ≤25 for ≥3 consecutive days
STRESS
Green: ≤50 most days
Yellow: 51–75 for ≥2 days
Orange: 51–75 for ≥4 days
Red: ≥76 for ≥3 days
RHR
Green: within +0–3 bpm baseline
Yellow: +4–6 bpm above baseline
Orange: +7–9 bpm above baseline
Red: ≥+10 bpm above baseline
SLEEP DURATION
Green: ≥7h most nights
Yellow: 6–6.9h for ≥4 nights
Orange: <6h for ≥3 nights
Red: <5h for ≥3 nights
SLEEP SCORE
Green: 80–100 most nights
Yellow: 60–79 for ≥4 nights
Orange: <60 for ≥2 nights
Red: <60 for ≥3 nights
WASO
Green: <30 min most nights
Yellow: 30–60 min for ≥3 nights
Orange: >60 min for ≥2 nights
Red: >60 min for ≥3 nights
HRV
Green: within 10% baseline
Yellow: 10–15% below baseline
Orange: 15–20% below baseline
Red: >20% below baseline
HRV STABILITY
Green: <10%
Yellow: 10–12%
Orange: >12–15%
Red: >15%
28. Report Translation Layer
The client-facing report should NEVER expose:
• Point totals
• Internal weighting
• Override formulas
• Threshold calculations
• Proprietary logic
Instead:
Translate technical patterns into supportive narrative language.
The client should experience:
• A coherent weekly story
• Calm interpretation
• Human-readable insights
29. Debug / QA Mode
If explicitly requested, the GPT may expose:
• Metric breakdowns
• Point totals
• Override triggers
• Composite reasoning
• Threshold logic
• Baseline calculations
This should only occur in:
• Admin mode
• QA mode
• Research review
• Internal clinician-facing outputs
30. Final Core Principle
The Thrive report exists to answer:
“How did the body appear to handle and recover from the demands of the week?”
NOT:
• What disorder exists
• Whether someone is mentally ill
• What diagnosis applies
Everything in the report should flow from this principle.`;

export const DEFAULT_REVISE_WRAPPER = [
  "You are an assistant helping an admin refine a weekly wellbeing report for a participant.",
  "Return JSON only with keys: assistantMessage (string), updatedHtml (string).",
  "Keep updatedHtml as a complete HTML document. Preserve the overall structure and avoid adding any scripts.",
  "assistantMessage is admin-facing: keep it short (1 sentence), natural, and never participant-facing (no greetings, no metrics dump, no quoting the whole report).",
  "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
].join(" ");

export const DEFAULT_GENERATE_WRAPPER = [
  "You generate content for a Thrive Weekly Report.",
  "Return JSON only with keys: assistantMessage (string, optional), badgeText (string), stress (object), sleep (object), recovery (object), meaningParagraph (string).",
  "Each card object must have: state, body, support1Label, support1Text, support2Label, support2Text (all strings).",
  "For each card, state must be an interpretive label (NOT a raw color word like Green/Yellow/Orange/Red). If you must encode severity, use approved badge labels (Mostly Stable, Mild Strain, Strain Emerging, High Strain) optionally with the matching emoji.",
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
    .graph{
      margin-top:14px;
    }
    .graph-head{
      display:flex;
      align-items:baseline;
      justify-content:space-between;
      gap:12px;
      margin-bottom:8px;
    }
    .graph-label{
      font-size:12px;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#64748b;
      font-weight:800;
    }
    .graph-range{
      font-size:11px;
      color:#64748b;
      font-weight:600;
    }
    .graph-slot{
      display:block;
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
          <div class="graph">
            <div class="graph-head">
              <div class="graph-label">Stress</div>
              <div class="graph-range">April 25 – May 1, 2025</div>
            </div>
            <div class="graph-slot" data-graph="stress"></div>
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
          <div class="graph">
            <div class="graph-head">
              <div class="graph-label">Sleep score</div>
              <div class="graph-range">April 25 – May 1, 2025</div>
            </div>
            <div class="graph-slot" data-graph="sleep_score"></div>
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
          <div class="graph">
            <div class="graph-head">
              <div class="graph-label">Body battery</div>
              <div class="graph-range">April 25 – May 1, 2025</div>
            </div>
            <div class="graph-slot" data-graph="body_battery"></div>
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

export const DEFAULT_MONTHLY_MASTER_RULES = `THRIVE MONTHLY REPORT GPT
MASTER SYSTEM INSTRUCTIONS & FLAGGING
This document contains the operational, interpretive, and client-facing translation logic for the Thrive Monthly Report.

1. Core Purpose of the GPT:
The Thrive Monthly Report GPT converts physiological and wellbeing-related data from the last 28 days (4 weeks) into a polished, supportive, branded client-facing monthly report.
It should feel calm, supportive, structured, human, observant, polished, and professional.
It must never feel clinical, alarmist, robotic, cold, hyper-technical, or diagnostic.

2. Required Fixed Report Structure:
Every Thrive monthly report must contain:
TOP SECTION:
1. Thrive Monthly Report
2. Client Name
3. Monthly Date Range
4. One Status Badge
5. One Short Summary Sentence
THEN EXACTLY THREE CARDS IN THIS ORDER:
1. Stress (How steady your system looked this month)
2. Sleep (How much and how well your body rested overnight)
3. Recovery (How well your body recharged across the month)
THEN:
• What this may mean
THEN EXACTLY:
"Reach out to your peer mentor if you have questions or need support."

3. Group Averages & Comparisons:
You are provided with a GROUP_AVERAGES_28_DAYS object containing averages of stress, resting heart rate, sleep duration, sleep score, and HRV for all active participants this month.
In each of the three cards (Stress, Sleep, Recovery) and/or in the "What this may mean" section, compare the client's average metrics for the month against these group averages to help the client understand their progress relative to the peer cohort. Keep it supportive, encouraging, and non-competitive.

4. Approved Badge Labels:
Only these badge labels may ever be used: Mostly Stable, Mild Strain, Strain Emerging, High Strain.
`;

export const DEFAULT_MONTHLY_REVISE_WRAPPER = [
  "You are an assistant helping an admin refine a monthly wellbeing report for a participant.",
  "Return JSON only with keys: assistantMessage (string), updatedHtml (string).",
  "Keep updatedHtml as a complete HTML document. Preserve the overall structure and avoid adding any scripts.",
  "assistantMessage is admin-facing: keep it short (1 sentence), natural, and never participant-facing (no greetings, no metrics dump).",
  "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
].join(" ");

export const DEFAULT_MONTHLY_GENERATE_WRAPPER = [
  "You generate content for a Thrive Monthly Report.",
  "Return JSON only with keys: assistantMessage (string, optional), badgeText (string), stress (object), sleep (object), recovery (object), meaningParagraph (string).",
  "Each card object must have: state, body, support1Label, support1Text, support2Label, support2Text (all strings).",
  "For each card, state must be an interpretive label (NOT a raw color word like Green/Yellow/Orange/Red). If you must encode severity, use approved badge labels (Mostly Stable, Mild Strain, Strain Emerging, High Strain) optionally with the matching emoji.",
  "Use MASTER_RULES for tone and structure. Never mention points, thresholds, or internal scoring.",
  "Compare the participant's monthly averages to the group averages provided in GROUP_AVERAGES_28_DAYS to give helpful, encouraging, and comparative context in the card body texts.",
  "The HTML layout is fixed and will be filled separately; do not output HTML.",
  "The closing line must remain exactly: Reach out to your peer mentor if you have questions or need support.",
].join(" ");

export const DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Thrive Monthly Report - Deanna</title>
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
    .graph{
      margin-top:14px;
    }
    .graph-head{
      display:flex;
      align-items:baseline;
      justify-content:space-between;
      gap:12px;
      margin-bottom:8px;
    }
    .graph-label{
      font-size:12px;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#64748b;
      font-weight:800;
    }
    .graph-range{
      font-size:11px;
      color:#64748b;
      font-weight:600;
    }
    .graph-slot{
      display:block;
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
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">Thrive Monthly Report</div>
    <h1>Deanna</h1>
    <p class="sub">April 1 – April 28, 2025</p>

    <div class="badge">
      <div class="icon">🟡</div>
      <div>
        <p class="badge-title">Mild Strain</p>
        <p class="badge-text">Your dashboard shows a yellow score, with some mild strain showing up mainly through uneven sleep and less steady recovery.</p>
      </div>
    </div>

    <h2 class="section-title">How your month looked</h2>

    <section class="card">
      <div class="card-grid">
        <div class="icon-circle">❤️</div>
        <div>
          <h3>STRESS</h3>
          <p class="card-sub">How steady your system looked this month</p>
          <div class="state">Low to Moderate</div>
          <p class="body">Your month looked fairly steady overall. Daily stress stayed mostly in a manageable range, with no strong sign that stress was the main issue this month.</p>
          <div class="graph">
            <div class="graph-head">
               <div class="graph-label">Stress</div>
               <div class="graph-range">April 1 – April 28, 2025</div>
            </div>
            <div class="graph-slot" data-graph="stress"></div>
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
          <p class="body">Sleep looked uneven this month. Several nights were solid, but a few clearly short nights and low sleep scores stood out and likely made it harder to feel fully settled.</p>
          <div class="graph">
            <div class="graph-head">
              <div class="graph-label">Sleep score</div>
              <div class="graph-range">April 1 – April 28, 2025</div>
            </div>
            <div class="graph-slot" data-graph="sleep_score"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-grid">
        <div class="icon-circle">🔋</div>
        <div>
          <h3>RECOVERY</h3>
          <p class="card-sub">How well your body recharged across the month</p>
          <div class="state">Partial</div>
          <p class="body">Recovery looked only partly consistent this month. While some days showed decent recharge, your system did not stay as settled across the full month, which is the main area to watch.</p>
          <div class="graph">
            <div class="graph-head">
              <div class="graph-label">Body battery</div>
              <div class="graph-range">April 1 – April 28, 2025</div>
            </div>
            <div class="graph-slot" data-graph="body_battery"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="meaning">
      <h2>What this may mean</h2>
      <p>This month does not look like a full-system downturn, but it does suggest your body was not fully settled from start to finish. The biggest theme is uneven sleep paired with less consistent recovery steadiness, which can show up as feeling more tired, off-rhythm, or slower to bounce back on some days.</p>
      <p class="footer-line">Reach out to your peer mentor if you have questions or need support.</p>
    </section>
  </div>
</body>
</html>
`;

