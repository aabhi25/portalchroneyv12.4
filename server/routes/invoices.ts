import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { billingCustomers, businessAccounts, invoiceSellers, invoices, type BillingCustomer, type Invoice, type InvoiceSeller } from "@shared/schema";
import {
  BILLING_CYCLES,
  INVOICE_STATUSES,
  addDays,
  blankInvoice,
  computeInvoiceTotals,
  isCurrency,
  isIsoDate,
  nextBilling,
  nextInvoiceNumber,
  placeOfSupplyFor,
  resolveLines,
  resolveOptions,
  resolveParty,
  resolveSellerCopy,
  resolveSellerSettings,
  suggestTaxMode,
  todayIst,
  type BillingCycle,
  type InvoiceDto,
  type InvoiceStatus,
} from "@shared/invoice";
import { requireAuth, requireRole } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";

/**
 * Invoices we raise, for super admins only (super admin › Billing):
 *  /api/super-admin/billing/sellers     our company details ("Billed by"), bank, numbering, defaults
 *  /api/super-admin/billing/customers   the billing list: who we bill, how often, next invoice due
 *  /api/super-admin/billing/invoices    invoices, each with its own copy of every detail
 * Sums and schedules are in shared/invoice.ts; the PDF is drawn by the browser from the same data.
 */
const router = Router();
const superAdmin = [requireAuth, requireRole("super_admin")];

const LOGO_MAX_BYTES = 300 * 1024;
const isoDate = z.string().refine(isIsoDate, "Use a valid date");

function sellerView(s: InvoiceSeller) {
  return { id: s.id, label: s.label, isDefault: s.isDefault, settings: resolveSellerSettings(s.settings), logoData: s.logoData };
}

async function getSeller(id: string | null | undefined): Promise<InvoiceSeller | null> {
  if (!id) return null;
  const [s] = await db.select().from(invoiceSellers).where(eq(invoiceSellers.id, id));
  return s ?? null;
}

async function defaultSeller(): Promise<InvoiceSeller | null> {
  const [s] = await db.select().from(invoiceSellers).orderBy(desc(invoiceSellers.isDefault), invoiceSellers.createdAt).limit(1);
  return s ?? null;
}

function fail(res: Response, where: string, error: unknown, message: string) {
  console.error(`[Billing] ${where} error:`, error);
  res.status(500).json({ error: message });
}

// ── our company details ──────────────────────────────────────────────────────

router.get("/api/super-admin/billing/sellers", ...superAdmin, async (_req, res) => {
  try {
    const list = await db.select().from(invoiceSellers).orderBy(desc(invoiceSellers.isDefault), invoiceSellers.label);
    res.json({ sellers: list.map(sellerView) });
  } catch (error) { fail(res, "sellers", error, "Failed to load your company details"); }
});

const sellerBody = z.object({
  label: z.string().trim().min(1, "Give it a name").max(120),
  settings: z.unknown(),
  isDefault: z.boolean(),
}).partial();

