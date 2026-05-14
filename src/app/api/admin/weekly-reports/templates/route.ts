import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";

const getSchema = z.object({
  keys: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
});

const upsertSchema = z.object({
  key: z.string().min(1).max(64),
  content: z.string().min(1).max(200_000),
});

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const keysParam = url.searchParams.get("keys");
  const keys = keysParam ? keysParam.split(",").map((k) => k.trim()).filter(Boolean) : undefined;

  const parsed = getSchema.safeParse({ keys });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const supabase = guard.admin;

  let query = supabase
    .from("weekly_report_templates")
    .select("id, key, content, version, is_active, updated_by, created_at, updated_at")
    .eq("is_active", true);

  if (parsed.data.keys?.length) {
    query = query.in("key", parsed.data.keys);
  }

  const { data, error } = await query.order("key", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function PUT(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let payload: z.infer<typeof upsertSchema>;
  try {
    payload = upsertSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = guard.admin;

  // Load current active version (if any)
  const { data: current, error: curErr } = await supabase
    .from("weekly_report_templates")
    .select("id, version")
    .eq("key", payload.key)
    .eq("is_active", true)
    .maybeSingle();

  if (curErr) {
    return NextResponse.json({ error: "Failed to load current template" }, { status: 500 });
  }

  const nextVersion = (current?.version ?? 0) + 1;

  // Deactivate previous active row (if exists) and insert new one.
  if (current?.id) {
    const { error: updErr } = await supabase
      .from("weekly_report_templates")
      .update({ is_active: false })
      .eq("id", current.id);
    if (updErr) {
      return NextResponse.json({ error: "Failed to update current template" }, { status: 500 });
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from("weekly_report_templates")
    .insert({
      key: payload.key,
      content: payload.content,
      version: nextVersion,
      is_active: true,
    })
    .select("id, key, content, version, is_active, updated_by, created_at, updated_at")
    .single();

  if (insErr) {
    return NextResponse.json({ error: "Failed to save template" }, { status: 500 });
  }

  return NextResponse.json({ template: inserted });
}

