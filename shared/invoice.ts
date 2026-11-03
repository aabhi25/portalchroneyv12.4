/**
 * Invoices raised by us (super admin › Billing): sums, tax split, amount in words, invoice numbers
 * and the billing-list schedule. Shared by the server (which stores the totals) and the pages.
 * Each invoice keeps its own copy of the seller and billed-to details, so later edits never change it.
 */

// ── parties ──────────────────────────────────────────────────────────────────

/** A company on an invoice: the seller ("Billed by") or the customer ("Billed to"). */
export interface InvoiceParty {
  name: string;
  /** Address, one line per row. */
  address: string;
  /** e.g. "Uttar Pradesh"; with the code, used for the place of supply. */
  state: string;
  /** GST state code, e.g. "09". */
  stateCode: string;
  country: string;
  /** PIN / postal code, shown after the country ("India - 201310"). */
  pinCode: string;
  gstin: string;
  pan: string;
  email: string;
  phone: string;
  /** Further tax IDs or lines ("CIN: …", "VAT: …"), shown under the others. */
  extra: { label: string; value: string }[];
}

export interface InvoiceBank {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  /** Further rows, e.g. SWIFT, branch, UPI ID. */
  extra: { label: string; value: string }[];
}

export type InvoiceTaxMode = "split" | "single" | "none";

/** The choices on an invoice besides its lines; a seller keeps defaults for new invoices. */
export interface InvoiceOptions {
  title: string;
  taxMode: InvoiceTaxMode;
  /** Column names: CGST/SGST when split, IGST (or VAT, …) when single. */
  taxLabels: [string, string];
  showHsn: boolean;
  showAmountInWords: boolean;
  /** Round the total to the nearest whole unit, with a "Round off" row. */
  roundTotal: boolean;
  showSignature: boolean;
  signatureLabel: string;
  footer: string;
  accent: string;
}

export const DEFAULT_INVOICE_OPTIONS: InvoiceOptions = {
  title: "Invoice",
  taxMode: "split",
  taxLabels: ["CGST", "SGST"],
  showHsn: true,
  showAmountInWords: true,
  roundTotal: false,
  showSignature: false,
  signatureLabel: "Authorised signatory",
  footer: "This is an electronically generated document, no signature is required.",
  accent: "#f97316",
};

/** Everything a seller ("our company") keeps: details, bank, numbering and defaults for new invoices. */
export interface InvoiceSellerSettings {
  party: InvoiceParty;
  bank: InvoiceBank;
  currency: string;
  /** e.g. "INV{CODE}{MM}{YYYY}/{SEQ:2}" — see INVOICE_NUMBER_TOKENS. */
  numberFormat: string;
  dueDays: number;
  defaultTaxRate: number;
  defaultHsn: string;
  notes: string;
  terms: string;
  options: InvoiceOptions;
}

export function emptyParty(): InvoiceParty {
  return { name: "", address: "", state: "", stateCode: "", country: "India", pinCode: "", gstin: "", pan: "", email: "", phone: "", extra: [] };
}

export function emptyBank(): InvoiceBank {
  return { accountName: "", bankName: "", accountNumber: "", ifsc: "", extra: [] };
}

export const DEFAULT_NUMBER_FORMAT = "INV{CODE}{MM}{YYYY}/{SEQ:2}";

