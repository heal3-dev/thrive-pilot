import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

type RouteParams = { params: Promise<{ id: string }> };

const updateParticipantSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

export async function GET(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  // Get participant
  const { data: participant, error: participantError } = await admin
    .from("participants")
    .select("*")
    .eq("id", id)
    .single();

  if (participantError || !participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  // Get assignment history
  const { data: assignments, error: assignmentsError } = await admin
    .from("mentor_assignments")
    .select(`
      id,
      mentor_id,
      assigned_at,
      unassigned_at,
      mentors ( id, name, email )
    `)
    .eq("participant_id", id)
    .order("assigned_at", { ascending: false });

  if (assignmentsError) {
    return NextResponse.json({ error: "Failed to fetch assignment history" }, { status: 500 });
  }

  // Transform assignments
  const assignmentHistory = (assignments ?? []).map((a) => ({
    id: a.id,
    mentor_id: a.mentor_id,
    assigned_at: a.assigned_at,
    unassigned_at: a.unassigned_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mentor: a.mentors as any,
  }));

  return NextResponse.json({
    participant,
    assignmentHistory,
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing participant id" }, { status: 400 });
  }

  let payload: z.infer<typeof updateParticipantSchema>;
  try {
    payload = updateParticipantSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check participant exists
  const { data: existing, error: existingError } = await admin
    .from("participants")
    .select("id")
    .eq("id", id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  // Prevent duplicate email (excluding this participant)
  if (payload.email) {
    const { data: existingEmail } = await admin
      .from("participants")
      .select("id")
      .eq("email", payload.email)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    if (existingEmail?.id) {
      return NextResponse.json(
        { error: "A participant with this email already exists" },
        { status: 409 }
      );
    }
  }

  // Prevent duplicate phone (excluding this participant)
  if (payload.phone_number) {
    const { data: existingPhone } = await admin
      .from("participants")
      .select("id")
      .eq("phone_number", payload.phone_number)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    if (existingPhone?.id) {
      return NextResponse.json(
        { error: "A participant with this phone number already exists" },
        { status: 409 }
      );
    }
  }

  // Build update object
  const update: Record<string, unknown> = {};
  if (payload.name !== undefined) update.name = payload.name;
  if (payload.email !== undefined) update.email = payload.email;
  if (payload.phone_number !== undefined) update.phone_number = payload.phone_number;
  if (payload.is_active !== undefined) update.is_active = payload.is_active;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("participants")
    .update(update)
    .eq("id", id)
    .select("id, name, phone_number, email, is_active, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update participant" }, { status: 500 });
  }

  // If deactivating, also end any active assignments
  if (payload.is_active === false) {
    const { error: unassignError } = await admin
      .from("mentor_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("participant_id", id)
      .is("unassigned_at", null);

    if (unassignError) {
      console.error("Failed to unassign mentor during deactivation", unassignError);
      // We don't fail the request, just log it, as the participant is already inactive
    }
  }

  return NextResponse.json({ participant: data });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  // Check if participant record exists in the participants table
  const { data: existing } = await admin
    .from("participants")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existing?.id) {
    // ── Existing participant: soft delete ──
    const { error } = await admin
      .from("participants")
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to remove participant" }, { status: 500 });
    }

    // Also end any active assignments
    const { error: assignError } = await admin
      .from("mentor_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("participant_id", id)
      .is("unassigned_at", null);

    if (assignError) {
      console.error("Failed to unassign mentor during deletion", assignError);
    }

    return NextResponse.json({ ok: true });
  }

  // ── No participant record: this is an unverified auth-only user ──
  // Verify the auth user exists and is a participant invite
  const { data: authData, error: getUserError } =
    await admin.auth.admin.getUserById(id);

  if (getUserError || !authData?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const meta = authData.user.user_metadata as Record<string, unknown> | undefined;
  if (meta?.role !== "participant") {
    return NextResponse.json(
      { error: "This auth user is not a participant invite" },
      { status: 400 }
    );
  }

  // Hard delete the auth user
  const { error: deleteAuthError } = await admin.auth.admin.deleteUser(id);
  if (deleteAuthError) {
    console.error("[DELETE] Failed to delete auth user", deleteAuthError);
    return NextResponse.json(
      { error: "Failed to delete invited user" },
      { status: 500 }
    );
  }

  console.info("[DELETE] Unverified auth user deleted", {
    id,
    email: authData.user.email,
  });

  return NextResponse.json({ ok: true });
}
