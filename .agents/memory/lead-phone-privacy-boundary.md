---
name: Lead phone privacy boundary
description: Durable privacy rules for account-level masking of lead phone numbers.
---

Treat lead phone masking as a response-layer privacy boundary across every user-visible Leads surface. Masking only the top-level phone property is insufficient: CRM debug payloads and contact answers in forms, conversations, or journeys may repeat the full number.

**Why:** Lead records can carry the same phone value through several response shapes. A visually masked table still leaks PII if nested payloads or detail dialogs return the original value.

**How to apply:** For any new lead list, detail, export, group view, form detail, or journey response, apply the account policy on the server before serialization, including when a superadmin is viewing the account. Keep stored values and internal CRM operations raw.