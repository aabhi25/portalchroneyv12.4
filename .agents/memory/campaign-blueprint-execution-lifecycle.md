---
name: Campaign blueprint execution lifecycle
description: Safety and immutability rules for recurring automations derived from draft WhatsApp campaigns.
---

A campaign remains protected from direct send, cancellation, and deletion for as long as any non-deleted automation references it, even when that automation is paused. Blueprint attachment and direct-send claiming must serialize on the same campaign-scoped lock.

Generated execution campaigns are immutable operational records: ordinary campaign APIs must not edit, delete, cancel, retry, or start them. Review approval and cancellation belong to the automation run, and only the due-time scheduler may start an approved execution.

Each run must retain immutable audience and blueprint-configuration snapshots in addition to campaign/workbook IDs and revisions.

**Why:** A paused blueprint can still be resumed, public campaign actions can bypass review or scheduled time, and workbook versions and generated groups are mutable/deletable. IDs alone therefore cannot prove what an historical run reviewed and sent.

**How to apply:** Any new campaign mutation or dispatch path must check both blueprint references and execution-run linkage. Lifecycle transitions use locked conditional updates, and historical views use run snapshots rather than reconstructing old state from live records.