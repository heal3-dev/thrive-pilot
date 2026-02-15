
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function inspectMetrics() {
  console.log("Checking garmin_metrics table...");

  const { count, error: countError } = await supabase
    .from("garmin_metrics")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("Error counting metrics:", countError);
    return;
  }

  console.log(`Total rows in garmin_metrics: ${count}`);

  if (count === 0) {
    console.log("No metrics found. Checking connection status...");
    const { data: tokens } = await supabase.from("garmin_tokens").select("id, participant_id");
    console.log(`Found ${tokens?.length} connected participants.`);
    console.table(tokens);
    return;
  }

  const { data: metrics, error: fetchError } = await supabase
    .from("garmin_metrics")
    .select("id, participant_id, calendar_date, steps, resting_heart_rate, stress_avg")
    .order("calendar_date", { ascending: false })
    .limit(5);

  if (fetchError) {
    console.error("Error fetching metrics:", fetchError);
    return;
  }

  console.log("Latest 5 metrics:");
  console.table(metrics);
}

inspectMetrics().catch(console.error);