router.post("/api/super-admin/billing/sellers", ...superAdmin, async (req, res) => {
  try {
    const parsed = sellerBody.required({ label: true }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    const settings = resolveSellerSettings(parsed.data.settings ?? { party: { name: parsed.data.label } });
    if (!settings.party.name) settings.party.name = parsed.data.label;
    const first = !(await defaultSeller());
    const [s] = await db.insert(invoiceSellers).values({
      label: parsed.data.label, settings: settings as unknown as Record<string, unknown>, isDefault: first || !!parsed.data.isDefault,
    }).returning();
    if (s.isDefault && !first) await db.update(invoiceSellers).set({ isDefault: false }).where(ne(invoiceSellers.id, s.id));
    await recordAuditEventSafely(req, { action: "billing.seller_created", outcome: "success", resourceType: "invoice_seller", resourceId: s.id, metadata: { label: s.label } });
    res.json({ seller: sellerView(s) });
  } catch (error) { fail(res, "seller create", error, "Failed to save your company details"); }
});

router.patch("/api/super-admin/billing/sellers/:id", ...superAdmin, async (req, res) => {
  try {
    const seller = await getSeller(req.params.id);
    if (!seller) return res.status(404).json({ error: "Not found" });
    const parsed = sellerBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    const b = parsed.data;
    const updates: Partial<typeof invoiceSellers.$inferInsert> = { updatedAt: new Date() };
    if (b.label !== undefined) updates.label = b.label;
    if (b.settings !== undefined) updates.settings = resolveSellerSettings(b.settings) as unknown as Record<string, unknown>;
    if (b.isDefault === true) updates.isDefault = true;
    const [after] = await db.update(invoiceSellers).set(updates).where(eq(invoiceSellers.id, seller.id)).returning();
    if (b.isDefault === true) await db.update(invoiceSellers).set({ isDefault: false }).where(ne(invoiceSellers.id, seller.id));
    await recordAuditEventSafely(req, { action: "billing.seller_updated", outcome: "success", resourceType: "invoice_seller", resourceId: seller.id, metadata: { changed: Object.keys(b) } });
    res.json({ seller: sellerView(after) });
  } catch (error) { fail(res, "seller update", error, "Failed to save your company details"); }
});

router.put("/api/super-admin/billing/sellers/:id/logo", ...superAdmin, async (req, res) => {
  try {
    const seller = await getSeller(req.params.id);
    if (!seller) return res.status(404).json({ error: "Not found" });
    const input = req.body?.logo ?? null;
    let logoData: string | null = null;
    if (input !== null && input !== "") {
      const m = typeof input === "string" ? /^data:image\/(png|jpeg|webp|svg\+xml);base64,([a-z0-9+/=]+)$/i.exec(input) : null;
      if (!m) return res.status(400).json({ error: "Upload a PNG, JPG, WebP or SVG image" });
      if (Buffer.from(m[2], "base64").length > LOGO_MAX_BYTES) return res.status(400).json({ error: "The logo must be 300 KB or smaller" });
      logoData = input;
    }
    const [after] = await db.update(invoiceSellers).set({ logoData, updatedAt: new Date() }).where(eq(invoiceSellers.id, seller.id)).returning();
    res.json({ seller: sellerView(after) });
  } catch (error) { fail(res, "seller logo", error, "Failed to save the logo"); }
});

router.delete("/api/super-admin/billing/sellers/:id", ...superAdmin, async (req, res) => {
  try {
    const seller = await getSeller(req.params.id);
    if (!seller) return res.status(404).json({ error: "Not found" });
    // Invoices keep their own copy of these details, so they are unaffected.
    await db.delete(invoiceSellers).where(eq(invoiceSellers.id, seller.id));
    if (seller.isDefault) {
      const next = await defaultSeller();
      if (next) await db.update(invoiceSellers).set({ isDefault: true }).where(eq(invoiceSellers.id, next.id));
    }
    await recordAuditEventSafely(req, { action: "billing.seller_deleted", outcome: "success", resourceType: "invoice_seller", resourceId: seller.id, metadata: { label: seller.label } });
    res.json({ deleted: true });
  } catch (error) { fail(res, "seller delete", error, "Failed to delete"); }
});

// ── Chroney accounts to pick from ────────────────────────────────────────────

router.get("/api/super-admin/billing/accounts", ...superAdmin, async (_req, res) => {
  try {
    const list = await db.select({ id: businessAccounts.id, name: businessAccounts.name, website: businessAccounts.website })
      .from(businessAccounts).orderBy(businessAccounts.name);
    res.json({ accounts: list });
  } catch (error) { fail(res, "accounts", error, "Failed to load accounts"); }
});

// ── billing list ─────────────────────────────────────────────────────────────

const cycleKeys = BILLING_CYCLES.map(c => c.key) as [BillingCycle, ...BillingCycle[]];
const customerBody = z.object({
  businessAccountId: z.string().nullable(),
  sellerId: z.string().nullable(),
  code: z.string().trim().max(20),
  billedTo: z.unknown(),
  cycle: z.enum(cycleKeys),
  startDate: isoDate,
  timing: z.enum(["after", "before"]),
  raiseAfterDays: z.number().int().min(-60).max(120),
  dueDays: z.number().int().min(0).max(365).nullable(),
  currency: z.string().nullable().refine(v => v === null || isCurrency(v), "Unknown currency"),
  lines: z.unknown(),
  notes: z.string().max(4000).nullable(),
  active: z.boolean(),
}).partial();

function customerUpdates(b: z.infer<typeof customerBody>): Partial<typeof billingCustomers.$inferInsert> {
  const u: Partial<typeof billingCustomers.$inferInsert> = {};
  if (b.businessAccountId !== undefined) u.businessAccountId = b.businessAccountId || null;
  if (b.sellerId !== undefined) u.sellerId = b.sellerId || null;
  if (b.code !== undefined) u.code = b.code;
  if (b.billedTo !== undefined) u.billedTo = resolveParty(b.billedTo) as unknown as Record<string, unknown>;
  if (b.cycle !== undefined) u.cycle = b.cycle;
  if (b.startDate !== undefined) u.startDate = b.startDate;
  if (b.timing !== undefined) u.timing = b.timing;
  if (b.raiseAfterDays !== undefined) u.raiseAfterDays = b.raiseAfterDays;
  if (b.dueDays !== undefined) u.dueDays = b.dueDays;
  if (b.currency !== undefined) u.currency = b.currency;
  if (b.lines !== undefined) u.lines = resolveLines(b.lines) as unknown as Record<string, unknown>[];
  if (b.notes !== undefined) u.notes = b.notes;
  if (b.active !== undefined) u.active = b.active;
  return u;
}

function customerView(c: BillingCustomer, stats: CustomerStats | undefined, today: string) {
  const schedule = { cycle: c.cycle as BillingCycle, startDate: c.startDate, timing: (c.timing === "before" ? "before" : "after") as "after" | "before", raiseAfterDays: c.raiseAfterDays };
  return {
    id: c.id, businessAccountId: c.businessAccountId, sellerId: c.sellerId, code: c.code,
    billedTo: resolveParty(c.billedTo), ...schedule, dueDays: c.dueDays, currency: c.currency,
    lines: resolveLines(c.lines), notes: c.notes, active: c.active,
    next: c.active ? nextBilling(schedule, stats?.lastPeriodEnd ?? null, today, (stats?.count ?? 0) > 0) : null,
    lastInvoice: stats?.last ?? null,
    unpaid: stats?.unpaid ?? 0,
  };
}

interface CustomerStats {
  count: number;
  lastPeriodEnd: string | null;
  last: { id: string; number: string; invoiceDate: string; total: number; currency: string; status: string } | null;
  unpaid: number;
}

async function customerStats(ids: string[]): Promise<Map<string, CustomerStats>> {
  const out = new Map<string, CustomerStats>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: invoices.id, customerId: invoices.customerId, number: invoices.number, status: invoices.status,
    invoiceDate: invoices.invoiceDate, periodEnd: invoices.periodEnd, total: invoices.total, currency: invoices.currency,
  }).from(invoices).where(and(inArray(invoices.customerId, ids), ne(invoices.status, "cancelled")))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt));
  for (const r of rows) {
    const s = out.get(r.customerId!) ?? { count: 0, lastPeriodEnd: null, last: null, unpaid: 0 };
    s.count++;
    if (r.periodEnd && (!s.lastPeriodEnd || r.periodEnd > s.lastPeriodEnd)) s.lastPeriodEnd = r.periodEnd;
    if (!s.last) s.last = { id: r.id, number: r.number, invoiceDate: r.invoiceDate, total: Number(r.total), currency: r.currency, status: r.status };
    if (r.status === "sent") s.unpaid = Math.round((s.unpaid + Number(r.total)) * 100) / 100;
    out.set(r.customerId!, s);
  }
  return out;
}

