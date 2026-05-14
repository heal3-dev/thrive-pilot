import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/app/api/admin/_utils";
import {
  DEFAULT_GENERATE_WRAPPER,
  DEFAULT_MASTER_RULES,
  DEFAULT_OLGA_HTML_BASE_TEMPLATE,
  DEFAULT_REVISE_WRAPPER,
  type WeeklyReportTemplateKey,
} from "@/lib/weekly-reports/template-defaults";

const requestSchema = z.object({
  keys: z.array(z.enum(["master_rules", "html_base_template", "revise_wrapper", "generate_wrapper"])).min(1).max(4).optional(),
  force: z.boolean().optional(),
});

const DEFAULT_SEED_KEYS: WeeklyReportTemplateKey[] = ["master_rules", "html_base_template"];

function getDefaultContent(key: WeeklyReportTemplateKey): string {
  switch (key) {
    case "master_rules":
      return DEFAULT_MASTER_RULES;
    case "html_base_template":
      return DEFAULT_OLGA_HTML_BASE_TEMPLATE;
    case "revise_wrapper":
      return DEFAULT_REVISE_WRAPPER;
    case "generate_wrapper":
      return DEFAULT_GENERATE_WRAPPER;
    default:
      return "";
  }
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

  const keys = (payload.keys as WeeklyReportTemplateKey[] | undefined) ?? DEFAULT_SEED_KEYS;
  const force = payload.force ?? false;
  const supabase = guard.admin;

  const seeded: Array<{ key: string; action: "inserted" | "skipped" | "replaced" }> = [];

  for (const key of keys) {
    const { data: current, error: curErr } = await supabase
      .from("weekly_report_templates")
      .select("id, version")
      .eq("key", key)
      .eq("is_active", true)
      .maybeSingle();

    if (curErr) {
      return NextResponse.json({ error: `Failed to load current template for ${key}` }, { status: 500 });
    }

    if (current?.id && !force) {
      seeded.push({ key, action: "skipped" });
      continue;
    }

    const nextVersion = (current?.version ?? 0) + 1;

    if (current?.id) {
      const { error: updErr } = await supabase
        .from("weekly_report_templates")
        .update({ is_active: false })
        .eq("id", current.id);
      if (updErr) {
        return NextResponse.json({ error: `Failed to deactivate current template for ${key}` }, { status: 500 });
      }
    }

    const { error: insErr } = await supabase.from("weekly_report_templates").insert({
      key,
      content: getDefaultContent(key),
      version: nextVersion,
      is_active: true,
    });

    if (insErr) {
      return NextResponse.json({ error: `Failed to seed template for ${key}` }, { status: 500 });
    }

    seeded.push({ key, action: current?.id ? "replaced" : "inserted" });
  }

  return NextResponse.json({ seeded });
}

