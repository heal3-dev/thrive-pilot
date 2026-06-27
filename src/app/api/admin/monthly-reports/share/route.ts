import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";

import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const requestSchema = z.union([
  z.object({
    action: z.literal("mint").optional(),
    reportId: z.string().uuid(),
    revokeExisting: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("revoke"),
    reportId: z.string().uuid(),
    tokenId: z.string().uuid().optional(),
  }),
]);

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function expiresAtIso(days: number): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = guard.admin;

  if ("action" in payload && payload.action === "revoke") {
    let q = admin
      .from("monthly_report_shares")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("monthly_report_id", payload.reportId)
      .eq("is_active", true);
    if (payload.tokenId) q = q.eq("id", payload.tokenId);
    const { error } = await q;
    if (error) {
      return NextResponse.json({ error: `Failed to revoke link: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const reportId = payload.reportId;
  const revokeExisting = payload.revokeExisting ?? true;

  const { data: report, error: reportErr } = await admin
    .from("monthly_reports")
    .select("id")
    .eq("id", reportId)
    .maybeSingle();
  if (reportErr) {
    return NextResponse.json({ error: `Failed to load report: ${reportErr.message}` }, { status: 500 });
  }
  if (!report?.id) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const { data: existing, error: existingErr } = await admin
    .from("monthly_report_shares")
    .select("id, token, expires_at")
    .eq("monthly_report_id", reportId)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: `Failed to load share link: ${existingErr.message}` }, { status: 500 });
  }
  if (existing?.token) {
    return NextResponse.json({ tokenId: existing.id, token: existing.token, expiresAt: existing.expires_at });
  }

  if (revokeExisting) {
    await admin
      .from("monthly_report_shares")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("monthly_report_id", reportId)
      .eq("is_active", true);
  }

  const token = randomToken();
  const expiresAt = expiresAtIso(7);
  const { data: inserted, error: insertErr } = await admin
    .from("monthly_report_shares")
    .insert({
      monthly_report_id: reportId,
      token,
      is_active: true,
      expires_at: expiresAt,
    })
    .select("id, token, expires_at")
    .single();

  if (insertErr || !inserted?.id) {
    return NextResponse.json(
      { error: insertErr?.message || "Failed to mint share link" },
      { status: 500 }
    );
  }

  return NextResponse.json({ tokenId: inserted.id, token: inserted.token, expiresAt: inserted.expires_at });
}
