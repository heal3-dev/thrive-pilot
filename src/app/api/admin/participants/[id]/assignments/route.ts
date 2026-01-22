import { NextResponse } from "next/server";

import { requireAdmin } from "../../../_utils";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing participant id" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("mentor_assignments")
    .select(
      `
      id,
      mentor_id,
      participant_id,
      assigned_at,
      unassigned_at,
      mentors ( id, name, email )
    `
    )
    .eq("participant_id", id)
    .order("assigned_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch assignment history" }, { status: 500 });
  }

  const history = (data ?? []).map((a) => ({
    id: a.id,
    mentor_id: a.mentor_id,
    participant_id: a.participant_id,
    assigned_at: a.assigned_at,
    unassigned_at: a.unassigned_at,
    mentor: a.mentors ?? null,
  }));

  return NextResponse.json({ history });
}

