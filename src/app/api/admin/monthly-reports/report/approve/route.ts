import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  participantId: z.string().uuid(),
  monthEnding: z.string().min(10).max(10),
  status: z.enum(["draft", "approved"]),
});

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status: payload.status,
    last_error: null,
  };
  if (payload.status === "approved") {
    update.approved_at = new Date().toISOString();
  } else {
    update.approved_at = null;
    update.queued_at = null;
    update.sent_at = null;
    update.email_job_id = null;
    update.sms_message_id = null;
    update.sms_sent_at = null;
    update.sms_last_error = null;
  }

  const { data, error } = await guard.admin
    .from("monthly_reports")
    .update(update)
    .eq("participant_id", payload.participantId)
    .eq("month_ending", payload.monthEnding)
    .select(
      "id, participant_id, month_ending, status, approved_at, queued_at, sent_at, email_job_id, sms_message_id, sms_sent_at, sms_last_error, updated_at",
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to update monthly report status: ${error.message}` }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Monthly report not found for participant/month" }, { status: 404 });
  }

  return NextResponse.json({ report: data });
}
