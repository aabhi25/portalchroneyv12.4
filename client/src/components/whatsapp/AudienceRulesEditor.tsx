import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Users, X } from "lucide-react";

export interface LeadFilter {
  channels?: string[];
  lastNDays?: number | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  topic?: string | null;
  search?: string | null;
}

export interface ContactCondition {
  field: string;
  op: "equals" | "not_equals" | "contains" | "not_contains" | "is_empty" | "not_empty";
  value?: string;
}

export type AudienceRules =
  | { source: "leads"; leads: LeadFilter }
  | { source: "contacts"; contacts: { groupIds?: string[]; match?: "all" | "any"; conditions?: ContactCondition[] } };

export interface AudiencePreview {
  matched: number;
  withoutPhone: number;
  duplicates: number;
  optedOut: number;
  count: number;
  sample: { phone: string; name: string }[];
}

interface LeadOptions {
  channels: string[];
  statuses: string[];
  topics: string[];
  phonesHidden: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website chat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

const OP_LABELS: Record<ContactCondition["op"], string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  is_empty: "is empty",
  not_empty: "is filled in",
};

const ANY = "__any__";

function useDebounced<T>(value: T, ms = 500): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [JSON.stringify(value), ms]);
  return debounced;
}

/** Live "how many people match" for a set of rules (debounced, read-only). */
export function useAudiencePreview(rules: AudienceRules | null, excludeGroupId?: string) {
  const debounced = useDebounced(rules);
  return useQuery<AudiencePreview>({
    queryKey: ["/api/whatsapp/audiences/preview-rules", JSON.stringify(debounced), excludeGroupId || ""],
    queryFn: () => apiRequest<AudiencePreview>("POST", "/api/whatsapp/audiences/preview-rules", { rules: debounced, excludeGroupId }),
    enabled: Boolean(debounced),
    staleTime: 15_000,
    retry: false,
  });
}

export function AudiencePreviewLine({ preview, isFetching, error }: { preview?: AudiencePreview; isFetching: boolean; error?: Error | null }) {
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (!preview) {
    return <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting people…</p>;
  }
  const skipped = [
    preview.duplicates ? `${preview.duplicates.toLocaleString()} duplicate${preview.duplicates === 1 ? "" : "s"}` : "",
    preview.optedOut ? `${preview.optedOut.toLocaleString()} opted out` : "",
    preview.withoutPhone ? `${preview.withoutPhone.toLocaleString()} without a phone number` : "",
  ].filter(Boolean);
  return (
    <div className="rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2 text-sm" data-testid="text-audience-preview">
      <div className="flex items-center gap-2 font-medium text-teal-900">
        <Users className="h-4 w-4" />
        {preview.count.toLocaleString()} {preview.count === 1 ? "person" : "people"} right now
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" />}
      </div>
      {skipped.length > 0 && <div className="text-xs text-teal-800 mt-0.5">Left out: {skipped.join(" · ")}</div>}
      {preview.sample.length > 0 && (
        <div className="text-xs text-gray-600 mt-1 truncate">
          e.g. {preview.sample.slice(0, 3).map(s => s.name || s.phone).join(", ")}
        </div>
      )}
    </div>
  );
}

