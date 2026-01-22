import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

type RouteParams = { params: Promise<{ id: string }> };

const updateMentorSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).max(50).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing mentor id" }, { status: 400 });
  }

  let payload: z.infer<typeof updateMentorSchema>;
  try {
    payload = updateMentorSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Prevent duplicate email if updating email
  if (payload.email) {
    const { data: existing } = await guard.admin
      .from("mentors")
      .select("id")
      .eq("email", payload.email)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json({ error: "Mentor email already exists" }, { status: 409 });
    }
  }

  const { data, error } = await guard.admin
    .from("mentors")
    .update(payload)
    .eq("id", id)
    .select("id, user_id, name, email, role, is_active, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update mentor" }, { status: 500 });
  }

  return NextResponse.json({ mentor: data });
}

