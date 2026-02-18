/**
 * One-time script: Encrypt participant_id in participant_pseudonyms table.
 *
 * Prerequisites:
 *   1. Migration 20260218100000 has been applied (adds hash + encrypted columns)
 *   2. PSEUDONYM_ENCRYPTION_KEY is set in .env.local
 *
 * What it does:
 *   1. Reads all rows from participant_pseudonyms (with plaintext participant_id)
 *   2. Computes HMAC-SHA256 hash + AES-256-GCM encrypted value for each
 *   3. Updates each row with the hash + encrypted columns
 *   4. Drops the plaintext participant_id column
 *   5. Adds NOT NULL constraints on the new columns
 *
 * Usage:
 *   npx tsx scripts/encrypt-pseudonym-mapping.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encryptionKeyHex = process.env.PSEUDONYM_ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!encryptionKeyHex) {
  console.error("Missing PSEUDONYM_ENCRYPTION_KEY in .env.local");
  console.error("Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

const encryptionKey = Buffer.from(encryptionKeyHex, "hex");
if (encryptionKey.length !== 32) {
  console.error("PSEUDONYM_ENCRYPTION_KEY must be a 64-char hex string (256 bits)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function hashId(participantId: string): string {
  return crypto.createHmac("sha256", encryptionKey).update(participantId).digest("hex");
}

function encryptId(participantId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(participantId, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

async function main() {
  console.log("Fetching participant_pseudonyms rows...");

  const { data: rows, error: fetchError } = await supabase
    .from("participant_pseudonyms")
    .select("id, participant_id, participant_id_hash");

  if (fetchError) {
    console.error("Failed to fetch rows:", fetchError.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("No rows to process.");
    return;
  }

  // Only process rows that haven't been encrypted yet
  const toProcess = rows.filter((r: { participant_id_hash: string | null }) => !r.participant_id_hash);

  if (toProcess.length === 0) {
    console.log("All rows already encrypted. Proceeding to drop plaintext column...");
  } else {
    console.log(`Encrypting ${toProcess.length} row(s)...`);

    for (const row of toProcess) {
      const hash = hashId(row.participant_id);
      const encrypted = encryptId(row.participant_id);

      const { error: updateError } = await supabase
        .from("participant_pseudonyms")
        .update({
          participant_id_hash: hash,
          participant_id_encrypted: encrypted,
        })
        .eq("id", row.id);

      if (updateError) {
        console.error(`Failed to update row ${row.id}:`, updateError.message);
        process.exit(1);
      }

      console.log(`  Encrypted: ${row.participant_id} → hash=${hash.slice(0, 16)}...`);
    }

    console.log("All rows encrypted successfully.");
  }

  // Drop the plaintext column and add NOT NULL constraints
  console.log("Dropping plaintext participant_id column and adding constraints...");

  const { error: alterError } = await supabase.rpc("exec_sql", {
    query: `
      ALTER TABLE participant_pseudonyms DROP COLUMN IF EXISTS participant_id;
      ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_hash SET NOT NULL;
      ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_encrypted SET NOT NULL;
    `,
  });

  if (alterError) {
    // rpc('exec_sql') might not exist -- fall back to manual instruction
    console.warn("Could not auto-drop column (exec_sql RPC not available).");
    console.warn("Run this SQL manually in the Supabase SQL editor:");
    console.warn("");
    console.warn("  ALTER TABLE participant_pseudonyms DROP COLUMN IF EXISTS participant_id;");
    console.warn("  ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_hash SET NOT NULL;");
    console.warn("  ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_encrypted SET NOT NULL;");
    console.warn("");
  } else {
    console.log("Plaintext column dropped. Constraints added.");
  }

  console.log("Done! The participant_pseudonyms table is now encrypted.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
