---
name: Voice session accounting
description: Reliability invariants for durable voice-duration analytics across reconnects, disconnect races, and server restarts.
---

Voice-duration reporting must use one durable interval per browser voice connection, not the resumable chat conversation lifetime or AI token counts. Permit at most one open interval per conversation and serialize reconnect rotation.

**Why:** WebSocket setup includes awaited work. A disconnect can happen before normal listeners are attached, concurrent reconnects can overlap, and an unbounded restart cleanup can accidentally close a row created by the new process. Each failure silently distorts reported minutes.

**How to apply:** Check socket state after awaited setup boundaries, make interval close idempotent, prevent inserts after cleanup, enforce one open row in the database, and close restart orphans only before a captured boot boundary. Clip intervals to report-range overlap.