import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, MoreHorizontal, ReceiptText, RefreshCw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { Panel } from "@/components/agency/agencyUi";
import { CurrencySelect, Field, InvoiceStatusPill, LinesEditor, PartyFields } from "@/components/billing/billingUi";
import { InvoiceDocument, printInvoice } from "@/components/billing/InvoiceDocument";
import { ReadInvoiceButton } from "@/components/billing/ReadInvoiceDialog";
import { invoiceHref } from "@/navigation/superAdminAreas";
import { SELLERS_KEY, type SellerDto } from "@/pages/billing/BillingCompanyPage";
import { CUSTOMERS_KEY, type BillingCustomerDto } from "@/pages/billing/BillingListPage";
import { INVOICES_KEY } from "@/pages/billing/InvoicesListPage";
import {
  INVOICE_STATUSES, INVOICE_STATUS_LABEL, addDays, computeInvoiceTotals, formatInvoiceMoney, placeOfSupplyFor, suggestTaxMode,
  type InvoiceDto, type InvoiceOptions, type InvoiceReadResult, type InvoiceReadSection, type InvoiceStatus, type InvoiceTaxMode,
} from "@shared/invoice";

const TAX_CHOICES: { key: string; label: string; mode: InvoiceTaxMode; labels: [string, string] }[] = [
  { key: "cgst", label: "CGST + SGST (same state)", mode: "split", labels: ["CGST", "SGST"] },
  { key: "igst", label: "IGST (another state)", mode: "single", labels: ["IGST", "SGST"] },
  { key: "single", label: "One tax with my own name (VAT…)", mode: "single", labels: ["Tax", "SGST"] },
  { key: "none", label: "No tax (export, exempt)", mode: "none", labels: ["CGST", "SGST"] },
];

function taxChoice(o: InvoiceOptions): string {
  if (o.taxMode === "none") return "none";
  if (o.taxMode === "split") return "cgst";
  return o.taxLabels[0] === "IGST" ? "igst" : "single";
}

