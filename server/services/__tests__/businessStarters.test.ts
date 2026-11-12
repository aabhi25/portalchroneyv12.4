/**
 * Tests for the business starter packs (shared/businessStarters.ts) and the lead
 * details they set (starterLeadConfig).
 * Run manually: `npx tsx server/services/__tests__/businessStarters.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { BUSINESS_STARTERS, BUSINESS_STARTER_KEYS, describeBusinessStarter, describeDays, describeHours, getBusinessStarter, starterLeadConfig } from "@shared/businessStarters";
import { leadTrainingConfigSchema } from "@shared/leadTrainingConfig";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

const PERSONALITIES = ["friendly", "professional", "funny", "polite", "casual"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

expect(BUSINESS_STARTERS.map(s => s.key).join() === BUSINESS_STARTER_KEYS.join(), "one pack per key, in order");
expect(getBusinessStarter("clinic")?.label === "Clinic / Doctor" && getBusinessStarter("nope") === undefined, "lookup by key");

for (const s of BUSINESS_STARTERS) {
  expect(s.instructions.filter(i => i.type === "fallback").length <= 1, `${s.key}: at most one fallback (Training allows one)`);
  expect(s.instructions.every(i => i.text.trim().length > 0 && (i.type !== "conditional" || i.keywords.length > 0)), `${s.key}: instructions have text, trigger instructions have words`);
  expect(!s.personality || PERSONALITIES.includes(s.personality), `${s.key}: personality is one the widget knows`);
  if (s.hours) {
    const h = s.hours;
    expect(h.days.length > 0 && h.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6), `${s.key}: days 0–6`);
    expect(TIME.test(h.start) && TIME.test(h.end) && h.start < h.end, `${s.key}: hours ${h.start}–${h.end} valid`);
    expect(h.slotMinutes > 0 && h.slotMinutes <= 240, `${s.key}: slot length`);
    expect(!!s.switches.appointments, `${s.key}: hours only with Appointments on`);
  }
  if (s.bookingTriggers?.length) expect(!!s.switches.appointments, `${s.key}: booking suggestions only with Appointments on`);
  if (s.leadDetails) {
    const config = starterLeadConfig(s.leadDetails);
    const parsed = leadTrainingConfigSchema.safeParse(config);
    expect(parsed.success, `${s.key}: lead details pass the Training page's validation`);
    const asked = config.fields.filter(f => f.enabled).map(f => f.id);
    expect(asked.join() === s.leadDetails.ask.join(), `${s.key}: asks for ${s.leadDetails.ask.join(", ")} in that order`);
    expect(config.fields.map(f => f.priority).join() === "1,2,3,4", `${s.key}: priorities 1..4`);
  }
  expect(describeBusinessStarter(s).length > 0, `${s.key}: has a summary`);
}

expect(describeDays([1, 2, 3, 4, 5, 6]) === "Mon–Sat", "Mon–Sat");
expect(describeDays([0, 1, 2, 3, 4, 5, 6]) === "Every day", "every day");
expect(describeDays([1, 3, 5]) === "Mon, Wed, Fri", "non-consecutive days listed");
expect(describeHours({ days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slotMinutes: 30 }) === "Mon–Sat, 9am–6pm, 30-minute slots", "clinic hours wording");
expect(describeBusinessStarter(getBusinessStarter("clinic")!).some(l => l === "Switches on: Website chat, Appointments"), "clinic switches on chat + appointments");
expect(describeBusinessStarter(getBusinessStarter("blank")!)[0].startsWith("Website chat on"), "blank = today's defaults");

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nAll business starter checks passed");
