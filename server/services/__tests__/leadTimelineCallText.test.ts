/**
 * How an AI call reads on the lead timeline (leadTimelineService.describeCall): an answered call
 * shows its outcome and a readable callback time; a call still waiting for its time (the callback
 * the person asked for, the next try) never says "Not answered".
 * Run: npx tsx server/services/__tests__/leadTimelineCallText.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"; // never queried here

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const { describeCall, readableCallTime } = await import("../leadTimelineService");
  const tz = "Asia/Kolkata";
  const now = new Date("2026-11-23T09:00:00Z");
  const base = { direction: "outbound", status: "completed", trigger: "auto_lead", outcome: null, answeredAt: null, summary: null, callbackAt: null, scheduledAt: null } as const;

  // The Symbiosis case: answered, asked for a call tomorrow, the callback queued for then.
  const answered = describeCall({ ...base, answeredAt: new Date("2026-11-23T08:38:35Z"), outcome: "callback_requested", summary: "Interested in the online MBA; call tomorrow.", callbackAt: new Date("2026-11-24T08:40:00Z") }, tz, now);
  expect(answered.title === "AI call · Call back later", "an answered call shows its outcome", answered);
  expect(/Asked to be called back on 24 Nov, 2:10 PM\.$/.test(answered.detail || "") && !/2026-11-24T|Z\b/.test(answered.detail || ""), "the callback time is a readable local time, not a raw timestamp", answered.detail);

  const callback = describeCall({ ...base, status: "queued", trigger: "callback", scheduledAt: new Date("2026-11-24T08:40:00Z") }, tz, now);
  expect(callback.title === "AI call · Call back planned", "a queued callback is titled as planned", callback);
  expect(callback.detail === "They asked to be called back. The AI will call on 24 Nov, 2:10 PM.", "…and says when the AI will call", callback.detail);
  expect(!/Not answered/.test(`${callback.title} ${callback.detail}`), "a call that hasn't happened yet never says Not answered");

  const retry = describeCall({ ...base, status: "queued", trigger: "retry", scheduledAt: new Date("2026-11-23T11:00:00Z") }, tz, now);
  expect(retry.title === "AI call · Trying again" && retry.detail === "The last call wasn't answered. The AI will try again on 23 Nov, 4:30 PM.", "a queued retry says when it will try again", retry);

  const fresh = describeCall({ ...base, status: "queued", trigger: "auto_lead", scheduledAt: new Date("2026-11-23T09:02:00Z") }, tz, now);
  expect(fresh.title === "AI call · Waiting to call" && fresh.detail === "The AI will call on 23 Nov, 2:32 PM.", "a new lead's queued call says when it will be placed", fresh);

  const ringing = describeCall({ ...base, status: "ringing" }, tz, now);
  const onCall = describeCall({ ...base, status: "in_progress", answeredAt: new Date("2026-11-23T08:59:00Z") }, tz, now);
  expect(ringing.title === "AI call · Ringing" && ringing.detail === null && onCall.title === "AI call · On the call" && onCall.detail === null, "ringing / on the call: no Not answered", { ringing, onCall });

  // Calls that really didn't connect still say so.
  const busy = describeCall({ ...base, status: "busy", outcome: "no_answer" }, tz, now);
  const noAnswer = describeCall({ ...base, status: "no_answer" }, tz, now);
  expect(busy.title === "AI call · Busy · No answer" && busy.detail === "Not answered.", "a busy call still says Not answered", busy);
  expect(noAnswer.title === "AI call · No answer" && noAnswer.detail === "Not answered.", "an unanswered call still says Not answered", noAnswer);

  // What the panel shows: the result as a tag, talk time, waiting calls under "Coming up", missed calls as one quiet line.
  expect(answered.label === "AI call" && answered.tag?.label === "Call back later" && answered.tag.tone === "wait" && !answered.upcoming && !answered.quiet, "answered call: 'AI call' with a 'Call back later' tag", answered);
  const timed = describeCall({ ...base, answeredAt: new Date(), outcome: "interested", durationSec: 108 }, tz, now);
  expect(timed.tag?.tone === "good" && timed.meta === "1m 48s" && describeCall({ ...base, answeredAt: new Date(), durationSec: 31 }, tz, now).meta === "31s", "talk time shows next to the time", timed);
  expect(callback.upcoming && callback.label === "AI calls back" && callback.meta === "They asked to be called back" && callback.tag?.tone === "wait", "a waiting callback goes under Coming up with why", callback);
  expect(retry.upcoming && retry.label === "AI tries again" && fresh.upcoming && fresh.label === "AI calls", "retries and new calls are coming up too", { retry, fresh });
  expect(!ringing.upcoming && ringing.tag?.label === "Ringing" && ringing.tag.tone === "wait", "a ringing call is a row with a Ringing tag", ringing);
  expect(busy.quiet && busy.tag?.label === "Busy" && busy.tag.tone === "muted" && noAnswer.quiet && noAnswer.tag?.label === "No answer", "missed calls are one quiet line tagged Busy / No answer", { busy, noAnswer });

  const inbound = describeCall({ ...base, direction: "inbound", trigger: "inbound", answeredAt: new Date(), outcome: "interested", summary: "Asked about fees." }, tz, now);
  expect(inbound.title === "Called you · Interested" && inbound.detail === "Asked about fees.", "an incoming call is unchanged", inbound);

  expect(readableCallTime("2027-01-05T04:30:00Z", tz, now) === "5 Jan 2027, 10:00 AM", "another year shows the year", readableCallTime("2027-01-05T04:30:00Z", tz, now));
  expect(readableCallTime("2026-11-24T08:40:00Z", "Not/AZone", now) === "24 Nov, 2:10 PM", "an unknown time zone falls back to India time");
  expect(readableCallTime("2026-11-24T08:40:00Z", "Asia/Dubai", now) === "24 Nov, 12:40 PM", "the business's own time zone is used");

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll lead timeline call text checks passed");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
