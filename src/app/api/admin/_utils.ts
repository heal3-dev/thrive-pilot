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

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getInviteRedirect(request: Request): {
  redirectTo?: string;
  source: "env" | "origin" | "forwarded" | "none";
} {
  const siteUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (siteUrl) {
    return { redirectTo: `${siteUrl}/invite/consent`, source: "env" };
  }

  const origin = normalizeBaseUrl(request.headers.get("origin"));
  if (origin) {
    return { redirectTo: `${origin}/invite/consent`, source: "origin" };
  }

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim() || "https";
    const forwardedBase = normalizeBaseUrl(`${forwardedProto}://${forwardedHost}`);
    if (forwardedBase) {
      return { redirectTo: `${forwardedBase}/invite/consent`, source: "forwarded" };
    }
  }

  return { source: "none" };
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

