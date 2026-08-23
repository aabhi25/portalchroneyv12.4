---
name: Tester client-store filters
description: Scope-authority boundary for the TopScholar Widget Tester and live widget.
---

The Widget Tester may build its curriculum filters from complete scope metadata physically stored with the client’s embeddings. This does not make that store the production scope authority: live chat, voice, and signed launches continue to use the application’s CP-to-curriculum mapping until a coordinated production migration.

**Why:** Existing embedding chunks originally lacked Board, Medium, and Grade, and a Tester-only switch can otherwise preview a curriculum that the deployed widget cannot resolve. The app mapping remains the complete compatibility catalogue during the transition.

**How to apply:** Persist and backfill complete scope metadata into client content stores, then require an exact CP-set comparison against live mapping before minting a Tester preview. If the sets differ or the requested chapter is absent, block the preview rather than falling back to an unsigned or broader scope.