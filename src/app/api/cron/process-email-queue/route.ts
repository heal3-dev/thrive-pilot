/**
 * GET /api/cron/process-email-queue
 *
 * Vercel Cron job that drains the email_jobs queue.
 * - Sends via Resend first
 * - Fails over to SendPulse only for explicit Resend quota exhaustion
 *
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { getSupabaseAdmin } from "@/lib/supabase";
import { resendProvider } from "@/lib/email/providers/resend";
import { sendPulseProvider } from "@/lib/email/providers/sendpulse";
import type { EmailProvider, SendEmailErr, SendEmailOk } from "@/lib/email/providers/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type EmailJobRow = {
  id: string;
  kind: string;
  to_email: string;
  subject: string;
  html: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  provider: string | null;
  provider_message_id: string | null;
  last_error: string | null;
};

function parsePositiveInt(v: string | undefined | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function backoffMs(attempt: number): number {
  // attempt is the *next* attempt number (1-based)
  const base = 60_000; // 1 min
  const max = 30 * 60_000; // 30 min
  const raw = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, max);
}

async function sendWithProvider(
  provider: EmailProvider,
  job: EmailJobRow
): Promise<SendEmailOk | SendEmailErr> {
  return provider.send({
    to: job.to_email,
    subject: job.subject,
    html: job.html,
  });
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  const isAuthorized = authHeader === `Bearer ${secret}` || (querySecret && querySecret === secret);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const workerId = `vercel-cron-${Date.now()}`;
  const batchSize = parsePositiveInt(process.env.EMAIL_QUEUE_BATCH_SIZE, 10);
  const maxLoops = parsePositiveInt(process.env.EMAIL_QUEUE_MAX_LOOPS, 10);

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "process-email-queue", status: "in_progress" },
    { schedule: { type: "crontab", value: "*/1 * * * *" }, maxRuntime: 60, timezone: "UTC" }
  );

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let retried = 0;
  const errors: string[] = [];

  try {
    for (let loop = 0; loop < maxLoops; loop++) {
      const { data, error } = await supabase.rpc("claim_email_jobs", {
        batch_size: batchSize,
        worker_id: workerId,
      });

      if (error) {
        errors.push(`claim_email_jobs failed: ${error.message}`);
        break;
      }

      const jobs = (data ?? []) as EmailJobRow[];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        processed++;

        const primaryResult: SendEmailOk | SendEmailErr = await sendWithProvider(resendProvider, job);
        let finalResult: SendEmailOk | SendEmailErr = primaryResult;

        // Only fail over to SendPulse on explicit Resend quota exhaustion.
        if (!primaryResult.ok && primaryResult.kind === "quota") {
          finalResult = await sendWithProvider(sendPulseProvider, job);
        }

        if (finalResult.ok) {
          sent++;
          const { error: updateErr } = await supabase
            .from("email_jobs")
            .update({
              status: "sent",
              provider: finalResult.provider,
              provider_message_id: finalResult.messageId,
              last_error: null,
              locked_at: null,
              locked_by: null,
            })
            .eq("id", job.id);

          if (updateErr) {
            errors.push(`Failed to mark job sent (${job.id}): ${updateErr.message}`);
          }

          if (job.kind === "weekly_report") {
            const { error: reportErr } = await supabase
              .from("weekly_reports")
              .update({
                status: "sent",
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("email_job_id", job.id);
            if (reportErr) errors.push(`Failed to mark weekly report sent (${job.id}): ${reportErr.message}`);
          }

          continue;
        }

        const nextAttempts = (job.attempts ?? 0) + 1;

        if (finalResult.kind === "permanent" || nextAttempts >= (job.max_attempts ?? 8)) {
          failed++;
          const { error: updateErr } = await supabase
            .from("email_jobs")
            .update({
              status: "failed",
              provider: finalResult.provider,
              last_error: finalResult.detail,
              attempts: nextAttempts,
              locked_at: null,
              locked_by: null,
            })
            .eq("id", job.id);
          if (updateErr) errors.push(`Failed to mark job failed (${job.id}): ${updateErr.message}`);

          if (job.kind === "weekly_report") {
            const { error: reportErr } = await supabase
              .from("weekly_reports")
              .update({
                status: "failed",
                last_error: finalResult.detail,
              })
              .eq("email_job_id", job.id);
            if (reportErr) errors.push(`Failed to mark weekly report failed (${job.id}): ${reportErr.message}`);
          }
          continue;
        }

        // Retry later (rate/temporary/quota-on-sendpulse).
        retried++;
        const delay = backoffMs(nextAttempts);
        const nextAttemptAt = new Date(Date.now() + delay).toISOString();
        const { error: updateErr } = await supabase
          .from("email_jobs")
          .update({
            status: "pending",
            provider: finalResult.provider,
            last_error: finalResult.detail,
            attempts: nextAttempts,
            next_attempt_at: nextAttemptAt,
            locked_at: null,
            locked_by: null,
          })
          .eq("id", job.id);
        if (updateErr) errors.push(`Failed to requeue job (${job.id}): ${updateErr.message}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    Sentry.captureException(e);
  }

  const status = errors.length > 0 ? "error" : "ok";
  Sentry.captureCheckIn({ checkInId, monitorSlug: "process-email-queue", status });

  return NextResponse.json({
    workerId,
    processed,
    sent,
    failed,
    retried,
    errors: errors.length > 0 ? errors : undefined,
  });
}

