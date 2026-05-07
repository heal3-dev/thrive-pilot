import { NextResponse } from "next/server";

import { verifyTwilioSignature } from "@/lib/twilio";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail } from "@/lib/email/send";

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

function classifyInboundMessageType(body: string): "user_message" | "user_command" {
  const text = body.trim().toUpperCase();
  // Common Twilio compliance keywords + basic commands you might use in testing.
  const commands = new Set([
    "HELP",
    "INFO",
    "STOP",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "START",
    "YES",
    "UNSTOP",
    "TEST",
  ]);
  return commands.has(text) ? "user_command" : "user_message";
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
  const webhookUrl = process.env.TWILIO_INCOMING_WEBHOOK_URL || buildTwilioSignatureUrl(request);

  if (!signature || !verifyTwilioSignature(webhookUrl, params, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Step 3: Extract required fields from Twilio payload
  const from = params.From;
  const body = params.Body;
  const messageSid = params.MessageSid;

  if (!from || !messageSid || !body?.trim()) {
    return NextResponse.json({ error: "Missing required Twilio fields" }, { status: 400 });
  }

  const normalizedFrom = normalizePhoneNumber(from);
  const messageType = classifyInboundMessageType(body);

  // Step 4: Create Supabase service-role client (Twilio webhooks are unauthenticated)
  const supabase = getSupabaseAdmin();

  // Step 5: Find participant by phone number
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("id")
    .eq("phone_number", normalizedFrom)
    .limit(1)
    .maybeSingle();

  if (participantError || !participant?.id) {
    console.warn("Inbound SMS: participant not found for phone number", { from, normalizedFrom, messageSid });
    // Return 200 to prevent Twilio from retrying for a non-transient error.
    return NextResponse.json({ warning: "Participant not found" }, { status: 200 });
  }

  // Step 6: (Optional) find assigned mentor_id for this participant
  // This helps if sms_messages.mentor_id is NOT NULL in your schema.
  const { data: assignment } = await supabase
    .from("mentor_assignments")
    .select("mentor_id")
    .eq("participant_id", participant.id)
    .limit(1)
    .maybeSingle();

  if (!assignment?.mentor_id) {
    console.warn("Inbound SMS: mentor assignment not found for participant", {
      participantId: participant.id,
      messageSid,
    });
    // Non-transient until an assignment exists; returning 200 prevents retries.
    return NextResponse.json({ warning: "Mentor assignment not found" }, { status: 200 });
  }

  // Step 7: Store inbound message in sms_messages (idempotent via UNIQUE + upsert)
  // DB constraint: UNIQUE (twilio_sid, direction)
  const { error: upsertError } = await supabase.from("sms_messages").upsert(
    {
      participant_id: participant.id,
      mentor_id: assignment.mentor_id,
      direction: "inbound",
      message_type: messageType,
      message_body: body,
      phone_number: normalizedFrom,
      twilio_sid: messageSid,
      twilio_status: "received",
      created_at: new Date().toISOString(), // Explicit UTC timestamp
    },
    {
      onConflict: "twilio_sid,direction",
      ignoreDuplicates: true,
    }
  );

  if (upsertError) {
    console.error("Inbound SMS: failed to store message record", { messageSid, upsertError });
    const debug =
      process.env.NODE_ENV !== "production"
        ? {
            // PostgRESTError typically has: message, details, hint, code
            upsertError,
          }
        : undefined;
    return NextResponse.json(
      { error: "Failed to store message record", ...(debug ? { debug } : {}) },
      { status: 500 }
    );
  }

  // Step 8: Best-effort notify assigned mentor via email (rate-limited).
  // Avoid blocking Twilio on email delivery; any failure here should not cause retries.
  if (messageType === "user_message") {
    try {
      const cooldownMinutes = Number(process.env.MENTOR_UNREAD_ALERT_COOLDOWN_MINUTES ?? "30");
      const cooldownMs = Number.isFinite(cooldownMinutes) ? cooldownMinutes * 60_000 : 30 * 60_000;
      const now = new Date();

      const { data: mentorRow, error: mentorErr } = await supabase
        .from("mentors")
        .select("id, email, name, is_active")
        .eq("id", assignment.mentor_id)
        .maybeSingle();

      if (!mentorErr && mentorRow?.email && mentorRow.is_active !== false) {
        const { data: alertRow, error: alertErr } = await supabase
          .from("mentor_unread_alerts")
          .select("last_alerted_at")
          .eq("mentor_id", assignment.mentor_id)
          .eq("participant_id", participant.id)
          .maybeSingle();

        const last = alertRow?.last_alerted_at ? new Date(alertRow.last_alerted_at) : null;
        const shouldSend = !last || now.getTime() - last.getTime() >= cooldownMs;

        if (!alertErr && shouldSend) {
          const { data: participantDetails } = await supabase
            .from("participants")
            .select("name, phone_number, email")
            .eq("id", participant.id)
            .maybeSingle();

          const participantLabel =
            participantDetails?.name?.trim() ||
            participantDetails?.email?.trim() ||
            participantDetails?.phone_number ||
            "a participant";

          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
          const dashboardLink = siteUrl ? `${siteUrl}/dashboard#inbox` : null;

          const safeBody = body.trim().slice(0, 400);
          const html = `
            <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f8fafc; padding: 24px;">
              <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;">
                <h1 style="margin: 0 0 12px; font-size: 18px; color: #0f172a;">New message from ${participantLabel}</h1>
                <p style="margin: 0 0 12px; color: #334155; line-height: 1.5;">
                  ${safeBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                </p>
                ${
                  dashboardLink
                    ? `<p style="margin: 0 0 16px;">
                        <a href="${dashboardLink}" style="display: inline-block; background: #0d9488; color: white; text-decoration: none; padding: 10px 14px; border-radius: 12px; font-weight: 700;">
                          Open inbox
                        </a>
                      </p>`
                    : ""
                }
                <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.4;">
                  You may receive at most one alert per participant every ${Math.round(cooldownMs / 60_000)} minutes.
                </p>
              </div>
            </div>
          `;

          await sendEmail({
            to: mentorRow.email,
            subject: `Thrive Pilot: New message from ${participantLabel}`,
            html,
          });

          await supabase.from("mentor_unread_alerts").upsert(
            {
              mentor_id: assignment.mentor_id,
              participant_id: participant.id,
              last_alerted_at: now.toISOString(),
            },
            { onConflict: "mentor_id,participant_id" }
          );
        }
      }
    } catch (e) {
      console.warn("Inbound SMS: mentor alert email failed (ignored)", {
        messageSid,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Step 9: Return 200 OK to Twilio
  return new Response("", { status: 200 });
}