router.get("/api/super-admin/billing/customers", ...superAdmin, async (_req, res) => {
  try {
    const list = await db.select().from(billingCustomers).orderBy(billingCustomers.createdAt);
    const stats = await customerStats(list.map(c => c.id));
    const today = todayIst();
    res.json({ today, customers: list.map(c => customerView(c, stats.get(c.id), today)) });
  } catch (error) { fail(res, "customers", error, "Failed to load the billing list"); }
});

router.post("/api/super-admin/billing/customers", ...superAdmin, async (req, res) => {
  try {
    const parsed = customerBody.required({ startDate: true }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    const u = customerUpdates(parsed.data);
    if (!resolveParty(u.billedTo).name) return res.status(400).json({ error: "Enter the customer's name" });
    const [c] = await db.insert(billingCustomers).values({ ...u, startDate: parsed.data.startDate }).returning();
    await recordAuditEventSafely(req, { action: "billing.customer_created", outcome: "success", resourceType: "billing_customer", resourceId: c.id });
    res.json({ customer: customerView(c, undefined, todayIst()) });
  } catch (error) { fail(res, "customer create", error, "Failed to save"); }
});

router.patch("/api/super-admin/billing/customers/:id", ...superAdmin, async (req, res) => {
  try {
    const parsed = customerBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    const u = customerUpdates(parsed.data);
    if (u.billedTo && !resolveParty(u.billedTo).name) return res.status(400).json({ error: "Enter the customer's name" });
    const [c] = await db.update(billingCustomers).set({ ...u, updatedAt: new Date() }).where(eq(billingCustomers.id, req.params.id)).returning();
    if (!c) return res.status(404).json({ error: "Not found" });
    await recordAuditEventSafely(req, { action: "billing.customer_updated", outcome: "success", resourceType: "billing_customer", resourceId: c.id, metadata: { changed: Object.keys(parsed.data) } });
    const stats = await customerStats([c.id]);
    res.json({ customer: customerView(c, stats.get(c.id), todayIst()) });
  } catch (error) { fail(res, "customer update", error, "Failed to save"); }
});

router.delete("/api/super-admin/billing/customers/:id", ...superAdmin, async (req, res) => {
  try {
    // Its invoices stay (customer_id is cleared).
    const [c] = await db.delete(billingCustomers).where(eq(billingCustomers.id, req.params.id)).returning();
    if (!c) return res.status(404).json({ error: "Not found" });
    await recordAuditEventSafely(req, { action: "billing.customer_deleted", outcome: "success", resourceType: "billing_customer", resourceId: c.id });
    res.json({ deleted: true });
  } catch (error) { fail(res, "customer delete", error, "Failed to delete"); }
});

// ── invoices ─────────────────────────────────────────────────────────────────

function invoiceView(i: Invoice): InvoiceDto & { createdAt: Date; updatedAt: Date } {
  return {
    id: i.id, number: i.number, status: (INVOICE_STATUSES as readonly string[]).includes(i.status) ? i.status as InvoiceStatus : "draft",
    sellerId: i.sellerId, customerId: i.customerId, businessAccountId: i.businessAccountId,
    invoiceDate: i.invoiceDate, dueDate: i.dueDate, periodStart: i.periodStart, periodEnd: i.periodEnd,
    currency: i.currency, seller: resolveSellerCopy(i.seller), billedTo: resolveParty(i.billedTo),
    placeOfSupply: i.placeOfSupply, countryOfSupply: i.countryOfSupply,
    lines: resolveLines(i.lines), options: resolveOptions(i.options), notes: i.notes, terms: i.terms,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}

async function numbersInUse(excludeId?: string | null): Promise<string[]> {
  const rows = await db.select({ number: invoices.number }).from(invoices)
    .where(excludeId ? ne(invoices.id, excludeId) : undefined);
  return rows.map(r => r.number);
}

async function suggestNumber(sellerId: string | null, code: string, invoiceDate: string, periodStart: string | null, excludeId?: string | null): Promise<string> {
  const seller = (await getSeller(sellerId)) ?? (await defaultSeller());
  const format = resolveSellerSettings(seller?.settings).numberFormat;
  return nextInvoiceNumber(format, { code, invoiceDate, periodStart }, await numbersInUse(excludeId));
}

router.get("/api/super-admin/billing/invoices", ...superAdmin, async (_req, res) => {
  try {
    // Not the seller copy (it carries the logo).
    const list = await db.select({
      id: invoices.id, number: invoices.number, status: invoices.status, customerId: invoices.customerId,
      billedTo: invoices.billedTo, invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate,
      periodStart: invoices.periodStart, periodEnd: invoices.periodEnd, currency: invoices.currency,
      amount: invoices.amount, tax: invoices.tax, total: invoices.total, paidAt: invoices.paidAt,
      sellerName: sql<string>`${invoices.seller}->'party'->>'name'`,
    }).from(invoices).orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt));
    res.json({
      today: todayIst(),
      invoices: list.map(i => ({
        ...i, billedToName: resolveParty(i.billedTo).name, billedTo: undefined,
        amount: Number(i.amount), tax: Number(i.tax), total: Number(i.total), sellerName: i.sellerName ?? "",
      })),
    });
  } catch (error) { fail(res, "invoices", error, "Failed to load invoices"); }
});

