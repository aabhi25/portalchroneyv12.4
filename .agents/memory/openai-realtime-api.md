---
name: OpenAI Realtime API
description: Connection headers, the session.update shape, and how to validate a model swap without a microphone.
---

# Do not send the beta header

Connecting to `wss://api.openai.com/v1/realtime` with
`OpenAI-Beta: realtime=v1` is rejected with `beta_api_shape_disabled`
("The Realtime Beta API is no longer supported").

**Why:** the beta shape was retired; the GA endpoint is the same URL but takes
`Authorization` alone.

**How to apply:** send only the `Authorization` header. If a realtime connection
starts failing with an `invalid_request_error` at session-update time, check for
a stray beta header before suspecting the model name or the session config.

# Validating a realtime model swap without audio

A model swap can be verified end to end without a microphone or browser: open a
WebSocket to the new model, send the exact `session.update` the app sends, and
wait for `session.updated` (accepted) or `error` (rejected). The echoed session
reports the resolved model, voice, transcription model, VAD settings and the
count of tools accepted.

**Why:** the risk in a realtime model swap is almost never the model name — it
is whether the new model still accepts the existing session config (tool schema,
noise reduction, transcription sub-model, audio formats).

**How to apply:** reuse the app's own tool-conversion helper when building the
test config, otherwise the test proves less than it appears to.

# Usage arrives on response.done

The `response.done` event carries `response.usage` with `input_tokens`,
`output_tokens` and nested `input_token_details` / `output_token_details`
(each with `text_tokens` / `audio_tokens`, plus `cached_tokens_details`).
This shape is not in the published docs, so parse it defensively and treat a
missing nested field as unknown rather than zero.
