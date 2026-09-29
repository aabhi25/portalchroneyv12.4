#!/usr/bin/env node
// Static check for AI cost tracking (see server/lib/openaiClient.ts).
//
// 1. Every OpenAI SDK client under server/ must come from createOpenAI(), which
//    records token usage into ai_usage_events automatically. A direct
//    `new OpenAI(` bypasses that and is flagged unless allow-listed below.
// 2. A file that logs usage itself (aiUsageLogger.log*) must opt those calls
//    out of automatic tracking (`trackUsage: false` on the client, or
//    `withoutUsageTracking(() => ...)` around the call); otherwise the same
//    call would be counted twice. Flagged when a file has explicit logging and
//    createOpenAI() but neither opt-out.
//
// Usage: node scripts/check-openai-usage.mjs   (exit 1 on findings)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Direct constructions that are fine without tracking.
const DIRECT_OK = new Map([
  ['server/lib/openaiClient.ts', 'the factory itself'],
  ['server/services/imageGenerationProviders.ts', 'images API only (no token usage to record)'],
]);
// Files with explicit aiUsageLogger calls that do not overlap SDK calls.
const SELF_LOG_OK = new Map([
  ['server/services/aiUsageLogger.ts', 'the logger'],
  ['server/index.ts', 'pricing init only'],
  ['server/lib/openaiClient.ts', 'the automatic tracker'],
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const CTOR_RE = /new\s+(OpenAI\w*|AzureOpenAI)\s*\(/g;
const NOT_SDK = new Set(['OpenAIImageProvider']);
const problems = [];
let factoryCalls = 0;
let optedOutClients = 0;
let optedOutCalls = 0;
const selfLogging = [];

for (const file of walk(path.join(ROOT, 'server'))) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  factoryCalls += (src.match(/\bcreateOpenAI\s*\(/g) || []).length;
  const clientOptOuts = (src.match(/trackUsage:\s*false\s*[,}]/g) || []).length;
  const callOptOuts = (src.match(/\bwithoutUsageTracking\s*\(/g) || []).length;
  optedOutClients += clientOptOuts;
  optedOutCalls += callOptOuts;

  CTOR_RE.lastIndex = 0;
  let m;
  while ((m = CTOR_RE.exec(src))) {
    if (NOT_SDK.has(m[1]) || DIRECT_OK.has(rel)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(`${rel}:${line}  direct \`new ${m[1]}(\` bypasses usage tracking — use createOpenAI()`);
  }

  const explicitLogs = (src.match(/aiUsageLogger\.log\w*\(/g) || []).length;
  if (explicitLogs && !SELF_LOG_OK.has(rel)) {
    selfLogging.push(`${rel} (${explicitLogs} explicit log call(s), ${clientOptOuts} client opt-out(s), ${callOptOuts} call opt-out(s))`);
    const usesSdk = /\bcreateOpenAI\s*\(/.test(src);
    if (usesSdk && clientOptOuts === 0 && callOptOuts === 0) {
      problems.push(`${rel}  logs usage via aiUsageLogger but never opts out of automatic tracking — calls may be counted twice`);
    }
  }
}

if (problems.length) {
  console.error(`Found ${problems.length} AI usage tracking problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`OK: ${factoryCalls} createOpenAI() call(s) are tracked automatically; no direct SDK clients outside the allow-list (${[...DIRECT_OK.keys()].join(', ')}).`);
console.log(`Self-logging files (opted out: ${optedOutClients} client(s), ${optedOutCalls} call(s)):`);
for (const s of selfLogging) console.log('  ' + s);
