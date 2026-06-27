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

  let { data, error } = await admin
    .from("weekly_report_shares")
    .select("id, token, is_active, expires_at, access_count, weekly_report_id")
    .eq("token", t)
    .eq("is_active", true)
    .maybeSingle();

  let isMonthly = false;
  if (!data) {
    const { data: monData, error: monErr } = await admin
      .from("monthly_report_shares")
      .select("id, token, is_active, expires_at, access_count, monthly_report_id")
      .eq("token", t)
      .eq("is_active", true)
      .maybeSingle();

    if (monData) {
      data = monData as any;
      isMonthly = true;
    }
  }

  if (error || !data) {
    // Hide existence details for invalid tokens.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    // Expired share link.
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  let html = "";
  if (isMonthly) {
    const { data: report, error: reportErr } = await admin
      .from("monthly_reports")
      .select("html")
      .eq("id", (data as any).monthly_report_id)
      .maybeSingle();
    if (reportErr || !report) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    html = report.html ?? "";
  } else {
    const { data: report, error: reportErr } = await admin
      .from("weekly_reports")
      .select("html")
      .eq("id", data.weekly_report_id)
      .maybeSingle();
    if (reportErr || !report) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    html = report.html ?? "";
  }

  if (!html || html.trim().length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort audit.
  if (isMonthly) {
    void admin
      .from("monthly_report_shares")
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (data.access_count ?? 0) + 1,
      })
      .eq("id", data.id);
  } else {
    void admin
      .from("weekly_report_shares")
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (data.access_count ?? 0) + 1,
      })
      .eq("id", data.id);
  }

  const res = new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Ensure regenerated reports are always fetched fresh (no CDN/browser caching).
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });

  return res;
}

