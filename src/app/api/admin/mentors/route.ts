import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../_utils";

const createMentorSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
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
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof createMentorSchema>;
  try {
    payload = createMentorSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Prevent duplicate email in mentors table
  const { data: existingMentor } = await guard.admin
    .from("mentors")
    .select("id")
    .eq("email", payload.email)
    .limit(1)
    .maybeSingle();

  if (existingMentor?.id) {
    return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
  }

  // Check if email exists in participants table
  const { data: existingParticipant } = await guard.admin
    .from("participants")
    .select("id")
    .eq("email", payload.email)
    .limit(1)
    .maybeSingle();

  if (existingParticipant?.id) {
    return NextResponse.json({ error: "This email is already registered as a participant" }, { status: 409 });
  }

  const { data, error } = await guard.admin
    .from("mentors")
    .insert({
      name: payload.name,
      email: payload.email,
      role: payload.role,
      is_active: true,
    })
    .select("id, user_id, name, email, role, is_active, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create mentor" }, { status: 500 });
  }

  return NextResponse.json({ mentor: data }, { status: 201 });
}

