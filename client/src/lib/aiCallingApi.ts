/**
 * AI Calling — every server call the portal makes, and the response shapes it expects.
 *
 * The contract lives in the shared brief / shared/aiCalling.ts. Where the brief did not pin a
 * shape down, the assumption is written here (marked "assumed") so the server side can match it
 * in one place.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { MeResponseDto } from "@shared/dto";
import type {
  AiCallingSettingsView,
  AiCallView,
  CallDirection,
  CallOutcome,
  CallStatus,
  CallTrigger,
} from "@shared/aiCalling";

// ── Feature flag ────────────────────────────────────────────────────────────

/**
 * True / false when /api/auth/me carries `businessAccount.aiCallingEnabled`; undefined when the
 * server does not send the field yet (then the caller probes /api/calling/settings instead).
 */
export function readAiCallingFlag(user: MeResponseDto | null | undefined): boolean | undefined {
  const raw = (user?.businessAccount as Record<string, unknown> | null | undefined)?.aiCallingEnabled;
  if (raw === undefined || raw === null) return undefined;
  return raw === true || raw === "true";
}

export function canSeeBusinessCalling(user: MeResponseDto | null | undefined): boolean {
  if (!user || !user.businessAccount) return false;
  if (user.role === "account_group_admin") return false;
  if (user.role === "super_admin" && !user.activeBusinessAccountId) return false;
  return true;
}

/** An error from apiRequest carries the HTTP status. */
export function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/** 403 / 404 from a calling endpoint = the feature isn't switched on (or the server part isn't deployed). */
export function isCallingUnavailable(err: unknown): boolean {
  const s = errorStatus(err);
  return s === 403 || s === 404;
}

// ── Types ───────────────────────────────────────────────────────────────────

export type CallingSettingsResponse = AiCallingSettingsView & {
  superAdminMinuteCap: number | null;
  minutesThisMonth: number;
};

/** PUT /api/calling/settings body: any view field + write-only secrets ("" = keep). */
export type CallingSettingsUpdate = Partial<
  Omit<AiCallingSettingsView, "exotel" | "setup" | "consentAttestedAt" | "updatedAt">
> & {
  exotel?: Partial<Pick<AiCallingSettingsView["exotel"], "accountSid" | "subdomain" | "callerId" | "flowAppId">>;
  exotelApiKey?: string;
  exotelApiToken?: string;
  attestConsent?: boolean;
};

export interface CallsListParams {
  status?: CallStatus | "";
  outcome?: CallOutcome | "";
  direction?: CallDirection | "";
  search?: string;
  from?: string;
  to?: string;
  leadId?: string;
  limit?: number;
  offset?: number;
}

export interface CallsListResponse {
  calls: AiCallView[];
  total: number;
}

export interface CallTranscriptLine {
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
}

export type CallDetail = AiCallView & {
  capturedFields: Record<string, string> | null;
  outcomeNote: string | null;
  callbackAt: string | null;
  errorMessage: string | null;
  transferred: boolean;
  followUpSentAt: string | null;
};

export interface CallDetailResponse {
  call: CallDetail;
  transcript: CallTranscriptLine[];
  lead: { id: string; name: string | null; phone: string | null; email: string | null } | null;
}

export interface CreateCallBody {
  leadId?: string;
  phone?: string;
  name?: string;
  note?: string;
}

/**
 * POST /api/calling/calls. Brief: `{ call }`. Assumed extras: `message` (plain-language note,
 * e.g. "Outside calling hours — scheduled for 10:00 tomorrow") and `scheduledAt`.
 */
export interface CreateCallResponse {
  call: AiCallView;
  message?: string | null;
  scheduledAt?: string | null;
}

export interface CallStats {
  total: number;
  answered: number;
  completed: number;
  noAnswer: number;
  interested: number;
  callbacks: number;
  doNotCall: number;
  minutes: number;
  avgDurationSec: number;
  byDay: { date: string; calls: number; answered: number }[];
}

