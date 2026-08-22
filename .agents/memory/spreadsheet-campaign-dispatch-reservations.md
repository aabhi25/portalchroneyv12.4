---
name: Spreadsheet campaign dispatch reservations
description: Safe duplicate-prevention semantics for daily spreadsheet WhatsApp automations.
---

Duplicate-suppression keys represent a delivery reservation, not merely an uploaded row. A review-mode spreadsheet run must not reserve its loan/installment (or other business record) key until an operator approves it for scheduling. Cancelling a draft or scheduled run must remove its reservation.

**Why:** Treating an uploaded or cancelled review as already sent prevents a corrected daily file from ever reaching the customer. Conversely, releasing a key after a campaign has started risks customer-visible duplicates.

**How to apply:** When adding new automated campaign sources or retry/cancel paths, make reservation creation and release transactional with the pre-send campaign state. Preserve the reservation once the underlying campaign has left a cancellable pre-send state.