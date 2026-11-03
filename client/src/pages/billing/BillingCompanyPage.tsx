import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Star, Trash2, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/agency/agencyUi";
import { BankFields, CurrencySelect, Field, PartyFields } from "@/components/billing/billingUi";
import { ReadInvoiceButton } from "@/components/billing/ReadInvoiceDialog";
import {
  INVOICE_NUMBER_TOKENS, nextInvoiceNumber, todayIst, type InvoiceOptions, type InvoiceSellerSettings,
} from "@shared/invoice";

export interface SellerDto {
  id: string;
  label: string;
  isDefault: boolean;
  settings: InvoiceSellerSettings;
  logoData: string | null;
}

export const SELLERS_KEY = ["/api/super-admin/billing/sellers"];

const LOGO_MAX = 300 * 1024;

/** Super admin › Invoices & billing › Our details: the company (or companies) we bill as. */
export default function BillingCompanyPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ sellers: SellerDto[] }>({ queryKey: SELLERS_KEY });
  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const sellers = data?.sellers ?? [];
  const current = sellers.find(s => s.id === selected) ?? sellers[0] ?? null;

  const add = useMutation({
    mutationFn: () => apiRequest<{ seller: SellerDto }>("POST", "/api/super-admin/billing/sellers", { label: newLabel }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: SELLERS_KEY });
      setSelected(r.seller.id);
      setAddOpen(false);
      setNewLabel("");
    },
    onError: (e: Error) => toast({ title: "Couldn't add", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <>
      {sellers.length === 0 ? (
        <Panel>
          <div className="rounded-xl bg-gray-50 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-gray-900">Add your company details first</p>
            <p className="mt-1 text-[13px] text-gray-500">Name, address, GSTIN, bank details and logo. They go on every invoice as "Billed by".</p>
            <Button className="mt-4" onClick={() => setAddOpen(true)} data-testid="button-add-seller"><Plus className="mr-1 h-4 w-4" />Add company details</Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {sellers.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${current?.id === s.id ? "border-gray-900 bg-gray-900 text-white" : "border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
                data-testid={`seller-chip-${s.id}`}
              >
                {s.isDefault && <Star className="h-3.5 w-3.5" />}{s.label}
              </button>
            ))}
            <Button variant="ghost" size="sm" className="text-violet-700" onClick={() => setAddOpen(true)} data-testid="button-add-seller"><Plus className="mr-1 h-4 w-4" />Another company</Button>
          </div>
          {current && <SellerForm key={current.id} seller={current} onDeleted={() => setSelected(null)} />}
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add company details</DialogTitle>
            <DialogDescription>The company that bills, e.g. "Knightlabs AI LLP". You fill in the rest on the next screen.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
            <Field label="Company name">
              <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} autoFocus data-testid="input-seller-label" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!newLabel.trim() || add.isPending} data-testid="button-create-seller">{add.isPending ? "Adding…" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SellerForm({ seller, onDeleted }: { seller: SellerDto; onDeleted: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState(seller.label);
  const [s, setS] = useState<InvoiceSellerSettings>(seller.settings);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const setOpt = <K extends keyof InvoiceOptions>(k: K, v: InvoiceOptions[K]) => setS({ ...s, options: { ...s.options, [k]: v } });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("PATCH", `/api/super-admin/billing/sellers/${seller.id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: SELLERS_KEY }); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const logo = useMutation({
    mutationFn: (dataUrl: string | null) => apiRequest("PUT", `/api/super-admin/billing/sellers/${seller.id}/logo`, { logo: dataUrl }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLERS_KEY }),
    onError: (e: Error) => toast({ title: "Couldn't save the logo", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/billing/sellers/${seller.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: SELLERS_KEY }); setConfirmDelete(false); onDeleted(); },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return toast({ title: "Use a PNG, JPG, WebP or SVG image", variant: "destructive" });
    if (file.size > LOGO_MAX) return toast({ title: "The logo must be 300 KB or smaller", variant: "destructive" });
    const reader = new FileReader();
    reader.onload = () => logo.mutate(String(reader.result));
    reader.readAsDataURL(file);
  };

  const today = todayIst();
  const example = nextInvoiceNumber(s.numberFormat, { code: "J", invoiceDate: today, periodStart: today.slice(0, 8) + "01" }, []);

  return (
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); save.mutate({ label, settings: s }); }}>
      <Panel
        title="Company"
        subtitle='Shown on every new invoice as "Billed by". Invoices already made keep the details they were made with.'
        actions={(
          <>
            <ReadInvoiceButton
              label="Fill from one of our invoices"
              sections={["seller"]}
              onApply={r => {
                // The company, bank, currency and terms; not the notes, which belong to that one invoice.
                setS(prev => ({
                  ...prev,
                  party: r.seller.name ? r.seller : prev.party,
                  bank: r.bank.accountNumber || r.bank.bankName ? r.bank : prev.bank,
                  currency: r.currency ?? prev.currency,
                  terms: r.terms || prev.terms,
                }));
                toast({ title: "Filled in from the invoice", description: "Check the details, then press Save details. The logo isn't copied: upload it separately." });
              }}
            />
            {!seller.isDefault && <Button type="button" variant="outline" size="sm" onClick={() => save.mutate({ isDefault: true })}><Star className="mr-1 h-4 w-4" />Use by default</Button>}
            <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
          </>
        )}
      >
        <div className="grid gap-5 lg:grid-cols-[1fr_200px]">
          <div className="space-y-3">
            <Field label="Name in the list" hint="Only for you, to tell companies apart.">
              <Input value={label} onChange={e => setLabel(e.target.value)} data-testid="input-seller-list-label" />
            </Field>
            <PartyFields value={s.party} onChange={party => setS({ ...s, party })} idPrefix="seller" />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Logo</p>
            <div className="grid h-32 w-full place-items-center overflow-hidden rounded-2xl border border-black/[0.06] bg-gray-50">
              {seller.logoData ? <img src={seller.logoData} alt="Logo" className="h-full w-full object-contain p-2" /> : <span className="text-[12px] text-gray-400">No logo</span>}
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-seller-logo" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={logo.isPending}><Upload className="mr-1 h-4 w-4" />{seller.logoData ? "Replace" : "Upload"}</Button>
              {seller.logoData && <Button type="button" variant="ghost" size="sm" onClick={() => logo.mutate(null)}>Remove</Button>}
            </div>
            <p className="mt-2 text-[12px] text-gray-500">Top right of the invoice. Up to 300 KB.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Bank details" subtitle="Where customers pay. Leave empty to leave the section off.">
        <BankFields value={s.bank} onChange={bank => setS({ ...s, bank })} />
      </Panel>

      <Panel title="Numbers and defaults" subtitle="What a new invoice starts with. Each invoice can still change any of it.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Invoice number pattern" className="sm:col-span-2" hint={<>Next one would look like <b className="font-mono text-gray-800" data-testid="text-number-example">{example}</b></>}>
            <Input value={s.numberFormat} onChange={e => setS({ ...s, numberFormat: e.target.value })} className="font-mono" data-testid="input-number-format" />
          </Field>
          <Field label="Currency"><CurrencySelect value={s.currency} onChange={currency => setS({ ...s, currency })} /></Field>
          <Field label="Payment due after (days)"><Input type="number" min={0} value={String(s.dueDays)} onChange={e => setS({ ...s, dueDays: Number(e.target.value || 0) })} data-testid="input-due-days" /></Field>
          <Field label="Tax rate %"><Input type="number" min={0} max={100} step="0.01" value={String(s.defaultTaxRate)} onChange={e => setS({ ...s, defaultTaxRate: Number(e.target.value || 0) })} /></Field>
          <Field label="HSN/SAC code"><Input value={s.defaultHsn} onChange={e => setS({ ...s, defaultHsn: e.target.value })} /></Field>
          <Field label="Invoice title"><Input value={s.options.title} onChange={e => setOpt("title", e.target.value)} placeholder="Invoice / Tax Invoice" /></Field>
          <Field label="Heading colour">
            <div className="flex items-center gap-2">
              <input type="color" value={s.options.accent} onChange={e => setOpt("accent", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-black/10" aria-label="Heading colour" />
              <span className="font-mono text-[12px] text-gray-500">{s.options.accent}</span>
            </div>
          </Field>
        </div>
        <details className="mt-3 text-[12px] text-gray-600">
          <summary className="cursor-pointer text-violet-700">What can go in the pattern</summary>
          <ul className="mt-2 space-y-1">
            {INVOICE_NUMBER_TOKENS.map(t => <li key={t.token}><span className="font-mono text-gray-900">{t.token}</span> — {t.meaning}</li>)}
          </ul>
        </details>
        <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Toggle label="Show HSN/SAC under each item" on={s.options.showHsn} set={v => setOpt("showHsn", v)} />
          <Toggle label="Show the total in words" on={s.options.showAmountInWords} set={v => setOpt("showAmountInWords", v)} />
          <Toggle label="Round the total to a whole amount" on={s.options.roundTotal} set={v => setOpt("roundTotal", v)} />
          <Toggle label="Signature space" on={s.options.showSignature} set={v => setOpt("showSignature", v)} testId="toggle-signature" />
        </div>
        {s.options.showSignature && (
          <Field label="Under the signature" className="mt-3 max-w-sm"><Input value={s.options.signatureLabel} onChange={e => setOpt("signatureLabel", e.target.value)} /></Field>
        )}
      </Panel>

      <Panel title="Notes, terms and footer" subtitle="Start text for new invoices. One paragraph per line.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Notes"><Textarea rows={4} value={s.notes} onChange={e => setS({ ...s, notes: e.target.value })} /></Field>
          <Field label="Terms and conditions"><Textarea rows={4} value={s.terms} onChange={e => setS({ ...s, terms: e.target.value })} data-testid="input-terms" /></Field>
          <Field label="Footer line" className="lg:col-span-2"><Input value={s.options.footer} onChange={e => setOpt("footer", e.target.value)} /></Field>
        </div>
      </Panel>

      <div className="sticky bottom-0 -mx-1 flex justify-end bg-[#f5f5f7]/90 px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={save.isPending || !label.trim()} data-testid="button-save-seller">{save.isPending ? "Saving…" : "Save details"}</Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {seller.label}?</DialogTitle>
            <DialogDescription>Invoices already made keep their copy of these details. New invoices can't use this company any more.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function Toggle({ label, on, set, testId }: { label: string; on: boolean; set: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[14px] text-gray-800">
      {label}
      <Switch checked={on} onCheckedChange={set} data-testid={testId} />
    </label>
  );
}