export function defaultSellerSettings(): InvoiceSellerSettings {
  return {
    party: emptyParty(),
    bank: emptyBank(),
    currency: "INR",
    numberFormat: DEFAULT_NUMBER_FORMAT,
    dueDays: 7,
    defaultTaxRate: 18,
    defaultHsn: "998319",
    notes: "",
    terms: "1. This is computer generated invoice, no signature and stamp required",
    options: { ...DEFAULT_INVOICE_OPTIONS },
  };
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const rows = (v: unknown): { label: string; value: string }[] =>
  Array.isArray(v) ? v.slice(0, 10).map(r => ({ label: str((r as any)?.label, 60), value: str((r as any)?.value, 200) })).filter(r => r.label || r.value) : [];

export function resolveParty(v: unknown): InvoiceParty {
  const o = (v ?? {}) as Record<string, unknown>;
  const e = emptyParty();
  return {
    name: str(o.name, 200), address: str(o.address, 600), state: str(o.state, 80), stateCode: str(o.stateCode, 10),
    country: typeof o.country === "string" ? str(o.country, 80) : e.country, pinCode: str(o.pinCode, 20),
    gstin: str(o.gstin, 30), pan: str(o.pan, 20), email: str(o.email, 200), phone: str(o.phone, 40), extra: rows(o.extra),
  };
}

export function resolveBank(v: unknown): InvoiceBank {
  const o = (v ?? {}) as Record<string, unknown>;
  return { accountName: str(o.accountName, 200), bankName: str(o.bankName, 200), accountNumber: str(o.accountNumber, 60), ifsc: str(o.ifsc, 30), extra: rows(o.extra) };
}

export function resolveOptions(v: unknown, base: InvoiceOptions = DEFAULT_INVOICE_OPTIONS): InvoiceOptions {
  const o = (v ?? {}) as Record<string, unknown>;
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const labels = Array.isArray(o.taxLabels) ? o.taxLabels : base.taxLabels;
  return {
    title: str(o.title, 60) || base.title,
    taxMode: o.taxMode === "split" || o.taxMode === "single" || o.taxMode === "none" ? o.taxMode : base.taxMode,
    taxLabels: [str(labels[0], 20) || base.taxLabels[0], str(labels[1], 20) || base.taxLabels[1]],
    showHsn: bool(o.showHsn, base.showHsn),
    showAmountInWords: bool(o.showAmountInWords, base.showAmountInWords),
    roundTotal: bool(o.roundTotal, base.roundTotal),
    showSignature: bool(o.showSignature, base.showSignature),
    signatureLabel: typeof o.signatureLabel === "string" ? str(o.signatureLabel, 80) : base.signatureLabel,
    footer: typeof o.footer === "string" ? str(o.footer, 300) : base.footer,
    accent: typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : base.accent,
  };
}

export function resolveSellerSettings(v: unknown): InvoiceSellerSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const d = defaultSellerSettings();
  return {
    party: resolveParty(o.party),
    bank: resolveBank(o.bank),
    currency: isCurrency(o.currency) ? o.currency : d.currency,
    numberFormat: str(o.numberFormat, 80) || d.numberFormat,
    dueDays: Math.max(0, Math.min(365, Math.round(num(o.dueDays, d.dueDays)))),
    defaultTaxRate: Math.max(0, Math.min(100, num(o.defaultTaxRate, d.defaultTaxRate))),
    defaultHsn: typeof o.defaultHsn === "string" ? str(o.defaultHsn, 20) : d.defaultHsn,
    notes: typeof o.notes === "string" ? str(o.notes, 4000) : d.notes,
    terms: typeof o.terms === "string" ? str(o.terms, 4000) : d.terms,
    options: resolveOptions(o.options),
  };
}

// ── currencies ───────────────────────────────────────────────────────────────

export interface InvoiceCurrency {
  code: string;
  symbol: string;
  locale: string;
  /** For the amount in words: "Rupees … and … Paise Only". */
  major: string;
  minor: string;
  /** Lakh/crore (Indian) or million/billion grouping in words. */
  indianWords: boolean;
}

export const INVOICE_CURRENCIES: InvoiceCurrency[] = [
  { code: "INR", symbol: "₹", locale: "en-IN", major: "Rupees", minor: "Paise", indianWords: true },
  { code: "USD", symbol: "$", locale: "en-US", major: "US Dollars", minor: "Cents", indianWords: false },
  { code: "EUR", symbol: "€", locale: "en-IE", major: "Euros", minor: "Cents", indianWords: false },
  { code: "GBP", symbol: "£", locale: "en-GB", major: "Pounds", minor: "Pence", indianWords: false },
  { code: "AED", symbol: "AED ", locale: "en-AE", major: "Dirhams", minor: "Fils", indianWords: false },
  { code: "SGD", symbol: "S$", locale: "en-SG", major: "Singapore Dollars", minor: "Cents", indianWords: false },
  { code: "AUD", symbol: "A$", locale: "en-AU", major: "Australian Dollars", minor: "Cents", indianWords: false },
  { code: "CAD", symbol: "C$", locale: "en-CA", major: "Canadian Dollars", minor: "Cents", indianWords: false },
];

