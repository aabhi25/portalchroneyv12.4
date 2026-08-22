---
name: TopScholar Plan sync durability
description: Durable constraints for complete-Plan curriculum embeddings into a client-managed content store.
---

Complete Plan syncs must resolve the current CP IDs, then queue those CP IDs as durable work. Direct client-store embedding is limited to one active CP per account through a renewable database lease; work must remain restart-safe and cancellation-aware at the CP boundary.

**Why:** Starting a fire-and-forget direct embedding worker for every resolved CP retains large curriculum payloads and can overwhelm the app or external database. A client-Mongo connection failure must be surfaced before a bulk run starts rather than turning into many concurrent failures.

**How to apply:** Keep Plan state, CP work state, leases, and cancellation markers in the app database only—never raw client curriculum. Guard resolve completion against a concurrent cancel, preserve terminal cancellation states, and make every external-store Full entry point use the same queue.