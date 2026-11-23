#!/usr/bin/env node
// The app never uses the browser's own alert / confirm / prompt boxes: ask with confirmDialog()
// (client/src/components/ui/confirm-dialog.tsx), report with a toast.
// Usage: node scripts/check-no-browser-popups.mjs   (exit 1 on findings)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CALL = /(?:^|[^.\w$])(?:(?:window|globalThis|self)\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/;
const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
    if (!/\.(ts|tsx|js|jsx|html)$/.test(e.name) || /\.min\.js$/.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (!/^\s*(\/\/|\*|\/\*)/.test(line) && CALL.test(line)) found.push(`${path.relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
})(path.join(ROOT, 'client'));
if (found.length) {
  console.error(`${found.length} browser popup(s) — use confirmDialog() or a toast:\n  ${found.join('\n  ')}`);
  process.exit(1);
}
console.log('OK: no browser alert / confirm / prompt boxes in client/.');
