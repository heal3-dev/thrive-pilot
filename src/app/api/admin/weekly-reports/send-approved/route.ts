import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  // If omitted, sends all approved reports.
  participantIds: z.array(z.string().uuid()).optional(),
  // Prefer specifying reportIds when selecting a subset.
  reportIds: z.array(z.string().uuid()).optional(),
  // Optional filter to only send a specific week.
  weekEnding: z.string().min(10).max(10).optional(),
  // When true, returns a preview without enqueueing.
  dryRun: z.boolean().optional(),
});

type WeeklyReportRow = {
  id: string;
  participant_id: string;
  week_ending: string;
  week_range: string;
  badge_label: string;
  badge_icon: string;
  html: string;
  status: "draft" | "approved" | "queued" | "sent" | "failed";
  email_job_id: string | null;
};

type ParticipantRow = { id: string; email: string | null; name: string | null };

async function ensureEmailJob(params: {
  admin: SupabaseClient;
  report: WeeklyReportRow;
  participant: ParticipantRow;
}): Promise<{ jobId: string } | { error: string }> {
  const { admin, report, participant } = params;
  const to = (participant.email ?? "").trim();
  if (!to) return { error: "Participant has no email" };

  const subject = `Thrive Weekly Report (${report.week_range})`;
  const idempotencyKey = `weekly-report:${report.id}`;

  const { data: inserted, error: insertErr } = await admin
    .from("email_jobs")
    .upsert(
      {
        kind: "weekly_report",
        to_email: to,
        subject,
        html: report.html,
        idempotency_key: idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (!insertErr && inserted?.id) return { jobId: inserted.id };

  // If duplicate, fetch existing job id.
  const { data: existing, error: fetchErr } = await admin
    .from("email_jobs")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (fetchErr || !existing?.id) {
    return { error: insertErr?.message || fetchErr?.message || "Failed to create email job" };
  }
  return { jobId: existing.id };
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let query = guard.admin
    .from("weekly_reports")
    .select("id, participant_id, week_ending, week_range, badge_label, badge_icon, html, status, email_job_id")
    .eq("status", "approved");

  if (payload.weekEnding && /^\d{4}-\d{2}-\d{2}$/.test(payload.weekEnding)) {
    query = query.eq("week_ending", payload.weekEnding);
  }

  if (payload.reportIds && payload.reportIds.length > 0) {
    query = query.in("id", payload.reportIds);
  } else if (payload.participantIds && payload.participantIds.length > 0) {
    query = query.in("participant_id", payload.participantIds);
  }

  const { data: reports, error: reportsErr } = await query;
  if (reportsErr) {
    return NextResponse.json({ error: `Failed to load approved reports: ${reportsErr.message}` }, { status: 500 });
  }

  const rows = (reports ?? []) as WeeklyReportRow[];
  if (rows.length === 0) {
    return NextResponse.json({ enqueued: 0, skippedNoEmail: 0, skippedAlreadyQueued: 0, failed: 0 });
  }

  const participantIds = Array.from(new Set(rows.map((r) => r.participant_id)));
  const { data: participants, error: participantsErr } = await guard.admin
    .from("participants")
    .select("id, email, name")
    .in("id", participantIds);

  if (participantsErr) {
    return NextResponse.json({ error: `Failed to load participant emails: ${participantsErr.message}` }, { status: 500 });
  }

  const byId = new Map((participants ?? []).map((p) => [p.id, p as ParticipantRow]));

  let enqueued = 0;
  let skippedNoEmail = 0;
  let skippedAlreadyQueued = 0;
  let failed = 0;
  const errors: Array<{ reportId: string; participantId: string; error: string }> = [];
  const toEnqueue: Array<{ reportId: string; participantId: string; toEmail: string; participantName: string; weekRange: string }> = [];
  const alreadyQueued: Array<{ reportId: string; participantId: string; weekRange: string }> = [];
  const noEmail: Array<{ reportId: string; participantId: string; participantName: string; weekRange: string }> = [];

  for (const report of rows) {
    const participant = byId.get(report.participant_id);
    if (!participant) {
      failed++;
      errors.push({ reportId: report.id, participantId: report.participant_id, error: "Participant missing" });
      continue;
    }

    // If already linked, treat as already queued (idempotent).
    if (report.email_job_id) {
      skippedAlreadyQueued++;
      alreadyQueued.push({ reportId: report.id, participantId: report.participant_id, weekRange: report.week_range });
      continue;
    }

    const toEmail = (participant.email ?? "").trim();
    const participantName = participant.name?.trim() || participant.email?.trim() || "Participant";
    if (!toEmail) {
      skippedNoEmail++;
      noEmail.push({ reportId: report.id, participantId: report.participant_id, participantName, weekRange: report.week_range });
      continue;
    }

    if (payload.dryRun) {
      toEnqueue.push({ reportId: report.id, participantId: report.participant_id, toEmail, participantName, weekRange: report.week_range });
      continue;
    }

    const job = await ensureEmailJob({ admin: guard.admin, report, participant });
    if ("error" in job) {
      skippedNoEmail += job.error === "Participant has no email" ? 1 : 0;
      if (job.error !== "Participant has no email") {
        failed++;
        errors.push({ reportId: report.id, participantId: report.participant_id, error: job.error });
      }
      continue;
    }

    const { error: updateErr } = await guard.admin
      .from("weekly_reports")
      .update({
        status: "queued",
        queued_at: new Date().toISOString(),
        email_job_id: job.jobId,
        last_error: null,
      })
      .eq("id", report.id);

    if (updateErr) {
      failed++;
      errors.push({ reportId: report.id, participantId: report.participant_id, error: `Failed to update report: ${updateErr.message}` });
      continue;
    }

    enqueued++;
  }

  return NextResponse.json({
    enqueued,
    skippedNoEmail,
    skippedAlreadyQueued,
    failed,
    toEnqueue: payload.dryRun ? toEnqueue : undefined,
    alreadyQueued: payload.dryRun ? alreadyQueued : undefined,
    noEmail: payload.dryRun ? noEmail : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
}

