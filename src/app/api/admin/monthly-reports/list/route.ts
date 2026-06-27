import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(800),
});

type MonthlyReportMini = {
  id: string;
  participant_id: string;
  month_ending: string;
  month_range: string;
  badge_label: string;
  badge_icon: string;
  status: "draft" | "approved" | "queued" | "sent" | "failed";
  email_job_id: string | null;
  sms_message_id: string | null;
  sms_sent_at: string | null;
  sms_last_error: string | null;
  email_jobs: {
    status: string;
    last_error: string | null;
  }[] | null;
  updated_at?: string;
};

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("monthly_reports")
    .select(`
      id,
      participant_id,
      month_ending,
      month_range,
      badge_label,
      badge_icon,
      status,
      email_job_id,
      updated_at,
      sms_message_id,
      sms_sent_at,
      sms_last_error,
      email_jobs (
        status,
        last_error
      )
    `)
    .in("participant_id", payload.participantIds)
    .order("month_ending", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: `Failed to load monthly reports: ${error.message}` }, { status: 500 });
  }

  // Reduce to latest report per participant.
  const latestByParticipant: Record<string, MonthlyReportMini> = {};
  for (const row of (data ?? []) as MonthlyReportMini[]) {
    if (!latestByParticipant[row.participant_id]) {
      latestByParticipant[row.participant_id] = row;
    }
  }

  return NextResponse.json({ latestByParticipant });
}
