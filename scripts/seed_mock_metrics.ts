
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

async function seed() {
  console.log(`Seeding mock metrics for ${participantId}...`);
  
  const metrics = [];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    metrics.push({
      participant_id: participantId,
      metric_date: dateStr,
      steps: Math.floor(Math.random() * 10000) + 2000,
      resting_heart_rate: Math.floor(Math.random() * 20) + 50,
      average_stress_level: Math.floor(Math.random() * 50) + 10,
      sleep_duration_seconds: Math.floor(Math.random() * 28800) + 18000, // 5-8 hours
    });
  }

  const { error } = await supabase.from("garmin_metrics").upsert(metrics, {
    onConflict: "participant_id,metric_date"
  });

  if (error) {
    console.error("Seed error:", error);
  } else {
    console.log("Seeded 14 days of metrics.");
  }
}

seed();
