/**
 * Force-update all templates (weekly & monthly HTML templates and rules) in the DB.
 * Run from project root: npx tsx scripts/seed-all-templates.mts
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_MASTER_RULES,
  DEFAULT_REVISE_WRAPPER,
  DEFAULT_GENERATE_WRAPPER,
  DEFAULT_OLGA_HTML_BASE_TEMPLATE,
  DEFAULT_MONTHLY_MASTER_RULES,
  DEFAULT_MONTHLY_REVISE_WRAPPER,
  DEFAULT_MONTHLY_GENERATE_WRAPPER,
  DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE,
} from "../src/lib/weekly-reports/template-defaults";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const supabaseUrl = env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const serviceKey = env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
if (!supabaseUrl || !serviceKey) {
  console.error("Missing env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const toSeed = [
  // Weekly templates
  { key: "master_rules", content: DEFAULT_MASTER_RULES, label: "Weekly Master Rules" },
  { key: "revise_wrapper", content: JSON.stringify(DEFAULT_REVISE_WRAPPER), label: "Weekly Revise Wrapper" },
  { key: "generate_wrapper", content: JSON.stringify(DEFAULT_GENERATE_WRAPPER), label: "Weekly Generate Wrapper" },
  { key: "html_base_template", content: DEFAULT_OLGA_HTML_BASE_TEMPLATE, label: "Weekly HTML Template" },
  // Monthly templates
  { key: "monthly_master_rules", content: DEFAULT_MONTHLY_MASTER_RULES, label: "Monthly Master Rules" },
  { key: "monthly_revise_wrapper", content: JSON.stringify(DEFAULT_MONTHLY_REVISE_WRAPPER), label: "Monthly Revise Wrapper" },
  { key: "monthly_generate_wrapper", content: JSON.stringify(DEFAULT_MONTHLY_GENERATE_WRAPPER), label: "Monthly Generate Wrapper" },
  { key: "monthly_html_base_template", content: DEFAULT_MONTHLY_OLGA_HTML_BASE_TEMPLATE, label: "Monthly HTML Template" },
];

for (const { key, content, label } of toSeed) {
  const { data: current, error: curErr } = await supabase
    .from("weekly_report_templates")
    .select("id, version")
    .eq("key", key)
    .eq("is_active", true)
    .maybeSingle();

  if (curErr) {
    console.error(`[${label}] fetch error:`, curErr.message);
    continue;
  }

  const nextVersion = (current?.version ?? 0) + 1;

  if (current?.id) {
    const { error: deactivateErr } = await supabase
      .from("weekly_report_templates")
      .update({ is_active: false })
      .eq("id", current.id);
    if (deactivateErr) {
      console.error(`[${label}] deactivate error:`, deactivateErr.message);
      continue;
    }
  }

  const { error: insErr } = await supabase.from("weekly_report_templates").insert({
    key,
    content,
    version: nextVersion,
    is_active: true,
  });

  if (insErr) {
    console.error(`[${label}] insert error:`, insErr.message);
    continue;
  }

  console.log(`[${label}] ✓ v${nextVersion}${current?.id ? " (replaced)" : " (fresh)"}`);
}

console.log("Done seeding all templates.");