export function isCurrency(v: unknown): v is string {
  return typeof v === "string" && INVOICE_CURRENCIES.some(c => c.code === v);
}

export function invoiceCurrency(code: string): InvoiceCurrency {
  return INVOICE_CURRENCIES.find(c => c.code === code) ?? INVOICE_CURRENCIES[0];
}

/** "₹10,440.00" */
export function formatInvoiceMoney(amount: number, code: string): string {
  const c = invoiceCurrency(code);
  return `${amount < 0 ? "-" : ""}${c.symbol}${Math.abs(amount).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "10,440" or "18.5": a plain number as typed (rate and quantity columns). */
export function formatInvoiceNumber(n: number, code: string): string {
  return n.toLocaleString(invoiceCurrency(code).locale, { maximumFractionDigits: 4 });
}

// ── lines and totals ─────────────────────────────────────────────────────────

export interface InvoiceLine {
  item: string;
  /** Second line under the item, e.g. "(Lead Generation)". */
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  taxRate: number;
}

export function resolveLines(v: unknown): InvoiceLine[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 100).map(l => {
    const o = (l ?? {}) as Record<string, unknown>;
    return {
      item: str(o.item, 300), description: str(o.description, 600), hsn: str(o.hsn, 20),
      qty: num(o.qty, 0), rate: num(o.rate, 0), taxRate: Math.max(0, Math.min(100, num(o.taxRate, 0))),
    };
  });
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceLineTotals {
  amount: number;
  tax1: number;
  tax2: number;
  total: number;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotals[];
  amount: number;
  tax1: number;
  tax2: number;
  roundOff: number;
  total: number;
}

/** Line amounts, tax per column (split = half each, rounded per line) and the invoice totals. */
export function computeInvoiceTotals(lines: InvoiceLine[], taxMode: InvoiceTaxMode, roundTotal = false): InvoiceTotals {
  const out = lines.map(l => {
    const amount = round2(l.qty * l.rate);
    const tax = taxMode === "none" ? 0 : amount * l.taxRate / 100;
    const tax1 = taxMode === "split" ? round2(tax / 2) : round2(tax);
    const tax2 = taxMode === "split" ? round2(tax / 2) : 0;
    return { amount, tax1, tax2, total: round2(amount + tax1 + tax2) };
  });
  const sum = (k: keyof InvoiceLineTotals) => round2(out.reduce((s, l) => s + l[k], 0));
  const exact = sum("total");
  const total = roundTotal ? Math.round(exact) : exact;
  return { lines: out, amount: sum("amount"), tax1: sum("tax1"), tax2: sum("tax2"), roundOff: round2(total - exact), total };
}

/** The tax a line pays in each column, as a rate ("9%" each when split). */
export function lineTaxRateLabel(taxRate: number, taxMode: InvoiceTaxMode): string {
  if (taxMode === "none") return "";
  const r = taxMode === "split" ? taxRate / 2 : taxRate;
  return `${Number(r.toFixed(3))}%`;
}

/** Same state → CGST + SGST; another Indian state → IGST; abroad → no tax. */
export function suggestTaxMode(seller: InvoiceParty, buyer: InvoiceParty): { taxMode: InvoiceTaxMode; taxLabels: [string, string] } {
  const india = (c: string) => !c.trim() || /^india$/i.test(c.trim());
  if (!india(buyer.country)) return { taxMode: "none", taxLabels: ["IGST", "SGST"] };
  const same = (seller.stateCode && buyer.stateCode && seller.stateCode.trim() === buyer.stateCode.trim())
    || (!!seller.state.trim() && seller.state.trim().toLowerCase() === buyer.state.trim().toLowerCase());
  return same ? { taxMode: "split", taxLabels: ["CGST", "SGST"] } : { taxMode: "single", taxLabels: ["IGST", "SGST"] };
}

// ── amount in words ──────────────────────────────────────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

function wholeInWords(n: number, indian: boolean): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  if (indian) {
    const crore = Math.floor(n / 1e7);
    if (crore) parts.push(`${wholeInWords(crore, true)} Crore`);
    n %= 1e7;
    const lakh = Math.floor(n / 1e5);
    if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
    n %= 1e5;
    const thousand = Math.floor(n / 1000);
    if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
    n %= 1000;
    if (n) parts.push(belowThousand(n));
    return parts.join(" ");
  }
  const scales = ["", "Thousand", "Million", "Billion", "Trillion"];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${belowThousand(chunk)}${scales[i] ? ` ${scales[i]}` : ""}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(" ");
}

/** "Rupees Fifty Three Thousand Four Hundred Fifty Four Only" (with "and … Paise" when there are any). */
export function amountInWords(amount: number, code: string): string {
  const c = invoiceCurrency(code);
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const minor = cents % 100;
  const words = `${c.major} ${wholeInWords(whole, c.indianWords)}${minor ? ` and ${belowThousand(minor)} ${c.minor}` : ""} Only`;
  return amount < 0 ? `Minus ${words}` : words;
}

// ── dates ────────────────────────────────────────────────────────────────────

/** Dates are plain "YYYY-MM-DD" strings (no time zone). */
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(d: string, days: number): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + days);
  return fromUtc(x);
}

/** Adds whole months, keeping the day where the month allows (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, months: number): string {
  const x = toUtc(d);
  const day = x.getUTCDate();
  const target = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fromUtc(target);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

/** "01/11/2026" — the layout of the reference invoice. */
export function formatInvoiceDate(d: string | null | undefined): string {
  if (!d || !isIsoDate(d)) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/** "1 Sept 2026 – 30 Sept 2026", or "September 2026" for a whole calendar month. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "";
  const long = (d: string, opts: Intl.DateTimeFormatOptions) => toUtc(d).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
  if (start.endsWith("-01") && addDays(end, 1).endsWith("-01") && daysBetween(start, end) < 31) {
    return long(start, { month: "long", year: "numeric" });
  }
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  return `${long(start, o)} – ${long(end, o)}`;
}

/** Today in India, as "YYYY-MM-DD". */
export function todayIst(now = new Date()): string {
  return fromUtc(new Date(now.getTime() + 330 * 60000));
}

// ── invoice numbers ──────────────────────────────────────────────────────────

export const INVOICE_NUMBER_TOKENS: { token: string; meaning: string }[] = [
  { token: "{SEQ}", meaning: "running number (next free one for the rest of the pattern); {SEQ:3} pads it to 3 digits" },
  { token: "{CODE}", meaning: "the customer's short code from the billing list (e.g. J for Jaro)" },
  { token: "{MM}", meaning: "month of the billing period (or of the invoice date)" },
  { token: "{YYYY}", meaning: "year of the billing period (or of the invoice date); {YY} for two digits" },
  { token: "{FY}", meaning: "Indian financial year of the invoice date, e.g. 2026-27" },
];

export interface NumberContext {
  code: string;
  invoiceDate: string;
  periodStart?: string | null;
}

function fillTokens(format: string, ctx: NumberContext): string {
  const base = ctx.periodStart && isIsoDate(ctx.periodStart) ? ctx.periodStart : ctx.invoiceDate;
  const [y, m] = base.split("-");
  const [iy, im] = ctx.invoiceDate.split("-").map(Number);
  const fyStart = im >= 4 ? iy : iy - 1;
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  return format
    .replace(/\{CODE\}/g, ctx.code.trim().toUpperCase())
    .replace(/\{MM\}/g, m)
    .replace(/\{YYYY\}/g, y)
    .replace(/\{YY\}/g, y.slice(2))
    .replace(/\{FY\}/g, fy);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The next invoice number for a pattern: tokens filled in, and {SEQ} one more than the highest
 * existing number that matches the same pattern (so "{MM}{YYYY}/{SEQ}" restarts every month and
 * "{FY}/{SEQ}" every financial year). Without {SEQ}, a "-2", "-3"… is added if the number is taken.
 */
export function nextInvoiceNumber(format: string, ctx: NumberContext, existing: string[]): string {
  const filled = fillTokens(format || DEFAULT_NUMBER_FORMAT, ctx);
  const seq = /\{SEQ(?::(\d))?\}/.exec(filled);
  const taken = new Set(existing.map(n => n.trim().toUpperCase()));
  if (!seq) {
    if (!taken.has(filled.toUpperCase())) return filled;
    for (let i = 2; ; i++) if (!taken.has(`${filled}-${i}`.toUpperCase())) return `${filled}-${i}`;
  }
  const pad = seq[1] ? Number(seq[1]) : 1;
  const before = filled.slice(0, seq.index);
  const after = filled.slice(seq.index + seq[0].length).replace(/\{SEQ(?::\d)?\}/g, "");
  const re = new RegExp(`^${escapeRe(before)}(\\d+)${escapeRe(after)}$`, "i");
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${before}${String(max + 1).padStart(pad, "0")}${after}`;
}

