---
name: Environment quirks
description: Replit/workspace specifics for this repl that are easy to get wrong.
---

# Schema changes

Schema lives in `shared/schema.ts` and is applied with `npm run db:push`
(drizzle-kit push), not migration files. `-- --force` is needed when drizzle
prompts interactively, since the agent shell is non-interactive.

**How to apply:** after a push, verify the columns landed by querying
`information_schema.columns` rather than trusting the "Changes applied" line.

# pgvector

The `vector` extension must exist before a push that touches an embedding
column. The server initializes it on boot, so a fresh database needs one
successful boot first.

# .replit

Never edit `.replit` directly — it goes through the verify-and-replace flow.

# A schema push is NOT a deployment

`db:push` updates the development database only. Production starts from the
built bundle and never runs it, so a column that exists in dev can be missing in
production and every insert touching it fails there.

**Why:** the dev and production databases drift independently, and a pushed
change looks completely finished locally.

**How to apply:** any new column also needs an expand-only
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the startup init path, which runs
on every boot in both environments. Follow the existing convention there:
nullable or defaulted, wrapped in its own try/catch so one failure cannot abort
boot. Verify by dropping the columns and restarting — if they come back and the
app works, the production upgrade path is proven.
