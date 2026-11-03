import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, MoreHorizontal, Plus, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel } from "@/components/agency/agencyUi";
import { InvoiceStatusPill } from "@/components/billing/billingUi";
import { printInvoice } from "@/components/billing/InvoiceDocument";
import { invoiceHref } from "@/navigation/superAdminAreas";
import {
  INVOICE_STATUSES, INVOICE_STATUS_LABEL, formatInvoiceDate, formatInvoiceMoney, formatPeriod,
  type InvoiceDto, type InvoiceStatus,
} from "@shared/invoice";

interface InvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  billedToName: string;
  sellerName: string;
  invoiceDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  amount: number;
  tax: number;
  total: number;
}

export const INVOICES_KEY = ["/api/super-admin/billing/invoices"];

/** Super admin › Invoices & billing › Invoices: every invoice we've made. */
export default function InvoicesListPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ today: string; invoices: InvoiceRow[] }>({ queryKey: INVOICES_KEY });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<InvoiceStatus | "all" | "unpaid">("all");

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InvoiceStatus }) => apiRequest("PATCH", `/api/super-admin/billing/invoices/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/billing/customers"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  const download = async (id: string) => {
    try {
      const r = await apiRequest<{ invoice: InvoiceDto }>("GET", `/api/super-admin/billing/invoices/${id}`);
      printInvoice(r.invoice);
    } catch (e) {
      toast({ title: "Couldn't open the invoice", description: (e as Error).message, variant: "destructive" });
    }
  };

  const today = data?.today ?? "";
  const overdue = (i: InvoiceRow) => i.status === "sent" && !!i.dueDate && i.dueDate < today;
  const all = data?.invoices ?? [];
  const term = q.trim().toLowerCase();
  const list = all.filter(i =>
    (filter === "all" || (filter === "unpaid" ? i.status === "sent" : i.status === filter))
    && (!term || i.number.toLowerCase().includes(term) || i.billedToName.toLowerCase().includes(term)));
  const chips: { key: typeof filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: all.length },
    { key: "draft", label: "Drafts", n: all.filter(i => i.status === "draft").length },
    { key: "unpaid", label: "Waiting for payment", n: all.filter(i => i.status === "sent").length },
    { key: "paid", label: "Paid", n: all.filter(i => i.status === "paid").length },
  ];

  return (
    <Panel
      actions={<Button onClick={() => setLocation(invoiceHref("new"))} data-testid="button-new-invoice"><Plus className="mr-1 h-4 w-4" />New invoice</Button>}
      title="Invoices"
      subtitle="Every invoice made here. Open one to change it, or download it as a PDF."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by number or customer" data-testid="input-search-invoices" />
        </div>
        {chips.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${filter === c.key ? "border-gray-900 bg-gray-900 text-white" : "border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            {c.label}{c.n ? ` · ${c.n}` : ""}
          </button>
        ))}
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl bg-gray-50 px-4 py-8 text-center">
          <p className="text-[14px] font-medium text-gray-900">{all.length ? "No invoices match" : "No invoices yet"}</p>
          {!all.length && <p className="mt-1 text-[13px] text-gray-500">Start one with New invoice, or from a customer on the Billing list.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                <th className="py-2 pr-3 font-medium">Number</th>
                <th className="py-2 pr-3 font-medium">Billed to</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Period</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map(i => (
                <tr key={i.id} className="cursor-pointer border-b border-black/[0.04] last:border-0 hover:bg-gray-50" onClick={() => setLocation(invoiceHref(i.id))} data-testid={`row-invoice-${i.id}`}>
                  <td className="py-3 pr-3 font-mono text-[13px] font-medium text-gray-900">{i.number}</td>
                  <td className="py-3 pr-3">
                    <p className="text-gray-900">{i.billedToName}</p>
                    {i.sellerName && <p className="text-[12px] text-gray-500">by {i.sellerName}</p>}
                  </td>
                  <td className="py-3 pr-3 tabular-nums">
                    <p>{formatInvoiceDate(i.invoiceDate)}</p>
                    {i.dueDate && <p className="text-[12px] text-gray-500">due {formatInvoiceDate(i.dueDate)}</p>}
                  </td>
                  <td className="py-3 pr-3 text-[13px] text-gray-600">{formatPeriod(i.periodStart, i.periodEnd) || "—"}</td>
                  <td className="py-3 pr-3 text-right font-medium tabular-nums">{formatInvoiceMoney(i.total, i.currency)}</td>
                  <td className="py-3 pr-3"><InvoiceStatusPill status={i.status} overdue={overdue(i)} /></td>
                  <td className="py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => download(i.id)} aria-label="Download PDF" data-testid={`button-pdf-${i.id}`}><Download className="h-4 w-4" /></Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" aria-label="More" data-testid={`button-more-${i.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {INVOICE_STATUSES.filter(st => st !== i.status).map(st => (
                            <DropdownMenuItem key={st} onClick={() => setStatus.mutate({ id: i.id, status: st })}>Mark as {INVOICE_STATUS_LABEL[st].toLowerCase()}</DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setLocation(invoiceHref(i.id))}>Open</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
