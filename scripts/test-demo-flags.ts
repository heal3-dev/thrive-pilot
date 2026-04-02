import { getDemoWeeklyFlag, DEMO_PARTICIPANTS } from '../src/lib/demo-data';

console.log("Demo Weekly Flags:");
for (const p of DEMO_PARTICIPANTS) {
  console.log(`\nParticipant: ${p.name}`);
  const wf = getDemoWeeklyFlag(p.id) ?? p.weekly_flag;
  if (!wf) {
    console.log("- (no weekly flag)");
    continue;
  }
  console.log(`- Final: ${wf.finalColor.toUpperCase()} (score ${wf.weeklyScore}/24, base ${wf.baseColor.toUpperCase()}, override ${wf.overrideApplied})`);
  for (const key of ["body_battery","stress","rhr","sleep_duration","sleep_score","waso","hrv","hrv_stability"] as const) {
    const m = wf.metrics[key];
    console.log(`  - ${key}: ${m.color} (${m.points} pts)`);
  }
}
