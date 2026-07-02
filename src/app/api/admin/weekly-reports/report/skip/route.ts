import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  reportId: z.string().uuid(),
  type: z.enum(["email", "sms"]),
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

  const update: Record<string, unknown> = {};
  if (payload.type === "email") {
    update.email_job_id = "skipped";
  } else {
    update.sms_message_id = "skipped";
  }

  const { data, error } = await guard.admin
    .from("weekly_reports")
    .update(update)
    .eq("id", payload.reportId)
    .select("id, participant_id, status, email_job_id, sms_message_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to skip weekly report: ${error.message}` }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Weekly report not found" }, { status: 404 });
  }

  return NextResponse.json({ report: data });
}
