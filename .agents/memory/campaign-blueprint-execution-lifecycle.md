---
name: Campaign blueprint execution lifecycle
description: Safety and immutability rules for recurring automations derived from draft WhatsApp campaigns.
---

A campaign remains protected from direct send, cancellation, and deletion for as long as any non-deleted automation references it, even when that automation is paused. Blueprint attachment and direct-send claiming must serialize on the same campaign-scoped lock.

Automation campaigns own reusable template and AI behavior only. Their audience (AI Workbook or fixed contact groups) and recurring timing belong to the automation setup; they never carry a one-time audience or send-at value. Existing blueprint automations may still resolve their previously linked Workbook for compatibility.

Generated execution campaigns are immutable operational records: ordinary campaign APIs must not edit, delete, cancel, retry, or start them. Review approval and cancellation belong to the automation run, and only the due-time scheduler may start an approved execution.

Each run must retain immutable audience and blueprint-configuration snapshots in addition to campaign/workbook IDs and revisions.

**Why:** Separating reusable behavior from audience and cadence avoids duplicate configuration and lets one campaign definition serve different automation audiences. A paused blueprint can still be resumed, public campaign actions can bypass review or scheduled time, and source data is mutable/deletable.

**How to apply:** Campaign creation asks one-time versus automation first. New automation campaigns save without groups or one-time scheduling, then the automation selects and snapshots its own audience. Any mutation or dispatch path must still check blueprint references and execution-run linkage.