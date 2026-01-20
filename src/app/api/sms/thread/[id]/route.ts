import { NextResponse } from "next/server";

import { createSupabaseClientWithAuth } from "@/lib/supabase";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { id: participantId } = await params;

  // Step 1: Get auth token (Supabase access token)
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json(
      { error: "Missing or invalid auth token" },
      { status: 401 }
    );
  }

  // Step 2: Validate participantId
  if (!participantId || participantId.trim() === "") {
    return NextResponse.json(
      { error: "Invalid participant ID" },
      { status: 400 }
    );
  }

  // Step 3: Create Supabase client scoped to the caller (RLS enforced via Bearer token)
  const supabase = createSupabaseClientWithAuth(token);

  // Step 5: Get authenticated user (validates token)
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token
  );
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  // Step 6: Look up mentor primary key (mentors.id)
  // RLS policies for sms_messages expect sms_messages.mentor_id = mentors.id
  const { data: mentor, error: mentorError } = await supabase
    .from("mentors")
    .select("id")
    .eq("user_id", userData.user.id)
    .single();

  if (mentorError || !mentor?.id) {
    return NextResponse.json(
      { error: "Mentor record not found" },
      { status: 404 }
    );
  }

  // Step 7: Verify participant exists and mentor has access (RLS enforced)
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("id")
    .eq("id", participantId)
    .single();

  if (participantError || !participant) {
    return NextResponse.json(
      { error: "Participant not found or access denied" },
      { status: 404 }
    );
  }

  // Step 8: Fetch SMS messages for the participant, ordered by created_at ascending
  const { data: messages, error: messagesError } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json(
      { error: "Failed to fetch messages", details: messagesError },
      { status: 500 }
    );
  }

  // Return empty array if no messages found (not an error)
  return NextResponse.json({ messages: messages ?? [] });
}
