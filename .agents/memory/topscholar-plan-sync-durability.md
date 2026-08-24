---
name: TopScholar Plan sync durability
description: Durable constraints for complete-Plan curriculum embeddings into a client-managed content store.
---

Complete Plan syncs must resolve the current CP IDs, then queue those CP IDs as durable work. Direct client-store embedding is limited to one active CP per account through a renewable database lease; work must remain restart-safe and cancellation-aware at the CP boundary.

**Why:** Starting a fire-and-forget direct embedding worker for every resolved CP retains large curriculum payloads and can overwhelm the app or external database. A client-Mongo connection failure must be surfaced before a bulk run starts rather than turning into many concurrent failures.

**How to apply:** Keep Plan state, CP work state, leases, and cancellation markers in the app database only—never raw client curriculum. Guard resolve completion against a concurrent cancel, preserve terminal cancellation states, and make every external-store Full entry point use the same queue.

Targeted CP maintenance and complete-Plan work must atomically agree on one owner for an account/CP pair. Use a short queue-creation lock distinct from the long ingestion lock, and schedule runnable CP work ahead of submitted-only runs that are waiting for another owner.

**Why:** A Plan resolver and a manual refresh can otherwise each schedule a full write for the same CP, while an older submitted-only Plan run can starve the targeted work needed to resolve it.

**How to apply:** Any new entry point that creates or claims CP work must participate in the same short ownership lock, defer to an active owner rather than duplicate it, and leave the long client-store lock exclusively for the actual write.