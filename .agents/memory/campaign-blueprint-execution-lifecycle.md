---
name: Campaign blueprint execution lifecycle
description: Safety and immutability rules for recurring automations derived from draft WhatsApp campaigns.
---

A campaign remains protected from direct send, cancellation, and deletion for as long as any non-deleted automation references it, even when that automation is paused. Blueprint attachment and direct-send claiming must serialize on the same campaign-scoped lock.

New automation campaigns own the reusable template, AI behavior, recipient source, mobile-number mapping, and Campaign-AI field allowlist. Automation setup owns name/personalization mapping, business-record identity, date/status eligibility, offsets, recurrence, review mode, and delivery timing. Legacy automations may keep their older source configuration.

Generated execution campaigns are immutable operational records: ordinary campaign APIs must not edit, delete, cancel, retry, or start them. Review approval and cancellation belong to the automation run, and only the due-time scheduler may start an approved execution.

Each run must retain immutable audience and blueprint-configuration snapshots in addition to campaign/workbook IDs and revisions.

Only explicitly allowlisted recipient fields may enter Campaign-AI prompts. When one phone maps to multiple distinct loan/account identities, account-specific disclosure requires outbound-message context identifying the record; otherwise the reply must ask the customer to disambiguate.

**Why:** The mobile number identifies the WhatsApp destination, while record keys identify invoices, loans, appointments, or other business records. Keeping delivery identity with the campaign prevents recipient drift; keeping matching rules with the automation makes scheduling and deduplication explicit. Generated executions contain recipient attributes that must not bypass the original AI allowlist.

**How to apply:** Campaign creation asks one-time versus automation first. New automation campaigns choose and validate their source/mobile column before template mapping. Automation setup inherits those read-only, then requires record/date rules and any template-required name mapping before save or run. Each run re-reads the latest source, validates it, and snapshots the exact version and recipients. Any mutation or dispatch path must still check blueprint references and execution-run linkage.