/** A new invoice filled in from a billing-list customer, a Chroney account or just our details. */
router.get("/api/super-admin/billing/invoices/new", ...superAdmin, async (req, res) => {
  try {
    const today = todayIst();
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : null;
    const [customer] = customerId ? await db.select().from(billingCustomers).where(eq(billingCustomers.id, customerId)) : [];
    const seller = (await getSeller(customer?.sellerId)) ?? (await defaultSeller());
    const s = resolveSellerSettings(seller?.settings);
    const draft = blankInvoice(seller?.id ?? null, s, seller?.logoData ?? null, today);
    if (customer) {
      const stats = (await customerStats([customer.id])).get(customer.id);
      const next = nextBilling(
        { cycle: customer.cycle as BillingCycle, startDate: customer.startDate, timing: customer.timing === "before" ? "before" : "after", raiseAfterDays: customer.raiseAfterDays },
        stats?.lastPeriodEnd ?? null, today, (stats?.count ?? 0) > 0,
      );
      draft.customerId = customer.id;
      draft.businessAccountId = customer.businessAccountId;
      draft.billedTo = resolveParty(customer.billedTo);
      if (customer.currency && isCurrency(customer.currency)) draft.currency = customer.currency;
      draft.periodStart = next.periodStart;
      draft.periodEnd = next.periodEnd;
      draft.dueDate = addDays(today, customer.dueDays ?? s.dueDays);
      const lines = resolveLines(customer.lines);
      if (lines.length) draft.lines = lines;
      if (customer.notes !== null) draft.notes = customer.notes;
    }
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
    if (!customer && accountId) {
      const [acc] = await db.select({ id: businessAccounts.id, name: businessAccounts.name }).from(businessAccounts).where(eq(businessAccounts.id, accountId));
      if (acc) { draft.businessAccountId = acc.id; draft.billedTo.name = acc.name; }
    }
    const tax = suggestTaxMode(draft.seller.party, draft.billedTo);
    draft.options = { ...draft.options, ...tax };
    draft.placeOfSupply = placeOfSupplyFor(draft.billedTo);
    draft.countryOfSupply = draft.billedTo.country || "India";
    draft.number = await suggestNumber(draft.sellerId, customer?.code ?? "", draft.invoiceDate, draft.periodStart);
    res.json({ invoice: draft });
  } catch (error) { fail(res, "new invoice", error, "Failed to start an invoice"); }
});

