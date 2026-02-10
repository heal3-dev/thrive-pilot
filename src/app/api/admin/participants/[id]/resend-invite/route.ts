import { NextResponse } from "next/server";

import { getInviteRedirect, requireAdmin } from "../../../_utils";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/participants/[id]/resend-invite
 * Resend the invite email for an unverified auth user (one who exists in
 * Supabase Auth but hasn't yet accepted the invite / created a participant record).
 *
 * Flow:
 *   1. Look up the auth user by ID to grab email & metadata
 *   2. Delete the existing auth user
 *   3. Re-invite using inviteUserByEmail (which sends a fresh email)
 */
export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const admin = guard.admin;
  const { id } = await params;

  // 1. Fetch the auth user
  const { data: authData, error: getUserError } =
    await admin.auth.admin.getUserById(id);

  if (getUserError || !authData?.user) {
    return NextResponse.json(
      { error: "Auth user not found" },
      { status: 404 }
    );
  }

  const user = authData.user;
  const email = user.email;
  const meta = user.user_metadata as Record<string, unknown> | undefined;

  if (!email) {
    return NextResponse.json(
      { error: "Auth user has no email" },
      { status: 400 }
    );
  }

  // Ensure user is actually an unverified participant (exists in auth but NOT
  // in the participants table).
  if (meta?.role !== "participant") {
    return NextResponse.json(
      { error: "This user is not a participant invite" },
      { status: 400 }
    );
  }

  const { data: existingParticipant } = await admin
    .from("participants")
    .select("id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (existingParticipant?.id) {
    return NextResponse.json(
      { error: "This participant has already accepted the invite" },
      { status: 400 }
    );
  }

  // 2. Delete the old auth user so we can re-invite with a fresh token
  const { error: deleteError } = await admin.auth.admin.deleteUser(id);
  if (deleteError) {
    console.error("[RESEND-INVITE] Failed to delete old auth user", deleteError);
    return NextResponse.json(
      { error: "Failed to prepare re-invite" },
      { status: 500 }
    );
  }

  // 3. Re-invite with the same email & metadata
  const { redirectTo, source } = getInviteRedirect(request);

  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        name: (meta?.name as string) || null,
        phone_number: (meta?.phone_number as string) || null,
        role: "participant",
      },
      ...(redirectTo ? { redirectTo } : {}),
    });

  if (inviteError) {
    console.error("[RESEND-INVITE] inviteUserByEmail failed", {
      email,
      redirectTo,
      redirectSource: source,
      error: inviteError,
    });
    return NextResponse.json(
      { error: "Failed to resend invite: " + inviteError.message },
      { status: 500 }
    );
  }

  console.info("[RESEND-INVITE] Invite re-sent", {
    email,
    redirectTo,
    redirectSource: source,
    newAuthUserId: inviteData?.user?.id ?? null,
  });

  return NextResponse.json({
    ok: true,
    message: "Invite email resent successfully",
    newUserId: inviteData?.user?.id ?? null,
  });
}
