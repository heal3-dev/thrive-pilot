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

  // Check if the assignment exists
  const { data: currentAssignment } = await admin
    .from("mentor_assignments")
    .select("id, unassigned_at")
    .eq("id", payload.assignmentId)
    .single();

  if (!currentAssignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // Always UPDATE the existing assignment with the new mentor
  // (Database has unique constraint allowing only one row per participant)
  const { error: updateError } = await admin
    .from("mentor_assignments")
    .update({
      mentor_id: payload.newMentorId,
      assigned_at: nowIso,
      unassigned_at: null, // Reactivate if it was ended
    })
    .eq("id", payload.assignmentId);

  if (updateError) {
    console.error("Error updating assignment:", updateError);
    return NextResponse.json({ error: `Failed to reassign: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

