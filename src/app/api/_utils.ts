import { NextResponse } from "next/server";

import { createSupabaseClientWithAuth, getSupabaseAdmin } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export type MentorGuardResult =
  | {
      ok: true;
      mentor: {
        id: string;
        role: string | null;
        name: string | null;
        email: string | null;
        is_active: boolean | null;
      };
      user: User;
      admin: ReturnType<typeof getSupabaseAdmin>;
    }
  | { ok: false; response: NextResponse };

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  return token && token.trim().length > 0 ? token : null;
}

export async function requireMentor(request: Request): Promise<MentorGuardResult> {
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

  // Check if user has a mentor record
  const { data: mentor, error: mentorError } = await authed
    .from("mentors")
    .select("id, role, name, email, is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (mentorError || !mentor?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Mentor record not found or access denied" },
        { status: 404 }
      ),
    };
  }

  if (mentor.is_active === false) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Mentor account is inactive" },
        { status: 403 }
      ),
    };
  }

  return { 
    ok: true, 
    mentor, 
    user: userData.user,
    admin: getSupabaseAdmin() 
  };
}
