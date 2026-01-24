import { NextResponse } from "next/server";

import { createSupabaseClientWithAuth, getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/invite/consent
 * Called when a participant accepts the consent terms after clicking the invite link.
 * Updates the participant record with consent_given = true.
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

  const userEmail = userData.user.email;

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

  // If the participant row doesn't exist yet, create it now (acceptance-based creation).
  // This also supports the case where the admin only invited via Supabase Auth,
  // without pre-creating a participants row.
  if (!participant) {
    const { data: created, error: createError } = await admin
      .from("participants")
      .insert({
        email: userEmail,
        name: null,
        phone_number: "",
        is_active: true,
        consent_given: true,
        consent_timestamp: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError || !created?.id) {
      console.error("Error creating participant on consent:", createError);
      return NextResponse.json(
        { error: "Failed to create participant record" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, createdParticipant: true });
  }

  // Already consented - just return success
  if (participant.consent_given) {
    return NextResponse.json({ ok: true, alreadyConsented: true });
  }

  // Update consent
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