/** Filters for picking people out of the business's Leads. */
export function LeadFilterFields({ value, onChange }: { value: LeadFilter; onChange: (next: LeadFilter) => void }) {
  const { data: options } = useQuery<LeadOptions>({ queryKey: ["/api/whatsapp/audiences/lead-options"] });
  const dateMode = value.lastNDays ? String(value.lastNDays) : value.from || value.to ? "custom" : "all";
  const channels = value.channels || [];
  const toggleChannel = (channel: string, on: boolean) => {
    const next = on ? Array.from(new Set([...channels, channel])) : channels.filter(c => c !== channel);
    onChange({ ...value, channels: next });
  };

  return (
    <div className="space-y-3">
      {options?.phonesHidden && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Lead phone numbers are hidden for your account, so audiences can't be built from leads.
        </p>
      )}
      <div>
        <Label className="text-sm">Where the lead came from</Label>
        <div className="flex flex-wrap gap-3 mt-1.5">
          {(options?.channels || ["website"]).map(channel => (
            <label key={channel} className="flex items-center gap-2 text-sm">
              <Checkbox checked={channels.includes(channel)} onCheckedChange={v => toggleChannel(channel, v === true)} />
              {CHANNEL_LABELS[channel] || channel}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">Leave all unticked to include every channel.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-sm">When</Label>
          <Select
            value={dateMode}
            onValueChange={mode => {
              if (mode === "all") onChange({ ...value, lastNDays: null, from: null, to: null });
              else if (mode === "custom") onChange({ ...value, lastNDays: null });
              else onChange({ ...value, lastNDays: Number(mode), from: null, to: null });
            }}
          >
            <SelectTrigger className="mt-1" data-testid="select-lead-date"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="custom">Pick dates…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {options && options.statuses.length > 0 && (
          <div>
            <Label className="text-sm">Lead status</Label>
            <Select value={value.status || ANY} onValueChange={v => onChange({ ...value, status: v === ANY ? null : v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any status</SelectItem>
                {options.statuses.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {dateMode === "custom" && (
        <div className="grid gap-3 grid-cols-2">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={(value.from || "").slice(0, 10)} onChange={e => onChange({ ...value, lastNDays: null, from: e.target.value || null })} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={(value.to || "").slice(0, 10)} onChange={e => onChange({ ...value, lastNDays: null, to: e.target.value || null })} />
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {options && options.topics.length > 0 && (
          <div>
            <Label className="text-sm">Interested in</Label>
            <Select value={value.topic || ANY} onValueChange={v => onChange({ ...value, topic: v === ANY ? null : v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any topic</SelectItem>
                {options.topics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label className="text-sm">Contains text (optional)</Label>
          <Input className="mt-1" value={value.search || ""} onChange={e => onChange({ ...value, search: e.target.value })} placeholder="Name, email or message" />
        </div>
      </div>
    </div>
  );
}

interface AudienceOption { id: string; name: string; audienceType?: string; contactCount: number }

/** Rules for a self-updating audience: from leads, or from people already in other audiences. */
export function AudienceRulesEditor({
  value, onChange, excludeGroupId,
}: {
  value: AudienceRules;
  onChange: (next: AudienceRules) => void;
  excludeGroupId?: string;
}) {
  const { data: groups = [] } = useQuery<AudienceOption[]>({ queryKey: ["/api/whatsapp/contact-groups"] });
  const { data: fieldData } = useQuery<{ fields: string[] }>({
    queryKey: ["/api/whatsapp/audiences/fields"],
    enabled: value.source === "contacts",
  });
  const staticGroups = groups.filter(g => (g.audienceType || "static") === "static" && g.id !== excludeGroupId);
  const contacts = value.source === "contacts" ? value.contacts : { groupIds: [], match: "all" as const, conditions: [] };
  const conditions = contacts.conditions || [];
  const setContacts = (patch: Partial<typeof contacts>) => onChange({ source: "contacts", contacts: { ...contacts, ...patch } });
  const fieldOptions = ["name", "phone", ...(fieldData?.fields || []).map(f => `attr:${f}`)];
  const fieldLabel = (f: string) => (f === "name" ? "Name" : f === "phone" ? "Phone" : f.slice(5));

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm">People come from</Label>
        <div className="grid gap-2 sm:grid-cols-2 mt-1.5">
          <button
            type="button"
            onClick={() => value.source !== "leads" && onChange({ source: "leads", leads: { lastNDays: 30 } })}
            className={`text-left rounded-lg border px-3 py-2 ${value.source === "leads" ? "border-teal-400 bg-teal-50/60" : "border-gray-200 hover:bg-gray-50"}`}
            data-testid="button-rules-source-leads"
          >
            <div className="text-sm font-medium">Your leads</div>
            <div className="text-xs text-gray-500">People who contacted you on your website or social channels.</div>
          </button>
          <button
            type="button"
            onClick={() => value.source !== "contacts" && onChange({ source: "contacts", contacts: { groupIds: [], match: "all", conditions: [] } })}
            className={`text-left rounded-lg border px-3 py-2 ${value.source === "contacts" ? "border-teal-400 bg-teal-50/60" : "border-gray-200 hover:bg-gray-50"}`}
            data-testid="button-rules-source-contacts"
          >
            <div className="text-sm font-medium">Your other audiences</div>
            <div className="text-xs text-gray-500">People already in your lists, filtered by their details.</div>
          </button>
        </div>
      </div>

      {value.source === "leads" ? (
        <LeadFilterFields value={value.leads} onChange={leads => onChange({ source: "leads", leads })} />
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-sm">From these audiences</Label>
            <div className="mt-1.5 max-h-36 overflow-y-auto rounded-md border divide-y">
              {staticGroups.length === 0 ? (
                <div className="p-3 text-xs text-gray-500">You have no other audiences yet.</div>
              ) : staticGroups.map(g => (
                <label key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Checkbox
                    checked={(contacts.groupIds || []).includes(g.id)}
                    onCheckedChange={v => setContacts({
                      groupIds: v === true
                        ? Array.from(new Set([...(contacts.groupIds || []), g.id]))
                        : (contacts.groupIds || []).filter(id => id !== g.id),
                    })}
                  />
                  <span className="truncate flex-1">{g.name}</span>
                  <span className="text-xs text-gray-400">{g.contactCount.toLocaleString()}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">Tick none to use all of them.</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm">Only people where</Label>
              {conditions.length > 1 && (
                <Select value={contacts.match || "all"} onValueChange={v => setContacts({ match: v as "all" | "any" })}>
                  <SelectTrigger className="h-8 w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all conditions match</SelectItem>
                    <SelectItem value="any">any condition matches</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2 mt-1.5">
              {conditions.length === 0 && <p className="text-xs text-gray-500">No conditions — everyone in the chosen audiences is included.</p>}
              {conditions.map((condition, index) => (
                <div key={index} className="grid gap-2 grid-cols-[1fr,1fr,auto] sm:grid-cols-[1fr,140px,1fr,auto] items-center">
                  <Select value={condition.field} onValueChange={field => setContacts({ conditions: conditions.map((c, i) => (i === index ? { ...c, field } : c)) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set([...fieldOptions, condition.field])).map(f => <SelectItem key={f} value={f}>{fieldLabel(f)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={condition.op} onValueChange={op => setContacts({ conditions: conditions.map((c, i) => (i === index ? { ...c, op: op as ContactCondition["op"] } : c)) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(OP_LABELS) as ContactCondition["op"][]).map(op => <SelectItem key={op} value={op}>{OP_LABELS[op]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    className="col-span-2 sm:col-span-1 order-last sm:order-none"
                    value={condition.value || ""}
                    disabled={condition.op === "is_empty" || condition.op === "not_empty"}
                    onChange={e => setContacts({ conditions: conditions.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)) })}
                    placeholder="Value"
                  />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => setContacts({ conditions: conditions.filter((_, i) => i !== index) })}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setContacts({ conditions: [...conditions, { field: fieldOptions[2] || "name", op: "equals", value: "" }] })}
                data-testid="button-add-condition"
              >
                <Plus className="h-4 w-4 mr-1" /> Add condition
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Short, readable summary of saved rules, e.g. "Leads · last 30 days · WhatsApp". */
export function describeRules(rules: AudienceRules | null | undefined, groupNames?: Map<string, string>): string {
  if (!rules) return "";
  if (rules.source === "leads") {
    const f = rules.leads || {};
    const parts = ["From your leads"];
    if (f.lastNDays) parts.push(f.lastNDays === 1 ? "last 24 hours" : `last ${f.lastNDays} days`);
    else if (f.from || f.to) parts.push(`${(f.from || "…").slice(0, 10)} to ${(f.to || "…").slice(0, 10)}`);
    if (f.channels && f.channels.length) parts.push(f.channels.map(c => CHANNEL_LABELS[c] || c).join(", "));
    if (f.status) parts.push(`status ${f.status}`);
    if (f.topic) parts.push(`interested in ${f.topic}`);
    if (f.search) parts.push(`contains "${f.search}"`);
    return parts.join(" · ");
  }
  const c = rules.contacts || {};
  const from = c.groupIds && c.groupIds.length
    ? c.groupIds.map(id => groupNames?.get(id) || "an audience").join(", ")
    : "all your audiences";
  const conds = (c.conditions || []).map(x => {
    const field = x.field === "name" ? "Name" : x.field === "phone" ? "Phone" : x.field.slice(5);
    return x.op === "is_empty" || x.op === "not_empty" ? `${field} ${OP_LABELS[x.op]}` : `${field} ${OP_LABELS[x.op]} "${x.value || ""}"`;
  });
  return `From ${from}${conds.length ? ` · where ${conds.join(c.match === "any" ? " or " : " and ")}` : ""}`;
}