// ── billing list (who we bill, how often, when the next invoice is due) ──────

export type BillingCycle = "monthly" | "quarterly" | "half_yearly" | "yearly" | "one_time";

export const BILLING_CYCLES: { key: BillingCycle; label: string; months: number }[] = [
  { key: "monthly", label: "Every month", months: 1 },
  { key: "quarterly", label: "Every 3 months", months: 3 },
  { key: "half_yearly", label: "Every 6 months", months: 6 },
  { key: "yearly", label: "Every year", months: 12 },
  { key: "one_time", label: "One time", months: 0 },
];

export type BillingTiming = "after" | "before";

export interface BillingSchedule {
  cycle: BillingCycle;
  /** First day of the first billing period. */
  startDate: string;
  /** "after": bill for a period once it ends (arrears); "before": at its start (advance). */
  timing: BillingTiming;
  /** Days after the period ends ("after") or starts ("before") to raise the invoice. */
  raiseAfterDays: number;
}

export interface NextBilling {
  /** null when a one-time customer has been invoiced already. */
  periodStart: string | null;
  periodEnd: string | null;
  raiseOn: string | null;
  /** Days from today to raiseOn (negative = late). */
  daysLeft: number | null;
  state: "upcoming" | "due" | "late" | "done";
}

/** The next period to bill: the one after the last invoiced period, or the first one. */
export function nextBilling(s: BillingSchedule, lastPeriodEnd: string | null, today: string, invoicedOnce = false): NextBilling {
  const months = BILLING_CYCLES.find(c => c.key === s.cycle)?.months ?? 1;
  if (months === 0 && (invoicedOnce || lastPeriodEnd)) return { periodStart: null, periodEnd: null, raiseOn: null, daysLeft: null, state: "done" };
  // Step through the cycle from the start date, so periods stay aligned (and a 31st start keeps its day).
  let k = 0;
  if (months > 0 && lastPeriodEnd) {
    while (addMonths(s.startDate, k * months) <= lastPeriodEnd && k < 1200) k++;
  }
  const periodStart = months > 0 ? addMonths(s.startDate, k * months) : s.startDate;
  const periodEnd = months > 0 ? addDays(addMonths(s.startDate, (k + 1) * months), -1) : periodStart;
  const raiseOn = addDays(s.timing === "before" ? periodStart : periodEnd, s.raiseAfterDays);
  const daysLeft = daysBetween(today, raiseOn);
  return { periodStart, periodEnd, raiseOn, daysLeft, state: daysLeft > 0 ? "upcoming" : daysLeft === 0 ? "due" : "late" };
}

