import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { CurrencySelect, Field, InvoiceStatusPill, LinesEditor, PartyFields, blankLine } from "@/components/billing/billingUi";
import { invoiceHref } from "@/navigation/superAdminAreas";
import { ReadInvoiceButton } from "@/components/billing/ReadInvoiceDialog";
import { SELLERS_KEY, type SellerDto } from "@/pages/billing/BillingCompanyPage";
import {
  BILLING_CYCLES, emptyParty, formatInvoiceDate, formatInvoiceMoney, formatPeriod, todayIst,
  type BillingCycle, type BillingTiming, type InvoiceLine, type InvoiceParty, type InvoiceStatus, type NextBilling,
} from "@shared/invoice";

export interface BillingCustomerDto {
  id: string;
  businessAccountId: string | null;
  sellerId: string | null;
  code: string;
  billedTo: InvoiceParty;
  cycle: BillingCycle;
  startDate: string;
  timing: BillingTiming;
  raiseAfterDays: number;
  dueDays: number | null;
  currency: string | null;
  lines: InvoiceLine[];
  notes: string | null;
  active: boolean;
  next: NextBilling | null;
  lastInvoice: { id: string; number: string; invoiceDate: string; total: number; currency: string; status: InvoiceStatus } | null;
  unpaid: number;
}

export const CUSTOMERS_KEY = ["/api/super-admin/billing/customers"];
const ACCOUNTS_KEY = ["/api/super-admin/billing/accounts"];

const cycleLabel = (c: BillingCycle) => BILLING_CYCLES.find(x => x.key === c)?.label ?? c;

function DuePill({ next }: { next: NextBilling | null }) {
  if (!next) return <span className="text-[12px] text-gray-400">Paused</span>;
  if (next.state === "done") return <span className="text-[12px] text-gray-500">Invoiced</span>;
  const d = next.daysLeft ?? 0;
  const [tone, text] = next.state === "late"
    ? ["bg-red-50 text-red-700", `${-d} day${d === -1 ? "" : "s"} late`]
    : next.state === "due" ? ["bg-amber-50 text-amber-800", "Raise today"]
    : d <= 7 ? ["bg-sky-50 text-sky-700", `In ${d} day${d === 1 ? "" : "s"}`]
    : ["bg-gray-100 text-gray-600", `In ${d} days`];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{text}</span>;
}

