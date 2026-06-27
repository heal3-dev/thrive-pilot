import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  participantId: z.string().uuid(),
  monthEnding: z.string().min(10).max(10), // YYYY-MM-DD
  monthRange: z.string().min(1).max(64),
  badgeLabel: z.string().min(1).max(64),
  badgeIcon: z.string().min(1).max(8),
  html: z.string().min(1).max(500_000),
});

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const participantId = url.searchParams.get("participantId") ?? "";
  if (!participantId) {
    return NextResponse.json({ error: "Missing participantId" }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("monthly_reports")
    .select("id, participant_id, month_ending, month_range, badge_label, badge_icon, html, status, approved_at, queued_at, sent_at, last_error, email_job_id, updated_at")
    .eq("participant_id", participantId)
    .order("month_ending", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to load monthly report: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ report: data ?? null });
}

export async function PUT(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof upsertSchema>;
  try {
    payload = upsertSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("monthly_reports")
    .upsert(
      {
        participant_id: payload.participantId,
        month_ending: payload.monthEnding,
        month_range: payload.monthRange,
        badge_label: payload.badgeLabel,
        badge_icon: payload.badgeIcon,
        html: payload.html,
        status: "draft",
        approved_at: null,
        queued_at: null,
        sent_at: null,
        last_error: null,
        email_job_id: null,
      },
      { onConflict: "participant_id,month_ending" }
    )
    .select("id, participant_id, month_ending, status, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to save monthly report: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ report: data ?? null });
}
