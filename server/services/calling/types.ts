/**
 * AI Calling — telephony provider contract.
 *
 * A provider places outbound calls and reports their status. The AUDIO of every call
 * (Exotel or simulator) arrives on our media-stream WebSocket in Exotel's AgentStream
 * format (see mediaStream.ts), so the call pipeline is identical for all providers.
 */
import type { CallProviderId, CallStatus } from "@shared/aiCalling";

/** Decrypted, ready-to-use provider configuration for one business. Never logged. */
export interface ProviderCredentials {
  provider: CallProviderId;
  exotel?: {
    apiKey: string;
    apiToken: string;
    accountSid: string;
    subdomain: string;      // "api.in.exotel.com" (India) | "api.exotel.com" (Singapore)
    callerId: string;       // ExoPhone
    flowAppId?: string | null;
  };
}

export interface PlaceCallInput {
  callId: string;
  businessAccountId: string;
  to: string;                 // customer, +E.164
  /** wss URL of our media stream for THIS call (signed; see streamToken.ts). */
  streamUrl: string;
  /** https URL the provider posts status updates to (signed). */
  statusCallbackUrl: string;
  record: boolean;
  timeLimitSec: number;
  ringTimeoutSec?: number;
}

export interface PlaceCallResult {
  providerCallSid: string;
  status: CallStatus;         // usually 'dialing' or 'ringing'
}

/** A normalised status update from a provider webhook (or the simulator). */
export interface ProviderStatusUpdate {
  providerCallSid: string;
  status: CallStatus;
  durationSec?: number | null;
  recordingUrl?: string | null;
  answeredAt?: Date | null;
  endedAt?: Date | null;
  raw?: Record<string, unknown>;
}

export interface TelephonyProvider {
  id: CallProviderId;
  /** Check the credentials work (e.g. fetch the account / ExoPhone). Throws a plain-language Error if not. */
  verify(creds: ProviderCredentials): Promise<{ ok: true; detail?: string }>;
  placeCall(creds: ProviderCredentials, input: PlaceCallInput): Promise<PlaceCallResult>;
  /** Ask the provider to hang up a live call (best effort). */
  hangup?(creds: ProviderCredentials, providerCallSid: string): Promise<void>;
  /** Parse a status webhook body into a normalised update (null = ignore). */
  parseStatusWebhook?(body: Record<string, unknown>): ProviderStatusUpdate | null;
  /** Download a recording (for our staff-only proxy). */
  fetchRecording?(creds: ProviderCredentials, recordingUrl: string): Promise<{ contentType: string; body: Buffer }>;
}
