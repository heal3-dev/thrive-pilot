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
 * 
 * NOTE: This is a placeholder implementation.
 * In production, integrate with:
 * - Supabase Edge Functions for email sending
 * - External email service (SendGrid, Resend, etc.)
 * - Generate secure invite token with expiration
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

  // Check for duplicate email
  const { data: existingEmail } = await admin
    .from("participants")
    .select("id")
    .eq("email", payload.email)
    .limit(1)
    .maybeSingle();

  if (existingEmail?.id) {
    return NextResponse.json({ error: "A participant with this email already exists" }, { status: 409 });
  }

  // Generate invite token (in production, store this securely with expiration)
  const inviteToken = crypto.randomUUID();

  // Create participant record with pending status
  const { data: participant, error: createError } = await admin
    .from("participants")
    .insert({
      email: payload.email,
      name: payload.name || null,
      phone_number: "", // Will be filled during onboarding
      is_active: true, // Active but incomplete profile
    })
    .select("id, email, name")
    .single();

  if (createError) {
    return NextResponse.json({ error: "Failed to create participant" }, { status: 500 });
  }

  // TODO: In production, implement actual email sending here
  // Example with Resend/SendGrid:
  // await sendEmail({
  //   to: payload.email,
  //   subject: "Welcome to Thrive Pilot",
  //   html: `
  //     <h1>You've been invited to Thrive Pilot!</h1>
  //     <p>Click the link below to complete your registration:</p>
  //     <a href="${process.env.NEXT_PUBLIC_APP_URL}/onboard?token=${inviteToken}">
  //       Complete Registration
  //     </a>
  //   `
  // });

  // For now, log the invite details
  console.log(`[INVITE] Email invite generated for ${payload.email}`);
  console.log(`[INVITE] Token: ${inviteToken}`);

  return NextResponse.json({
    participant,
    inviteToken, // In production, don't expose this - just confirm email was sent
    message: `Invitation sent to ${payload.email}`,
  }, { status: 201 });
}
