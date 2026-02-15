
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const participantId = "1f5eba59-ddd5-4732-9987-9317c646b0ab";
const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(today.getDate() - 30);

const startDate = thirtyDaysAgo.toISOString().split("T")[0];
const endDate = today.toISOString().split("T")[0];

console.log(`Starting backfill for ${participantId} from ${startDate} to ${endDate}...`);

(async () => {
  try {
    const { runBackfill } = await import("../src/lib/garmin/pull-client");
    const res = await runBackfill({
      participantId,
      startDate,
      endDate
    });
    console.log("Backfill result:", res);
  } catch (err) {
    console.error("Backfill error:", err);
  }
})();
