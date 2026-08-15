import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown, ChevronUp, Loader2, ShieldCheck, Lock, Plus, Trash2, Pencil, Info, Sparkles,
} from "lucide-react";

// ----- Types -----------------------------------------------------------

type Severity = "info" | "warning" | "blocker";
type RuleType = "presence" | "cross_field" | "threshold" | "chronology";

interface RuleSet {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystemSeed: boolean;
}

interface Rule {
  id: string;
  ruleSetId: string;
  ruleType: RuleType;
  name: string;
  severity: Severity;
  messageTemplate: string;
  sortOrder: number;
  isActive: boolean;
  config: Record<string, any>;
}

const severityClass: Record<Severity, string> = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  blocker: "bg-red-100 text-red-700",
};

const ruleTypeLabel: Record<RuleType, string> = {
  presence: "Required documents",
  cross_field: "Cross-document match",
  threshold: "Value threshold",
  chronology: "Date chronology",
};

// One-sentence explainer per rule type, shown in the editor and as a legend.
const ruleTypeHelp: Record<RuleType, string> = {
  presence: "Fails when the lead has not uploaded one of the required documents (by document-type key).",
  cross_field: "Checks that the same field — like name or date of birth — agrees across two or more documents.",
  threshold: "Compares a single field on a single document against a value (≥, ≤, =, regex, in list).",
  chronology: "Checks the gap (in years) between a date field on one document and a date field on another.",
};

// Per-field info copy used in tooltips next to each config input.
type FieldHelp = { label: string; help: string };
const fieldHelp: Record<RuleType, Record<string, FieldHelp>> = {
  presence: {
    requiredDocTypes: { label: "Required document types", help: "Comma-separated document-type keys. Use the same keys configured under Document Types. Example: aadhaar_card, tenth_marksheet, graduation_marksheet" },
  },
  cross_field: {
    field: { label: "Field to compare", help: "The extracted field name to compare across documents. Example: name, dob, phone" },
    docTypes: { label: "Documents to compare", help: "Two or more document-type keys whose values for the field above should match. Example: aadhaar_card, tenth_marksheet" },
    comparator: { label: "Comparator", help: "How to compare the values. 'Exact' = string equality, 'Fuzzy name' = lenient name match, 'Date' = parse to date, 'Numeric' = parse to number with tolerance." },
    threshold: { label: "Threshold", help: "For 'Fuzzy name', a similarity 0–1 (e.g. 0.85 ≈ 'close enough'). For 'Numeric', the maximum allowed absolute difference." },
  },
  threshold: {
    docType: { label: "Document type", help: "The document-type key whose field you want to threshold. Example: graduation_marksheet" },
    field: { label: "Field", help: "The extracted field on that document to test. Example: percentage_or_cgpa" },
    operator: { label: "Operator", help: "Comparison operator. Use 'in' for a CSV allow-list, 'regex' for a pattern." },
    value: { label: "Value", help: "Right-hand value to compare against. Numbers are auto-parsed. For 'in', enter a CSV list (e.g. Open,General,OBC)." },
    normalizeCgpa: { label: "Normalize CGPA → %", help: "When the extracted value is ≤ 10 it is treated as CGPA and converted to a percentage by multiplying by 9.5." },
  },
  chronology: {
    "from.docType": { label: "From — document type", help: "Document key whose date is the start of the gap. Example: twelfth_marksheet" },
    "from.field": { label: "From — field", help: "The date/year field on that document. Example: passing_year" },
    "to.docType": { label: "To — document type", help: "Document key whose date is the end of the gap. Example: graduation_marksheet" },
    "to.field": { label: "To — field", help: "The date/year field on the second document." },
    maxGapYears: { label: "Max gap (years)", help: "Rule fails if the gap is larger than this. Leave empty to skip the maximum check." },
    minGapYears: { label: "Min gap (years)", help: "Rule fails if the gap is smaller than this. Leave empty to skip the minimum check." },
  },
};

