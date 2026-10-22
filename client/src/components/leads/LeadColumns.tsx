import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Columns3, Filter, GitBranch, Mail, MapPin, MessageSquare, Phone, RotateCcw } from "lucide-react";
import { isMaskedValue } from "@shared/contactMasking";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Leads table columns a business can show, hide and reorder (Name, CRM and actions always show).
 * Journey questions are columns too: `q:<question text>`.
 */
export type LeadColumnKey = string;

export const DEFAULT_LEAD_COLUMNS: LeadColumnKey[] = ["phone", "email", "city", "topics", "funnel"];

export const BUILT_IN_LEAD_COLUMNS: Array<{ key: LeadColumnKey; label: string; group: string }> = [
  { key: "phone", label: "Phone", group: "Contact" },
  { key: "email", label: "Email", group: "Contact" },
  { key: "city", label: "City", group: "Contact" },
  { key: "topics", label: "Topics", group: "What they want" },
  { key: "message", label: "Message", group: "What they want" },
  { key: "funnel", label: "Funnel", group: "Source" },
  { key: "captured", label: "Captured", group: "Source" },
  { key: "pageUrl", label: "Page URL", group: "Source" },
  { key: "landingUrl", label: "Landing page", group: "Source" },
  { key: "utmSource", label: "UTM source", group: "Source" },
  { key: "utmMedium", label: "UTM medium", group: "Source" },
  { key: "utmCampaign", label: "UTM campaign", group: "Source" },
  { key: "journey", label: "Journey", group: "Journey" },
  { key: "leadId", label: "Lead ID", group: "Other" },
];

export const questionColumnKey = (question: string) => `q:${question}`;

export function leadColumnLabel(key: LeadColumnKey): string {
  if (key.startsWith("q:")) return key.slice(2);
  return BUILT_IN_LEAD_COLUMNS.find(c => c.key === key)?.label || key;
}

/** A campaign parameter from the page URL, else from the landing page (first touch). */
export function campaignParam(pageUrl: string | null | undefined, landingUrl: string | null | undefined, name: string): string | null {
  for (const url of [pageUrl, landingUrl]) {
    if (!url) continue;
    try {
      const value = new URL(url).searchParams.get(name);
      if (value) return value;
    } catch { /* not a URL */ }
  }
  return null;
}

/** A website lead's value for an extra (text) column, as plain text; null when empty. */
export function websiteLeadColumnText(key: LeadColumnKey, lead: Record<string, any>): string | null {
  if (key.startsWith("q:")) {
    const answers = (lead.journeyAnswers || {}) as Record<string, string>;
    return answers[key.slice(2)] || null;
  }
  switch (key) {
    case "message": return lead.message || null;
    case "pageUrl": return lead.sourceUrl || null;
    case "landingUrl": return lead.landingUrl || null;
    case "utmSource": return campaignParam(lead.sourceUrl, lead.landingUrl, "utm_source");
    case "utmMedium": return campaignParam(lead.sourceUrl, lead.landingUrl, "utm_medium");
    case "utmCampaign": return campaignParam(lead.sourceUrl, lead.landingUrl, "utm_campaign");
    case "journey": return lead.journeyName || null;
    case "leadId": return lead.id || null;
    default: return null;
  }
}

/** Header icon for a column (null when it has none). */
export function leadColumnIcon(key: LeadColumnKey): ReactNode {
  return key === 'phone' ? <Phone className="h-4 w-4 text-green-600" />
    : key === 'email' ? <Mail className="h-4 w-4 text-blue-600" />
    : key === 'city' ? <MapPin className="h-4 w-4 text-red-500" />
    : key === 'topics' ? <MessageSquare className="h-4 w-4 text-purple-600" />
    : key === 'funnel' ? <Filter className="h-4 w-4 text-indigo-600" />
    : key.startsWith('q:') ? <GitBranch className="h-4 w-4 text-violet-600" />
    : null;
}

/** Header width class for a column. */
export function leadColumnWidth(key: LeadColumnKey): string {
  return key === 'phone' ? 'w-[140px]' : key === 'email' ? 'w-[170px]' : key === 'city' ? 'w-[100px]'
    : key === 'topics' ? 'w-[180px]' : key === 'funnel' ? 'w-[120px]' : 'min-w-[120px] max-w-[220px]';
}

const FUNNEL_VALUES = ['Via Form', 'Via Journey Form', 'Discount Availed'];
const EMPTY = <span className="text-gray-400 text-sm">—</span>;

