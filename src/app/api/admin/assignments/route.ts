import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../_utils";

const createAssignmentSchema = z.object({
  participantId: z.string().min(1),
  mentorId: z.string().min(1),
});

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  // Fetch assignments with joined participant + mentor details
  const { data: assignmentsData, error: assignmentsError } = await admin
    .from("mentor_assignments")
    .select(
      `
      id,
      mentor_id,
      participant_id,
      assigned_at,
      unassigned_at,
      participants ( id, name, phone_number, email, is_active ),
      mentors ( id, name, email, role, is_active )
    `
    )
    .order("assigned_at", { ascending: false });

  if (assignmentsError) {
    return NextResponse.json({ error: "Failed to fetch assignments" }, { status: 500 });
  }

  const assignments = (assignmentsData ?? []).map((a) => ({
    id: a.id,
    mentor_id: a.mentor_id,
    participant_id: a.participant_id,
    assigned_at: a.assigned_at,
    unassigned_at: a.unassigned_at,
    participant: a.participants ?? null,
    mentor: a.mentors ?? null,
  }));

  // Active assignment participant ids (unassigned_at is NULL)
  const activeAssignmentParticipantIds = assignments
    .filter((a) => !a.unassigned_at)
    .map((a) => a.participant_id);

  // Unassigned participants = active participants NOT in active assignments
  let unassignedQuery = admin.from("participants").select("*").eq("is_active", true);
  if (activeAssignmentParticipantIds.length > 0) {
    // PostgREST "in" expects a comma-separated list without quotes when values are UUIDs.
    unassignedQuery = unassignedQuery.not(
      "id",
      "in",
      `(${activeAssignmentParticipantIds.join(",")})`
    );
  }
  const { data: unassignedParticipants, error: unassignedError } = await unassignedQuery;
  if (unassignedError) {
    return NextResponse.json({ error: "Failed to fetch unassigned participants" }, { status: 500 });
  }

  // Active mentors (non-admin)
  const { data: activeMentors, error: mentorsError } = await admin
    .from("mentors")
    .select("*")
    .eq("is_active", true)
    .neq("role", "admin");

  if (mentorsError) {
    return NextResponse.json({ error: "Failed to fetch mentors" }, { status: 500 });
  }

  return NextResponse.json({
    assignments,
    unassignedParticipants: unassignedParticipants ?? [],
    activeMentors: activeMentors ?? [],
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  let payload: z.infer<typeof createAssignmentSchema>;
  try {
    payload = createAssignmentSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Enforce 1-to-1: participant cannot already have an active assignment
  const { data: existing, error: existingError } = await admin
    .from("mentor_assignments")
    .select("id")
    .eq("participant_id", payload.participantId)
    .is("unassigned_at", null)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: "Failed to validate assignment" }, { status: 500 });
  }
  if (existing?.id) {
    return NextResponse.json(
      { error: "This participant already has an active assignment" },
      { status: 409 }
    );
  }

  const { error: insertError } = await admin.from("mentor_assignments").insert({
    participant_id: payload.participantId,
    mentor_id: payload.mentorId,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to create assignment" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