/** Assumed row shape (mirrors the ai_call_do_not_call table). */
export interface DoNotCallItem {
  id: string;
  phone: string;
  reason: string | null;
  source: "call" | "staff" | "import" | string;
  callId?: string | null;
  createdAt: string;
}

export interface DoNotCallList {
  items: DoNotCallItem[];
  total: number;
}

export interface IncomingSimCall {
  id: string;
  phone: string;
  leadName: string | null;
  trigger: CallTrigger;
  createdAt: string;
}

/** GET/PUT /api/super-admin/ai-calling/:businessAccountId. `minutesThisMonth` assumed optional. */
export interface SuperAdminCallingState {
  enabled: boolean;
  monthlyMinuteCap: number | null;
  minutesThisMonth?: number;
}

/** Existing campaign template list item (GET /api/whatsapp/templates) — only the fields used here. */
export interface WhatsappTemplateOption {
  id: string;
  name: string;
  status: string;
  language?: string | null;
}

/** Existing website leads list (GET /api/leads?search=&limit=). */
export interface LeadSearchItem {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  createdAt?: string;
}

// ── Query keys ──────────────────────────────────────────────────────────────

export const callingKeys = {
  all: ["/api/calling"] as const,
  settings: ["/api/calling", "settings"] as const,
  calls: (p: CallsListParams) => ["/api/calling", "calls", p] as const,
  callsRoot: ["/api/calling", "calls"] as const,
  call: (id: string) => ["/api/calling", "call", id] as const,
  stats: (from: string, to: string) => ["/api/calling", "stats", from, to] as const,
  dnc: (search: string, offset: number, limit: number) => ["/api/calling", "dnc", search, offset, limit] as const,
  dncRoot: ["/api/calling", "dnc"] as const,
  incoming: ["/api/calling", "simulator", "incoming"] as const,
  superAdmin: (businessAccountId: string) => ["/api/super-admin/ai-calling", businessAccountId] as const,
};

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Calls ───────────────────────────────────────────────────────────────────

export const callingApi = {
  getSettings: () => apiRequest<CallingSettingsResponse>("GET", "/api/calling/settings"),
  saveSettings: (body: CallingSettingsUpdate) => apiRequest<CallingSettingsResponse>("PUT", "/api/calling/settings", body),
  verify: () => apiRequest<{ ok: boolean; detail?: string }>("POST", "/api/calling/settings/verify"),

  listCalls: (p: CallsListParams) =>
    apiRequest<CallsListResponse>(
      "GET",
      `/api/calling/calls${qs({
        status: p.status,
        outcome: p.outcome,
        direction: p.direction,
        search: p.search,
        from: p.from,
        to: p.to,
        leadId: p.leadId,
        limit: p.limit,
        offset: p.offset,
      })}`,
    ),
  getCall: (id: string) => apiRequest<CallDetailResponse>("GET", `/api/calling/calls/${encodeURIComponent(id)}`),
  recordingUrl: (id: string) => `/api/calling/calls/${encodeURIComponent(id)}/recording`,
  createCall: (body: CreateCallBody) => apiRequest<CreateCallResponse>("POST", "/api/calling/calls", body),
  cancelCall: (id: string) => apiRequest<{ ok?: boolean; call?: AiCallView }>("POST", `/api/calling/calls/${encodeURIComponent(id)}/cancel`),

  // "Last N days" is open-ended (no `to`), so a call made a moment ago always counts.
  stats: (from: string, to?: string) => apiRequest<CallStats>("GET", `/api/calling/stats${qs({ from, to })}`),

  listDnc: (search: string, offset: number, limit: number) =>
    apiRequest<DoNotCallList>("GET", `/api/calling/do-not-call${qs({ search, offset, limit })}`),
  addDnc: (phone: string, reason: string) => apiRequest<DoNotCallItem | { item: DoNotCallItem }>("POST", "/api/calling/do-not-call", { phone, reason }),
  removeDnc: (id: string) => apiRequest<{ ok?: boolean }>("DELETE", `/api/calling/do-not-call/${encodeURIComponent(id)}`),

  incoming: () => apiRequest<{ calls: IncomingSimCall[] }>("GET", "/api/calling/simulator/incoming"),
  decline: (id: string) => apiRequest<{ ok?: boolean }>("POST", `/api/calling/simulator/${encodeURIComponent(id)}/decline`),

  superAdminGet: (businessAccountId: string) =>
    apiRequest<SuperAdminCallingState>("GET", `/api/super-admin/ai-calling/${encodeURIComponent(businessAccountId)}`),
  superAdminPut: (businessAccountId: string, body: { enabled: boolean; monthlyMinuteCap?: number | null }) =>
    apiRequest<SuperAdminCallingState>("PUT", `/api/super-admin/ai-calling/${encodeURIComponent(businessAccountId)}`, body),

  whatsappTemplates: () => apiRequest<WhatsappTemplateOption[]>("GET", "/api/whatsapp/templates"),
  searchLeads: (search: string) =>
    apiRequest<{ leads: LeadSearchItem[]; total: number }>("GET", `/api/leads${qs({ search, limit: 8, page: 1 })}`),
};

