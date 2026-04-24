import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../_utils";

// Schema for direct creation (with password)
const createMentorSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: z.string().min(1).max(50).optional().default("mentor"),
});

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("mentors")
    .select("id, user_id, name, email, role, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch mentors" }, { status: 500 });
  }

  return NextResponse.json({ mentors: data ?? [] });
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin(request);
    if (!guard.ok) return guard.response;

    const admin = guard.admin;

    let payload: z.infer<typeof createMentorSchema>;
    try {
      payload = createMentorSchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Prevent duplicate email in mentors table
    const { data: existingMentor } = await admin
      .from("mentors")
      .select("id")
      .eq("email", payload.email)
      .limit(1)
      .maybeSingle();

    if (existingMentor?.id) {
      return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
    }

    // Check if email exists in participants table
    const { data: existingParticipant } = await admin
      .from("participants")
      .select("id")
      .eq("email", payload.email)
      .limit(1)
      .maybeSingle();

    if (existingParticipant?.id) {
      return NextResponse.json({ error: "This email is already registered as a participant" }, { status: 409 });
    }

    // Create new auth user with password (auto-confirmed)
    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true, // Auto-confirm so they can log in immediately
      user_metadata: {
        role: payload.role,
        name: payload.name,
      },
    });

    if (createError || !userData?.user?.id) {
      // Extract error message - Supabase AuthError has .message property
      let errorMsg = "Failed to create user account";
      if (createError) {
        if (createError instanceof Error) {
          errorMsg = createError.message;
        } else if (typeof createError === "object") {
          const errObj = createError as Record<string, unknown>;
          errorMsg = String(
            errObj.message || errObj.error_description || errObj.msg || errObj.error || "Failed to create user account"
          );
        }
      }
      console.error("Error creating auth user:", errorMsg, createError);

      const lower = errorMsg.toLowerCase();
      if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
        return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
      }

      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const userId = userData.user.id;

    // Create mentor record with user_id
    const { data, error } = await admin
      .from("mentors")
      .insert({
        user_id: userId,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        is_active: true,
      })
      .select("id, user_id, name, email, role, is_active, created_at")
      .single();

    if (error) {
      console.error("Error creating mentor record:", error);
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.message ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.details ||
        "Failed to create mentor";

      const lower = String(msg).toLowerCase();
      if (lower.includes("duplicate") || lower.includes("already") || lower.includes("unique")) {
        return NextResponse.json({ error: String(msg) }, { status: 409 });
      }

      return NextResponse.json({ error: String(msg) }, { status: 500 });
    }

    return NextResponse.json({ mentor: data }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in mentor creation:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

