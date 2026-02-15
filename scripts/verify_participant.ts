
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing env vars.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const participantId = "1f5eba59-ddd5-4732-9987-9317c646b0ab";

async function verifyParticipant() {
  console.log(`Verifying participant ${participantId}...`);
  
  const { data, error } = await supabase
    .from("participants")
    .select("id, name, email")
    .eq("id", participantId)
    .single();

  if (error) {
    console.error("Verify error:", error);
  } else {
    console.log("Found participant:", data);
  }
}

verifyParticipant();