/** Paths for the simulator media WebSocket (same protocol as Exotel). */
export const simulatorPaths = {
  outbound: (callId: string) => `/api/calling/simulate/${encodeURIComponent(callId)}`,
  inbound: () => "/api/calling/simulate-inbound",
};

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Whether this business has AI Calling (super admin switch). Uses the flag from /api/auth/me when
 * the server sends it; otherwise asks /api/calling/settings once (200 = on, 403/404 = off).
 */
export function useAiCallingAvailability(user: MeResponseDto | null | undefined): { enabled: boolean; loading: boolean } {
  const visible = canSeeBusinessCalling(user);
  const flag = readAiCallingFlag(user);
  const probe = useQuery<CallingSettingsResponse>({
    queryKey: callingKeys.settings,
    queryFn: callingApi.getSettings,
    enabled: visible && flag !== false,
    staleTime: 60_000,
    retry: false,
  });
  if (!visible || flag === false) return { enabled: false, loading: false };
  if (flag === true) return { enabled: true, loading: false };
  return { enabled: probe.isSuccess, loading: probe.isLoading };
}

export function useCallingSettings(enabled = true) {
  return useQuery<CallingSettingsResponse>({
    queryKey: callingKeys.settings,
    queryFn: callingApi.getSettings,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Plain-language reason a call ended / was not placed. Unknown codes are shown tidied up. */
export const END_REASON_LABEL: Record<string, string> = {
  ai_ended: "The AI wrapped up the call",
  customer_hung_up: "The person hung up",
  caller_hung_up: "The person hung up",
  max_duration: "Reached the maximum call length",
  silence: "Nobody spoke for a while",
  voicemail: "Voicemail picked up",
  do_not_call: "Number is on the do-not-call list",
  no_consent: "No permission to call this person",
  outside_hours: "Outside calling hours",
  limit_reached: "Monthly minute limit reached",
  monthly_limit: "Monthly minute limit reached",
  cancelled: "Cancelled by your team",
  transferred: "Passed to your team",
  provider_error: "The phone service reported a problem",
  no_phone: "No phone number",
  disabled: "AI Calling was switched off",
  declined: "Declined in test mode",
};

export function endReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return END_REASON_LABEL[code] ?? code.replace(/[_-]+/g, " ").replace(/^\w/, c => c.toUpperCase());
}

export function friendlyFieldName(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, c => c.toUpperCase());
}

/** Fill {name}, {business}, {assistant} in the opening line for the live preview. */
export function previewOpeningLine(template: string, sample: { name: string; business: string; assistant: string }): string {
  return template
    .replace(/\{name\}/gi, sample.name)
    .replace(/\{business\}/gi, sample.business)
    .replace(/\{assistant\}/gi, sample.assistant);
}
