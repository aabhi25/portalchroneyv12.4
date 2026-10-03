import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";

export function StepWho({ ctx }: { ctx: WizardCtx }) {
  const { v, set, isAutomation, groups } = ctx;
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const visibleGroups = groups.filter(g => g.name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggleGroup = (id: string, on: boolean) =>
    set({ groupIds: on ? Array.from(new Set([...v.groupIds, id])) : v.groupIds.filter(g => g !== id) });

  return (
    <div className="space-y-4">
      <StepSection title="Campaign name and type">
        <div>
          <label className="text-sm font-medium text-gray-700" htmlFor="campaign-name">Campaign name</label>
          <Input
            id="campaign-name"
            className="mt-1"
            value={v.name}
            onChange={e => set({ name: e.target.value })}
            placeholder="Diwali offer 2026"
            data-testid="input-campaign-name"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            ["one_time", "Send once", "Pick who gets it and when."],
            ["automation", "Repeat automatically", "Save the message now; set up who gets it and when in Automations."],
          ] as const).map(([value, label, description]) => (
            <button
              key={value}
              type="button"
              onClick={() => set(value === "automation"
                ? { campaignType: value, groupIds: [], scheduledAt: "" }
                : { campaignType: value })}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                v.campaignType === value
                  ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                  : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"
              }`}
              data-testid={`button-campaign-type-${value}`}
            >
              <span className="block text-sm font-medium text-gray-800">{label}</span>
              <span className="mt-1 block text-xs text-gray-500">{description}</span>
            </button>
          ))}
        </div>
      </StepSection>

      {!isAutomation ? (
        <StepSection
          title="Who should get it?"
          description="Pick one or more audiences. Each phone number gets the message only once."
          action={<Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-emerald-700" onClick={() => setLocation("/admin/whatsapp-contact-groups")}>Manage audiences</Button>}
        >
          {groups.length > 6 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input className="pl-8" placeholder="Search audiences" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          )}
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">No audiences yet. Create one and add contacts first.</p>
          ) : (
            <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {visibleGroups.map(g => {
                const empty = g.contactCount === 0;
                const checked = v.groupIds.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-3 px-3 py-3 text-sm ${empty ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
                    data-testid={`checkbox-group-${g.id}`}
                  >
                    <Checkbox checked={checked} disabled={empty && !checked} onCheckedChange={c => toggleGroup(g.id, !!c)} />
                    <Users className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <Badge variant="outline" className="shrink-0">{empty ? "Empty" : `${g.contactCount.toLocaleString()} contacts`}</Badge>
                  </label>
                );
              })}
              {visibleGroups.length === 0 && <p className="p-4 text-center text-sm text-gray-500">No audience matches "{search}".</p>}
            </div>
          )}
          {v.groupIds.length > 0 && <AudienceCounts ctx={ctx} />}
        </StepSection>
      ) : (
        <AutomationSource ctx={ctx} />
      )}
    </div>
  );
}

export function AudienceCounts({ ctx, compact = false }: { ctx: WizardCtx; compact?: boolean }) {
  const { preview, previewLoading } = ctx;
  if (previewLoading && !preview) {
    return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Counting people…</p>;
  }
  if (!preview) return null;
  const { invalid, duplicates, optedOut } = preview.skipped;
  const skippedTotal = invalid + duplicates + optedOut;
  return (
    <div className={`rounded-lg border ${preview.willSend > 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"} p-3`} data-testid="audience-counts">
      <p className={`flex items-center gap-2 font-medium ${preview.willSend > 0 ? "text-emerald-800" : "text-amber-800"} ${compact ? "text-sm" : "text-base"}`}>
        {preview.willSend > 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {preview.willSend.toLocaleString()} {preview.willSend === 1 ? "person" : "people"} will get this message
      </p>
      {skippedTotal > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {duplicates > 0 && <li>• {duplicates.toLocaleString()} duplicate number{duplicates === 1 ? "" : "s"} — they get it only once</li>}
          {optedOut > 0 && <li>• {optedOut.toLocaleString()} opted out — they asked not to get messages</li>}
          {invalid > 0 && <li>• {invalid.toLocaleString()} invalid number{invalid === 1 ? "" : "s"} — missing the country code or too short, will be skipped</li>}
        </ul>
      )}
    </div>
  );
}

function AutomationSource({ ctx }: { ctx: WizardCtx }) {
  const { v, set, groups, workbooks, workbookSheet } = ctx;
  const source = v.recipientSourceType || "ai_workbook";
  const columns = workbookSheet?.columns || [];
  const sample = workbookSheet?.rows?.[0]?.values;
  const allow = v.recipientAiAllowedFields || [];
  return (
    <StepSection title="Where the contacts come from" description="When and to whom it repeats is set up next, in Automations.">
      <div>
        <label className="text-sm font-medium text-gray-700">Contact source</label>
        <Select value={source} onValueChange={(value: "ai_workbook" | "contact_groups") => set(value === "ai_workbook"
          ? { recipientSourceType: value, groupIds: [] }
          : { recipientSourceType: value, recipientWorkbookId: "", recipientPhoneColumn: v.recipientPhoneColumn || "phone" })}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ai_workbook">AI Workbook</SelectItem>
            <SelectItem value="contact_groups">Fixed audiences</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {source === "ai_workbook" ? (
        <>
          <div>
            <label className="text-sm font-medium text-gray-700">AI Workbook</label>
            <Select value={v.recipientWorkbookId || undefined} onValueChange={value => set({ recipientWorkbookId: value, recipientWorkbookSheetId: "", recipientAiAllowedFields: [] })}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a workbook" /></SelectTrigger>
              <SelectContent>
                {workbooks.filter(w => w.status === "active").map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}{w.latestVersion ? ` · v${w.latestVersion.versionNumber}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {workbookSheet && (
            <div className="space-y-1 rounded-md border bg-gray-50 p-3 text-xs">
              <p className="font-medium text-gray-700">Sheet: {workbookSheet.name} · {columns.length} columns</p>
              {sample && <p className="break-words text-gray-600">First row: {columns.slice(0, 5).map(c => `${c.label}: ${String(sample[c.key] ?? "—")}`).join(" · ")}</p>}
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700">Mobile number column</label>
            <Select value={v.recipientPhoneColumn || undefined} onValueChange={value => set({ recipientPhoneColumn: value })}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose the column with phone numbers" /></SelectTrigger>
              <SelectContent>{columns.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {columns.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700">Details the AI may use in replies</label>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {columns.map(c => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox checked={allow.includes(c.key)} onCheckedChange={checked => set({ recipientAiAllowedFields: checked ? [...allow, c.key] : allow.filter(k => k !== c.key) })} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="divide-y rounded-lg border">
          {groups.map(g => (
            <label key={g.id} className="flex items-center gap-3 px-3 py-3 text-sm">
              <Checkbox
                checked={v.groupIds.includes(g.id)}
                disabled={g.contactCount === 0}
                onCheckedChange={checked => set({ groupIds: checked ? [...v.groupIds, g.id] : v.groupIds.filter(id => id !== g.id) })}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <Badge variant="outline">{g.contactCount} contacts</Badge>
            </label>
          ))}
        </div>
      )}
    </StepSection>
  );
}
