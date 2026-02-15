
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing env vars for Seed script.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const participantId = "1f5eba59-ddd5-4732-9987-9317c646b0ab";

async function clearMockMetrics() {
  console.log(`Clearing metrics for ${participantId}...`);
  
  const { error } = await supabase
    .from("garmin_metrics")
    .delete()
    .eq("participant_id", participantId);

  if (error) {
    console.error("Clear error:", error);
  } else {
    console.log("Cleared metrics.");
  }
}

clearMockMetrics();