// ── statuses ─────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["draft", "sent", "paid", "cancelled"] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", paid: "Paid", cancelled: "Cancelled",
};

// ── one invoice, as the pages and the API exchange it ────────────────────────

export interface InvoiceSellerCopy {
  party: InvoiceParty;
  bank: InvoiceBank;
  /** data: URL, copied so the invoice keeps its logo. */
  logoData: string | null;
}

export interface InvoiceDto {
  id: string | null;
  number: string;
  status: InvoiceStatus;
  sellerId: string | null;
  customerId: string | null;
  businessAccountId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  seller: InvoiceSellerCopy;
  billedTo: InvoiceParty;
  placeOfSupply: string;
  countryOfSupply: string;
  lines: InvoiceLine[];
  options: InvoiceOptions;
  notes: string;
  terms: string;
}

export function resolveSellerCopy(v: unknown): InvoiceSellerCopy {
  const o = (v ?? {}) as Record<string, unknown>;
  const logo = typeof o.logoData === "string" && o.logoData.startsWith("data:image/") ? o.logoData : null;
  return { party: resolveParty(o.party), bank: resolveBank(o.bank), logoData: logo };
}

/** "Uttar Pradesh (09)" */
export function placeOfSupplyFor(p: InvoiceParty): string {
  return p.state ? `${p.state}${p.stateCode ? ` (${p.stateCode})` : ""}` : "";
}