/** Super admin › Invoices & billing › Billing list: who we bill, how often, and when the next invoice is due. */
export default function BillingListPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<{ today: string; customers: BillingCustomerDto[] }>({ queryKey: CUSTOMERS_KEY });
  const [editing, setEditing] = useState<BillingCustomerDto | "new" | null>(null);
  const list = [...(data?.customers ?? [])].sort((a, b) => {
    const k = (c: BillingCustomerDto) => (c.active && c.next?.raiseOn ? c.next.raiseOn : "9999");
    return k(a).localeCompare(k(b)) || a.billedTo.name.localeCompare(b.billedTo.name);
  });
  const active = list.filter(c => c.active && c.next && c.next.state !== "done");
  const dueNow = active.filter(c => c.next!.state !== "upcoming").length;
  const thisWeek = active.filter(c => c.next!.state === "upcoming" && (c.next!.daysLeft ?? 99) <= 7).length;
  const unpaid = new Map<string, number>();
  for (const c of list) if (c.unpaid > 0) {
    const cur = c.lastInvoice?.currency ?? c.currency ?? "INR";
    unpaid.set(cur, (unpaid.get(cur) ?? 0) + c.unpaid);
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="To raise now" value={dueNow} hint={dueNow ? "Due today or late" : "Nothing waiting"} />
        <Stat label="Due in the next 7 days" value={thisWeek} />
        <Stat
          label="Sent, not yet paid"
          value={unpaid.size ? Array.from(unpaid).map(([c, v]) => formatInvoiceMoney(v, c)).join(" + ") : "—"}
        />
      </div>
      <Panel
        title="Billing list"
        subtitle="Everyone we bill, how often, and when each next invoice is due. Raise invoice starts one with the right period and lines filled in."
        actions={<Button onClick={() => setEditing("new")} data-testid="button-add-customer"><Plus className="mr-1 h-4 w-4" />Add customer</Button>}
      >
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : list.length === 0 ? (
          <div className="rounded-xl bg-gray-50 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-gray-900">No customers on the billing list yet</p>
            <p className="mt-1 text-[13px] text-gray-500">Add each customer you bill, with how often and from when. You'll then see when every invoice is due.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">How often</th>
                  <th className="py-2 pr-3 font-medium">Next period</th>
                  <th className="py-2 pr-3 font-medium">Raise invoice on</th>
                  <th className="py-2 pr-3 font-medium">Last invoice</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className={`border-b border-black/[0.04] last:border-0 ${c.active ? "" : "opacity-60"}`} data-testid={`row-customer-${c.id}`}>
                    <td className="py-3 pr-3">
                      <p className="font-medium text-gray-900">{c.billedTo.name}</p>
                      <p className="text-[12px] text-gray-500">{[c.code && `Code ${c.code}`, c.billedTo.state].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p>{cycleLabel(c.cycle)}</p>
                      <p className="text-[12px] text-gray-500">{c.cycle === "one_time" ? `on ${formatInvoiceDate(c.startDate)}` : c.timing === "before" ? "in advance" : "after the period ends"}</p>
                    </td>
                    <td className="py-3 pr-3">{c.next?.periodStart ? formatPeriod(c.next.periodStart, c.next.periodEnd) : "—"}</td>
                    <td className="py-3 pr-3">
                      <p className="tabular-nums">{c.next?.raiseOn ? formatInvoiceDate(c.next.raiseOn) : "—"}</p>
                      <DuePill next={c.active ? c.next : null} />
                    </td>
                    <td className="py-3 pr-3">
                      {c.lastInvoice ? (
                        <button type="button" className="text-left" onClick={() => setLocation(invoiceHref(c.lastInvoice!.id))}>
                          <p className="font-mono text-[13px] text-violet-700 hover:underline">{c.lastInvoice.number}</p>
                          <p className="flex items-center gap-1.5 text-[12px] text-gray-500">
                            {formatInvoiceMoney(c.lastInvoice.total, c.lastInvoice.currency)} <InvoiceStatusPill status={c.lastInvoice.status} />
                          </p>
                        </button>
                      ) : <span className="text-[12px] text-gray-400">None yet</span>}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label="Edit" data-testid={`button-edit-customer-${c.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant={c.next && c.next.state !== "upcoming" && c.next.state !== "done" ? "default" : "outline"} onClick={() => setLocation(invoiceHref("new", c.id))} data-testid={`button-raise-${c.id}`}>
                          <FilePlus2 className="mr-1 h-4 w-4" />Raise invoice
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <CustomerDialog customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CustomerDialog({ customer, onClose }: { customer: BillingCustomerDto | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: sellersData } = useQuery<{ sellers: SellerDto[] }>({ queryKey: SELLERS_KEY });
  const { data: accountsData } = useQuery<{ accounts: { id: string; name: string; website: string }[] }>({ queryKey: ACCOUNTS_KEY });
  const sellers = sellersData?.sellers ?? [];
  const def = sellers.find(s => s.isDefault) ?? sellers[0];
  const today = todayIst();
  const [f, setF] = useState(() => customer ? { ...customer } : {
    businessAccountId: null as string | null, sellerId: null as string | null, code: "", billedTo: emptyParty(),
    cycle: "monthly" as BillingCycle, startDate: `${today.slice(0, 8)}01`, timing: "after" as BillingTiming, raiseAfterDays: 1,
    dueDays: null as number | null, currency: null as string | null, lines: [] as InvoiceLine[], notes: null as string | null, active: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(prev => ({ ...prev, [k]: v }));
  const seller = sellers.find(s => s.id === f.sellerId) ?? def;
  const currency = f.currency ?? seller?.settings.currency ?? "INR";

  const save = useMutation({
    mutationFn: () => {
      const body = {
        businessAccountId: f.businessAccountId, sellerId: f.sellerId, code: f.code, billedTo: f.billedTo, cycle: f.cycle,
        startDate: f.startDate, timing: f.timing, raiseAfterDays: f.raiseAfterDays, dueDays: f.dueDays, currency: f.currency,
        lines: f.lines, notes: f.notes, active: f.active,
      };
      return customer
        ? apiRequest("PATCH", `/api/super-admin/billing/customers/${customer.id}`, body)
        : apiRequest("POST", "/api/super-admin/billing/customers", body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }); toast({ title: "Saved" }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/billing/customers/${customer!.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.billedTo.name}` : "Add a customer to the billing list"}</DialogTitle>
          <DialogDescription>Who we bill, how often and from when. Invoices copy these details, and each can still be changed.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-violet-50/60 px-3 py-2">
            <p className="text-[13px] text-gray-700">Have an invoice for this customer? Let AI fill in their details and usual lines.</p>
            <ReadInvoiceButton
              sections={["billedTo", "lines"]}
              onApply={(r, chosen) => setF(prev => ({
                ...prev,
                ...(chosen.has("billedTo") && r.billedTo.name ? { billedTo: r.billedTo } : {}),
                ...(chosen.has("lines") && r.lines.length ? { lines: r.lines, currency: r.currency ?? prev.currency } : {}),
              }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Chroney account (optional)" className="sm:col-span-2" hint="Fills in the name; leave empty for anyone else.">
              <SearchableSelect
                value={f.businessAccountId ?? ""}
                onValueChange={v => {
                  const acc = accountsData?.accounts.find(a => a.id === v);
                  setF(prev => ({ ...prev, businessAccountId: v || null, billedTo: acc && !prev.billedTo.name ? { ...prev.billedTo, name: acc.name } : prev.billedTo }));
                }}
                placeholder="Not a Chroney account"
                searchPlaceholder="Search accounts…"
                options={(accountsData?.accounts ?? []).map(a => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <Field label="Short code" hint="For invoice numbers, e.g. J">
              <Input value={f.code} onChange={e => set("code", e.target.value.toUpperCase())} data-testid="input-customer-code" />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[14px] font-semibold">Billed to</p>
            <PartyFields value={f.billedTo} onChange={p => set("billedTo", p)} idPrefix="customer" />
          </div>

          <div>
            <p className="mb-2 text-[14px] font-semibold">When to bill</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="How often">
                <Select value={f.cycle} onValueChange={v => set("cycle", v as BillingCycle)}>
                  <SelectTrigger data-testid="select-cycle"><SelectValue /></SelectTrigger>
                  <SelectContent>{BILLING_CYCLES.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={f.cycle === "one_time" ? "Date" : "First period starts"}>
                <Input type="date" value={f.startDate} onChange={e => set("startDate", e.target.value)} data-testid="input-start-date" />
              </Field>
              {f.cycle !== "one_time" && (
                <Field label="Bill">
                  <Select value={f.timing} onValueChange={v => set("timing", v as BillingTiming)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="after">After the period ends</SelectItem>
                      <SelectItem value="before">In advance</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label={f.cycle === "one_time" ? "Raise after (days)" : f.timing === "before" ? "Days after it starts" : "Days after it ends"}>
                <Input type="number" value={String(f.raiseAfterDays)} onChange={e => set("raiseAfterDays", Number(e.target.value || 0))} data-testid="input-raise-after" />
              </Field>
              <Field label="Payment due after (days)">
                <Input type="number" min={0} value={f.dueDays === null ? "" : String(f.dueDays)} placeholder={String(seller?.settings.dueDays ?? 7)} onChange={e => set("dueDays", e.target.value === "" ? null : Number(e.target.value))} />
              </Field>
              <Field label="Currency"><CurrencySelect value={currency} onChange={c => set("currency", c)} /></Field>
              {sellers.length > 1 && (
                <Field label="Billed by" className="sm:col-span-2">
                  <Select value={f.sellerId ?? def?.id ?? ""} onValueChange={v => set("sellerId", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[14px] font-semibold">Usual lines</p>
            <p className="mb-2 text-[12px] text-gray-500">Each invoice starts with these (e.g. a monthly fee). You can change them on the invoice.</p>
            {f.lines.length === 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => set("lines", [blankLine(seller?.settings.defaultHsn ?? "", seller?.settings.defaultTaxRate ?? 18)])} data-testid="button-add-usual-line">
                <Plus className="mr-1 h-4 w-4" />Add a usual line
              </Button>
            ) : (
              <LinesEditor
                lines={f.lines}
                onChange={update => setF(prev => ({ ...prev, lines: update(prev.lines) }))}
                currency={currency}
                taxMode="split"
                defaults={{ hsn: seller?.settings.defaultHsn ?? "", taxRate: seller?.settings.defaultTaxRate ?? 18 }}
              />
            )}
          </div>

          <Field label="Notes for each invoice (optional)" hint="Leave empty to use your company's usual notes.">
            <Textarea rows={2} value={f.notes ?? ""} onChange={e => set("notes", e.target.value || null)} />
          </Field>

          <label className="flex items-center gap-3 text-[14px]">
            <Switch checked={f.active} onCheckedChange={v => set("active", v)} />
            Still billing this customer
          </label>

          <DialogFooter className="gap-2 sm:justify-between">
            {customer ? <Button type="button" variant="ghost" className="text-red-600" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove from list</Button> : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={save.isPending || !f.billedTo.name.trim() || !f.startDate} data-testid="button-save-customer">{save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