// Compose a plain-English summary of a single rule from its config.
function summarizeRule(rule: Rule): string {
  const cfg = rule.config || {};
  switch (rule.ruleType) {
    case "presence": {
      const docs = (cfg.requiredDocTypes as string[]) || [];
      if (docs.length === 0) return "Requires documents — but no document types are configured yet.";
      return `Requires the lead to upload: ${docs.join(", ")}.`;
    }
    case "cross_field": {
      const docs = (cfg.docTypes as string[]) || [];
      const cmp = cfg.comparator || "exact";
      const cmpLabel: Record<string, string> = {
        exact: "exact match",
        fuzzy_name: `fuzzy name match${cfg.threshold ? ` ≥ ${cfg.threshold}` : ""}`,
        date: "date equality",
        numeric: `numeric equality${cfg.threshold ? ` (±${cfg.threshold})` : ""}`,
      };
      return `Compares "${cfg.field || "?"}" across ${docs.join(" + ") || "(no documents)"} using ${cmpLabel[cmp] || cmp}.`;
    }
    case "threshold": {
      const op = cfg.operator || "?";
      const val = Array.isArray(cfg.value) ? cfg.value.join(", ") : cfg.value;
      const norm = cfg.normalizeCgpa ? " (CGPA values are normalised to %)" : "";
      return `Checks ${cfg.docType || "?"}.${cfg.field || "?"} ${op} ${val ?? "?"}${norm}.`;
    }
    case "chronology": {
      const from = cfg.from || {};
      const to = cfg.to || {};
      const bounds: string[] = [];
      if (cfg.minGapYears != null) bounds.push(`≥ ${cfg.minGapYears}y`);
      if (cfg.maxGapYears != null) bounds.push(`≤ ${cfg.maxGapYears}y`);
      return `Gap between ${from.docType || "?"}.${from.field || "?"} and ${to.docType || "?"}.${to.field || "?"} must be ${bounds.join(" and ") || "(no bound)"}.`;
    }
  }
  return "Unknown rule type.";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ----- Info icon helpers ---------------------------------------------

function InfoHint({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center text-gray-400 hover:text-gray-600" data-testid={testId} aria-label="More info">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left whitespace-normal leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ ruleType, fieldKey }: { ruleType: RuleType; fieldKey: string }) {
  const meta = fieldHelp[ruleType]?.[fieldKey];
  if (!meta) return <Label>{fieldKey}</Label>;
  return (
    <div className="flex items-center gap-1.5">
      <Label>{meta.label}</Label>
      <InfoHint testId={`info-${ruleType}-${fieldKey}`}>{meta.help}</InfoHint>
    </div>
  );
}

// ----- Rule set editor dialog -----------------------------------------

function RuleSetDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<RuleSet>;
  onSave: (data: { name: string; description: string | null }) => Promise<any>;
  onRequestDelete?: () => void;
}) {
  const [name, setName] = useState(props.initial?.name || "");
  const [description, setDescription] = useState(props.initial?.description || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  return (
    <Dialog open={props.open} onOpenChange={(o) => { props.onOpenChange(o); if (o) { setName(props.initial?.name || ""); setDescription(props.initial?.description || ""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.initial?.id ? "Edit rule set" : "New rule set"}</DialogTitle>
          <DialogDescription>Rule sets group verification rules that run together against a lead.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rule-set-name" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description || ""} onChange={(e) => setDescription(e.target.value)} rows={3} data-testid="input-rule-set-description" />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {props.initial?.id && props.onRequestDelete && (
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => props.onRequestDelete!()}
                data-testid="button-delete-rule-set-dialog"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete rule set
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={saving || !name.trim()}
              onClick={async () => {
                try {
                  setSaving(true);
                  await props.onSave({ name: name.trim(), description: description.trim() || null });
                  props.onOpenChange(false);
                } catch (err: any) {
                  toast({ title: "Failed to save", description: err.message, variant: "destructive" });
                } finally {
                  setSaving(false);
                }
              }}
              data-testid="button-save-rule-set"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----- Document-type aware selectors ---------------------------------

interface DocTypeExtractionField {
  key: string;
  label: string;
  required?: boolean;
}

interface DocTypeOption {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  extractionFields: DocTypeExtractionField[];
}

function useActiveDocTypes(): { docTypes: DocTypeOption[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<{ documentTypes: DocTypeOption[] }>({
    queryKey: ["/api/whatsapp/document-types"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/document-types", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch document types");
      return res.json();
    },
  });
  const docTypes = (data?.documentTypes || []).filter(dt => dt.isActive);
  return { docTypes, isLoading };
}

function labelForDocKey(docTypes: DocTypeOption[], key: string): string {
  const match = docTypes.find(dt => dt.key === key);
  return match ? `${match.name} (${match.key})` : `${key} (not configured)`;
}

// Multi-select popover of active document types, returns/accepts list of doc keys.
function DocTypeMultiSelect({
  value, onChange, docTypes, placeholder, testId,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  docTypes: DocTypeOption[];
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (k: string) => {
    if (value.includes(k)) onChange(value.filter(v => v !== k));
    else onChange([...value, k]);
  };
  const summary = value.length === 0
    ? (placeholder || "Select document types")
    : value.map(k => docTypes.find(dt => dt.key === k)?.name || k).join(", ");
  // Show any "orphan" keys (referenced but no longer active/configured) so admins can remove them.
  const orphans = value.filter(v => !docTypes.some(dt => dt.key === v));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate text-left", value.length === 0 && "text-muted-foreground")}>{summary}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-2 max-h-[280px] overflow-y-auto" align="start">
        {docTypes.length === 0 && (
          <p className="text-xs text-gray-500 p-2">No active document types. Enable some in the Document Types section above.</p>
        )}
        {docTypes.map(dt => (
          <label key={dt.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer" data-testid={`doctype-option-${dt.key}`}>
            <Checkbox checked={value.includes(dt.key)} onCheckedChange={() => toggle(dt.key)} />
            <span className="text-sm flex-1 truncate">{dt.name}</span>
            <code className="text-[10px] text-gray-400">{dt.key}</code>
          </label>
        ))}
        {orphans.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <p className="text-[10px] uppercase tracking-wide text-amber-600 px-2 mb-1">Unavailable (referenced but not configured)</p>
            {orphans.map(k => (
              <label key={k} className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer">
                <Checkbox checked onCheckedChange={() => toggle(k)} />
                <span className="text-sm flex-1 truncate text-amber-700">{k}</span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Single-select document type (uses SearchableSelect for nicer UX with many types).
function DocTypeSelect({
  value, onChange, docTypes, placeholder, testId,
}: {
  value: string;
  onChange: (next: string) => void;
  docTypes: DocTypeOption[];
  placeholder?: string;
  testId?: string;
}) {
  const options = docTypes.map(dt => ({ value: dt.key, label: `${dt.name} (${dt.key})` }));
  // If current value isn't in active list, surface it so it can be re-picked or replaced.
  if (value && !docTypes.some(dt => dt.key === value)) {
    options.unshift({ value, label: `${value} (not configured)` });
  }
  return (
    <div data-testid={testId}>
      <SearchableSelect
        value={value}
        onValueChange={onChange}
        placeholder={placeholder || "Select document type"}
        searchPlaceholder="Search documents…"
        options={options}
        emptyMessage="No active document types. Enable some above."
      />
    </div>
  );
}

// Single-select extraction field, cascading from one or more selected doc types.
// When multiple docTypes are given, fields are grouped by their owning doc type for clarity.
function FieldSelect({
  value, onChange, docTypes, fromDocKeys, placeholder, testId,
}: {
  value: string;
  onChange: (next: string) => void;
  docTypes: DocTypeOption[];
  fromDocKeys: string[];
  placeholder?: string;
  testId?: string;
}) {
  const selectedDocs = docTypes.filter(dt => fromDocKeys.includes(dt.key));

  // Build option groups: one per selected doc type, deduped by field key within each group.
  // If no doc selected yet, fall back to flat list of all fields across all active docs.
  const groups = (selectedDocs.length > 0 ? selectedDocs : docTypes).map(dt => ({
    label: dt.name,
    options: (dt.extractionFields || []).map(f => ({
      value: f.key,
      label: f.label ? `${f.label} (${f.key})` : f.key,
    })),
  })).filter(g => g.options.length > 0);

  // Surface orphan value (e.g. legacy data) so admin sees it and can re-pick.
  const allKeys = new Set(groups.flatMap(g => g.options.map(o => o.value)));
  const hasOrphan = value && !allKeys.has(value);

  const finalGroups = hasOrphan
    ? [{ label: "Current value (not in any selected document)", options: [{ value, label: `${value} (not configured)` }] }, ...groups]
    : groups;

  if (finalGroups.length === 0) {
    // No fields available — fall back to text input so the form is still usable.
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Pick a document type first"}
        data-testid={testId}
      />
    );
  }

  return (
    <div data-testid={testId}>
      <SearchableSelect
        value={value}
        onValueChange={onChange}
        placeholder={placeholder || "Select field"}
        searchPlaceholder="Search fields…"
        groups={finalGroups}
        emptyMessage="No fields available."
      />
    </div>
  );
}

// ----- Rule editor dialog --------------------------------------------

function RuleConfigForm({ ruleType, config, onChange, docTypes }: { ruleType: RuleType; config: Record<string, any>; onChange: (c: Record<string, any>) => void; docTypes: DocTypeOption[] }) {
  const setField = (k: string, v: any) => onChange({ ...config, [k]: v });

  const noDocsConfigured = docTypes.length === 0;
  const noDocsHint = noDocsConfigured ? (
    <p className="text-xs text-amber-600">
      No active document types found. Configure and enable some in the <strong>Document Types</strong> section above first.
    </p>
  ) : null;

  if (ruleType === "presence") {
    const list = (config.requiredDocTypes as string[]) || [];
    return (
      <div className="space-y-1">
        <FieldLabel ruleType="presence" fieldKey="requiredDocTypes" />
        <DocTypeMultiSelect
          value={list}
          onChange={(next) => setField("requiredDocTypes", next)}
          docTypes={docTypes}
          placeholder="Pick required document types"
          testId="input-cfg-required-docs"
        />
        {noDocsHint || (
          <p className="text-xs text-gray-500">Only documents currently enabled in <strong>Document Types</strong> are shown.</p>
        )}
      </div>
    );
  }

  if (ruleType === "cross_field") {
    const docs = (config.docTypes as string[]) || [];
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <FieldLabel ruleType="cross_field" fieldKey="docTypes" />
          <DocTypeMultiSelect
            value={docs}
            onChange={(next) => setField("docTypes", next)}
            docTypes={docTypes}
            placeholder="Pick at least 2 document types"
            testId="input-cfg-doctypes"
          />
          {noDocsHint}
        </div>
        <div className="space-y-1">
          <FieldLabel ruleType="cross_field" fieldKey="field" />
          <FieldSelect
            value={config.field || ""}
            onChange={(v) => setField("field", v)}
            docTypes={docTypes}
            fromDocKeys={docs}
            placeholder={docs.length === 0 ? "Pick documents first" : "Select field to compare"}
            testId="input-cfg-field"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel ruleType="cross_field" fieldKey="comparator" />
            <select className="w-full border rounded px-2 py-1.5 text-sm bg-white" value={config.comparator || "exact"} onChange={(e) => setField("comparator", e.target.value)} data-testid="select-cfg-comparator">
              <option value="exact">Exact</option>
              <option value="fuzzy_name">Fuzzy name</option>
              <option value="date">Date</option>
              <option value="numeric">Numeric</option>
            </select>
          </div>
          <div className="space-y-1">
            <FieldLabel ruleType="cross_field" fieldKey="threshold" />
            <Input type="number" step="0.01" value={config.threshold ?? ""} onChange={(e) => setField("threshold", e.target.value === "" ? undefined : parseFloat(e.target.value))} data-testid="input-cfg-threshold" />
          </div>
        </div>
      </div>
    );
  }

  if (ruleType === "threshold") {
    const docKey = config.docType || "";
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel ruleType="threshold" fieldKey="docType" />
            <DocTypeSelect
              value={docKey}
              onChange={(v) => {
                // Clear the field when doc type changes, since field options come from the new doc.
                const prev = config.docType;
                onChange({ ...config, docType: v, field: prev && prev !== v ? "" : config.field });
              }}
              docTypes={docTypes}
              placeholder="Select document"
              testId="input-cfg-doctype"
            />
            {noDocsHint}
          </div>
          <div className="space-y-1">
            <FieldLabel ruleType="threshold" fieldKey="field" />
            <FieldSelect
              value={config.field || ""}
              onChange={(v) => setField("field", v)}
              docTypes={docTypes}
              fromDocKeys={docKey ? [docKey] : []}
              placeholder={docKey ? "Select field" : "Pick a document first"}
              testId="input-cfg-field"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel ruleType="threshold" fieldKey="operator" />
            <select className="w-full border rounded px-2 py-1.5 text-sm bg-white" value={config.operator || ">="} onChange={(e) => setField("operator", e.target.value)} data-testid="select-cfg-operator">
              <option value=">=">≥</option>
              <option value="<=">≤</option>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value="==">=</option>
              <option value="regex">regex</option>
              <option value="in">in (csv list)</option>
            </select>
          </div>
          <div className="space-y-1">
            <FieldLabel ruleType="threshold" fieldKey="value" />
            <Input value={Array.isArray(config.value) ? config.value.join(",") : (config.value ?? "")} onChange={(e) => {
              const raw = e.target.value;
              if (config.operator === "in") setField("value", raw.split(",").map(s => s.trim()).filter(Boolean));
              else if (!isNaN(Number(raw)) && raw !== "") setField("value", Number(raw));
              else setField("value", raw);
            }} data-testid="input-cfg-value" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!config.normalizeCgpa} onChange={(e) => setField("normalizeCgpa", e.target.checked)} data-testid="checkbox-cfg-normalize-cgpa" />
          <span className="inline-flex items-center gap-1.5">
            Normalize CGPA → percentage (×9.5 when value ≤ 10)
            <InfoHint testId="info-threshold-normalizeCgpa">{fieldHelp.threshold.normalizeCgpa.help}</InfoHint>
          </span>
        </label>
      </div>
    );
  }

  // chronology
  const from = config.from || {};
  const to = config.to || {};
  return (
    <div className="space-y-3">
      {noDocsHint}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="from.docType" />
          <DocTypeSelect
            value={from.docType || ""}
            onChange={(v) => setField("from", { ...from, docType: v, field: from.docType && from.docType !== v ? "" : from.field })}
            docTypes={docTypes}
            placeholder="Select 'from' document"
            testId="input-cfg-from-doctype"
          />
        </div>
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="from.field" />
          <FieldSelect
            value={from.field || ""}
            onChange={(v) => setField("from", { ...from, field: v })}
            docTypes={docTypes}
            fromDocKeys={from.docType ? [from.docType] : []}
            placeholder={from.docType ? "Select date field" : "Pick a document first"}
            testId="input-cfg-from-field"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="to.docType" />
          <DocTypeSelect
            value={to.docType || ""}
            onChange={(v) => setField("to", { ...to, docType: v, field: to.docType && to.docType !== v ? "" : to.field })}
            docTypes={docTypes}
            placeholder="Select 'to' document"
            testId="input-cfg-to-doctype"
          />
        </div>
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="to.field" />
          <FieldSelect
            value={to.field || ""}
            onChange={(v) => setField("to", { ...to, field: v })}
            docTypes={docTypes}
            fromDocKeys={to.docType ? [to.docType] : []}
            placeholder={to.docType ? "Select date field" : "Pick a document first"}
            testId="input-cfg-to-field"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="maxGapYears" />
          <Input type="number" value={config.maxGapYears ?? ""} onChange={(e) => setField("maxGapYears", e.target.value === "" ? undefined : parseInt(e.target.value, 10))} data-testid="input-cfg-max-gap" />
        </div>
        <div className="space-y-1">
          <FieldLabel ruleType="chronology" fieldKey="minGapYears" />
          <Input type="number" value={config.minGapYears ?? ""} onChange={(e) => setField("minGapYears", e.target.value === "" ? undefined : parseInt(e.target.value, 10))} data-testid="input-cfg-min-gap" />
        </div>
      </div>
    </div>
  );
}

function RuleDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<Rule>;
  onSave: (data: { ruleType: RuleType; name: string; severity: Severity; messageTemplate: string; config: Record<string, any>; sortOrder: number }) => Promise<any>;
}) {
  const [ruleType, setRuleType] = useState<RuleType>((props.initial?.ruleType as RuleType) || "presence");
  const [name, setName] = useState(props.initial?.name || "");
  // Task #1 — Severity model collapsed to Warning + Blocker. Legacy "info"
  // rules loaded from the DB are surfaced as Warning in the editor (and saved
  // back as "warning") so admins can no longer pick the retired tier.
  const [severity, setSeverity] = useState<Severity>(
    (props.initial?.severity === "blocker" ? "blocker" : "warning") as Severity,
  );
  const [messageTemplate, setMessageTemplate] = useState(props.initial?.messageTemplate || "");
  const [config, setConfig] = useState<Record<string, any>>(props.initial?.config || {});
  const [sortOrder, setSortOrder] = useState<number>(props.initial?.sortOrder ?? 0);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { docTypes } = useActiveDocTypes();

  const reset = () => {
    setRuleType((props.initial?.ruleType as RuleType) || "presence");
    setName(props.initial?.name || "");
    setSeverity((props.initial?.severity === "blocker" ? "blocker" : "warning") as Severity);
    setMessageTemplate(props.initial?.messageTemplate || "");
    setConfig(props.initial?.config || {});
    setSortOrder(props.initial?.sortOrder ?? 0);
  };

  const validate = (): string | null => {
    if (!name.trim()) return "Name is required";
    if (!messageTemplate.trim()) return "Message template is required";
    if (ruleType === "presence" && !((config.requiredDocTypes as string[])?.length)) return "At least one required document type";
    if (ruleType === "cross_field") {
      if (!config.field) return "Field is required";
      if (!((config.docTypes as string[])?.length) || (config.docTypes as string[]).length < 2) return "Pick at least 2 document types to compare";
    }
    if (ruleType === "threshold") {
      if (!config.docType || !config.field || !config.operator || config.value === undefined || config.value === "") return "docType, field, operator and value are required";
    }
    if (ruleType === "chronology") {
      if (!config.from?.docType || !config.from?.field || !config.to?.docType || !config.to?.field) return "From and To docType+field are required";
      if (config.maxGapYears == null && config.minGapYears == null) return "Set at least one of max/min gap years";
    }
    return null;
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => { props.onOpenChange(o); if (o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.initial?.id ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>
            Templates support <code className="text-[10px] bg-gray-100 px-1 rounded">{"{field}"}</code>, <code className="text-[10px] bg-gray-100 px-1 rounded">{"{values}"}</code>, <code className="text-[10px] bg-gray-100 px-1 rounded">{"{docs}"}</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Rule type</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-white" value={ruleType} onChange={(e) => { setRuleType(e.target.value as RuleType); setConfig({}); }} data-testid="select-rule-type">
                {(Object.keys(ruleTypeLabel) as RuleType[]).map(rt => (
                  <option key={rt} value={rt}>{ruleTypeLabel[rt]}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 leading-snug pt-1" data-testid="text-rule-type-help">{ruleTypeHelp[ruleType]}</p>
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <select className="w-full border rounded px-2 py-1.5 text-sm bg-white" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} data-testid="select-severity">
                <option value="warning">Warning</option>
                <option value="blocker">Blocker</option>
              </select>
              <p className="text-xs text-gray-500 leading-snug pt-1">
                <strong>Blocker</strong> → reject the upload and ask the customer to re-upload. <strong>Warning</strong> → notify the customer but accept the document and continue the flow.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Rule name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rule-name" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label>Message template</Label>
              <InfoHint testId="info-message-template">
                Shown to the customer when this rule fails. Placeholders are filled at runtime:
                <br />• <code>{"{field}"}</code> — the field name being checked
                <br />• <code>{"{values}"}</code> — the actual values that didn't match
                <br />• <code>{"{docs}"}</code> — the document(s) involved
              </InfoHint>
            </div>
            <Textarea value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} rows={2} data-testid="input-message-template" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label>Sort order</Label>
              <InfoHint testId="info-sort-order">
                Controls the position of this rule in the list — rules are shown and run from lowest number to highest. Has no effect on the verification outcome itself.
              </InfoHint>
            </div>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))} className="w-24" data-testid="input-sort-order" />
          </div>
          <div className="border rounded-lg p-3 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2 font-semibold uppercase">Configuration</p>
            <RuleConfigForm ruleType={ruleType} config={config} onChange={setConfig} docTypes={docTypes} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              const err = validate();
              if (err) { toast({ title: "Invalid rule", description: err, variant: "destructive" }); return; }
              try {
                setSaving(true);
                await props.onSave({ ruleType, name: name.trim(), severity, messageTemplate: messageTemplate.trim(), config, sortOrder });
                props.onOpenChange(false);
              } catch (e: any) {
                toast({ title: "Failed to save", description: e.message, variant: "destructive" });
              } finally {
                setSaving(false);
              }
            }}
            data-testid="button-save-rule"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----- Rule list for a single rule set --------------------------------

function RuleList({ ruleSetId }: { ruleSetId: string }) {
  const { data, isLoading } = useQuery<{ rules: Rule[] }>({
    queryKey: ["verification-rules", ruleSetId],
    queryFn: () => api(`/api/verification/rule-sets/${ruleSetId}/rules`),
  });
  const { toast } = useToast();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["verification-rules", ruleSetId] });

  const toggleRule = useMutation({
    mutationFn: (vars: { ruleId: string; isActive: boolean }) =>
      api(`/api/verification/rule-sets/${ruleSetId}/rules/${vars.ruleId}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: vars.isActive }),
      }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Failed to update rule", description: err.message, variant: "destructive" }),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) =>
      api(`/api/verification/rule-sets/${ruleSetId}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Failed to delete rule", description: err.message, variant: "destructive" }),
  });

  const saveRule = async (data: any) => {
    if (editing?.id) {
      await api(`/api/verification/rule-sets/${ruleSetId}/rules/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) });
    } else {
      await api(`/api/verification/rule-sets/${ruleSetId}/rules`, { method: "POST", body: JSON.stringify(data) });
    }
    invalidate();
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500 py-2 px-3 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading rules…</div>;
  }
  const rules = data?.rules || [];

  return (
    <div>
      {rules.length > 0 && (
        <div className="px-3 py-2 border-b bg-blue-50/40 text-[11px] text-gray-600 space-y-0.5">
          <p className="font-semibold uppercase tracking-wide text-gray-500">Rule type legend</p>
          {(Object.keys(ruleTypeLabel) as RuleType[]).map(rt => (
            <p key={rt}><span className="font-medium text-gray-700">{ruleTypeLabel[rt]}:</span> {ruleTypeHelp[rt]}</p>
          ))}
        </div>
      )}
      {rules.length === 0 ? (
        <div className="text-sm text-gray-500 py-2 px-3">No rules in this set yet.</div>
      ) : (
        <div className="divide-y">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-start justify-between gap-3 px-3 py-2" data-testid={`rule-row-${rule.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{rule.name}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">{ruleTypeLabel[rule.ruleType] || rule.ruleType}</Badge>
                  {/* Task #1 — legacy "info" rules are surfaced as Warning in the UI. */}
                  {(() => {
                    const displaySev: Severity = rule.severity === "blocker" ? "blocker" : "warning";
                    return (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${severityClass[displaySev]}`}>{displaySev}</span>
                    );
                  })()}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-gray-400 hover:text-gray-700" aria-label="Explain this rule" data-testid={`button-info-rule-${rule.id}`}>
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-xs leading-snug space-y-2" data-testid={`popover-info-rule-${rule.id}`}>
                      <div>
                        <p className="font-semibold text-gray-700">{ruleTypeLabel[rule.ruleType]}</p>
                        <p className="text-gray-500">{ruleTypeHelp[rule.ruleType]}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-700">What this rule checks</p>
                        <p className="text-gray-600">{summarizeRule(rule)}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-700">Message to customer on fail</p>
                        <p className="text-gray-600 italic">"{rule.messageTemplate}"</p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate" title={summarizeRule(rule)}>{summarizeRule(rule)}</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch
                  className="scale-75"
                  checked={rule.isActive}
                  onCheckedChange={(v) => toggleRule.mutate({ ruleId: rule.id, isActive: v })}
                  data-testid={`switch-rule-${rule.id}`}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(rule); }} data-testid={`button-edit-rule-${rule.id}`}>
                  <Pencil className="h-3.5 w-3.5 text-gray-500" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteRule.mutate(rule.id); }} data-testid={`button-delete-rule-${rule.id}`}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="px-3 py-2 border-t bg-gray-50">
        <Button size="sm" variant="outline" className="w-full" onClick={() => setCreating(true)} data-testid={`button-add-rule-${ruleSetId}`}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
        </Button>
      </div>
      {creating && (
        <RuleDialog open={creating} onOpenChange={setCreating} onSave={saveRule} />
      )}
      {editing && (
        <RuleDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} initial={editing} onSave={saveRule} />
      )}
    </div>
  );
}

// ----- Top-level section ----------------------------------------------

const SEED_RULE_SET_NAME = "Student Admission";
const LEGACY_SEED_RULE_SET_NAMES = ["Student Admission — Jain Online"];

export function VerificationRulesSection() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creatingSet, setCreatingSet] = useState(false);
  const [editingSet, setEditingSet] = useState<RuleSet | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RuleSet | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ ruleSets: RuleSet[] }>({
    queryKey: ["verification-rule-sets"],
    queryFn: () => api("/api/verification/rule-sets"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["verification-rule-sets"] });

  const toggleSet = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      api(`/api/verification/rule-sets/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: vars.isActive }),
      }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Failed to update rule set", description: err.message, variant: "destructive" }),
  });

  const deleteSet = useMutation({
    mutationFn: (id: string) => api(`/api/verification/rule-sets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Rule set deleted" });
    },
    onError: (err: Error) => toast({ title: "Failed to delete rule set", description: err.message, variant: "destructive" }),
  });

  const seedDemo = useMutation({
    mutationFn: () => api(`/api/verification/rule-sets/seed-demo`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Demo rule set created", description: `"${SEED_RULE_SET_NAME}" has been added.` });
    },
    onError: (err: Error) => toast({ title: "Failed to create demo rule set", description: err.message, variant: "destructive" }),
  });

  const saveSet = async (payload: { name: string; description: string | null }) => {
    if (editingSet?.id) {
      await api(`/api/verification/rule-sets/${editingSet.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api(`/api/verification/rule-sets`, { method: "POST", body: JSON.stringify(payload) });
    }
    invalidate();
  };

  if (isLoading) {
    return <div className="py-4 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  }

  const ruleSets = data?.ruleSets || [];
  const hasDemo = ruleSets.some(rs => rs.isSystemSeed || rs.name === SEED_RULE_SET_NAME || LEGACY_SEED_RULE_SET_NAMES.includes(rs.name));

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-2">
        {ruleSets.length === 0 && (
          <p className="text-sm text-gray-500">No rule sets yet — create your own, or load the demo to see a worked example.</p>
        )}
        {ruleSets.map(rs => {
          const isOpen = !!expanded[rs.id];
          return (
            <div key={rs.id} className="border rounded-lg overflow-hidden" data-testid={`rule-set-${rs.id}`}>
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                <button
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                  onClick={() => setExpanded(s => ({ ...s, [rs.id]: !s[rs.id] }))}
                  data-testid={`button-toggle-rule-set-${rs.id}`}
                >
                  {isOpen ? <ChevronUp className="h-4 w-4 text-gray-500 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />}
                  <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <span className="font-medium text-sm truncate">{rs.name}</span>
                  {rs.isSystemSeed && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase text-gray-500 flex-shrink-0">
                      <Lock className="h-2.5 w-2.5" /> seed
                    </span>
                  )}
                </button>
                <Switch
                  className="scale-75"
                  checked={rs.isActive}
                  onCheckedChange={(v) => toggleSet.mutate({ id: rs.id, isActive: v })}
                  data-testid={`switch-rule-set-${rs.id}`}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingSet(rs)} data-testid={`button-edit-rule-set-${rs.id}`}>
                  <Pencil className="h-3.5 w-3.5 text-gray-500" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirmDelete(rs)} data-testid={`button-delete-rule-set-${rs.id}`}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
              {rs.description && (
                <p className="text-xs text-gray-500 px-3 py-1.5 border-t bg-white">{rs.description}</p>
              )}
              {isOpen && (
                <div className="border-t bg-white">
                  <RuleList ruleSetId={rs.id} />
                </div>
              )}
            </div>
          );
        })}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setCreatingSet(true)} data-testid="button-add-rule-set">
            <Plus className="h-4 w-4 mr-1" /> Add Custom Rule Set
          </Button>
          {!hasDemo && (
            <Button
              variant="outline"
              onClick={() => seedDemo.mutate()}
              disabled={seedDemo.isPending}
              data-testid="button-seed-demo-rule-set"
            >
              {seedDemo.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Create demo rule set
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-400 pt-1">
          Attach a rule set to a flow by opening <strong>WhatsApp → Conversation Flows → Edit Flow Settings</strong> and choosing it from the <em>Verification rule set</em> dropdown. Rules then run after every document upload.
        </p>

        {creatingSet && (
          <RuleSetDialog open={creatingSet} onOpenChange={setCreatingSet} onSave={saveSet} />
        )}
        {editingSet && (
          <RuleSetDialog
            open={!!editingSet}
            onOpenChange={(o) => { if (!o) setEditingSet(null); }}
            initial={editingSet}
            onSave={async (p) => { await saveSet(p); setEditingSet(null); }}
            onRequestDelete={() => setConfirmDelete(editingSet)}
          />
        )}

        <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
          <AlertDialogContent data-testid="dialog-confirm-delete-rule-set">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete rule set?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{confirmDelete?.name}</strong> and all of its rules. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteSet.isPending} data-testid="button-confirm-delete-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteSet.isPending}
                className={cn(buttonVariants({ variant: "destructive" }))}
                onClick={async (e) => {
                  e.preventDefault();
                  if (!confirmDelete) return;
                  try {
                    await deleteSet.mutateAsync(confirmDelete.id);
                    setConfirmDelete(null);
                    setEditingSet(null);
                  } catch {
                    // Failure toast already surfaced by mutation's onError handler.
                  }
                }}
                data-testid="button-confirm-delete-rule-set"
              >
                {deleteSet.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
