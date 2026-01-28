import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

const checkSchema = z.object({
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
});

type ValidationErrors = {
  email?: string;
  phone_number?: string;
};

/**
 * POST /api/admin/participants/check
 * Check uniqueness constraints for email and phone number before creating/inviting a participant.
 * 
 * Email is checked against:
 * - Supabase Auth users (to prevent duplicate auth accounts)
 * - participants table
 * - mentors table
 * 
 * Phone number is checked against:
 * - participants table (participants_phone_number_unique constraint)
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  let payload: z.infer<typeof checkSchema>;
  try {
    payload = checkSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const errors: ValidationErrors = {};

  // Check email uniqueness
  if (payload.email) {
    // Check participants table
    const { data: existingParticipant } = await admin
      .from("participants")
      .select("id")
      .eq("email", payload.email)
      .limit(1)
      .maybeSingle();

    if (existingParticipant?.id) {
      errors.email = "A participant with this email already exists";
    }

    // Check mentors table
    if (!errors.email) {
      const { data: existingMentor } = await admin
        .from("mentors")
        .select("id")
        .eq("email", payload.email)
        .limit(1)
        .maybeSingle();

      if (existingMentor?.id) {
        errors.email = "This email is already registered as a mentor";
      }
    }

    // Check Supabase Auth users
    // This catches invited users who haven't completed consent yet
    if (!errors.email) {
      const { data: listData } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000, // Get a batch to check
      });

      if (listData?.users) {
        const authUserExists = listData.users.some(
          (u) => u.email?.toLowerCase() === payload.email?.toLowerCase()
        );
        if (authUserExists) {
          errors.email = "This email is already registered in the system";
        }
      }
    }
  }

  // Check phone number uniqueness
  if (payload.phone_number) {
    const { data: existingPhone } = await admin
      .from("participants")
      .select("id")
      .eq("phone_number", payload.phone_number)
      .limit(1)
      .maybeSingle();

    if (existingPhone?.id) {
      errors.phone_number = "A participant with this phone number already exists";
    }
  }

  return NextResponse.json({
    valid: Object.keys(errors).length === 0,
    errors,
  });
}