router.get("/api/super-admin/billing/next-number", ...superAdmin, async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const invoiceDate = isIsoDate(q.invoiceDate) ? q.invoiceDate : todayIst();
    const periodStart = isIsoDate(q.periodStart) ? q.periodStart : null;
    let code = "";
    if (q.customerId) {
      const [c] = await db.select({ code: billingCustomers.code }).from(billingCustomers).where(eq(billingCustomers.id, q.customerId));
      code = c?.code ?? "";
    }
    res.json({ number: await suggestNumber(q.sellerId ?? null, code, invoiceDate, periodStart, q.excludeId ?? null) });
  } catch (error) { fail(res, "next number", error, "Failed to suggest a number"); }
});

router.get("/api/super-admin/billing/invoices/:id", ...superAdmin, async (req, res) => {
  try {
    const [i] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!i) return res.status(404).json({ error: "Invoice not found" });
    res.json({ invoice: invoiceView(i) });
  } catch (error) { fail(res, "invoice", error, "Failed to load the invoice"); }
});

const invoiceBody = z.object({
  number: z.string().trim().min(1, "Enter an invoice number").max(60),
  status: z.enum(INVOICE_STATUSES),
  sellerId: z.string().nullable(),
  customerId: z.string().nullable(),
  businessAccountId: z.string().nullable(),
  invoiceDate: isoDate,
  dueDate: isoDate.nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  currency: z.string().refine(isCurrency, "Unknown currency"),
  seller: z.unknown(),
  billedTo: z.unknown(),
  placeOfSupply: z.string().max(120),
  countryOfSupply: z.string().max(80),
  lines: z.unknown(),
  options: z.unknown(),
  notes: z.string().max(4000),
  terms: z.string().max(4000),
});

