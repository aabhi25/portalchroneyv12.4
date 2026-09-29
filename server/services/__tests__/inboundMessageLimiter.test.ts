/**
 * Tests for the WhatsApp inbound message limiter (spam and bot-loop protection).
 * Run manually: `npx tsx server/services/__tests__/inboundMessageLimiter.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { InboundMessageLimiter, unsupportedMessageNotice } from "../inboundMessageLimiter";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const t0 = 1_700_000_000_000;
{
  const l = new InboundMessageLimiter();
  let allAllowed = true;
  for (let i = 0; i < 10; i++) if (!l.check('a', `answer number ${i}`, t0 + i * 5000).allowed) allAllowed = false;
  expect(allAllowed, "a normal customer (10 messages in a minute) is never limited");
  let okAllowed = true;
  for (let i = 0; i < 8; i++) if (!l.check('b', 'ok', t0 + i * 60_000).allowed) okAllowed = false;
  expect(okAllowed, "short repeated replies ('ok') don't count as a loop");
}
{
  const l = new InboundMessageLimiter();
  const decisions = Array.from({ length: 14 }, (_, i) => l.check('s', `spam ${i}`, t0 + i * 1000));
  const firstBlocked = decisions.findIndex(d => !d.allowed);
  expect(firstBlocked === 12, "13th message within a minute is blocked", firstBlocked);
  const d = decisions[12] as any;
  expect(d.reason === 'rate' && d.notify === true, "rate block → one notice", d);
  const next = decisions[13] as any;
  expect(!next.allowed && next.notify === false, "further messages blocked silently", next);
  expect(!l.check('s', 'hello', t0 + 10 * 60_000).allowed, "still paused 10 minutes later");
  expect(l.check('s', 'hello again', t0 + 16 * 60_000).allowed, "allowed again after the 15-minute pause");
}
{
  const l = new InboundMessageLimiter();
  const botText = "Thank you for contacting us! Our team will get back to you shortly.";
  const ds = Array.from({ length: 6 }, (_, i) => l.check('bot', botText, t0 + i * 20_000));
  expect(ds.slice(0, 4).every(d => d.allowed), "first 4 identical auto-replies allowed");
  const loop = ds[4] as any;
  expect(!loop.allowed && loop.reason === 'loop' && loop.notify === false, "5th identical message → loop pause, no notice (would feed the loop)", loop);
  expect(!l.check('bot', 'something else entirely', t0 + 25 * 60_000).allowed, "loop pause lasts 30 minutes");
  expect(l.check('bot', 'something else entirely', t0 + 32 * 60_000).allowed, "released after 30 minutes");
}
{
  const l = new InboundMessageLimiter();
  let blocked = false;
  for (let i = 0; i < 121; i++) if (!l.check('h', `message ${i}`, t0 + i * 25_000).allowed) blocked = true;
  expect(blocked, "more than 120 messages in an hour is blocked");
  expect(l.check('other', 'hi there', t0).allowed, "limits are per customer");
}

// Replies for message types the agent can't read.
expect(/voice messages/.test(unsupportedMessageNotice('audio', false) || ''), "voice note → explains, asks to type");
expect(/answer to continue/.test(unsupportedMessageNotice('audio', true) || ''), "voice note mid-form → asks for the typed answer");
expect(/location/.test(unsupportedMessageNotice('location', false) || ''), "location → explains");
expect(unsupportedMessageNotice('reaction', true) === null, "emoji reaction → no reply");
expect(/text messages, photos and PDF/.test(unsupportedMessageNotice('something_new', false) || ''), "unknown type → generic explanation");

if (failed > 0) { console.error(`\n${failed} limiter test(s) failed.`); process.exit(1); }
console.log("\nAll inbound limiter tests passed.");
