/**
 * Unit tests: PerKeyQueue (one task at a time per key, bounded wait) and CommentReplyLimiter.
 *   npx tsx server/services/__tests__/metaSpamLimits.test.ts
 */
import { PerKeyQueue } from "../../lib/perKeyQueue";
import { CommentReplyLimiter } from "../commentReplyLimiter";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── PerKeyQueue ──
  const q = new PerKeyQueue({ maxWaitMs: 5_000, name: "test" });
  const log: string[] = [];
  const task = (name: string, ms: number) => async () => { log.push(`${name}:start`); await sleep(ms); log.push(`${name}:end`); return name; };
  const results = await Promise.all([q.run("a", task("a1", 80)), q.run("a", task("a2", 10)), q.run("b", task("b1", 20))]);
  expect(results.join() === "a1,a2,b1", "queue returns each task's result", results);
  expect(log.indexOf("a1:end") < log.indexOf("a2:start"), "same key runs one at a time, in order", log);
  expect(log.indexOf("b1:start") < log.indexOf("a1:end"), "different keys run in parallel", log);
  expect(q.size === 0, "queue forgets idle keys", q.size);

  const failing = q.run("c", async () => { throw new Error("boom"); });
  const after = q.run("c", async () => "next");
  expect(await failing.then(() => "ok", (e) => e.message) === "boom", "a failing task rejects to its own caller");
  expect(await after === "next", "a failing task does not block the next one");

  const short = new PerKeyQueue({ maxWaitMs: 50, name: "test" });
  let stuckDone = false;
  short.run("s", () => sleep(400).then(() => { stuckDone = true; }));
  const t0 = Date.now();
  await short.run("s", async () => "ran");
  expect(Date.now() - t0 < 300 && !stuckDone, "a stuck task holds the next one only up to maxWaitMs", Date.now() - t0);

  // ── CommentReplyLimiter ──
  const lim = new CommentReplyLimiter({ perCommenterPerHour: 3, perPostPerHour: 5 });
  const now = Date.now();
  const r1 = [1, 2, 3, 4].map((i) => lim.check("instagram", "biz", "u1", "post1", now + i).allowed);
  expect(r1.join() === "true,true,true,false", "per-commenter hourly cap", r1);
  const r2 = ["u2", "u3", "u4"].map((u, i) => lim.check("instagram", "biz", u, "post1", now + 10 + i));
  expect(r2[0].allowed && r2[1].allowed && !r2[2].allowed && (r2[2] as any).reason === "post", "per-post hourly cap counts every commenter", r2);
  expect(lim.check("instagram", "biz", "u5", "post2", now + 20).allowed, "another post has its own budget");
  expect(lim.check("facebook", "biz", "u1", "post1", now + 20).allowed, "platforms are counted separately");
  expect(lim.check("instagram", "biz", "u1", "post3", now + 60 * 60_000 + 10).allowed, "cap resets after an hour");
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
  console.log("\nAll meta spam-limit unit tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
