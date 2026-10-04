/**
 * AI Calling — what happens after a call ends (owned by the calling engine).
 *
 * The media stream (mediaStream.ts) and the provider status webhook call
 * processFinishedCall(callId) once a call reaches a terminal status. It must be
 * idempotent (both may fire for the same call): summary + outcome, lead update,
 * do-not-call, retries / callbacks, WhatsApp follow-up and usage metering.
 *
 * Placeholder until the calling engine lands.
 */
export async function processFinishedCall(_callId: string): Promise<void> {
  // implemented by the calling engine
}
