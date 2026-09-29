# Database changes (migrations)

All schema changes go through versioned migration files in `migrations/`. There is no other way:
`npm run db:push` is disabled, and new `ALTER TABLE` lines must not be added to `server/init.ts`.

## Making a change

1. Edit `shared/schema.ts` (add the column, table or index).
2. Generate the migration:
   ```bash
   npm run db:generate -- --name short_description_of_change
   ```
   This writes `migrations/NNNN_short_description_of_change.sql`. Read it before committing.
3. Commit the schema change and the new migration file together.

## How it reaches a database

- **Automatically on startup.** The server applies any pending migrations before it starts serving
  (`server/migrate.ts`). If a migration fails, the server does not start — check the logs.
- **By hand** (optional): `npm run db:migrate`.
- **Replit:** `scripts/post-merge.sh` runs `npm run db:migrate` after each merge.
- **AWS:** nothing extra — `git pull`, `npm ci`, `npm run build`, restart. The migration runs on start.

Each migration runs once per database, in order, recorded in the `drizzle.__drizzle_migrations`
table. Two server processes starting together can't both migrate (advisory lock).

## The baseline

`migrations/0000_baseline.sql` is the schema production had on 2026-09-28. A database that already
has tables but no migration history (production, Replit) is recorded as being at the baseline
without running it; an empty database runs it to create everything from scratch.

## Rules of thumb

- Additive changes (new table, new nullable column, new index) are safe to ship any time.
- For a new `NOT NULL` column, give it a default.
- Renames and drops: do them in two releases (stop using the column first, drop it later).
- Creating an index briefly blocks writes to that table while it builds; for very large tables,
  schedule the deploy for a quiet time.
- The `migrations/manual/` folder is historical (hand-run SQL from before migrations were versioned).
