import { NextResponse } from "next/server";
import { z } from "zod";

import { getInviteRedirect, requireAdmin } from "../../_utils";

const inviteParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  phone_number: z.string().optional(),
});

/**
 * POST /api/admin/participants/invite
 * Send email invitation to a new participant.
 * 
 * This route ONLY sends the invite email - it does NOT create a participant record.
 * The participant record will be created when the user accepts the consent
 * (via POST /api/invite/consent).
 * 
 * Participant data (name, phone_number) is stored in auth user_metadata so it can
 * be retrieved when consent is given.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  let payload: z.infer<typeof inviteParticipantSchema>;
  try {
    payload = inviteParticipantSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check for duplicate email in participants table
  const { data: existingParticipant } = await admin
    .from("participants")
    .select("id")
    .eq("email", payload.email)
    .limit(1)
    .maybeSingle();

  if (existingParticipant?.id) {
    return NextResponse.json({ error: "A participant with this email already exists" }, { status: 409 });
  }

  // Check if email exists in mentors table
  const { data: existingMentor } = await admin
    .from("mentors")
    .select("id")
    .eq("email", payload.email)
    .limit(1)
    .maybeSingle();

  if (existingMentor?.id) {
    return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
  }

  // Check for duplicate phone number if provided
  if (payload.phone_number) {
    const { data: existingPhone } = await admin
      .from("participants")
      .select("id")
      .eq("phone_number", payload.phone_number)
      .limit(1)
      .maybeSingle();

    if (existingPhone?.id) {
      return NextResponse.json({ error: "A participant with this phone number already exists" }, { status: 409 });
    }
  }

  const { redirectTo, source } = getInviteRedirect(request);

  // Invite user - Supabase will send email using your custom invite template
  // Store name and phone_number in user_metadata so we can retrieve it when
  // the user accepts consent and we create the participant record
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(
    payload.email,
    {
      data: {
        name: payload.name || null,
        phone_number: payload.phone_number || null,
        role: "participant", // Mark as participant for identification
      },
      ...(redirectTo ? { redirectTo } : {}),
    }
  );

  if (authError) {
    console.error("[INVITE] Auth invite error:", {
      email: payload.email,
      redirectTo,
      redirectSource: source,
      error: authError,
    });
    return NextResponse.json(
      { error: "Failed to invite user: " + authError.message },
      { status: 500 }
    );
  }

  console.info("[INVITE] Invite email sent (participant will be created on consent)", {
    email: payload.email,
    name: payload.name || null,
    phone_number: payload.phone_number || null,
    redirectTo,
    redirectSource: source,
    authUserId: authUser?.user?.id ?? null,
  });

  return NextResponse.json(
    {
      inviteSent: true,
      message: "Invite email sent. Participant will be created when they accept.",
    },
    { status: 200 }
  );
}
