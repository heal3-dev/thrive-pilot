import { NextResponse } from "next/server";

import { createSupabaseClientWithAuth, getSupabaseAdmin } from "@/lib/supabase";

export type AdminGuardResult =
  | { ok: true; admin: ReturnType<typeof getSupabaseAdmin> }
  | { ok: false; response: NextResponse };

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  return token && token.trim().length > 0 ? token : null;
}

export async function requireAdmin(request: Request): Promise<AdminGuardResult> {
  const token = getBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing or invalid auth token" },
        { status: 401 }
      ),
    };
  }

  // Validate token and load user under RLS context
  const authed = createSupabaseClientWithAuth(token);
  const { data: userData, error: userError } = await authed.auth.getUser(token);
  if (userError || !userData?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid auth token" }, { status: 401 }),
    };
  }

  // Check mentor role is admin (RLS should allow user to read their own mentor record)
  const { data: mentor, error: mentorError } = await authed
    .from("mentors")
    .select("id, role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (mentorError || !mentor?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Mentor record not found" },
        { status: 404 }
      ),
    };
  }

  if (mentor.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { ok: true, admin: getSupabaseAdmin() };
}

