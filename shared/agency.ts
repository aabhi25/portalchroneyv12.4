/**
 * Agencies (resellers): a digital marketing agency gets its own login above its client accounts.
 * Everything an agency may do is configured per agency by a super admin, so different agencies
 * can be sold different packages. This file holds the catalogues and the money maths that both
 * the server and the portal use.
 */

// ── Features an agency may resell ────────────────────────────────────────────
// Each key is a business_accounts on/off column ('true' | 'false').

export const AGENCY_FEATURES = [
  { key: "chroneyEnabled", label: "Website chat", hint: "The AI chat widget on the client's website" },
  { key: "whatsappEnabled", label: "WhatsApp AI agent", hint: "AI replies on the client's WhatsApp number" },
  { key: "whatsappMarketingEnabled", label: "WhatsApp campaigns", hint: "Bulk and repeating WhatsApp campaigns" },
  { key: "instagramEnabled", label: "Instagram AI agent", hint: "AI replies to Instagram DMs and comments" },
  { key: "facebookEnabled", label: "Facebook AI agent", hint: "AI replies on the Facebook page" },
  { key: "appointmentsEnabled", label: "Appointments", hint: "Booking appointments from chats" },
  { key: "supportTicketsEnabled", label: "Support tickets", hint: "Tickets raised from chats" },
  { key: "voiceModeEnabled", label: "Voice in the widget", hint: "Visitors can talk to the website chat" },
  { key: "visualSearchEnabled", label: "Photo search", hint: "Visitors search products by photo" },
  { key: "shopifyEnabled", label: "Shopify", hint: "Product sync from a Shopify store" },
  { key: "leadsExportEnabled", label: "Lead export", hint: "The client can download all its leads" },
  { key: "aiCallingEnabled", label: "AI phone calls", hint: "The AI makes and takes phone calls (higher cost)" },
  { key: "demoOrdersEnabled", label: "Order lookup demo", hint: "Sample order tracking in the chat" },
  { key: "jewelryShowcaseEnabled", label: "Jewellery showcase", hint: "Vista jewellery catalogue" },
  { key: "k12EducationEnabled", label: "K12 tutor", hint: "School tutoring mode" },
  { key: "jobPortalEnabled", label: "Job portal", hint: "Jobs and applicants" },
] as const;

export type AgencyFeatureKey = typeof AGENCY_FEATURES[number]["key"];

export const AGENCY_FEATURE_KEYS: AgencyFeatureKey[] = AGENCY_FEATURES.map(f => f.key);

/** What a new agency may resell until a super admin changes it. */
export const DEFAULT_AGENCY_FEATURES: AgencyFeatureKey[] = [
  "chroneyEnabled", "whatsappEnabled", "whatsappMarketingEnabled", "instagramEnabled", "facebookEnabled",
  "appointmentsEnabled", "supportTicketsEnabled", "voiceModeEnabled", "leadsExportEnabled",
];

export function isAgencyFeatureKey(k: unknown): k is AgencyFeatureKey {
  return typeof k === "string" && (AGENCY_FEATURE_KEYS as string[]).includes(k);
}

/** Keeps known feature keys only, without duplicates, in catalogue order. */
export function cleanFeatureList(input: unknown): AgencyFeatureKey[] {
  const wanted = new Set(Array.isArray(input) ? input.filter(isAgencyFeatureKey) : []);
  return AGENCY_FEATURE_KEYS.filter(k => wanted.has(k));
}

// ── What an agency's logins may do ───────────────────────────────────────────

