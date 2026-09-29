#!/usr/bin/env node
// Static check: every `new OpenAI(` under server/ must pass an explicit
// `timeout` option. The OpenAI SDK default is 10 minutes with 2 retries, which
// lets a hung upstream pin a request (and its DB connection) for ~30 minutes.
// Prefer `createOpenAI()` from server/lib/openaiClient.ts, which applies sane
// defaults. The factory itself is the only documented exception.
//
// Usage: node scripts/check-openai-timeouts.mjs [--all]
//   --all  also list the compliant constructions (with their args)
// Exit code 1 when a construction without a timeout is found.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS = new Set([
  // The factory: applies DEFAULT_OPENAI_TIMEOUT_MS unless the caller overrides.
  'server/lib/openaiClient.ts',
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

const showAll = process.argv.includes('--all');
const offenders = [];
let total = 0;
let factoryCalls = 0;
// `new OpenAI(`, plus aliases of the SDK class from dynamic imports such as
// `const OpenAIClient = (await import('openai')).default; new OpenAIClient(`.
const CTOR_RE = /new\s+(OpenAI\w*|AzureOpenAI)\s*\(/g;
// Our own classes whose names happen to start with "OpenAI" (not SDK clients).
const NOT_SDK = new Set(['OpenAIImageProvider']);
for (const file of walk(path.join(ROOT, 'server'))) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  factoryCalls += (src.match(/\bcreateOpenAI\s*\(/g) || []).length;
  CTOR_RE.lastIndex = 0;
  let m;
  while ((m = CTOR_RE.exec(src))) {
    if (NOT_SDK.has(m[1])) continue;
    const i = m.index;
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    const args = src.slice(i + m[0].length, j).replace(/\s+/g, ' ').trim();
    const line = src.slice(0, i).split('\n').length;
    total++;
    const ok = /\btimeout\b/.test(args) || EXCEPTIONS.has(rel);
    if (!ok) offenders.push(`${rel}:${line}  new ${m[1]}(${args.slice(0, 140)})`);
    else if (showAll) console.log(`ok  ${rel}:${line}  ${args.slice(0, 140)}`);
    CTOR_RE.lastIndex = j;
  }
}

if (offenders.length) {
  console.error(`Found ${offenders.length} of ${total} \`new OpenAI(\` construction(s) without an explicit timeout:`);
  for (const o of offenders) console.error('  ' + o);
  console.error('Use createOpenAI() from server/lib/openaiClient.ts or pass { timeout }.');
  process.exit(1);
}
console.log(`OK: all ${total} direct \`new OpenAI(\` constructions under server/ set a timeout (exceptions: ${[...EXCEPTIONS].join(', ')}); ${factoryCalls} createOpenAI() call(s) get factory defaults.`);
