#!/usr/bin/env node
// Materialize local "compatibility stub" packages into node_modules.
//
// package.json `overrides` redirect a few transitive dependencies to local
// stubs via `file:stubs/<name>`. npm records these file: overrides in
// package-lock.json as a symlink whose target is resolved RELATIVE TO THE
// DEPENDENT package (e.g. node_modules/@aws-sdk/core/stubs/fast-xml-parser),
// which does not exist. On a clean `npm ci` (as the deployment runs) this
// produces a DANGLING symlink at node_modules/<name>, so `require('<name>')`
// throws MODULE_NOT_FOUND at runtime and the server crash-loops.
//
// This script is idempotent: for every `file:stubs/*` override it removes
// whatever is at node_modules/<name> (dangling symlink, symlink, or dir) and
// copies the real stub files in. Run automatically via `postinstall` and at
// the start of the `build` step so the deployed runtime image always has the
// stub present as real files regardless of npm's symlink behavior.

import { existsSync, rmSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const overrides = pkg.overrides || {};

const stubs = Object.entries(overrides)
  .filter(([, spec]) => typeof spec === "string" && spec.startsWith("file:stubs/"))
  .map(([name, spec]) => ({ name, dir: spec.slice("file:".length) }));

if (stubs.length === 0) {
  console.log("[install-stubs] no file:stubs/* overrides found — nothing to do");
  process.exit(0);
}

const nodeModules = path.join(root, "node_modules");
mkdirSync(nodeModules, { recursive: true });

for (const { name, dir } of stubs) {
  const src = path.join(root, dir);
  if (!existsSync(src)) {
    console.error(`[install-stubs] ERROR: stub source missing: ${dir}`);
    process.exit(1);
  }
  // Support scoped names (e.g. @scope/pkg) by ensuring the parent dir exists.
  const dest = path.join(nodeModules, ...name.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, dereference: true });
  console.log(`[install-stubs] materialized ${name} <- ${dir}`);
}

console.log(`[install-stubs] done (${stubs.length} stub${stubs.length === 1 ? "" : "s"})`);
