import { format } from "date-fns";
import { Loader2, MessageSquare, RefreshCw, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { isMaskedValue } from "@shared/contactMasking";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import { crmStatusLook } from "./LeadCrm";

/** A WhatsApp lead as the group admin's Leads page lists it (/api/group-admin/groups/:id/leads/whatsapp). */
export interface GroupWhatsappLead {
  id: string;
  businessAccountId: string;
  businessAccountName: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  capturedAt: string;
  leadsquaredSyncStatus: string | null;
  leadsquaredSyncError: string | null;
  leadsquaredSyncedAt?: string | null;
  /** The account has a WhatsApp LeadSquared connection and this admin may sync. */
  canSyncLeadSquared?: boolean;
  /** Opens the student's WhatsApp chat (sealed number). */
  chatKey?: string | null;
  lastMessage: string | null;
  extractedData: Record<string, unknown>;
  contactsHiddenFromView?: boolean;
}

// Answers already shown in their own column.
const CONTACT_FIELD = /name|phone|mobile|email|whatsapp/i;

function fieldLabel(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The lead's other answers (course, city, …) as [label, value]. */
function leadAnswers(lead: GroupWhatsappLead): Array<[string, string]> {
  return Object.entries(lead.extractedData || {})
    .filter(([k, v]) => !k.startsWith("_") && !CONTACT_FIELD.test(k) && v != null && typeof v !== "object" && String(v).trim() !== "")
    .map(([k, v]) => [fieldLabel(k), String(v).trim()]);
}

/** The lead's other answers as "Label: value", for the Details column. */
function leadDetails(lead: GroupWhatsappLead): string[] {
  return leadAnswers(lead).map(([k, v]) => `${k}: ${v}`);
}

const lsqLabel = (s: string | null) => (!s ? "Not sent" : crmStatusLook(s).text);
/** Held back on purpose (journey step not reached, junk-looking number): not an error. */
const HELD = ["waiting", "waiting_journey", "invalid_phone"];

/** Rows for the Excel export (same columns as the table, every answer as its own column). */
export function whatsappLeadsExcelRows(leads: GroupWhatsappLead[]): Record<string, string>[] {
  return leads.map(lead => {
    const row: Record<string, string> = {
      Name: lead.name || "-",
      Account: lead.businessAccountName || "-",
      Phone: lead.phone || "-",
      Email: lead.email || "-",
    };
    for (const [k, v] of leadAnswers(lead)) row[k] = v;
    row.LeadSquared = lsqLabel(lead.leadsquaredSyncStatus);
    row.Received = format(new Date(lead.capturedAt), "yyyy-MM-dd HH:mm:ss");
    return row;
  });
}

function LsqStatus({ lead, onSync, syncing }: { lead: GroupWhatsappLead; onSync?: (lead: GroupWhatsappLead) => void; syncing?: boolean }) {
  const s = lead.leadsquaredSyncStatus;
  if (onSync && lead.canSyncLeadSquared && s !== "synced") {
    return (
      <div className="flex items-center gap-1.5">
        {s && s !== "pending" && <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${HELD.includes(s) ? crmStatusLook(s).className : "bg-red-100 text-red-700"}`} title={HELD.includes(s) ? lead.leadsquaredSyncError || undefined : formatCrmSyncError(lead.leadsquaredSyncError)}>{lsqLabel(s)}</span>}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSync(lead); }}
          disabled={syncing}
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          title="Send to LeadSquared"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          {s && s !== "pending" && !HELD.includes(s) ? "Retry" : "Sync"}
        </button>
      </div>
    );
  }
  if (!s) return <span className="text-sm text-gray-400">—</span>;
  const style = s === "synced" ? "bg-green-100 text-green-700" : s === "failed" ? "bg-red-100 text-red-700" : crmStatusLook(s).className;
  const label = lsqLabel(s);
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${style}`} title={s === "failed" ? formatCrmSyncError(lead.leadsquaredSyncError) : HELD.includes(s) ? lead.leadsquaredSyncError || undefined : undefined}>
      {label}
    </span>
  );
}

const GRID = "36px minmax(150px, 1.3fr) 160px 150px 190px minmax(200px, 1.5fr) 110px 150px";

/** The group's WhatsApp leads (the "WhatsApp leads" side of the group Leads page switch). */
export function GroupWhatsappLeadsList({ leads, total, loading, hasMore, loadingMore, onLoadMore, hasFilters, onClearFilters, onOpen, onSync, syncingId }: {
  leads: GroupWhatsappLead[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  onOpen: (lead: GroupWhatsappLead) => void;
  onSync: (lead: GroupWhatsappLead) => void;
  syncingId: string | null;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-green-200 border-t-green-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400 mt-4">Loading WhatsApp leads...</p>
      </div>
    );
  }
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gray-50 to-green-50 flex items-center justify-center mb-5">
          <FaWhatsapp className="w-10 h-10 text-green-300" />
        </div>
        <h3 className="text-base font-semibold text-gray-700 mb-1.5">No WhatsApp leads found</h3>
        <p className="text-sm text-gray-400 text-center max-w-xs">
          {hasFilters
            ? "Try adjusting your filters or search term to find matching leads."
            : "Leads will appear here as students share their details on WhatsApp."}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="mt-4 text-purple-600 hover:text-purple-700 hover:bg-purple-50" onClick={onClearFilters}>
            <X className="w-3.5 h-3.5 mr-1.5" /> Clear all filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-fit flex-1">
      <div
        className="sticky top-0 z-10 grid items-center gap-3 px-6 py-3 bg-gray-50/95 backdrop-blur border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500"
        style={{ gridTemplateColumns: GRID }}
      >
        <span />
        <span>Name</span>
        <span>Account</span>
        <span>Phone</span>
        <span>Email</span>
        <span>Details</span>
        <span>LeadSquared</span>
        <span>Received</span>
      </div>
      <div className="divide-y divide-gray-50">
        {leads.map((lead) => {
          const details = leadDetails(lead);
          return (
            <div key={lead.id} onClick={() => onOpen(lead)} className="grid cursor-pointer items-center gap-3 px-6 py-3 hover:bg-green-50/30 transition-colors" style={{ gridTemplateColumns: GRID }}>
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <FaWhatsapp className="w-4 h-4 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${lead.name ? "text-gray-900" : "text-gray-400 italic font-normal"}`}>{lead.name || "Anonymous"}</p>
                {lead.lastMessage && <p className="truncate text-xs text-gray-400" title={lead.lastMessage}>{lead.lastMessage}</p>}
              </div>
              <span className="truncate text-xs font-medium px-2 py-1 rounded-md bg-gray-100 text-gray-700 w-fit max-w-full" title={lead.businessAccountName}>
                {lead.businessAccountName}
              </span>
              <span
                className={`text-sm font-mono ${lead.phone && isMaskedValue(lead.phone) ? "text-gray-500" : "text-gray-700"}`}
                title={lead.contactsHiddenFromView ? "Hidden from view. The full number is kept for CRM sync." : undefined}
              >
                {lead.phone || "—"}
              </span>
              <span className="truncate text-sm text-gray-700" title={lead.email || undefined}>{lead.email || <span className="text-gray-400">—</span>}</span>
              <div className="flex min-w-0 flex-wrap gap-1" title={details.join("\n")}>
                {details.length === 0 ? <span className="text-sm text-gray-400">—</span> : details.slice(0, 2).map((d) => (
                  <span key={d} className="max-w-[220px] truncate px-2 py-0.5 text-xs rounded-full bg-green-50 text-green-800">{d}</span>
                ))}
                {details.length > 2 && <span className="px-1.5 py-0.5 text-xs font-medium text-gray-500">+{details.length - 2}</span>}
              </div>
              <div><LsqStatus lead={lead} onSync={onSync} syncing={syncingId === lead.id} /></div>
              <span className="whitespace-nowrap text-sm text-gray-600">{format(new Date(lead.capturedAt), "MMM d, yyyy h:mm a")}</span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="flex justify-center py-4">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Load more ({(total - leads.length).toLocaleString()} more)
          </Button>
        </div>
      )}
    </div>
  );
}

/** A WhatsApp lead's details: contact, every answer, LeadSquared status, Sync and Open chat. */
export function GroupWhatsappLeadSheet({ lead, onClose, onSync, syncing, onOpenChat }: {
  lead: GroupWhatsappLead | null;
  onClose: () => void;
  onSync: (lead: GroupWhatsappLead) => void;
  syncing: boolean;
  onOpenChat?: (lead: GroupWhatsappLead) => void;
}) {
  const answers = lead ? leadAnswers(lead) : [];
  return (
    <Sheet open={!!lead} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {lead && (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600">
                  <FaWhatsapp className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{lead.name || "WhatsApp lead"}</SheetTitle>
                  <SheetDescription className="truncate">{lead.businessAccountName} · {format(new Date(lead.capturedAt), "MMM d, yyyy h:mm a")}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              {lead.contactsHiddenFromView && (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Contact details are hidden here. The real details are kept for your CRM.</p>
              )}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Contact</h4>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Phone</dt><dd className="font-mono text-gray-900">{lead.phone || "—"}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Email</dt><dd className="truncate text-gray-900">{lead.email || "—"}</dd></div>
                </dl>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">What they shared</h4>
                {answers.length === 0 ? (
                  <p className="text-sm text-gray-400">No other details.</p>
                ) : (
                  <dl className="space-y-1.5 text-sm">
                    {answers.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4"><dt className="shrink-0 text-gray-500">{k}</dt><dd className="text-right text-gray-900 break-words">{v}</dd></div>
                    ))}
                  </dl>
                )}
              </section>

              {lead.lastMessage && (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Last message</h4>
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{lead.lastMessage}</p>
                </section>
              )}

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">LeadSquared</h4>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="text-gray-900">{lsqLabel(lead.leadsquaredSyncStatus)}</p>
                    {lead.leadsquaredSyncStatus === "synced" && lead.leadsquaredSyncedAt && (
                      <p className="text-xs text-gray-500">{format(new Date(lead.leadsquaredSyncedAt), "MMM d, yyyy h:mm a")}</p>
                    )}
                    {lead.leadsquaredSyncStatus === "failed" && <p className="text-xs text-red-600">{formatCrmSyncError(lead.leadsquaredSyncError)}</p>}
                    {HELD.includes(lead.leadsquaredSyncStatus ?? "") && lead.leadsquaredSyncError && <p className="text-xs text-gray-500">{lead.leadsquaredSyncError}</p>}
                  </div>
                  {lead.canSyncLeadSquared && lead.leadsquaredSyncStatus !== "synced" && (
                    <Button size="sm" variant="outline" onClick={() => onSync(lead)} disabled={syncing}>
                      <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                      {lead.leadsquaredSyncStatus && lead.leadsquaredSyncStatus !== "pending" && !HELD.includes(lead.leadsquaredSyncStatus) ? "Retry sync" : "Sync now"}
                    </Button>
                  )}
                </div>
              </section>

              {onOpenChat && lead.chatKey && (
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => onOpenChat(lead)}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Open WhatsApp chat
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
