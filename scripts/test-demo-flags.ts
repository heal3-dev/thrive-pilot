import { getDemoFlags, DEMO_PARTICIPANTS } from './src/lib/demo-data';

console.log("Demo Flags:");
for (const p of DEMO_PARTICIPANTS) {
  console.log(`\nParticipant: ${p.name}`);
  for (const flag of p.flags) {
    console.log(`- [${flag.severity}] ${flag.type}: ${flag.message}`);
  }
}
