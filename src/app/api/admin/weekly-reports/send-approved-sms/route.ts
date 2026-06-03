import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdmin } from "@/app/api/admin/_utils";
import { twilioClient, TWILIO_PHONE_NUMBER } from "@/lib/twilio";
import { toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const requestSchema = z.object({
  // If omitted, sends all approved reports.
  participantIds: z.array(z.string().uuid()).optional(),
  // Prefer specifying reportIds when selecting a subset.
  reportIds: z.array(z.string().uuid()).optional(),
  // Optional filter to only send a specific week.
  weekEnding: z.string().min(10).max(10).optional(),
  // When true, returns a preview without sending.
  dryRun: z.boolean().optional(),
});

type WeeklyReportRow = {
  id: string;
  participant_id: string;
  week_ending: string;
  week_range: string;
  badge_label: string;
  badge_icon: string;
  status: "draft" | "approved" | "queued" | "sent" | "failed";
  approved_at: string | null;
  html: string;
  sms_message_id: string | null;
};

type ParticipantRow = {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function firstName(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] || trimmed;
}

async function ensureActiveShareToken(params: {
  admin: SupabaseClient;
  reportId: string;
}): Promise<{ token: string; expiresAt: string } | { error: string }> {
  const { admin, reportId } = params;

  const nowIso = new Date().toISOString();
  const { data: existing, error: existingErr } = await admin
    .from("weekly_report_shares")
    .select("id, token, expires_at")
    .eq("weekly_report_id", reportId)
    .eq("is_active", true)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) return { error: existingErr.message };
  if (existing?.token) return { token: existing.token, expiresAt: existing.expires_at };

  // Mint new token by calling the internal admin endpoint logic would be overkill here; insert directly.
  // Token format mirrors /api/admin/weekly-reports/share.
  const crypto = await import("crypto");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: inserted, error: insertErr } = await admin
    .from("weekly_report_shares")
    .insert({
      weekly_report_id: reportId,
      token,
      is_active: true,
      expires_at: expiresAt,
    })
    .select("token, expires_at")
    .single();

  if (insertErr || !inserted?.token) return { error: insertErr?.message || "Failed to mint share token" };
  return { token: inserted.token, expiresAt: inserted.expires_at };
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

  if (!TWILIO_PHONE_NUMBER) {
    return NextResponse.json({ error: "TWILIO_PHONE_NUMBER is missing" }, { status: 500 });
  }

  const siteUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (!siteUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL is missing" }, { status: 500 });
  }

  // For SMS, treat any report with approved_at as approved, even if email flow moved it to queued/sent.
  let query = guard.admin
    .from("weekly_reports")
    .select("id, participant_id, week_ending, week_range, badge_label, badge_icon, status, approved_at, html, sms_message_id")
    .not("approved_at", "is", null);

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
    return NextResponse.json({ sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0 });
  }

  const participantIds = Array.from(new Set(rows.map((r) => r.participant_id)));
  const { data: participants, error: participantsErr } = await guard.admin
    .from("participants")
    .select("id, name, phone_number, email")
    .in("id", participantIds);

  if (participantsErr) {
    return NextResponse.json({ error: `Failed to load participant phones: ${participantsErr.message}` }, { status: 500 });
  }

  const byId = new Map((participants ?? []).map((p) => [p.id, p as ParticipantRow]));

  // Active assignments: participant -> mentor_id (for threading).
  const { data: assignments, error: assignErr } = await guard.admin
    .from("mentor_assignments")
    .select("participant_id, mentor_id, unassigned_at")
    .in("participant_id", participantIds);

  if (assignErr) {
    return NextResponse.json({ error: `Failed to load mentor assignments: ${assignErr.message}` }, { status: 500 });
  }

  const mentorByParticipant = new Map<string, string>();
  for (const a of (assignments ?? []) as Array<{ participant_id: string; mentor_id: string; unassigned_at: string | null }>) {
    if (a.unassigned_at) continue;
    if (!mentorByParticipant.has(a.participant_id)) mentorByParticipant.set(a.participant_id, a.mentor_id);
  }

  let sent = 0;
  let skippedNoPhone = 0;
  let skippedAlreadySent = 0;
  let failed = 0;
  const errors: Array<{ reportId: string; participantId: string; error: string }> = [];
  const preview: Array<{
    reportId: string;
    participantId: string;
    participantName: string;
    toPhone: string;
    weekRange: string;
    shareUrl: string;
    messageBody: string;
    expiresAt: string;
  }> = [];

  for (const report of rows) {
    const p = byId.get(report.participant_id);
    const participantName = p?.name?.trim() || p?.email?.trim() || "Participant";
    const rawPhone = (p?.phone_number ?? "").trim();
    const e164 = rawPhone ? toE164(rawPhone) : null;
    if (!e164) {
      skippedNoPhone++;
      continue;
    }

    if (report.sms_message_id) {
      skippedAlreadySent++;
      continue;
    }

    const minted = await ensureActiveShareToken({ admin: guard.admin, reportId: report.id });
    if ("error" in minted) {
      failed++;
      errors.push({ reportId: report.id, participantId: report.participant_id, error: minted.error });
      continue;
    }

    const shareUrl = `${siteUrl}/r/w/${encodeURIComponent(minted.token)}`;
    const msg = [
      `Hi ${firstName(participantName)}, here’s your Thrive weekly report (${report.week_range}) — ${report.badge_label} ${report.badge_icon}.`,
      `View: ${shareUrl}`,
    ].join(" ");

    if (payload.dryRun) {
      preview.push({
        reportId: report.id,
        participantId: report.participant_id,
        participantName,
        toPhone: e164,
        weekRange: report.week_range,
        shareUrl,
        messageBody: msg,
        expiresAt: minted.expiresAt,
      });
      continue;
    }

    const mentorId = mentorByParticipant.get(report.participant_id) ?? null;
    if (!mentorId) {
      failed++;
      errors.push({ reportId: report.id, participantId: report.participant_id, error: "Mentor assignment not found" });
      continue;
    }

    try {
      const tw = await twilioClient.messages.create({
        to: e164,
        from: TWILIO_PHONE_NUMBER,
        body: msg,
      });

      const { data: inserted, error: insertErr } = await guard.admin
        .from("sms_messages")
        .insert({
          participant_id: report.participant_id,
          mentor_id: mentorId,
          direction: "outbound",
          message_type: "notification",
          message_body: msg,
          phone_number: e164,
          twilio_sid: tw.sid,
          twilio_status: tw.status,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertErr || !inserted?.id) {
        failed++;
        errors.push({ reportId: report.id, participantId: report.participant_id, error: "Failed to store message record" });
        await guard.admin
          .from("weekly_reports")
          .update({ sms_last_error: insertErr?.message || "Failed to store message record" })
          .eq("id", report.id);
        continue;
      }

      await guard.admin
        .from("weekly_reports")
        .update({
          sms_message_id: inserted.id,
          sms_sent_at: new Date().toISOString(),
          sms_last_error: null,
        })
        .eq("id", report.id);

      sent++;
    } catch (e) {
      failed++;
      const errMsg = e instanceof Error ? e.message : "Twilio API request failed";
      errors.push({ reportId: report.id, participantId: report.participant_id, error: errMsg });
      await guard.admin
        .from("weekly_reports")
        .update({ sms_last_error: errMsg })
        .eq("id", report.id);
    }
  }

  return NextResponse.json({
    sent,
    skippedNoPhone,
    skippedAlreadySent,
    failed,
    preview: payload.dryRun ? preview : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
}

