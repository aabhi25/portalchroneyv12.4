---
name: Mongo/pgvector reader parity
description: Rules for keeping the MongoDB content reader semantically identical to the pgvector reader
---

# Mongo/pgvector viewer parity

The TopScholar content viewer has two store backends that must return identical API shapes and semantics.

**Rule:** In Mongo aggregations, missing fields are NOT null. Always normalize with `$ifNull` before comparing/sorting a nullable field, or "missing" documents silently sort with named values instead of last (breaking pgvector `NULLS LAST` parity). A plain `{ field: null }` match filter DOES catch missing fields, but aggregation expressions (`$eq`, `$lte`) do not.

**Why:** First implementation used `$lte: ['$chapter', null]` for null-last sorting; review caught that missing-field docs weren't reliably classified.

**Also:** Never create a second MongoClient cache — reuse the shared shutdown-managed cache in `mongoContentDb.ts` (`getMongoCollection`), or clients leak on graceful shutdown.
