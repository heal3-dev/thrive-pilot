import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

const requestSchema = z.object({
  participantLabel: z.string().min(1).max(200),
  currentHtml: z.string().min(1).max(200_000),
  feedback: z.string().min(1).max(2000),
  currentOutreachText: z.string().max(2000).optional(),
});

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeCardStateLabel(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /^(green|yellow|orange|red)\b[^\w]*$/i.exec(s);
  if (!m) return null;
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
      return null;
  }
}

function normalizeHtmlStateLabels(html: string): string {
  return html.replace(/(<div\s+class="state"[^>]*>)([\s\S]*?)(<\/div>)/gi, (_m, p1: string, inner: string, p3: string) => {
    const stripped = inner.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
    const normalized = normalizeCardStateLabel(stripped);
    if (!normalized) return `${p1}${inner}${p3}`;
    return `${p1}${escapeHtml(normalized)}${p3}`;
  });
}

type TemplateRow = { key: string; content: string };
type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

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

  const model = process.env.OPENAI_WEEKLY_REPORT_MODEL ?? "gpt-5.4-nano-2026-03-17";

  const defaultReviseWrapper = [
    "You are an assistant helping an admin refine a weekly wellbeing report for a participant.",
    "Return JSON only with keys: assistantMessage (string), updatedHtml (string), updatedOutreachText (string).",
    "Keep updatedHtml as a complete HTML document. Preserve the overall structure and avoid adding any scripts.",
    "CRITICAL: Do NOT modify, alter, or reformat any <svg> elements, their coordinates, paths, colors, or text. Copy all <svg>...</svg> blocks exactly, character-for-character, from the input HTML.",
    "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
    "updatedOutreachText should be a supportive, concise text message summarizing the report to be sent to the participant via SMS. If the dates, badge score, or main details of the report have changed in the HTML, ensure the outreach text is regenerated to match the new details.",
  ].join(" ");

  let masterRules = "";
  let reviseWrapper = "";
  try {
    const { data, error } = await guard.admin
      .from("weekly_report_templates")
      .select("key, content")
      .eq("is_active", true)
      .in("key", ["master_rules", "revise_wrapper"]);
    if (!error && data) {
      for (const row of data as unknown as TemplateRow[]) {
        if (row?.key === "master_rules" && typeof row?.content === "string") masterRules = row.content;
        if (row?.key === "revise_wrapper" && typeof row?.content === "string") reviseWrapper = row.content;
      }
    }
  } catch {
    // Table may not exist yet in some environments; fall back to defaults.
  }

  const system = [
    masterRules?.trim() ? `MASTER_RULES:\n${masterRules.trim()}` : "",
    `REVISION_INSTRUCTIONS:\n${(reviseWrapper?.trim() || defaultReviseWrapper).trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Participant: ${payload.participantLabel}`,
    `Admin feedback: ${payload.feedback}`,
    `Current outreach text: ${payload.currentOutreachText || ""}`,
    "Current HTML:",
    payload.currentHtml,
  ].join("\n\n");

  // Use Chat Completions for broad compatibility.
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

  let parsed: { assistantMessage?: unknown; updatedHtml?: unknown; updatedMarkdown?: unknown; updatedOutreachText?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json(
      { error: "OpenAI returned non-JSON content", detail: escapeHtml(content).slice(0, 500) },
      { status: 502 }
    );
  }

  const assistantMessage =
    typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "Updated the draft based on your feedback.";
  const updatedHtml =
    typeof parsed.updatedHtml === "string"
      ? parsed.updatedHtml
      : typeof parsed.updatedMarkdown === "string"
        ? parsed.updatedMarkdown
        : payload.currentHtml;
  const updatedOutreachText =
    typeof parsed.updatedOutreachText === "string" ? parsed.updatedOutreachText : undefined;

  return NextResponse.json({
    assistantMessage,
    updatedHtml: normalizeHtmlStateLabels(updatedHtml),
    updatedOutreachText,
  });
}

