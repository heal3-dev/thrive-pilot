import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "../../_utils";
import * as Sentry from "@sentry/nextjs";

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

  const admin = guard.admin;
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

  const { data: existingMentor, error: existingMentorError } = await admin
    .from("mentors")
    .select("id, user_id, email")
    .eq("id", id)
    .maybeSingle();

  if (existingMentorError) {
    return NextResponse.json({ error: existingMentorError.message }, { status: 500 });
  }

  if (!existingMentor?.id) {
    return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
  }

  const isNameChange = typeof payload.name === "string" && payload.name.trim().length > 0;
  const isRoleChange = typeof payload.role === "string" && payload.role.trim().length > 0;

  const requestedEmailRaw = Object.prototype.hasOwnProperty.call(payload, "email")
    ? payload.email
    : undefined;
  const requestedEmail =
    typeof requestedEmailRaw === "string" ? requestedEmailRaw.trim() : requestedEmailRaw;

  const existingEmailLower = (existingMentor.email ?? "").toLowerCase();
  const requestedEmailLower =
    typeof requestedEmail === "string" ? requestedEmail.toLowerCase() : null;

  const isEmailChange =
    typeof requestedEmail === "string" &&
    requestedEmail.length > 0 &&
    requestedEmailLower !== existingEmailLower;

  let authUpdated = false;
  let oldAuthEmail: string | null = null;

  // If email is changing, validate uniqueness across mentors/participants/auth and update Auth email too.
  if (isEmailChange && requestedEmailLower) {
    // Prevent duplicate email in mentors table
    const { data: dupMentor, error: dupMentorError } = await admin
      .from("mentors")
      .select("id")
      .eq("email", requestedEmail)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    if (dupMentorError) {
      return NextResponse.json({ error: dupMentorError.message }, { status: 500 });
    }
    if (dupMentor?.id) {
      return NextResponse.json({ error: "This email is already registered as a mentor" }, { status: 409 });
    }

    // Prevent duplicate email in participants table
    const { data: dupParticipant, error: dupParticipantError } = await admin
      .from("participants")
      .select("id")
      .eq("email", requestedEmail)
      .limit(1)
      .maybeSingle();

    if (dupParticipantError) {
      return NextResponse.json({ error: dupParticipantError.message }, { status: 500 });
    }
    if (dupParticipant?.id) {
      return NextResponse.json({ error: "This email is already registered as a participant" }, { status: 409 });
    }

    // Prevent duplicate email in Supabase Auth (excluding this mentor's auth user).
    const perPage = 1000;
    let page = 1;
    const matches: string[] = [];
    while (true) {
      const { data: listData, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }
      const users = listData?.users ?? [];
      for (const u of users) {
        if ((u.email ?? "").toLowerCase() === requestedEmailLower) {
          matches.push(u.id);
        }
      }
      if (users.length < perPage) break;
      page += 1;
      if (page > 20) break;
    }

    const authEmailTaken = matches.some((matchId) => matchId !== existingMentor.user_id);
    if (authEmailTaken) {
      return NextResponse.json({ error: "This email is already registered in the system" }, { status: 409 });
    }

    // Update Auth email first so the old one is released consistently.
    const { data: authData, error: authGetError } = await admin.auth.admin.getUserById(existingMentor.user_id);
    if (authGetError || !authData?.user) {
      return NextResponse.json({ error: "Failed to load auth user for mentor" }, { status: 500 });
    }
    oldAuthEmail = authData.user.email ?? null;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(existingMentor.user_id, {
      email: requestedEmail,
      email_confirm: true,
    });
    if (authUpdateError) {
      const msg = authUpdateError.message ?? "Failed to update auth user";
      const lower = msg.toLowerCase();
      if (lower.includes("already") || lower.includes("registered") || lower.includes("exists")) {
        return NextResponse.json({ error: "This email is already registered in the system" }, { status: 409 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    authUpdated = true;
  }

  const dbPayload = {
    ...payload,
    ...(isEmailChange && typeof requestedEmail === "string" ? { email: requestedEmail } : {}),
  };

  const { data, error } = await admin
    .from("mentors")
    .update(dbPayload)
    .eq("id", id)
    .select("id, user_id, name, email, role, is_active, created_at")
    .single();

  if (error) {
    // Compensate: if auth email was updated but DB update failed, attempt to revert auth email.
    if (authUpdated && oldAuthEmail) {
      const { error: revertError } = await admin.auth.admin.updateUserById(existingMentor.user_id, {
        email: oldAuthEmail,
        email_confirm: true,
      });
      if (revertError) {
        Sentry.captureMessage("Auth email updated but mentor update failed; revert failed", {
          level: "warning",
          extra: { mentor_id: id, revertError: revertError.message, oldAuthEmail },
        });
      }
    }
    return NextResponse.json({ error: "Failed to update mentor" }, { status: 500 });
  }

  // Best-effort: keep auth user_metadata in sync for convenience/debugging.
  // Permissions still come from `mentors.role` in the DB.
  if (isNameChange || isRoleChange) {
    const metaUpdate: Record<string, unknown> = {};
    if (isNameChange) metaUpdate.name = payload.name?.trim();
    if (isRoleChange) metaUpdate.role = payload.role?.trim();
    try {
      const { error: metaErr } = await admin.auth.admin.updateUserById(existingMentor.user_id, {
        user_metadata: metaUpdate,
      });
      if (metaErr) {
        Sentry.captureMessage("Failed to sync mentor auth metadata", {
          level: "warning",
          extra: { mentor_id: id, user_id: existingMentor.user_id, error: metaErr.message },
        });
      }
    } catch (e) {
      Sentry.captureException(e, {
        extra: { mentor_id: id, user_id: existingMentor.user_id, action: "sync_auth_metadata" },
      });
    }
  }

  return NextResponse.json({ mentor: data });
}

