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
}
