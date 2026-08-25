---
name: Development campaign fixtures
description: Safety rules for seeding realistic WhatsApp campaign data in development.
---

Development-only campaign fixtures must write through the regular campaign, recipient, and transcript tables, while remaining impossible to dispatch through a real provider.

**Why:** A fixture template that looks provider-approved can be selected in a normal campaign and turn a harmless local demo into an external send. Concurrent fixture requests can also produce duplicate campaign data, and future-dated transcript events make a completed campaign look inconsistent.

**How to apply:** Guard the API and service by environment, authentication, and tenant scope; use a transaction-scoped tenant lock for create-or-return behavior; make fixture templates non-sendable; and seed complete historical timelines whose final message precedes campaign completion.