---
name: Environment quirks
description: Replit/workspace specifics for this repl that are easy to get wrong.
---

# Schema changes

Schema lives in `shared/schema.ts` and is applied with `npm run db:push`
(drizzle-kit push), not migration files. Never force a push that reports
unrelated destructive statements; apply only the required additive development
DDL and leave production to Replit Publish's managed schema diff.

**Why:** this project's Drizzle schema can drift from existing tables, so a
small additive change may also propose deleting populated unrelated columns.

**How to apply:** inspect every proposed statement. If unrelated destructive
changes appear, decline the push and apply only static additive DDL to
development. Verify columns and indexes through catalog queries.

# pgvector

The `vector` extension must exist before a push that touches an embedding
column. The server initializes it on boot, so a fresh database needs one
successful boot first.

**Why:** Drizzle introspection fails before the server can reach its own
startup initializer when the development database has no `vector` extension.

**How to apply:** on a fresh import, create the extension first, then run
`npm run db:push`; restart the app afterward so database initialization can
complete.

# Local dependency stubs

The repository's `file:stubs/*` npm overrides may leave dangling or missing
top-level packages after a clean dependency install.

**Why:** npm can resolve the file override relative to the dependent package,
while runtime resolution expects the package at `node_modules/<name>`.

**How to apply:** run the existing `npm run install:stubs` script after
dependency installation and before starting or building the app.

# .replit

Never edit `.replit` directly — it goes through the verify-and-replace flow.

# A schema push is NOT a deployment

Development schema changes do not modify production directly.

**Why:** Replit Publish manages the development-to-production schema diff and
rename confirmation; new startup-time DDL bypasses that safety model.

**How to apply:** keep the Drizzle schema authoritative, validate development,
and use Publish for production schema application. Do not add new boot-time DDL.
