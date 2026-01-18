import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { twilioClient, TWILIO_PHONE_NUMBER } from "@/lib/twilio";

const requestSchema = z.object({
  participantId: z.string().min(1),
  messageBody: z.string().min(1).max(1600),
});

export async function POST(request: Request) {
  // Step 1: Get auth token (Supabase access token)
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json({ error: "Missing or invalid auth token" }, { status: 401 });
  }

  // Step 2: Validate request body
  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Step 3: Verify required environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase environment variables are missing" },
      { status: 500 }
    );
  }

  if (!TWILIO_PHONE_NUMBER) {
    return NextResponse.json(
      { error: "TWILIO_PHONE_NUMBER is missing" },
      { status: 500 }
    );
  }

  // Step 4: Create Supabase client scoped to the caller (RLS enforced via Bearer token)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // Step 5: Get authenticated user (validates token)
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  // Step 6: ⭐ CRITICAL: Look up mentor primary key (mentors.id), not auth.users.id.
  // Our RLS policies for sms_messages expect sms_messages.mentor_id = mentors.id.
  const { data: mentor, error: mentorError } = await supabase
    .from("mentors")
    .select("id")
    .eq("user_id", userData.user.id)
    .single();

  if (mentorError || !mentor?.id) {
    return NextResponse.json({ error: "Mentor record not found" }, { status: 404 });
  }

  // Step 7: Fetch participant phone number (RLS should ensure mentor is assigned)
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("id, phone_number")
    .eq("id", payload.participantId)
    .single();

  if (participantError || !participant?.phone_number) {
    return NextResponse.json({ error: "Participant not found", details: participantError  }, { status: 404 });
  }

  // Step 8: Send SMS via Twilio, then persist message record
  try {
    const message = await twilioClient.messages.create({
      to: participant.phone_number,
      from: TWILIO_PHONE_NUMBER,
      body: payload.messageBody,
    });

    const { error: insertError } = await supabase.from("sms_messages").insert({
      participant_id: payload.participantId,
      mentor_id: mentor.id,
      direction: "outbound",
      message_type: "mentor_message",
      message_body: payload.messageBody,
      phone_number: participant.phone_number,
      twilio_sid: message.sid,
      twilio_status: message.status,
    });
    if (insertError) {
      return NextResponse.json(
        { error: "Failed to store message record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      messageId: message.sid,
      status: message.status,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Twilio API request failed" },
      { status: 502 }
    );
  }
}