/** A blank invoice from a seller's defaults (the pages then fill in the customer). */
export function blankInvoice(sellerId: string | null, s: InvoiceSellerSettings, logoData: string | null, today: string): InvoiceDto {
  return {
    id: null, number: "", status: "draft", sellerId, customerId: null, businessAccountId: null,
    invoiceDate: today, dueDate: addDays(today, s.dueDays), periodStart: null, periodEnd: null,
    currency: s.currency,
    seller: { party: s.party, bank: s.bank, logoData },
    billedTo: emptyParty(), placeOfSupply: "", countryOfSupply: "India",
    lines: [{ item: "", description: "", hsn: s.defaultHsn, qty: 1, rate: 0, taxRate: s.defaultTaxRate }],
    options: { ...s.options }, notes: s.notes, terms: s.terms,
  };
}

// ── reading an existing invoice (PDF or photo) with AI ───────────────────────

/** What the AI read from an uploaded invoice, already cleaned; the pages choose what to apply. */
export interface InvoiceReadResult {
  number: string;
  invoiceDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  /** The company that issued it ("Billed by", "From", the vendor). */
  seller: InvoiceParty;
  bank: InvoiceBank;
  billedTo: InvoiceParty;
  placeOfSupply: string;
  countryOfSupply: string;
  taxMode: InvoiceTaxMode;
  taxLabels: [string, string];
  lines: InvoiceLine[];
  notes: string;
  terms: string;
  /** The grand total printed on it, to check the lines against. */
  printedTotal: number | null;
  /** Plain checks for the person to glance at (e.g. "Lines add up to the printed total"). */
  checks: { ok: boolean; text: string }[];
}

export type InvoiceReadSection = "seller" | "billedTo" | "details" | "lines" | "notes";

export const INVOICE_READ_SECTIONS: { key: InvoiceReadSection; label: string }[] = [
  { key: "seller", label: "Billed by and bank details" },
  { key: "billedTo", label: "Billed to" },
  { key: "details", label: "Number, dates, period, currency and tax" },
  { key: "lines", label: "Lines" },
  { key: "notes", label: "Notes and terms" },
];

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Checks a read invoice: do the lines add up, do the GSTIN and IFSC look right. */
export function invoiceReadChecks(r: Omit<InvoiceReadResult, "checks">): { ok: boolean; text: string }[] {
  const out: { ok: boolean; text: string }[] = [];
  const code = r.currency ?? "INR";
  if (r.lines.length && r.printedTotal !== null) {
    const t = computeInvoiceTotals(r.lines, r.taxMode).total;
    const diff = Math.abs(t - r.printedTotal);
    out.push(diff <= 1
      ? { ok: true, text: `The lines add up to the total printed on it (${formatInvoiceMoney(r.printedTotal, code)}).` }
      : { ok: false, text: `The lines add up to ${formatInvoiceMoney(t, code)}, but the total printed on it is ${formatInvoiceMoney(r.printedTotal, code)}. Check the lines and tax.` });
  } else if (!r.lines.length) {
    out.push({ ok: false, text: "No lines were found." });
  }
  for (const [who, p] of [["Billed by", r.seller], ["Billed to", r.billedTo]] as const) {
    if (p.gstin && !GSTIN_RE.test(p.gstin)) out.push({ ok: false, text: `${who} GSTIN "${p.gstin}" doesn't look like a valid GSTIN.` });
  }
  if (r.bank.ifsc && !IFSC_RE.test(r.bank.ifsc)) out.push({ ok: false, text: `IFSC "${r.bank.ifsc}" doesn't look right.` });
  if (!r.seller.name) out.push({ ok: false, text: "The company that issued it wasn't found." });
  if (!r.billedTo.name) out.push({ ok: false, text: "Who it's billed to wasn't found." });
  return out;
}
