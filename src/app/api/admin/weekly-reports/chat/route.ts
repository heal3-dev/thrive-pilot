import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

const requestSchema = z.object({
  participantLabel: z.string().min(1).max(200),
  currentMarkdown: z.string().min(1).max(20_000),
  feedback: z.string().min(1).max(2000),
});

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  const model = process.env.OPENAI_WEEKLY_REPORT_MODEL ?? "gpt-5.4-nano-2026-03-17";

  const system = [
    "You are an assistant helping an admin refine a weekly wellbeing report for a participant.",
    "Return JSON only with keys: assistantMessage (string), updatedMarkdown (string).",
    "Keep updatedMarkdown in Markdown format. Preserve structure and avoid adding any unsafe HTML.",
    "Apply the admin feedback to improve tone/clarity while staying concise and supportive.",
  ].join(" ");

  const user = [
    `Participant: ${payload.participantLabel}`,
    `Admin feedback: ${payload.feedback}`,
    "Current markdown:",
    payload.currentMarkdown,
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

  const json = (await res.json().catch(() => null)) as any;
  const content = json?.choices?.[0]?.message?.content ?? "";
  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "OpenAI returned empty response" }, { status: 502 });
  }

  let parsed: { assistantMessage?: unknown; updatedMarkdown?: unknown };
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
  const updatedMarkdown =
    typeof parsed.updatedMarkdown === "string" ? parsed.updatedMarkdown : payload.currentMarkdown;

  return NextResponse.json({ assistantMessage, updatedMarkdown });
}

