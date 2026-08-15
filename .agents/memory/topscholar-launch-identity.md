---
name: TopScholar launch identity
description: How signed launch tokens interact with scope params and voice, and why unsigned admin preview surfaces silently lose voice.
---

# Signed launch identity beats URL scope params

When a launch token is present, the server derives the whole curriculum handoff
from the token and ignores the scope supplied in the URL. An invalid or expired
token does not fall back to the URL scope — it resolves to no identity at all.

**Why:** the token is the security boundary; honouring URL scope as a fallback
would let anyone drop the token and pick their own scope.

**How to apply:** any UI that mints a token and also puts scope in the URL must
key the token to the scope it was signed for, and refuse to render until the two
agree. Storing the token in an effect is not enough — the render caused by a
scope change commits *before* the effect runs, so a stale token from the previous
scope can be used for one render. Derive it during render instead.

# Voice demands a signed identity; chat does not

Widget-identity connections on a TopScholar account are refused for voice unless
they carry a *signed* token. Unsigned and plain-cp_id paths are rejected. Chat
does not go through this check.

**Why:** without it a student could drop the token and get an anonymous voice
session on a doubt that was just closed.

**How to apply:** if voice is dead on an internal admin/preview surface while
chat works fine, suspect a missing signed identity before suspecting the voice
stack, the model, or the microphone. The fix is to give that surface a real
signed token — never to add a role-based exemption to the guard, which would
reopen the hole for real students.

# A refused WebSocket upgrade is invisible to the browser

The refusal is written as a raw HTTP status on the upgrade, so no WebSocket is
ever created. The browser sees only `onerror` then `onclose` with code 1006 —
there is no readable status or close reason.

**Why it matters:** a client cannot report the real cause of a refused voice
session, so a pre-ready failure must be surfaced with generic wording and a
retry, and the actual reason must be read from the server log.

**How to apply:** never leave a pre-ready close handler that only flips state to
offline. If the control that starts the session is gated on that same online
flag, the result is a button that silently does nothing on every click — which
reads to users as "the click isn't registering", not as an error.