/** One invoice for super admins: the form on the left, the invoice as it will print on the right. */
export default function InvoiceEditorPage({ invoiceId }: { invoiceId: string }) {
  const isNew = invoiceId === "new";
  const search = useSearch();
  const customerParam = new URLSearchParams(search).get("customer");
  const openReader = new URLSearchParams(search).get("read") === "1";
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const source = useQuery<{ invoice: InvoiceDto }>({
    queryKey: isNew ? ["/api/super-admin/billing/invoices/new", customerParam ?? ""] : [`/api/super-admin/billing/invoices/${invoiceId}`],
    queryFn: () => apiRequest("GET", isNew
      ? `/api/super-admin/billing/invoices/new${customerParam ? `?customerId=${encodeURIComponent(customerParam)}` : ""}`
      : `/api/super-admin/billing/invoices/${invoiceId}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const { data: sellersData } = useQuery<{ sellers: SellerDto[] }>({ queryKey: SELLERS_KEY });
  const { data: customersData } = useQuery<{ customers: BillingCustomerDto[] }>({ queryKey: CUSTOMERS_KEY });
  const { data: accountsData } = useQuery<{ accounts: { id: string; name: string }[] }>({ queryKey: ["/api/super-admin/billing/accounts"] });

  const [inv, setInv] = useState<InvoiceDto | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (source.data) { setInv(source.data.invoice); setSaved(isNew ? "" : JSON.stringify(source.data.invoice)); }
  }, [source.data, isNew]);

  const save = useMutation({
    mutationFn: (body: InvoiceDto) => isNew
      ? apiRequest<{ invoice: InvoiceDto }>("POST", "/api/super-admin/billing/invoices", body)
      : apiRequest<{ invoice: InvoiceDto }>("PUT", `/api/super-admin/billing/invoices/${invoiceId}`, body),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
      toast({ title: isNew ? "Invoice saved" : "Saved" });
      if (isNew) {
        queryClient.setQueryData([`/api/super-admin/billing/invoices/${r.invoice.id}`], r);
        setLocation(invoiceHref(r.invoice.id!), { replace: true });
      } else {
        setInv(r.invoice);
        setSaved(JSON.stringify(r.invoice));
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/billing/invoices/${invoiceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
      setLocation("/super-admin/billing");
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });
  const suggestNumber = async () => {
    if (!inv) return;
    const p = new URLSearchParams({ invoiceDate: inv.invoiceDate });
    if (inv.sellerId) p.set("sellerId", inv.sellerId);
    if (inv.customerId) p.set("customerId", inv.customerId);
    if (inv.periodStart) p.set("periodStart", inv.periodStart);
    if (!isNew) p.set("excludeId", invoiceId);
    try {
      const r = await apiRequest<{ number: string }>("GET", `/api/super-admin/billing/next-number?${p}`);
      setInv(prev => prev && { ...prev, number: r.number });
    } catch (e) {
      toast({ title: "Couldn't suggest a number", description: (e as Error).message, variant: "destructive" });
    }
  };

  const dirty = !!inv && JSON.stringify(inv) !== saved;
  const sellers = sellersData?.sellers ?? [];

  /** Fills the form from an invoice the AI read; matches our saved companies and billing-list customers. */
  const applyRead = (r: InvoiceReadResult, chosen: Set<InvoiceReadSection>) => {
    const same = (a: { gstin: string; name: string }, b: { gstin: string; name: string }) =>
      (!!a.gstin && a.gstin === b.gstin) || (!!a.name.trim() && a.name.trim().toLowerCase() === b.name.trim().toLowerCase());
    const ourCompany = chosen.has("seller") ? sellers.find(s => same(s.settings.party, r.seller)) : undefined;
    const customer = chosen.has("billedTo") ? (customersData?.customers ?? []).find(c => same(c.billedTo, r.billedTo)) : undefined;
    setInv(prev => {
      if (!prev) return prev;
      const next: InvoiceDto = { ...prev, options: { ...prev.options } };
      if (chosen.has("seller")) {
        if (ourCompany) {
          next.sellerId = ourCompany.id;
          next.seller = { party: ourCompany.settings.party, bank: ourCompany.settings.bank, logoData: ourCompany.logoData };
        } else {
          next.seller = { ...prev.seller, party: r.seller, bank: r.bank };
        }
      }
      if (chosen.has("billedTo")) {
        next.billedTo = r.billedTo;
        if (customer) { next.customerId = customer.id; next.businessAccountId = customer.businessAccountId ?? prev.businessAccountId; }
      }
      if (chosen.has("details")) {
        if (r.number) next.number = r.number;
        if (r.invoiceDate) next.invoiceDate = r.invoiceDate;
        if (r.dueDate) next.dueDate = r.dueDate;
        if (r.periodStart) next.periodStart = r.periodStart;
        if (r.periodEnd) next.periodEnd = r.periodEnd;
        if (r.currency) next.currency = r.currency;
        if (r.placeOfSupply) next.placeOfSupply = r.placeOfSupply;
        if (r.countryOfSupply) next.countryOfSupply = r.countryOfSupply;
        next.options.taxMode = r.taxMode;
        next.options.taxLabels = r.taxLabels;
      }
      if (chosen.has("lines") && r.lines.length) next.lines = r.lines;
      if (chosen.has("notes")) {
        if (r.notes) next.notes = r.notes;
        if (r.terms) next.terms = r.terms;
      }
      return next;
    });
    const matched = [ourCompany && `Billed by: your saved "${ourCompany.label}"`, customer && `Billed to: "${customer.billedTo.name}" from the billing list`].filter(Boolean);
    toast({ title: "Filled in from the invoice", description: [...matched, "Check the details, then save."].join(". ") });
  };
  const totals = inv ? computeInvoiceTotals(inv.lines, inv.options.taxMode, inv.options.roundTotal) : null;

  return (
    <>
      <SaHeader
        icon={ReceiptText}
        tint="bg-rose-600"
        kind={isNew ? "New invoice" : "Invoice"}
        title={inv?.number || (isNew ? "New invoice" : source.isLoading ? "Loading…" : "Invoice not found")}
        subtitle={inv ? (
          <span className="inline-flex items-center gap-2">
            {!isNew && <InvoiceStatusPill status={inv.status} />}
            {inv.billedTo.name || "No customer yet"}{totals ? ` · ${formatInvoiceMoney(totals.total, inv.currency)}` : ""}
            {dirty && <span className="text-amber-700">· not saved</span>}
          </span>
        ) : undefined}
        back={{ label: "Invoices", href: "/super-admin/billing" }}
        actions={inv ? (
          <>
            <ReadInvoiceButton sections={["seller", "billedTo", "details", "lines", "notes"]} onApply={applyRead} startOpen={isNew && openReader} />
            <Button variant="outline" onClick={() => printInvoice(inv)} data-testid="button-download-pdf"><Download className="mr-1 h-4 w-4" />Download PDF</Button>
            <Button onClick={() => save.mutate(inv)} disabled={save.isPending || (!dirty && !isNew)} data-testid="button-save-invoice">{save.isPending ? "Saving…" : isNew ? "Save invoice" : "Save changes"}</Button>
            {!isNew && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="mr-2 h-4 w-4" />Delete invoice</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        ) : undefined}
      />
      <SaBody>
        {source.isError ? (
          <p className="text-sm text-gray-500">This invoice could not be found. It may have been deleted.</p>
        ) : !inv ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
            <InvoiceForm
              inv={inv}
              setInv={setInv}
              isNew={isNew}
              sellers={sellers}
              customers={customersData?.customers ?? []}
              accounts={accountsData?.accounts ?? []}
              onSuggestNumber={suggestNumber}
              onPickCustomer={id => setLocation(invoiceHref("new", id), { replace: true })}
            />
            <div className="xl:sticky xl:top-4">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-gray-500">Preview: as it will print</p>
              <ScaledPage><InvoiceDocument invoice={inv} /></ScaledPage>
            </div>
          </div>
        )}
      </SaBody>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete invoice {inv?.number}?</DialogTitle>
            <DialogDescription>This can't be undone. To keep a record, mark it as cancelled instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shows the A4-width invoice shrunk to fit its column. */
function ScaledPage({ children }: { children: ReactNode }) {
  const PAGE = 794;
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const k = Math.min(1, outer.current.clientWidth / PAGE);
      setScale(k);
      setHeight(inner.current.offsetHeight * k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-sm" style={{ height: height || undefined }}>
      <div ref={inner} style={{ width: PAGE, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

function InvoiceForm({ inv, setInv, isNew, sellers, customers, accounts, onSuggestNumber, onPickCustomer }: {
  inv: InvoiceDto;
  setInv: (fn: (prev: InvoiceDto | null) => InvoiceDto | null) => void;
  isNew: boolean;
  sellers: SellerDto[];
  customers: BillingCustomerDto[];
  accounts: { id: string; name: string }[];
  onSuggestNumber: () => void;
  onPickCustomer: (id: string) => void;
}) {
  const set = <K extends keyof InvoiceDto>(k: K, v: InvoiceDto[K]) => setInv(prev => prev && { ...prev, [k]: v });
  const setOpt = <K extends keyof InvoiceOptions>(k: K, v: InvoiceOptions[K]) => setInv(prev => prev && { ...prev, options: { ...prev.options, [k]: v } });
  const seller = sellers.find(s => s.id === inv.sellerId);
  const defaults = { hsn: seller?.settings.defaultHsn ?? "998319", taxRate: seller?.settings.defaultTaxRate ?? 18 };
  const workOutTax = () => setInv(prev => {
    if (!prev) return prev;
    const t = suggestTaxMode(prev.seller.party, prev.billedTo);
    return { ...prev, options: { ...prev.options, ...t }, placeOfSupply: placeOfSupplyFor(prev.billedTo) || prev.placeOfSupply, countryOfSupply: prev.billedTo.country || prev.countryOfSupply };
  });

  return (
    <div className="space-y-5">
      {sellers.length === 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Your company details are empty. Add them under <a className="font-medium underline" href="/super-admin/billing/company">Our details</a> so "Billed by" and the bank details fill in.
        </p>
      )}

      <Panel title="Billed to">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From the billing list" hint={isNew ? "Fills in the details, period and usual lines." : undefined}>
              <SearchableSelect
                value={inv.customerId ?? ""}
                onValueChange={id => {
                  if (!id) return set("customerId", null);
                  if (isNew) return onPickCustomer(id);
                  const c = customers.find(x => x.id === id);
                  setInv(prev => prev && { ...prev, customerId: id, billedTo: c ? c.billedTo : prev.billedTo, businessAccountId: c?.businessAccountId ?? prev.businessAccountId });
                }}
                placeholder="Pick a customer"
                searchPlaceholder="Search…"
                options={customers.map(c => ({ value: c.id, label: c.billedTo.name }))}
              />
            </Field>
            <Field label="Chroney account (optional)">
              <SearchableSelect
                value={inv.businessAccountId ?? ""}
                onValueChange={id => {
                  const acc = accounts.find(a => a.id === id);
                  setInv(prev => prev && { ...prev, businessAccountId: id || null, billedTo: acc && !prev.billedTo.name ? { ...prev.billedTo, name: acc.name } : prev.billedTo });
                }}
                placeholder="Not linked"
                searchPlaceholder="Search accounts…"
                options={accounts.map(a => ({ value: a.id, label: a.name }))}
              />
            </Field>
          </div>
          <PartyFields value={inv.billedTo} onChange={p => set("billedTo", p)} idPrefix="billed-to" />
        </div>
      </Panel>

      <Panel title="Invoice">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice number">
            <div className="flex gap-2">
              <Input value={inv.number} onChange={e => set("number", e.target.value)} className="font-mono" data-testid="input-invoice-number" />
              <Button type="button" variant="outline" size="icon" onClick={onSuggestNumber} aria-label="Suggest the next number" title="Suggest the next number"><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </Field>
          <Field label="Status">
            <Select value={inv.status} onValueChange={v => set("status", v as InvoiceStatus)}>
              <SelectTrigger data-testid="select-invoice-status"><SelectValue /></SelectTrigger>
              <SelectContent>{INVOICE_STATUSES.map(st => <SelectItem key={st} value={st}>{INVOICE_STATUS_LABEL[st]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={inv.invoiceDate} onChange={e => {
              const d = e.target.value;
              setInv(prev => {
                if (!prev || !d) return prev;
                // Keep the same number of days to pay.
                const gap = prev.dueDate ? Math.round((Date.parse(prev.dueDate) - Date.parse(prev.invoiceDate)) / 86400000) : null;
                return { ...prev, invoiceDate: d, dueDate: gap === null ? prev.dueDate : addDays(d, gap) };
              });
            }} data-testid="input-invoice-date" />
          </Field>
          <Field label="Due date">
            <Input type="date" value={inv.dueDate ?? ""} onChange={e => set("dueDate", e.target.value || null)} data-testid="input-due-date" />
          </Field>
          <Field label="Billing period from">
            <Input type="date" value={inv.periodStart ?? ""} onChange={e => set("periodStart", e.target.value || null)} data-testid="input-period-start" />
          </Field>
          <Field label="to">
            <Input type="date" value={inv.periodEnd ?? ""} onChange={e => set("periodEnd", e.target.value || null)} data-testid="input-period-end" />
          </Field>
          <Field label="Currency"><CurrencySelect value={inv.currency} onChange={c => set("currency", c)} /></Field>
          <Field label="Billed by">
            <Select
              value={inv.sellerId ?? ""}
              onValueChange={id => {
                const s = sellers.find(x => x.id === id);
                if (s) setInv(prev => prev && { ...prev, sellerId: s.id, seller: { party: s.settings.party, bank: s.settings.bank, logoData: s.logoData } });
              }}
            >
              <SelectTrigger data-testid="select-seller"><SelectValue placeholder={inv.seller.party.name || "Choose"} /></SelectTrigger>
              <SelectContent>{sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        {seller && !isNew && JSON.stringify({ party: seller.settings.party, bank: seller.settings.bank, logoData: seller.logoData }) !== JSON.stringify(inv.seller) && (
          <p className="mt-3 text-[12px] text-gray-500">
            This invoice keeps the company details it was made with.{" "}
            <button type="button" className="text-violet-700 underline" onClick={() => set("seller", { party: seller.settings.party, bank: seller.settings.bank, logoData: seller.logoData })}>Use the latest details</button>
          </p>
        )}
      </Panel>

      <Panel title="Supply and tax">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Country of supply"><Input value={inv.countryOfSupply} onChange={e => set("countryOfSupply", e.target.value)} /></Field>
          <Field label="Place of supply"><Input value={inv.placeOfSupply} onChange={e => set("placeOfSupply", e.target.value)} placeholder="Uttar Pradesh (09)" data-testid="input-place-of-supply" /></Field>
          <Field label="Tax">
            <Select
              value={taxChoice(inv.options)}
              onValueChange={k => {
                const c = TAX_CHOICES.find(x => x.key === k)!;
                setInv(prev => prev && { ...prev, options: { ...prev.options, taxMode: c.mode, taxLabels: c.labels } });
              }}
            >
              <SelectTrigger data-testid="select-tax"><SelectValue /></SelectTrigger>
              <SelectContent>{TAX_CHOICES.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {taxChoice(inv.options) === "single" ? (
            <Field label="Tax name"><Input value={inv.options.taxLabels[0]} onChange={e => setOpt("taxLabels", [e.target.value, inv.options.taxLabels[1]])} /></Field>
          ) : (
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="sm" className="text-violet-700" onClick={workOutTax} data-testid="button-work-out-tax">Work out from the two states</Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Lines">
        <LinesEditor lines={inv.lines} onChange={update => setInv(prev => prev && { ...prev, lines: update(prev.lines) })} currency={inv.currency} taxMode={inv.options.taxMode} defaults={defaults} />
      </Panel>

      <Panel title="Notes and terms" subtitle="One paragraph per line.">
        <div className="space-y-3">
          <Field label="Notes"><Textarea rows={3} value={inv.notes} onChange={e => set("notes", e.target.value)} data-testid="input-notes" /></Field>
          <Field label="Terms and conditions"><Textarea rows={2} value={inv.terms} onChange={e => set("terms", e.target.value)} /></Field>
        </div>
      </Panel>

      <Panel title="Look">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={inv.options.title} onChange={e => setOpt("title", e.target.value)} /></Field>
          <Field label="Footer line"><Input value={inv.options.footer} onChange={e => setOpt("footer", e.target.value)} /></Field>
        </div>
        <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {([
            ["showHsn", "HSN/SAC under each item"],
            ["showAmountInWords", "Total in words"],
            ["roundTotal", "Round the total"],
            ["showSignature", "Signature space"],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[14px]">
              {label}<Switch checked={inv.options[k]} onCheckedChange={v => setOpt(k, v)} data-testid={`toggle-${k}`} />
            </label>
          ))}
        </div>
      </Panel>
    </div>
  );
}