export const AGENCY_PERMISSIONS = [
  { key: "createAccounts", label: "Create client accounts", hint: "Up to the account limit", default: true },
  { key: "suspendAccounts", label: "Pause and restart clients", hint: "A paused client can't log in and its website chat stops", default: true },
  { key: "editFeatures", label: "Switch features per client", hint: "Only from the features this agency may resell", default: true },
  { key: "setLimits", label: "Set monthly AI limits per client", hint: "Within the agency's own AI cap", default: true },
  { key: "openClientPortal", label: "Open a client's portal", hint: "Set things up as the client", default: true },
  { key: "resetClientLogins", label: "Reset client passwords", hint: "Get a new temporary password", default: true },
  { key: "seeCosts", label: "See AI cost", hint: "Off: usage is shown as actions and % of limit only", default: true },
  { key: "seeStatement", label: "See our monthly bill", hint: "The statement of what we charge the agency", default: true },
  { key: "manageTeam", label: "Add agency staff logins", hint: "Only the agency's main login can do this", default: true },
  { key: "editBranding", label: "Change the widget footer", hint: "Show the agency's name, or nothing", default: true },
  { key: "setupConnectedApps", label: "Set up CRMs for clients", hint: "LeadSquared, Salesforce, Meritto and other connected apps", default: false },
] as const;

export type AgencyPermissionKey = typeof AGENCY_PERMISSIONS[number]["key"];
export type AgencyPermissions = Record<AgencyPermissionKey, boolean>;

/** Stored permissions merged over the defaults (unknown keys dropped). */
export function resolveAgencyPermissions(stored: unknown): AgencyPermissions {
  const src = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
  const out = {} as AgencyPermissions;
  for (const p of AGENCY_PERMISSIONS) out[p.key] = typeof src[p.key] === "boolean" ? src[p.key] as boolean : p.default;
  return out;
}

// ── Billing: what we charge the agency ───────────────────────────────────────

export type AgencyBillingModel = "per_account" | "usage" | "custom";
export type AgencyCurrency = "INR" | "USD";

export interface AgencyBilling {
  model: AgencyBillingModel;
  currency: AgencyCurrency;
  /** Fixed monthly fee for each active client account (agency currency). */
  pricePerAccount: number;
  /** AI use included in the fee, per account per month (agency currency). */
  includedAiPerAccount: number;
  /** Added on top of our AI cost for use above the allowance, in percent. */
  aiMarkupPercent: number;
  /** One fixed amount per month on top (platform fee, support plan…). */
  monthlyFee: number;
  notes: string;
}

export const DEFAULT_AGENCY_BILLING: AgencyBilling = {
  model: "per_account",
  currency: "INR",
  pricePerAccount: 0,
  includedAiPerAccount: 0,
  aiMarkupPercent: 0,
  monthlyFee: 0,
  notes: "",
};

function num(v: unknown, fallback = 0, max = 1e9): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export function resolveAgencyBilling(stored: unknown): AgencyBilling {
  const s = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
  const model: AgencyBillingModel = s.model === "usage" || s.model === "custom" ? s.model : "per_account";
  return {
    model,
    currency: s.currency === "USD" ? "USD" : "INR",
    pricePerAccount: num(s.pricePerAccount),
    includedAiPerAccount: num(s.includedAiPerAccount),
    aiMarkupPercent: num(s.aiMarkupPercent, 0, 1000),
    monthlyFee: num(s.monthlyFee),
    notes: typeof s.notes === "string" ? s.notes.slice(0, 2000) : "",
  };
}

export interface StatementLine {
  businessAccountId: string;
  name: string;
  status: string;
  /** Our AI cost this month, USD (as recorded). */
  aiCostUsd: number;
  /** The same in the agency's currency. */
  aiCost: number;
  /** AI use above the included allowance, agency currency. */
  aiOverage: number;
  /** What this account adds to the bill (fee + charged overage), agency currency. */
  amount: number;
}

