#!/usr/bin/env node
// Materialize local compatibility stub packages into node_modules.
//
// `file:` npm overrides resolve relative to the package being overridden, not
// the project root. That makes their lockfile links invalid for clean installs.
// The project instead records intended stubs in `compatibilityStubs`, then this
// script copies them as real files after npm has completed dependency resolution.
//
// This script is idempotent: it removes whatever is at node_modules/<name>
// (a package directory or symlink) before copying the local stub. It runs
// during postinstall and at the beginning of the build so both build-time and
// runtime dependency trees contain the intended compatibility package.

import { existsSync, rmSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const compatibilityStubs = pkg.compatibilityStubs || {};

const stubs = Object.entries(compatibilityStubs)
  .filter(([, dir]) => typeof dir === "string" && dir.startsWith("stubs/"))
  .map(([name, dir]) => ({ name, dir }));

if (stubs.length === 0) {
  console.log("[install-stubs] no compatibility stubs configured — nothing to do");
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
