import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

const inviteParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
});

/**
 * POST /api/admin/participants/invite
 * Send email invitation to a new participant
 * Creates both an Auth user and a participant database record
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

  // Invite user - Supabase will send email using your custom invite template
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(
    payload.email,
    {
      data: {
        name: payload.name || null,
      },
    }
  );

  if (authError) {
    console.error("Auth invite error:", authError);
    return NextResponse.json(
      { error: "Failed to invite user: " + authError.message },
      { status: 500 }
    );
  }

  // Create participant record with only email, name, phone
  const { data: participant, error: participantError } = await admin
    .from("participants")
    .insert({
      id: authUser.user.id, // Link to auth user
      email: payload.email,
      name: payload.name || null,
      phone_number: "", // Will be filled during onboarding
      is_active: true,
    })
    .select("id, email, name, phone_number")
    .single();

  if (participantError) {
    console.error("Participant creation error:", participantError);
    return NextResponse.json(
      { error: "Failed to create participant: " + participantError.message },
      { status: 500 }
    );
  }

  // TODO: Send email with:
  // - Consent/disclaimer to read
  // - Magic link or direct login link to /invite/consent
  // The link should auto-login them (since password is random, use magic link)
  // After they accept consent, redirect to complete onboarding

  console.log(`[INVITE] Created participant ${participant.id} for ${payload.email}`);

  return NextResponse.json(
    {
      participant,
      message: `Participant created. Email sending not implemented yet.`,
    },
    { status: 201 }
  );
}
