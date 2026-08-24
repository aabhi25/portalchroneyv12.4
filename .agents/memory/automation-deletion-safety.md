---
name: Automation deletion safety
description: Concurrency rule for removing workflow definitions that can create or schedule outbound campaigns.
---

Treat automation deletion as a coordinated lifecycle transition, not a simple row update. Deletion must lock the active definition and each pending generated campaign, then either cancel work that has not started or refuse deletion when delivery has already started.

**Why:** A background sender can inspect a scheduled campaign just before deletion and start it immediately after the definition is hidden. A successful delete must therefore mean that no new delivery can begin from the removed definition.

**How to apply:** Every workflow operation that creates or schedules work must revalidate an active, enabled definition inside its write transaction. Campaign senders must atomically claim an eligible state before dispatching; deletion must lock and cancel pending work through the same state boundary. Preserve completed history rather than hard-deleting it.