/** A website lead's cell content for one column (the business Leads table and the group admin's). */
export function WebsiteLeadColumnCell({ columnKey, lead }: { columnKey: LeadColumnKey; lead: Record<string, any> }) {
  switch (columnKey) {
    case 'phone':
      return lead.phone && isMaskedValue(lead.phone) ? (
        <span className="text-sm text-gray-500 font-mono" title="Hidden after sync. The CRM has the full number.">{lead.phone}</span>
      ) : lead.phone ? (
        <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()} className="text-sm text-green-600 hover:text-green-700 hover:underline transition-colors font-mono">{lead.phone}</a>
      ) : EMPTY;
    case 'email':
      return lead.email ? <span className="text-sm text-gray-700 truncate block max-w-[160px]" title={lead.email}>{lead.email}</span> : EMPTY;
    case 'city':
      return lead.city ? <span className="text-sm text-gray-600">{lead.city}</span> : EMPTY;
    case 'topics': {
      // Real interests only: journey answers are shown with their questions in the lead panel.
      const topics: string[] = Array.isArray(lead.interestTopics)
        ? lead.interestTopics
        : Array.isArray(lead.topicsOfInterest) ? (lead.topicsOfInterest as string[]).filter(t => !FUNNEL_VALUES.includes(t)) : [];
      if (topics.length > 0) {
        const colors = ['bg-purple-100 text-purple-700', 'bg-blue-100 text-blue-700'];
        return (
          <div className="flex flex-wrap items-center gap-1" title={topics.join(', ')}>
            {topics.slice(0, 2).map((topic, i) => (
              <span key={i} className={`max-w-[160px] truncate px-2 py-0.5 text-xs font-medium rounded-full ${colors[i % colors.length]}`}>{topic}</span>
            ))}
            {topics.length > 2 && <span className="px-1.5 py-0.5 text-xs font-medium text-gray-500">+{topics.length - 2}</span>}
          </div>
        );
      }
      if (lead.hasJourneyAnswers) return <span className="text-xs text-gray-500">Journey answers · open lead</span>;
      return lead.message && lead.message !== 'Via Chat'
        ? <span className="block max-w-[200px] truncate text-sm text-gray-500 italic" title={lead.message}>{lead.message}</span>
        : EMPTY;
    }
    case 'funnel': {
      const allTopics: string[] = Array.isArray(lead.topicsOfInterest) ? lead.topicsOfInterest : [];
      if (allTopics.includes('Discount Availed')) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">Discount Availed</span>;
      if (allTopics.includes('Via Form')) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Via Form</span>;
      if (allTopics.includes('Via Journey Form')) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Via Journey</span>;
      return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">Via Chat</span>;
    }
    case 'captured':
      return <span className="whitespace-nowrap text-sm text-gray-600">{format(new Date(lead.createdAt), "MMM d, yyyy h:mm a")}</span>;
    default: {
      const text = websiteLeadColumnText(columnKey, lead);
      if (!text) return EMPTY;
      return /^https?:\/\//i.test(text) ? (
        <a href={text} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          className="block max-w-[220px] truncate text-sm text-blue-600 hover:underline" title={text}>
          {text.replace(/^https?:\/\/(www\.)?/i, '')}
        </a>
      ) : (
        <span className="block max-w-[220px] truncate text-sm text-gray-700" title={text}>{text}</span>
      );
    }
  }
}

/** "Columns" button: tick columns to show, move them up / down, or go back to the default. */
export function LeadColumnsPicker({ columns, journeyQuestions, onChange, saving, excludeKeys, alwaysShownLabel = "Only Name and CRM", savedForLabel = "Saved for everyone on your team" }: {
  columns: LeadColumnKey[];
  journeyQuestions: string[];
  onChange: (columns: LeadColumnKey[] | null) => void;
  saving?: boolean;
  /** Built-in columns this table always shows itself (not offered here). */
  excludeKeys?: LeadColumnKey[];
  alwaysShownLabel?: string;
  savedForLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const available = useMemo(() => {
    const all = [...BUILT_IN_LEAD_COLUMNS.map(c => c.key).filter(k => !excludeKeys?.includes(k)), ...journeyQuestions.map(questionColumnKey)];
    return all.filter(k => !columns.includes(k));
  }, [columns, journeyQuestions, excludeKeys]);

  const move = (index: number, delta: number) => {
    const next = [...columns];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const toggle = (key: LeadColumnKey, on: boolean) => {
    onChange(on ? [...columns, key] : columns.filter(k => k !== key));
  };
  const groupOf = (key: LeadColumnKey) => key.startsWith("q:") ? "Journey questions" : BUILT_IN_LEAD_COLUMNS.find(c => c.key === key)?.group || "Other";
  const availableGroups = Array.from(new Set(available.map(groupOf)));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 gap-2" data-testid="button-lead-columns">
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-gray-900">Columns</p>
            <p className="text-[11px] text-gray-500">{savedForLabel}{saving ? " · saving…" : ""}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1.5">
          <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Shown (in this order)</p>
          {columns.length === 0 && <p className="px-3 py-1 text-xs text-gray-400">{alwaysShownLabel}</p>}
          {columns.map((key, i) => (
            <div key={key} className="group flex items-center gap-2 px-3 py-1 hover:bg-gray-50">
              <Checkbox checked onCheckedChange={() => toggle(key, false)} aria-label={`Hide ${leadColumnLabel(key)}`} />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800" title={leadColumnLabel(key)}>{leadColumnLabel(key)}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-25">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === columns.length - 1} aria-label="Move down"
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-25">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {availableGroups.map(group => (
            <div key={group}>
              <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{group}</p>
              {available.filter(k => groupOf(k) === group).map(key => (
                <label key={key} className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-gray-50">
                  <Checkbox checked={false} onCheckedChange={() => toggle(key, true)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-600" title={leadColumnLabel(key)}>{leadColumnLabel(key)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
