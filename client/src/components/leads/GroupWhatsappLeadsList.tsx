import { format } from "date-fns";
import { Loader2, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { isMaskedValue } from "@shared/contactMasking";
import { Button } from "@/components/ui/button";
import { formatCrmSyncError } from "@/lib/crmSyncError";

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

/** The lead's other answers (course, city, …) as "Label: value", for the Details column. */
function leadDetails(lead: GroupWhatsappLead): string[] {
  return Object.entries(lead.extractedData || {})
    .filter(([k, v]) => !CONTACT_FIELD.test(k) && v != null && typeof v !== "object" && String(v).trim() !== "")
    .map(([k, v]) => `${fieldLabel(k)}: ${String(v).trim()}`);
}

function LsqStatus({ lead }: { lead: GroupWhatsappLead }) {
  const s = lead.leadsquaredSyncStatus;
  if (!s) return <span className="text-sm text-gray-400">—</span>;
  const style = s === "synced" ? "bg-green-100 text-green-700" : s === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600";
  const label = s === "synced" ? "Synced" : s === "failed" ? "Failed" : s === "pending" ? "Pending" : s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${style}`} title={s === "failed" ? formatCrmSyncError(lead.leadsquaredSyncError) : undefined}>
      {label}
    </span>
  );
}

const GRID = "36px minmax(150px, 1.3fr) 160px 150px 190px minmax(200px, 1.5fr) 110px 150px";

/** The group's WhatsApp leads (the "WhatsApp leads" side of the group Leads page switch). */
export function GroupWhatsappLeadsList({ leads, total, loading, hasMore, loadingMore, onLoadMore, hasFilters, onClearFilters }: {
  leads: GroupWhatsappLead[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
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
            <div key={lead.id} className="grid items-center gap-3 px-6 py-3 hover:bg-green-50/30 transition-colors" style={{ gridTemplateColumns: GRID }}>
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
              <div><LsqStatus lead={lead} /></div>
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
