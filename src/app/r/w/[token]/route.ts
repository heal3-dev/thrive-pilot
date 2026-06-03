import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const t = (token ?? "").trim();
  if (!t) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("weekly_report_shares")
    .select(
      "id, token, is_active, expires_at, access_count, weekly_report_id, weekly_reports:weekly_report_id ( html )"
    )
    .eq("token", t)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    // Hide existence details for invalid tokens.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    // Expired share link.
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  const html = (data.weekly_reports as unknown as { html?: string } | null)?.html ?? "";
  if (!html || html.trim().length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort audit.
  void admin
    .from("weekly_report_shares")
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: (data.access_count ?? 0) + 1,
    })
    .eq("id", data.id);

  const res = new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });

  return res;
}

