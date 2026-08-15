---
name: Voice/chat parity for curriculum answers
description: Why a spoken tutor needs different handling of retrieval scope and curriculum media than the text path, even though both call the same retrieval.
---

# Voice and chat must agree on scope, but must NOT agree on media

Chat and voice share the retrieval layer, so it is tempting to assume they behave
alike. They diverge in two ways that are easy to reintroduce.

## Retrieval scope: absent is not the same as empty

The retrieval layer reads an **absent** content-pack list as "search the whole
account" and an **empty array** as "return nothing". That distinction is
load-bearing and silent: forgetting to pass scope does not error, it quietly
widens a session to every subject and grade the account owns. The failure looks
like hallucination — real content, wrong syllabus — which sends you hunting for a
model problem instead of a plumbing one.

**Why:** voice originally passed no scope at all, so a Class 4 Science session
could answer with Class 10 English content. It was mistaken for a bad model.

**How to apply:** any new retrieval call site must pass the resolved scope, and a
scope that resolves to nothing must stay an empty array. Never "fall back" to
unscoped on a lookup failure — fail closed. Retrieval also honours only the pack
id **list**; a single pack id on its own is ignored, so it has to be wrapped.

Precedence must mirror the text path exactly (full board/medium/grade/subject wins
over a directly-named pack; a *partial* scope is refused even when a pack id is
present). If the two paths disagree, the same launch answers in one mode and
refuses in the other.

## Curriculum media: anything the voice model can see, it can say

The text path deliberately feeds image URLs to the model and tells it to emit
Markdown, because a browser renders that. Doing the same for a spoken tutor makes
it read "h-t-t-p-s colon slash slash..." out loud.

**Why:** it destroys the illusion of a tutor, and it is the single most jarring
thing a voice assistant can do.

**How to apply:** media must travel **around** the model, not through it. Strip
image markup from every model-facing surface — the injected curriculum context,
tool results returned to the model, and any chat history injected into a voice
session (chat's own saved answers contain image Markdown). Carry the URLs
separately and attach them to the on-screen bubble. Conversation memory should
keep the spoken text only, or the images come back as history on a later turn and
get read aloud.

Retrieval also appends its images to the *end* of the notes, so any truncation of
model-facing text tends to cut them — which is why dropping them looked harmless
for a long time.

Because retrieval happens *before* the response that will speak it exists, pending
media has to be bound to a response id and discarded on interruption; otherwise
images from an abandoned question attach to whatever the student asks next.
