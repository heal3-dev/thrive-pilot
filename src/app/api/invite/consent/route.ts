import { NextResponse } from "next/server";

import { createSupabaseClientWithAuth, getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/invite/consent
 * Called when a participant accepts the consent terms after clicking the invite link.
 * 
 * This route creates the participant record AND records consent at the same time.
 * Participant data (name, phone_number) is retrieved from the auth user's user_metadata,
 * which was set when the admin sent the invite via /api/admin/participants/invite.
 */
export async function POST(request: Request) {
  // Get auth token from request
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

  // Validate the user's session
  const authedClient = createSupabaseClientWithAuth(token);
  const { data: userData, error: userError } = await authedClient.auth.getUser(token);

  if (userError || !userData?.user?.email) {
    return NextResponse.json(
      { error: "Invalid session or missing email" },
      { status: 401 }
    );
  }

  const user = userData.user;
  const userEmail = user.email;
  
  // Extract participant data from user_metadata (set during invite)
  const userMetadata = user.user_metadata || {};
  const participantName = userMetadata.name || null;
  const participantPhone = userMetadata.phone_number || "";

  // Use admin client to update participant record (bypasses RLS)
  const admin = getSupabaseAdmin();

  // Check if participant exists with this email
  const { data: participant, error: fetchError } = await admin
    .from("participants")
    .select("id, consent_given")
    .eq("email", userEmail)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching participant:", fetchError);
    return NextResponse.json(
      { error: "Failed to verify participant" },
      { status: 500 }
    );
  }

  // If the participant row doesn't exist yet, create it now.
  // This is the expected flow: admin sends invite → user accepts consent → participant created.
  if (!participant) {
    const { data: created, error: createError } = await admin
      .from("participants")
      .insert({
        user_id: user.id, // Link to auth user
        email: userEmail,
        name: participantName,
        phone_number: participantPhone,
        is_active: true,
        consent_given: true,
        consent_timestamp: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError || !created?.id) {
      console.error("[CONSENT] Error creating participant on consent:", {
        error: createError,
        code: createError?.code,
        message: createError?.message,
        details: createError?.details,
        hint: createError?.hint,
        userId: user.id,
        email: userEmail,
      });
      return NextResponse.json(
        { 
          error: "Failed to create participant record",
          details: createError?.message || "Unknown error"
        },
        { status: 500 }
      );
    }

    console.info("[CONSENT] Created participant on consent acceptance", {
      participantId: created.id,
      userId: user.id,
      email: userEmail,
      name: participantName,
      phone: participantPhone,
    });

    return NextResponse.json({ ok: true, createdParticipant: true });
  }

  // Already consented - just return success
  if (participant.consent_given) {
    return NextResponse.json({ ok: true, alreadyConsented: true });
  }

  // Update consent for existing participant (legacy flow or direct-add case)
  const { error: updateError } = await admin
    .from("participants")
    .update({
      consent_given: true,
      consent_timestamp: new Date().toISOString(),
    })
    .eq("id", participant.id);

  if (updateError) {
    console.error("Error updating consent:", updateError);
    return NextResponse.json(
      { error: "Failed to record consent" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
