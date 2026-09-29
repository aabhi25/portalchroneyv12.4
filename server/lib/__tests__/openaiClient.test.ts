/**
 * Tests for the shared OpenAI client factory (bounded timeouts / retries).
 * Run manually: `npx tsx server/lib/__tests__/openaiClient.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import {
  createOpenAI,
  resolveOpenAIOptions,
  OPENAI_TIMEOUTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
  DEFAULT_OPENAI_MAX_RETRIES,
} from "../openaiClient";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

{
  const o = resolveOpenAIOptions({ apiKey: "sk-test" });
  expect(o.timeout === 60_000 && DEFAULT_OPENAI_TIMEOUT_MS === 60_000, "default timeout is 60s", o.timeout);
  expect(o.maxRetries === 1 && DEFAULT_OPENAI_MAX_RETRIES === 1, "default maxRetries is 1", o.maxRetries);
  expect(o.apiKey === "sk-test", "apiKey passed through");
}
{
  const o = resolveOpenAIOptions({ apiKey: "k", timeout: 5_000, maxRetries: 0 });
  expect(o.timeout === 5_000, "explicit timeout wins", o.timeout);
  expect(o.maxRetries === 0, "explicit maxRetries: 0 is kept (not replaced by default)", o.maxRetries);
}
{
  const o = resolveOpenAIOptions({ apiKey: "k", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
  expect(o.baseURL?.includes("generativelanguage"), "baseURL (Gemini) passed through");
  expect(o.timeout === 60_000, "Gemini-compatible client also gets the default timeout");
}
{
  const c = createOpenAI({ apiKey: "sk-test" });
  expect(c.timeout === 60_000, "client instance timeout is 60s", c.timeout);
  expect(c.maxRetries === 1, "client instance maxRetries is 1", c.maxRetries);
  const long = createOpenAI({ apiKey: "sk-test", timeout: OPENAI_TIMEOUTS.document });
  expect(long.timeout === 300_000, "document category = 300s", long.timeout);
  expect(long.maxRetries === 1, "override of timeout keeps default retries", long.maxRetries);
  expect(createOpenAI({ apiKey: "k", timeout: OPENAI_TIMEOUTS.chat }).timeout === 120_000, "chat category = 120s");
}
{
  const vals = Object.values(OPENAI_TIMEOUTS);
  expect(vals.every(v => v > 0 && v <= 300_000), "every category is bounded (<= 5 min)", vals);
}

if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
console.log("\nAll openaiClient tests passed");