export interface AgencyStatement {
  month: string;
  currency: AgencyCurrency;
  model: AgencyBillingModel;
  usdToCurrency: number;
  accounts: number;
  lines: StatementLine[];
  accountFees: number;
  aiCharges: number;
  monthlyFee: number;
  total: number;
  aiCostUsd: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The monthly bill for an agency. Per account: the account fee plus AI use above the allowance,
 * with the markup. "usage" is the same sum with no allowance; "custom" lists the numbers but
 * charges only the fixed monthly fee (the rest is agreed outside the portal).
 * Suspended accounts pay no account fee but their AI use still counts.
 */
export function computeAgencyStatement(input: {
  month: string;
  billing: AgencyBilling;
  usdToInr: number;
  accounts: { businessAccountId: string; name: string; status: string; aiCostUsd: number }[];
}): AgencyStatement {
  const { billing } = input;
  const rate = billing.currency === "INR" ? input.usdToInr : 1;
  const markup = 1 + billing.aiMarkupPercent / 100;
  const included = billing.model === "usage" ? 0 : billing.includedAiPerAccount;
  const charging = billing.model !== "custom";
  const lines: StatementLine[] = input.accounts.map(a => {
    const aiCost = a.aiCostUsd * rate;
    const aiOverage = Math.max(0, aiCost - included);
    const fee = a.status === "active" ? billing.pricePerAccount : 0;
    return {
      businessAccountId: a.businessAccountId,
      name: a.name,
      status: a.status,
      aiCostUsd: round2(a.aiCostUsd),
      aiCost: round2(aiCost),
      aiOverage: round2(aiOverage),
      amount: charging ? round2(fee + aiOverage * markup) : 0,
    };
  });
  const activeCount = input.accounts.filter(a => a.status === "active").length;
  const accountFees = charging ? round2(activeCount * billing.pricePerAccount) : 0;
  const aiCharges = charging ? round2(lines.reduce((s, l) => s + l.aiOverage * markup, 0)) : 0;
  return {
    month: input.month,
    currency: billing.currency,
    model: billing.model,
    usdToCurrency: rate,
    accounts: activeCount,
    lines,
    accountFees,
    aiCharges,
    monthlyFee: round2(billing.monthlyFee),
    total: round2(accountFees + aiCharges + billing.monthlyFee),
    aiCostUsd: round2(input.accounts.reduce((s, a) => s + a.aiCostUsd, 0)),
  };
}

// ── Brand shown to the agency's clients and their visitors ───────────────────

export type WidgetFooterMode = "agency" | "hidden" | "platform";

export interface AgencyBranding {
  /** The name clients know the product by. */
  brandName: string;
  /** Widget footer: the agency's name and link, nothing, or ours. */
  widgetFooter: WidgetFooterMode;
  footerText: string;
  footerUrl: string;
  /** Lead source sent to the client's CRM instead of "AI Chroney". */
  leadSourceName: string;
}

export function resolveAgencyBranding(stored: unknown, agencyName = ""): AgencyBranding {
  const s = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const mode: WidgetFooterMode = s.widgetFooter === "hidden" || s.widgetFooter === "platform" ? s.widgetFooter : "agency";
  const url = str(s.footerUrl, 300);
  return {
    brandName: str(s.brandName, 80) || agencyName,
    widgetFooter: mode,
    footerText: str(s.footerText, 80),
    footerUrl: /^https?:\/\//i.test(url) ? url : "",
    leadSourceName: str(s.leadSourceName, 80),
  };
}

/** What the widget shows at the bottom for an agency client; null = leave the account's own setting. */
export function agencyWidgetFooter(branding: AgencyBranding): { hidden: true } | { hidden: false; text: string; url: string } | null {
  if (branding.widgetFooter === "platform") return null;
  if (branding.widgetFooter === "hidden") return { hidden: true };
  const text = branding.footerText || branding.brandName;
  return text ? { hidden: false, text, url: branding.footerUrl } : { hidden: true };
}

// ── What the portal gets about the agency side of a login ────────────────────

export interface AgencyContextDto {
  agencyId: string;
  agencyName: string;
  brandName: string;
  adminRole: "owner" | "staff";
  permissions: AgencyPermissions;
  /** Set while the agency login is looking at one client's portal. */
  viewingClient: { businessAccountId: string; name: string } | null;
}