/** Checks and normalises an invoice body; the totals are always worked out here. */
async function invoiceValues(req: Request, res: Response, excludeId: string | null): Promise<Partial<typeof invoices.$inferInsert> | null> {
  const parsed = invoiceBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid invoice" }); return null; }
  const b = parsed.data;
  if (b.periodStart && b.periodEnd && b.periodEnd < b.periodStart) { res.status(400).json({ error: "The billing period ends before it starts" }); return null; }
  const taken = (await numbersInUse(excludeId)).some(n => n.trim().toUpperCase() === b.number.toUpperCase());
  if (taken) { res.status(409).json({ error: `Invoice number ${b.number} is already used` }); return null; }
  const billedTo = resolveParty(b.billedTo);
  if (!billedTo.name) { res.status(400).json({ error: "Enter who the invoice is billed to" }); return null; }
  const lines = resolveLines(b.lines).filter(l => l.item.trim() || l.rate || l.description.trim());
  if (!lines.length) { res.status(400).json({ error: "Add at least one line" }); return null; }
  const options = resolveOptions(b.options);
  const totals = computeInvoiceTotals(lines, options.taxMode, options.roundTotal);
  return {
    number: b.number, status: b.status, sellerId: b.sellerId || null, customerId: b.customerId || null,
    businessAccountId: b.businessAccountId || null,
    invoiceDate: b.invoiceDate, dueDate: b.dueDate, periodStart: b.periodStart, periodEnd: b.periodEnd,
    currency: b.currency,
    seller: resolveSellerCopy(b.seller) as unknown as Record<string, unknown>,
    billedTo: billedTo as unknown as Record<string, unknown>,
    placeOfSupply: b.placeOfSupply, countryOfSupply: b.countryOfSupply,
    lines: lines as unknown as Record<string, unknown>[],
    options: options as unknown as Record<string, unknown>,
    notes: b.notes, terms: b.terms,
    amount: totals.amount.toFixed(2), tax: (totals.tax1 + totals.tax2).toFixed(2), total: totals.total.toFixed(2),
  };
}

router.post("/api/super-admin/billing/invoices", ...superAdmin, async (req, res) => {
  try {
    const values = await invoiceValues(req, res, null);
    if (!values) return;
    const [i] = await db.insert(invoices).values({
      ...(values as typeof invoices.$inferInsert),
      paidAt: values.status === "paid" ? new Date() : null,
      createdBy: req.user!.id,
    }).returning();
    await recordAuditEventSafely(req, { action: "billing.invoice_created", outcome: "success", resourceType: "invoice", resourceId: i.id, metadata: { number: i.number, total: i.total } });
    res.json({ invoice: invoiceView(i) });
  } catch (error) { fail(res, "invoice create", error, "Failed to save the invoice"); }
});

router.put("/api/super-admin/billing/invoices/:id", ...superAdmin, async (req, res) => {
  try {
    const [before] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!before) return res.status(404).json({ error: "Invoice not found" });
    const values = await invoiceValues(req, res, before.id);
    if (!values) return;
    const paidAt = values.status === "paid" ? (before.paidAt ?? new Date()) : null;
    const [i] = await db.update(invoices).set({ ...values, paidAt, updatedAt: new Date() }).where(eq(invoices.id, before.id)).returning();
    await recordAuditEventSafely(req, { action: "billing.invoice_updated", outcome: "success", resourceType: "invoice", resourceId: i.id, metadata: { number: i.number, total: i.total, status: i.status } });
    res.json({ invoice: invoiceView(i) });
  } catch (error) { fail(res, "invoice update", error, "Failed to save the invoice"); }
});

/** Just the status (Sent / Paid / Cancelled) from the list. */
router.patch("/api/super-admin/billing/invoices/:id/status", ...superAdmin, async (req, res) => {
  try {
    const parsed = z.object({ status: z.enum(INVOICE_STATUSES) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Unknown status" });
    const [before] = await db.select({ paidAt: invoices.paidAt }).from(invoices).where(eq(invoices.id, req.params.id));
    if (!before) return res.status(404).json({ error: "Invoice not found" });
    const status = parsed.data.status;
    await db.update(invoices).set({ status, paidAt: status === "paid" ? (before.paidAt ?? new Date()) : null, updatedAt: new Date() }).where(eq(invoices.id, req.params.id));
    await recordAuditEventSafely(req, { action: "billing.invoice_status", outcome: "success", resourceType: "invoice", resourceId: req.params.id, metadata: { status } });
    res.json({ status });
  } catch (error) { fail(res, "invoice status", error, "Failed to change the status"); }
});

router.delete("/api/super-admin/billing/invoices/:id", ...superAdmin, async (req, res) => {
  try {
    const [i] = await db.delete(invoices).where(eq(invoices.id, req.params.id)).returning({ id: invoices.id, number: invoices.number });
    if (!i) return res.status(404).json({ error: "Invoice not found" });
    await recordAuditEventSafely(req, { action: "billing.invoice_deleted", outcome: "success", resourceType: "invoice", resourceId: i.id, metadata: { number: i.number } });
    res.json({ deleted: true });
  } catch (error) { fail(res, "invoice delete", error, "Failed to delete the invoice"); }
});

export default router;
