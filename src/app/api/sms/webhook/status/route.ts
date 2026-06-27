import { NextResponse } from "next/server";

import { twilioClient, verifyTwilioSignature } from "@/lib/twilio";
import { getSupabaseAdmin } from "@/lib/supabase";

function buildTwilioSignatureUrl(request: Request): string {
  // Twilio signs the *public* URL it requests (e.g. your ngrok URL).
  // Prefer forwarded headers when behind a proxy.
  const url = new URL(request.url);

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;

  return `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`;
}

function formDataToParams(formData: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

function normalizePhoneNumber(phone: string): string {
  // Remove all non-digits except leading +
  return phone.replace(/[^\d+]/g, "");
}

function pickFirst(params: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = params[k];
    if (v) return v;
  }
  return undefined;
}

type TwilioStatus = "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed";

function normalizeStatus(status: string): TwilioStatus | string {
  return status.trim().toLowerCase();
}

export async function POST(request: Request) {
  // Step 1: Parse Twilio form payload (application/x-www-form-urlencoded)
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const params = formDataToParams(formData);

  // Step 2: Verify Twilio signature
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const webhookUrl = process.env.TWILIO_STATUS_WEBHOOK_URL || buildTwilioSignatureUrl(request);

  if (!signature || !verifyTwilioSignature(webhookUrl, params, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Step 3: Extract status callback fields from Twilio payload
  const messageSid = pickFirst(params, ["MessageSid", "SmsSid"]);
  const messageStatusRaw = pickFirst(params, ["MessageStatus", "SmsStatus"]);
  const messageStatus = messageStatusRaw ? normalizeStatus(messageStatusRaw) : undefined;

  // Twilio error details (often present for failures)
  const errorCode = pickFirst(params, ["ErrorCode"]);
  const errorMessage = pickFirst(params, ["ErrorMessage"]);

  if (!messageSid || !messageStatus) {
    return NextResponse.json(
      { error: "Missing required Twilio fields (MessageSid/MessageStatus)" },
      { status: 400 }
    );
  }

  // Step 4: Create Supabase service-role client (Twilio webhooks are unauthenticated)
  const supabase = getSupabaseAdmin();

  // Step 5: Load the outbound message row to update
  const { data: existing, error: existingError } = await supabase
    .from("sms_messages")
    .select("id, sent_at, delivered_at, failed_at")
    .eq("twilio_sid", messageSid)
    .eq("direction", "outbound")
    .maybeSingle();

  if (existingError) {
    console.error("Status webhook: failed to query sms_messages", { messageSid, existingError });
    return NextResponse.json({ error: "Database read failed" }, { status: 500 });
  }

  if (!existing?.id) {
    // This can happen for Twilio-generated auto replies (opt-out/help responses) or
    // for messages sent outside our app. To store them, fetch message details from Twilio
    // and insert a corresponding outbound row.
    try {
      const msg = await twilioClient.messages(messageSid).fetch();

      const to = msg.to ? normalizePhoneNumber(msg.to) : undefined;
      const from = msg.from ? normalizePhoneNumber(msg.from) : undefined;

      if (!to) {
        console.warn("Status webhook: Twilio message missing 'to'", { messageSid, messageStatus, from });
        return NextResponse.json({ warning: "Message not found" }, { status: 200 });
      }

      const { data: participant } = await supabase
        .from("participants")
        .select("id")
        .eq("phone_number", to)
        .limit(1)
        .maybeSingle();

      if (!participant?.id) {
        console.warn("Status webhook: participant not found for outbound message", { messageSid, to, from });
        return NextResponse.json({ warning: "Message not found" }, { status: 200 });
      }

      const { data: assignment } = await supabase
        .from("mentor_assignments")
        .select("mentor_id")
        .eq("participant_id", participant.id)
        .limit(1)
        .maybeSingle();

      if (!assignment?.mentor_id) {
        console.warn("Status webhook: mentor assignment not found for participant", {
          messageSid,
          participantId: participant.id,
        });
        return NextResponse.json({ warning: "Message not found" }, { status: 200 });
      }

      const nowIso = new Date().toISOString();
      const seed: Record<string, unknown> = {
        participant_id: participant.id,
        mentor_id: assignment.mentor_id,
        direction: "outbound",
        message_type: msg.direction === "outbound-reply" ? "system_auto_reply" : "notification",
        message_body: msg.body ?? "",
        phone_number: to,
        twilio_sid: messageSid,
        twilio_status: messageStatus,
        updated_at: nowIso,
      };

      if (messageStatus === "sent") seed.sent_at = nowIso;
      if (messageStatus === "delivered") seed.delivered_at = nowIso;
      if (messageStatus === "failed" || messageStatus === "undelivered") {
        seed.failed_at = nowIso;
        const reason = errorMessage || errorCode;
        if (reason) seed.failure_reason = reason;
      }

      const { error: seedError } = await supabase.from("sms_messages").insert(seed);
      if (seedError) {
        console.error("Status webhook: failed to seed sms_messages row", { messageSid, seedError });
        return NextResponse.json({ error: "Database write failed" }, { status: 500 });
      }

      return new Response("OK", { status: 200 });
    } catch (e) {
      console.error("Status webhook: failed to fetch Twilio message", { messageSid, e });
      return NextResponse.json({ warning: "Message not found" }, { status: 200 });
    }
  }

  // Step 6: Compute updates
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    twilio_status: messageStatus,
    updated_at: nowIso,
  };

  if (messageStatus === "sent" && !existing.sent_at) update.sent_at = nowIso;
  if (messageStatus === "delivered" && !existing.delivered_at) update.delivered_at = nowIso;

  // Treat undelivered/failed as failures; record a timestamp and reason.
  if ((messageStatus === "failed" || messageStatus === "undelivered") && !existing.failed_at) {
    update.failed_at = nowIso;
    const reason = errorMessage || errorCode;
    if (reason) update.failure_reason = reason;
  }

  // Step 7: Persist update
  const { error: updateError } = await supabase
    .from("sms_messages")
    .update(update)
    .eq("id", existing.id);

  if (updateError) {
    console.error("Status webhook: failed to update sms_messages", { messageSid, updateError });
    return NextResponse.json({ error: "Database write failed" }, { status: 500 });
  }

  // Propagate status update to weekly_reports or monthly_reports if this message was a report
  if (messageStatus === "failed" || messageStatus === "undelivered") {
    const reason = errorMessage || errorCode || "Twilio delivery failed";
    await supabase
      .from("weekly_reports")
      .update({
        status: "failed",
        sms_last_error: reason,
        last_error: reason,
      })
      .eq("sms_message_id", existing.id);

    await supabase
      .from("monthly_reports")
      .update({
        status: "failed",
        sms_last_error: reason,
        last_error: reason,
      })
      .eq("sms_message_id", existing.id);
  } else if (messageStatus === "delivered") {
    await supabase
      .from("weekly_reports")
      .update({
        status: "sent",
        sms_last_error: null,
      })
      .eq("sms_message_id", existing.id);

    await supabase
      .from("monthly_reports")
      .update({
        status: "sent",
        sms_last_error: null,
      })
      .eq("sms_message_id", existing.id);
  }

  // Step 8: Return 200 OK to Twilio
  return new Response("OK", { status: 200 });
}

