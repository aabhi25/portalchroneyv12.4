/**
 * In-portal simulator provider (no Exotel keys needed).
 *
 * placeCall only marks the call as ringing with providerCallSid "SIM-<callId>". The portal polls
 * GET /api/calling/simulator/incoming, shows the ringing call, and when staff press Answer the
 * browser opens /api/calling/simulate/<callId> (media handler) and plays Exotel's role.
 * Decline → POST /api/calling/simulator/:id/decline (no_answer). A simulator call still ringing
 * after SIMULATOR_RING_TIMEOUT_MS is marked no_answer by the dialer tick.
 */
import type { TelephonyProvider } from "../types";

export const SIMULATOR_RING_TIMEOUT_MS = 45_000;

export const simulatorProvider: TelephonyProvider = {
  id: "simulator",
  async verify() {
    return { ok: true, detail: "The simulator rings in this portal — no phone company account needed." };
  },
  async placeCall(_creds, input) {
    return { providerCallSid: `SIM-${input.callId}`, status: "ringing" };
  },
  async hangup() { /* the browser closes its socket */ },
  parseStatusWebhook() {
    return null;
  },
};
