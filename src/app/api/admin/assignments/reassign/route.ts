import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

const reassignSchema = z.object({
  assignmentId: z.string().min(1),
  participantId: z.string().min(1),
  newMentorId: z.string().min(1),
});

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;

  let payload: z.infer<typeof reassignSchema>;
  try {
    payload = reassignSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  // End current assignment (by id)
  const { error: endError } = await admin
    .from("mentor_assignments")
    .update({ unassigned_at: nowIso })
    .eq("id", payload.assignmentId);

  if (endError) {
    return NextResponse.json({ error: "Failed to end current assignment" }, { status: 500 });
  }

  // Enforce 1-to-1: ensure no other active assignment exists now (defense-in-depth)
  const { data: existing } = await admin
    .from("mentor_assignments")
    .select("id")
    .eq("participant_id", payload.participantId)
    .is("unassigned_at", null)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json(
      { error: "Participant already has an active assignment" },
      { status: 409 }
    );
  }

  // Create new assignment row
  const { error: insertError } = await admin.from("mentor_assignments").insert({
    participant_id: payload.participantId,
    mentor_id: payload.newMentorId,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to create new assignment" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

