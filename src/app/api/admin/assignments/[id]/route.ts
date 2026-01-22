import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";

type RouteParams = { params: Promise<{ id: string }> };

const unassignSchema = z.object({
  unassigned_at: z.string().datetime().optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing assignment id" }, { status: 400 });
  }

  let payload: z.infer<typeof unassignSchema>;
  try {
    payload = unassignSchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unassignedAt = payload.unassigned_at ?? new Date().toISOString();

  const { error } = await admin
    .from("mentor_assignments")
    .update({ unassigned_at: unassignedAt })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to unassign mentor" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

