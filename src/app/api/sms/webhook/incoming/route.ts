import { NextResponse } from "next/server";

import { verifyTwilioSignature } from "@/lib/twilio";
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

  // Step 8: Return 200 OK to Twilio
  return new Response("OK", { status: 200 });
}

