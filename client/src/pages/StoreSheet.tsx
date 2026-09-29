import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  SHEET_COLUMNS, SHEET_LEVELS, EMI_FORMAT_HINT, parseEmiSchemes, formatEmiSchemes,
  type EmiScheme, type SheetColumn, type SheetLevel, type StoreSheetRow, type StoreSheetRowInput,
} from "@shared/storeSheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle, ChevronDown, ChevronUp, Copy, Download, Eye, FileSpreadsheet, KeyRound, Link2, Loader2,
  Plus, RefreshCw, Search, Sparkles, Store, Trash2, Upload, X,
} from "lucide-react";

// ─── Types & API ─────────────────────────────────────────────────────────────

const QUERY_KEY = ["/api/store-sheet"] as const;

interface LinkedStep {
  stepId: string;
  stepKey: string;
  stepOrder: number;
  prompt: string;
  saveToField: string | null;
  level: SheetLevel | null;
  suggestedLevel: SheetLevel | null;
}

interface SheetResponse {
  enabled: boolean;
  rows: StoreSheetRow[];
  linkedSteps: LinkedStep[];
  flowName: string | null;
  canRevealSecrets: boolean;
  /** Stores in the journey's own lists that aren't in the sheet yet. */
  journeyStoresNotInSheet: number;
}

interface NamedRow { dealer: string; city: string; store: string }

interface ImportPreview {
  added: (NamedRow & { rowNumber: number })[];
  changed: (NamedRow & { rowNumber: number; id: string; fields: string[] })[];
  unchangedCount: number;
  removed: (NamedRow & { id: string })[];
  errors: { rowNumber: number; message: string }[];
}

interface SeedPreview {
  rows: (NamedRow & {
    emiSchemes: EmiScheme[];
    matchedCredentialId: string | null;
    losStoreName: string | null;
    notes: string[];
  })[];
  unmatchedCount: number;
  alreadyInSheet: number;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status})`);
  return data as T;
}

const showError = (err: unknown) =>
  toast({ title: "Couldn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });

const LEVEL_LABELS: Record<SheetLevel, string> = { dealer: "Dealer", city: "City", store: "Store", emi: "EMI scheme" };
const REQUIRED_LEVELS: SheetLevel[] = ["dealer", "city", "store"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** Checks which sheet levels are missing or used twice in a step → level assignment. */
function levelProblems(levels: (SheetLevel | null)[]) {
  const counts: Record<SheetLevel, number> = { dealer: 0, city: 0, store: 0, emi: 0 };
  for (const l of levels) if (l) counts[l]++;
  const duplicated = SHEET_LEVELS.filter(l => counts[l] > 1);
  const missing = SHEET_LEVELS.filter(l => counts[l] === 0);
  const ready = REQUIRED_LEVELS.every(l => counts[l] === 1) && duplicated.length === 0;
  return { duplicated, missing, ready };
}

/** Applies a PATCH body to a row for the optimistic update. */
function applyPatch(row: StoreSheetRow, p: Partial<StoreSheetRowInput>): StoreSheetRow {
  const next: StoreSheetRow = { ...row };
  if (p.dealer !== undefined) next.dealer = p.dealer;
  if (p.city !== undefined) next.city = p.city;
  if (p.store !== undefined) next.store = p.store;
  if (p.emiSchemes !== undefined) next.emiSchemes = p.emiSchemes;
  if (p.losDealerName !== undefined) next.losDealerName = p.losDealerName ?? "";
  if (p.losStoreName !== undefined) next.losStoreName = p.losStoreName ?? "";
  if (p.losStoreId !== undefined) {
    const n = p.losStoreId === null || p.losStoreId === "" ? null : Number(p.losStoreId);
    next.losStoreId = n !== null && Number.isFinite(n) ? n : null;
  }
  if (p.sid !== undefined) next.sid = p.sid ?? "";
  if (p.secret) next.hasSecret = true;
  if (p.isActive !== undefined) next.isActive = p.isActive;
  if (p.inJourney !== undefined) next.inJourney = p.inJourney;
  return next;
}

function updateRowInCache(id: string, fn: (r: StoreSheetRow) => StoreSheetRow) {
  queryClient.setQueryData<SheetResponse>(QUERY_KEY, old =>
    old ? { ...old, rows: old.rows.map(r => (r.id === id ? fn(r) : r)) } : old,
  );
}

// ─── Excel helpers ───────────────────────────────────────────────────────────

const COLUMN_HELP: Record<SheetColumn, string> = {
  "Dealer": "Dealer name the customer sees in WhatsApp. Required.",
  "City": "City the customer picks after the dealer. Required.",
  "Store": "Store name the customer sees. Required. Dealer + City + Store together identify a row.",
  "EMI Schemes": `EMI options for this store: ${EMI_FORMAT_HINT}. The label is shown to the customer, the scheme ID is sent to the LOS.`,
  "LOS Dealer Name": "Dealer name exactly as registered in the LOS. Optional — leave blank if it is the same as Dealer.",
  "LOS Store Name": "Store name exactly as registered in the LOS. Optional — leave blank if it is the same as Store.",
  "LOS Store ID": "Numeric store ID from the LOS.",
  "SID": "Store SID from the LOS, used to sign CRM requests.",
  "Secret": "Store secret from the LOS. Leave blank to keep the secret that is already saved.",
  "Active": "Yes or No. No = the store is not used anywhere. Blank means Yes.",
  "Show in Journey": "Yes or No. No = kept for the LOS (e.g. website leads) but not offered in the WhatsApp dropdowns. Blank means Yes.",
};

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADER_ALIASES: Partial<Record<SheetColumn, string[]>> = {
  "EMI Schemes": ["emi", "emischeme", "schemes"],
  "LOS Store ID": ["storeid", "losid"],
  "Show in Journey": ["injourney", "showinjourney", "journey"],
  "Active": ["isactive", "status"],
};

function autoMap(headers: string[]): Record<SheetColumn, string> {
  const out = {} as Record<SheetColumn, string>;
  for (const col of SHEET_COLUMNS) {
    const wanted = [normHeader(col), ...(HEADER_ALIASES[col] || [])];
    out[col] = headers.find(h => wanted.includes(normHeader(h))) || "";
  }
  return out;
}

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const example = ["Acme Mobiles", "Pune", "Acme FC Road", "6/1=32; 12/1=34", "ACME MOBILES PVT LTD", "ACME FC ROAD PUNE", 1234, "SID1234", "", "Yes", "Yes"];
  const ws = XLSX.utils.aoa_to_sheet([[...SHEET_COLUMNS], example]);
  ws["!cols"] = SHEET_COLUMNS.map(c => ({ wch: Math.max(14, c.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, "Stores");
  const help = XLSX.utils.aoa_to_sheet([
    ["Column", "What to put"],
    ...SHEET_COLUMNS.map(c => [c, COLUMN_HELP[c]]),
    [],
    ["Tip", "One row per store. Replace the example row with your own stores. Blank Secret keeps the current secret."],
  ]);
  help["!cols"] = [{ wch: 18 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, help, "How to fill");
  XLSX.writeFile(wb, "dealers-stores-template.xlsx");
}

async function exportRows(rows: StoreSheetRow[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const data = rows.map(r => [
    r.dealer, r.city, r.store, formatEmiSchemes(r.emiSchemes), r.losDealerName, r.losStoreName,
    r.losStoreId ?? "", r.sid, "", yesNo(r.isActive), yesNo(r.inJourney),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([[...SHEET_COLUMNS], ...data]);
  ws["!cols"] = SHEET_COLUMNS.map(c => ({ wch: Math.max(14, c.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, "Stores");
  const note = XLSX.utils.aoa_to_sheet([
    ["Note"],
    ["Secrets are not exported, so the Secret column is blank. If you upload this file again, blank secrets keep the ones already saved."],
    [],
    ["Column", "What to put"],
    ...SHEET_COLUMNS.map(c => [c, COLUMN_HELP[c]]),
  ]);
  note["!cols"] = [{ wch: 18 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, note, "How to fill");
  XLSX.writeFile(wb, `dealers-stores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Small building blocks ───────────────────────────────────────────────────

function EditableCell({
  value, onSave, ariaLabel, placeholder, required, className, numeric,
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);

  const start = () => { setDraft(value); done.current = false; setEditing(true); };
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const v = draft.trim();
    if (v === value.trim()) return;
    if (required && !v) { toast({ title: `${ariaLabel} can't be empty`, variant: "destructive" }); return; }
    if (numeric && v && !/^\d+$/.test(v)) { toast({ title: `${ariaLabel} must be a number`, variant: "destructive" }); return; }
    onSave(v);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        aria-label={ariaLabel}
        inputMode={numeric ? "numeric" : undefined}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); done.current = true; setEditing(false); }
        }}
        className={`h-8 min-w-[7rem] ${className ?? ""}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Click to edit"
      aria-label={`${ariaLabel}: ${value || "empty"}. Click to edit`}
      className={`w-full min-h-8 px-2 py-1 text-left rounded-md hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring truncate ${className ?? ""}`}
    >
      {value || <span className="text-muted-foreground/70 italic">{placeholder ?? "—"}</span>}
    </button>
  );
}

function EmiChips({ schemes, max = 4 }: { schemes: EmiScheme[]; max?: number }) {
  if (schemes.length === 0) return <span className="text-amber-600 text-xs font-medium">No schemes</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {schemes.slice(0, max).map(s => (
        <Badge key={s.label} variant="secondary" className="font-normal whitespace-nowrap">
          {s.label} <span className="mx-1 text-muted-foreground">→</span> {s.schemeId}
        </Badge>
      ))}
      {schemes.length > max && <Badge variant="outline" className="font-normal">+{schemes.length - max}</Badge>}
    </span>
  );
}

/** Chips that open a small editor for a store's EMI schemes. */
function EmiSchemesEditor({ schemes, onSave, storeName }: { schemes: EmiScheme[]; onSave: (s: EmiScheme[]) => void; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "text">("list");
  const [list, setList] = useState<EmiScheme[]>(schemes);
  const [text, setText] = useState(formatEmiSchemes(schemes));
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setList(schemes.length ? schemes : [{ label: "", schemeId: "" }]); setText(formatEmiSchemes(schemes)); setError(null); setMode("list"); };

  const fromList = (): EmiScheme[] => {
    const filled = list.map(s => ({ label: s.label.trim(), schemeId: s.schemeId.trim() })).filter(s => s.label || s.schemeId);
    const half = filled.find(s => !s.label || !s.schemeId);
    if (half) throw new Error("Each scheme needs both a label and a scheme ID");
    const bad = filled.find(s => /[=;]/.test(s.label) || /[=;\s]/.test(s.schemeId));
    if (bad) throw new Error(`"${bad.label}" — labels can't contain = or ;, and scheme IDs can't contain spaces`);
    return parseEmiSchemes(formatEmiSchemes(filled)); // also checks for duplicate labels
  };

  const switchMode = (m: string) => {
    setError(null);
    try {
      if (m === "text") setText(formatEmiSchemes(fromList()));
      else { const parsed = parseEmiSchemes(text); setList(parsed.length ? parsed : [{ label: "", schemeId: "" }]); }
      setMode(m as "list" | "text");
    } catch (e) { setError((e as Error).message); }
  };

  const save = () => {
    try {
      const next = mode === "list" ? fromList() : parseEmiSchemes(text);
      if (formatEmiSchemes(next) !== formatEmiSchemes(schemes)) onSave(next);
      setOpen(false);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Popover open={open} onOpenChange={o => { if (o) reset(); setOpen(o); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`EMI schemes for ${storeName || "this store"}: ${formatEmiSchemes(schemes) || "none"}. Click to edit`}
          className="w-full min-h-8 px-2 py-1 text-left rounded-md hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <EmiChips schemes={schemes} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem]" align="start">
        <div className="space-y-3">
          <div>
            <p className="font-medium text-sm">EMI schemes{storeName ? ` — ${storeName}` : ""}</p>
            <p className="text-xs text-muted-foreground">Label is what the customer sees; scheme ID is sent to the LOS.</p>
          </div>
          <Tabs value={mode} onValueChange={switchMode}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="list">One by one</TabsTrigger>
              <TabsTrigger value="text">Type or paste</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs text-muted-foreground px-0.5">
                <span>Label (e.g. 6/1)</span><span>Scheme ID (e.g. 32)</span><span />
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {list.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_2rem] gap-2">
                    <Input
                      aria-label={`Scheme ${i + 1} label`}
                      value={s.label}
                      placeholder="6/1"
                      className="h-8"
                      onChange={e => setList(l => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    />
                    <Input
                      aria-label={`Scheme ${i + 1} scheme ID`}
                      value={s.schemeId}
                      placeholder="32"
                      className="h-8"
                      onChange={e => setList(l => l.map((x, j) => (j === i ? { ...x, schemeId: e.target.value } : x)))}
                    />
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      aria-label={`Remove scheme ${s.label || i + 1}`}
                      onClick={() => setList(l => l.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => setList(l => [...l, { label: "", schemeId: "" }])}>
                <Plus className="h-4 w-4 mr-1" /> Add scheme
              </Button>
            </TabsContent>
            <TabsContent value="text" className="space-y-1">
              <Textarea
                aria-label="EMI schemes as text"
                rows={4}
                value={text}
                placeholder="6/1=32; 12/1=34"
                onChange={e => { setText(e.target.value); setError(null); }}
              />
              <p className="text-xs text-muted-foreground">{EMI_FORMAT_HINT}</p>
            </TabsContent>
          </Tabs>
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={save}>Save schemes</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Sticky header cell for the sheet table. */
function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={`sticky top-0 z-10 bg-muted py-2 px-2 font-medium border-b ${className ?? ""}`}>{children}</th>;
}

function IssuesIcon({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`Needs attention: ${issues.join(", ")}`} className="text-amber-500 hover:text-amber-600">
          <AlertTriangle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p className="font-medium mb-1">Needs attention</p>
        <ul className="list-disc pl-4 space-y-0.5">{issues.map(i => <li key={i}>{i}</li>)}</ul>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Linked journey steps ────────────────────────────────────────────────────

function LinkedStepsPanel({
  data, open, onOpenChange, onSaved,
}: {
  data: SheetResponse;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (next: SheetResponse) => void;
}) {
  const steps = useMemo(() => [...data.linkedSteps].sort((a, b) => a.stepOrder - b.stepOrder), [data.linkedSteps]);
  const initial = () => Object.fromEntries(steps.map(s => [s.stepId, s.level ?? s.suggestedLevel])) as Record<string, SheetLevel | null>;
  const [draft, setDraft] = useState<Record<string, SheetLevel | null>>(initial);
  const signature = JSON.stringify(steps.map(s => [s.stepId, s.level, s.suggestedLevel]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(initial()); }, [signature]);

  const saved = levelProblems(steps.map(s => s.level));
  const problems = levelProblems(steps.map(s => draft[s.stepId] ?? null));
  const dirty = steps.some(s => (draft[s.stepId] ?? null) !== s.level);

  const save = useMutation({
    mutationFn: () => api<SheetResponse>("PUT", "/api/store-sheet/settings", { stepLevels: draft }),
    onSuccess: next => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast({ title: "Journey steps linked" });
      onSaved(next);
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return (
    <Card id="linked-steps">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left" aria-label={open ? "Hide linked journey steps" : "Show linked journey steps"}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Link2 className="h-5 w-5 text-purple-600 shrink-0" />
                <div className="min-w-0">
                  <CardTitle className="text-base">Linked journey steps</CardTitle>
                  <CardDescription className="truncate">
                    {data.flowName ? `Which dropdown in “${data.flowName}” shows dealers, cities, stores and EMI schemes` : "No active guided journey found"}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {steps.length > 0 && (saved.ready
                  ? <Badge variant="secondary" className="bg-green-50 text-green-700">Linked</Badge>
                  : <Badge variant="secondary" className="bg-amber-50 text-amber-700">Not linked yet</Badge>)}
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your active guided journey has no dropdown steps yet. Add Dealer, City, Store and EMI scheme steps to the journey, then come back here to link them.
              </p>
            ) : (
              <>
                <div className="divide-y rounded-lg border">
                  {steps.map(s => {
                    const value = draft[s.stepId] ?? null;
                    const isSuggestion = s.level === null && s.suggestedLevel !== null && value === s.suggestedLevel;
                    return (
                      <div key={s.stepId} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            <span className="text-muted-foreground mr-1">Step {s.stepOrder + 1}.</span>{s.prompt || s.stepKey}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {s.saveToField ? `Saves to “${s.saveToField}”` : "Doesn't save to a field"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isSuggestion && <Badge variant="outline" className="text-purple-700 border-purple-200">Suggested</Badge>}
                          <Select
                            value={value ?? "none"}
                            onValueChange={v => setDraft(d => ({ ...d, [s.stepId]: v === "none" ? null : (v as SheetLevel) }))}
                          >
                            <SelectTrigger className="w-40" aria-label={`Sheet column for step ${s.stepOrder + 1}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {SHEET_LEVELS.map(l => <SelectItem key={l} value={l}>{LEVEL_LABELS[l]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(problems.duplicated.length > 0 || problems.missing.length > 0) && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-900 text-sm space-y-0.5">
                      {problems.duplicated.map(l => <p key={l}>{LEVEL_LABELS[l]} is chosen for more than one step — pick it for just one.</p>)}
                      {problems.missing.map(l => (
                        <p key={l}>
                          No step is set to {LEVEL_LABELS[l]}.
                          {l === "emi" ? " EMI schemes won't be offered in the journey." : " This is needed before the sheet can drive the journey."}
                        </p>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex justify-end">
                  <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                    {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Save linked steps
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ─── Build from journey ──────────────────────────────────────────────────────

function SeedCard({ isEmpty, onHide }: { isEmpty: boolean; onHide: () => void }) {
  const [preview, setPreview] = useState<SeedPreview | null>(null);

  const loadPreview = useMutation({
    mutationFn: () => api<SeedPreview>("POST", "/api/store-sheet/seed-from-journey/preview"),
    onSuccess: setPreview,
    onError: showError,
  });
  const apply = useMutation({
    mutationFn: () => api<{ created: number; updated: number }>("POST", "/api/store-sheet/seed-from-journey/apply"),
    onSuccess: r => {
      toast({ title: "Sheet built from your journey", description: `${plural(r.created, "store")} added, ${plural(r.updated, "store")} updated.` });
      setPreview(null);
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return (
    <>
      <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-white">
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Build from your current journey</p>
            <p className="text-sm text-muted-foreground">
              {isEmpty
                ? "Fill this sheet in one go from the dealer, city, store and EMI lists already typed into your guided journey. Stores are matched to your existing LOS store records."
                : "Your guided journey has stores that aren't in this sheet yet. Add them from the lists typed into the journey — you'll see exactly what changes before anything is saved."}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {!isEmpty && <Button variant="ghost" size="sm" onClick={onHide}>Hide</Button>}
            <Button onClick={() => loadPreview.mutate()} disabled={loadPreview.isPending}>
              {loadPreview.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Build the sheet from your journey</DialogTitle>
            <DialogDescription>
              {preview && (
                <>
                  {plural(preview.rows.length, "store")} found in your journey
                  {preview.alreadyInSheet > 0 && ` · ${preview.alreadyInSheet} already in the sheet`}
                  {preview.unmatchedCount > 0 && ` · ${preview.unmatchedCount} without a matching LOS store`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {preview && (preview.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nothing to build — your journey has no dealer/city/store lists, or everything is already in the sheet.</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Dealer</th>
                    <th className="p-2 font-medium">City</th>
                    <th className="p-2 font-medium">Store</th>
                    <th className="p-2 font-medium">EMI schemes</th>
                    <th className="p-2 font-medium">LOS store</th>
                    <th className="p-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="align-top">
                      <td className="p-2">{r.dealer}</td>
                      <td className="p-2">{r.city}</td>
                      <td className="p-2">{r.store}</td>
                      <td className="p-2"><EmiChips schemes={r.emiSchemes} max={6} /></td>
                      <td className="p-2">
                        {r.matchedCredentialId
                          ? <span className="text-green-700">{r.losStoreName || "Matched"}</span>
                          : <span className="text-amber-700">No LOS store found — add SID/secret later</span>}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{r.notes.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending || !preview?.rows.length}>
              {apply.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Add store ───────────────────────────────────────────────────────────────

const EMPTY_NEW: StoreSheetRowInput & { emiSchemes: EmiScheme[] } = {
  dealer: "", city: "", store: "", emiSchemes: [], losDealerName: "", losStoreName: "", losStoreId: "",
  sid: "", secret: "", isActive: true, inJourney: true,
};

function AddStoreDialog({ open, onOpenChange, rows }: { open: boolean; onOpenChange: (o: boolean) => void; rows: StoreSheetRow[] }) {
  const [form, setForm] = useState(EMPTY_NEW);
  useEffect(() => { if (open) setForm(EMPTY_NEW); }, [open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  const dealers = useMemo(() => Array.from(new Set(rows.map(r => r.dealer).filter(Boolean))).sort(), [rows]);
  const cities = useMemo(() => {
    const d = form.dealer.trim().toLowerCase();
    const pool = d ? rows.filter(r => r.dealer.toLowerCase() === d) : rows;
    return Array.from(new Set((pool.length ? pool : rows).map(r => r.city).filter(Boolean))).sort();
  }, [rows, form.dealer]);

  const create = useMutation({
    mutationFn: () => {
      const body: StoreSheetRowInput = {
        dealer: form.dealer.trim(),
        city: form.city.trim(),
        store: form.store.trim(),
        emiSchemes: form.emiSchemes,
        losDealerName: form.losDealerName?.trim() || null,
        losStoreName: form.losStoreName?.trim() || null,
        losStoreId: String(form.losStoreId ?? "").trim() || null,
        sid: form.sid?.trim() || null,
        isActive: form.isActive,
        inJourney: form.inJourney,
      };
      if (form.secret?.trim()) body.secret = form.secret.trim();
      return api<StoreSheetRow>("POST", "/api/store-sheet/rows", body);
    },
    onSuccess: row => {
      toast({ title: "Store added", description: `${row.store} (${row.dealer}, ${row.city})` });
      onOpenChange(false);
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const missing = !form.dealer.trim() || !form.city.trim() || !form.store.trim();
  const badId = !!String(form.losStoreId ?? "").trim() && !/^\d+$/.test(String(form.losStoreId).trim());

  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {el}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a store</DialogTitle>
          <DialogDescription>Dealer, City and Store are what customers see in WhatsApp. The LOS details are used when leads are sent to the CRM.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); if (!missing && !badId) create.mutate(); }}
        >
          <div className="grid sm:grid-cols-3 gap-3">
            {field("new-dealer", "Dealer *", <>
              <Input id="new-dealer" list="new-dealer-options" value={form.dealer} onChange={e => set("dealer", e.target.value)} placeholder="e.g. Acme Mobiles" />
              <datalist id="new-dealer-options">{dealers.map(d => <option key={d} value={d} />)}</datalist>
            </>)}
            {field("new-city", "City *", <>
              <Input id="new-city" list="new-city-options" value={form.city} onChange={e => set("city", e.target.value)} placeholder="e.g. Pune" />
              <datalist id="new-city-options">{cities.map(c => <option key={c} value={c} />)}</datalist>
            </>)}
            {field("new-store", "Store *", <Input id="new-store" value={form.store} onChange={e => set("store", e.target.value)} placeholder="e.g. Acme FC Road" />)}
          </div>
          <div className="space-y-1">
            <Label>EMI schemes</Label>
            <div className="rounded-md border px-1 py-1">
              <EmiSchemesEditor schemes={form.emiSchemes} storeName={form.store} onSave={s => set("emiSchemes", s)} />
            </div>
            <p className="text-xs text-muted-foreground">Click to add the EMI options for this store.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field("new-los-dealer", "LOS dealer name", <Input id="new-los-dealer" value={form.losDealerName ?? ""} onChange={e => set("losDealerName", e.target.value)} placeholder="Same as Dealer if blank" />)}
            {field("new-los-store", "LOS store name", <Input id="new-los-store" value={form.losStoreName ?? ""} onChange={e => set("losStoreName", e.target.value)} placeholder="Same as Store if blank" />)}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {field("new-los-id", "LOS store ID", <Input id="new-los-id" inputMode="numeric" value={String(form.losStoreId ?? "")} onChange={e => set("losStoreId", e.target.value)} />, badId ? "Must be a number" : undefined)}
            {field("new-sid", "SID", <Input id="new-sid" value={form.sid ?? ""} onChange={e => set("sid", e.target.value)} />)}
            {field("new-secret", "Secret", <Input id="new-secret" type="password" autoComplete="new-password" value={form.secret ?? ""} onChange={e => set("secret", e.target.value)} />)}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.isActive} onCheckedChange={v => set("isActive", v)} aria-label="Active" /> Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.inJourney} onCheckedChange={v => set("inJourney", v)} aria-label="Show in WhatsApp journey" /> Show in WhatsApp journey
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={missing || badId || create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Add store
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Excel upload ────────────────────────────────────────────────────────────

interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  mapping: Record<SheetColumn, string>;
}

function buildImportRows(file: ParsedFile): Record<string, unknown>[] {
  return file.rows.map(raw => {
    const out: Record<string, unknown> = {};
    for (const col of SHEET_COLUMNS) {
      const h = file.mapping[col];
      if (h) out[col] = raw[h] ?? "";
    }
    return out;
  });
}

function ImportFlow({ file, onClose }: { file: ParsedFile | null; onClose: () => void }) {
  const [mapping, setMapping] = useState<Record<SheetColumn, string> | null>(null);
  const [needsMapping, setNeedsMapping] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [result, setResult] = useState<ImportPreview | null>(null);

  const preview = useMutation({
    mutationFn: (v: { rows: Record<string, unknown>[]; removeMissing: boolean }) => api<ImportPreview>("POST", "/api/store-sheet/import/preview", v),
    onSuccess: setResult,
    onError: e => { showError(e); },
  });
  const apply = useMutation({
    mutationFn: (v: { rows: Record<string, unknown>[]; removeMissing: boolean }) =>
      api<{ added: number; changed: number; removed: number }>("POST", "/api/store-sheet/import/apply", v),
    onSuccess: r => {
      toast({
        title: "Sheet updated from Excel",
        description: `${plural(r.added, "store")} added, ${r.changed} changed${r.removed ? `, ${r.removed} removed` : ""}.`,
      });
      onClose();
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const rowsToSend = useMemo(() => (file && mapping ? buildImportRows({ ...file, mapping }) : []), [file, mapping]);

  useEffect(() => {
    setResult(null);
    setRemoveMissing(false);
    if (!file) { setMapping(null); return; }
    setMapping(file.mapping);
    const complete = SHEET_COLUMNS.every(c => file.mapping[c]);
    setNeedsMapping(!complete);
    if (complete) preview.mutate({ rows: buildImportRows(file), removeMissing: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!file || !mapping) return null;

  const runPreview = (rm: boolean) => preview.mutate({ rows: rowsToSend, removeMissing: rm });
  const requiredMapped = (["Dealer", "City", "Store"] as SheetColumn[]).every(c => mapping[c]);

  if (needsMapping) {
    return (
      <Dialog open onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Match your columns</DialogTitle>
            <DialogDescription>
              Some column names in “{file.fileName}” don't match the template. For each sheet column, pick the column from your file that holds it.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-lg border">
            {SHEET_COLUMNS.map(col => (
              <div key={col} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{col}{["Dealer", "City", "Store"].includes(col) && <span className="text-red-500"> *</span>}</p>
                  <p className="text-xs text-muted-foreground truncate" title={COLUMN_HELP[col]}>{COLUMN_HELP[col]}</p>
                </div>
                <Select value={mapping[col] || "__none__"} onValueChange={v => setMapping(m => (m ? { ...m, [col]: v === "__none__" ? "" : v } : m))}>
                  <SelectTrigger className="w-48 shrink-0" aria-label={`File column for ${col}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not in my file</SelectItem>
                    {file.headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Columns marked “Not in my file” are left as they are for existing stores.</p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!requiredMapped || preview.isPending} onClick={() => { setNeedsMapping(false); runPreview(removeMissing); }}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const nothingToDo = result && result.added.length + result.changed.length + result.removed.length === 0;
  const hasErrors = !!result && result.errors.length > 0;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check the changes before saving</DialogTitle>
          <DialogDescription>From “{file.fileName}” — {plural(file.rows.length, "row")}. Nothing is saved until you click Apply.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3 space-y-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={removeMissing}
              aria-label="Remove stores that are not in this file"
              onCheckedChange={v => { const b = v === true; setRemoveMissing(b); runPreview(b); }}
              className="mt-0.5"
            />
            <span>Remove stores that are not in this file</span>
          </label>
          {removeMissing && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5">
              Any store in the sheet that isn't in this file will be deleted, along with its SID and secret. Only tick this if the file is your complete list.
            </p>
          )}
        </div>

        {preview.isPending || !result ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            {preview.isPending ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Checking your file…</> : "Couldn't check the file."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              {[
                ["New", result.added.length, "text-green-700"],
                ["Changed", result.changed.length, "text-blue-700"],
                ["Unchanged", result.unchangedCount, "text-muted-foreground"],
                ["Removed", result.removed.length, "text-red-700"],
                ["Errors", result.errors.length, result.errors.length ? "text-red-700" : "text-muted-foreground"],
              ].map(([label, n, cls]) => (
                <div key={label as string} className="rounded-lg border p-2">
                  <p className={`text-xl font-semibold ${cls}`}>{n as number}</p>
                  <p className="text-xs text-muted-foreground">{label as string}</p>
                </div>
              ))}
            </div>

            {hasErrors && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-900 text-sm">
                  Fix the errors in your file and upload it again. Nothing can be applied while the file has errors.
                </AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue={hasErrors ? "errors" : "added"}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="added">New ({result.added.length})</TabsTrigger>
                <TabsTrigger value="changed">Changed ({result.changed.length})</TabsTrigger>
                <TabsTrigger value="removed">Removed ({result.removed.length})</TabsTrigger>
                <TabsTrigger value="errors">Errors ({result.errors.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="added"><PreviewList empty="No new stores." items={result.added.map(r => ({ key: `a${r.rowNumber}`, row: r.rowNumber, text: `${r.dealer} · ${r.city} · ${r.store}` }))} /></TabsContent>
              <TabsContent value="changed">
                <PreviewList empty="No changes to existing stores." items={result.changed.map(r => ({ key: r.id, row: r.rowNumber, text: `${r.dealer} · ${r.city} · ${r.store}`, extra: r.fields.join(", ") }))} />
              </TabsContent>
              <TabsContent value="removed">
                <PreviewList
                  empty={removeMissing ? "No stores will be removed." : "Nothing is removed unless you tick “Remove stores that are not in this file”."}
                  items={result.removed.map(r => ({ key: r.id, text: `${r.dealer} · ${r.city} · ${r.store}` }))}
                />
              </TabsContent>
              <TabsContent value="errors">
                <PreviewList empty="No errors." items={result.errors.map((e, i) => ({ key: `e${i}`, row: e.rowNumber, text: e.message, error: true }))} />
              </TabsContent>
            </Tabs>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => apply.mutate({ rows: rowsToSend, removeMissing })}
            disabled={!result || preview.isPending || hasErrors || !!nothingToDo || apply.isPending}
          >
            {apply.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {nothingToDo ? "Nothing to change" : "Apply changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewList({ items, empty }: { items: { key: string; row?: number; text: string; extra?: string; error?: boolean }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">{empty}</p>;
  return (
    <ul className="max-h-72 overflow-y-auto divide-y rounded-lg border text-sm">
      {items.map(i => (
        <li key={i.key} className="flex gap-3 px-3 py-2">
          {i.row !== undefined && <span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">Row {i.row}</span>}
          <div className="min-w-0">
            <p className={i.error ? "text-red-700" : ""}>{i.text}</p>
            {i.extra && <p className="text-xs text-blue-700">Changed: {i.extra}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Chip = "attention" | "notInJourney" | null;

export default function StoreSheet() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<SheetResponse>("GET", "/api/store-sheet"),
  });

  const [stepsOpen, setStepsOpen] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [seedHidden, setSeedHidden] = useState(false);

  const [search, setSearch] = useState("");
  const [dealerFilter, setDealerFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [chip, setChip] = useState<Chip>(null);
  const [showLos, setShowLos] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [secretRow, setSecretRow] = useState<StoreSheetRow | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [importFile, setImportFile] = useState<ParsedFile | null>(null);
  const [parsing, setParsing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { Object.values(revealTimers.current).forEach(clearTimeout); }, []);

  const rows = data?.rows ?? [];

  // ── mutations ──
  const settings = useMutation({
    mutationFn: (body: { enabled?: boolean; stepLevels?: Record<string, SheetLevel | null> }) =>
      api<SheetResponse>("PUT", "/api/store-sheet/settings", body),
    onSuccess: next => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast({
        title: next.enabled ? "Journey now uses this sheet" : "Journey is back on its own lists",
        description: next.enabled
          ? "The Dealer, City, Store and EMI dropdowns are built from this sheet."
          : "The lists typed into the journey are used again.",
      });
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const patchRow = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<StoreSheetRowInput>; prev?: StoreSheetRow }) =>
      api<StoreSheetRow>("PATCH", `/api/store-sheet/rows/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<SheetResponse>(QUERY_KEY)?.rows.find(r => r.id === id);
      updateRowInCache(id, r => applyPatch(r, patch));
      return { prev };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.prev) updateRowInCache(id, () => ctx.prev!);
      showError(err);
    },
    onSuccess: row => updateRowInCache(row.id, () => row),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const patch = (row: StoreSheetRow, p: Partial<StoreSheetRowInput>) => patchRow.mutate({ id: row.id, patch: p });

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) { await api("DELETE", `/api/store-sheet/rows/${ids[0]}`); return 1; }
      return (await api<{ deleted: number }>("POST", "/api/store-sheet/rows/bulk-delete", { ids })).deleted;
    },
    onSuccess: (n, ids) => {
      toast({ title: `${plural(n, "store")} deleted` });
      setSelected(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
      setDeleteIds(null);
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const reveal = useMutation({
    mutationFn: (id: string) => api<{ secret: string }>("POST", `/api/store-sheet/rows/${id}/reveal-secret`),
    onSuccess: ({ secret }, id) => {
      setRevealed(r => ({ ...r, [id]: secret }));
      clearTimeout(revealTimers.current[id]);
      revealTimers.current[id] = setTimeout(() => {
        setRevealed(r => { const { [id]: _, ...rest } = r; return rest; });
      }, 30_000);
    },
    onError: showError,
  });

  // ── derived ──
  const dealers = useMemo(() => Array.from(new Set(rows.map(r => r.dealer).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const cities = useMemo(
    () => Array.from(new Set(rows.filter(r => dealerFilter === "all" || r.dealer === dealerFilter).map(r => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows, dealerFilter],
  );
  const attentionCount = rows.filter(r => r.issues.length > 0).length;
  const notInJourneyCount = rows.filter(r => !r.inJourney).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r =>
        (dealerFilter === "all" || r.dealer === dealerFilter) &&
        (cityFilter === "all" || r.city === cityFilter) &&
        (chip !== "attention" || r.issues.length > 0) &&
        (chip !== "notInJourney" || !r.inJourney) &&
        (!q || [r.dealer, r.city, r.store, r.losDealerName, r.losStoreName].some(v => v?.toLowerCase().includes(q))),
      )
      .sort((a, b) => a.dealer.localeCompare(b.dealer) || a.city.localeCompare(b.city) || a.store.localeCompare(b.store));
  }, [rows, search, dealerFilter, cityFilter, chip]);

  useEffect(() => { if (cityFilter !== "all" && !cities.includes(cityFilter)) setCityFilter("all"); }, [cities, cityFilter]);
  // Drop selections for rows that no longer exist.
  useEffect(() => {
    setSelected(s => {
      const ids = new Set(rows.map(r => r.id));
      const next = new Set(Array.from(s).filter(id => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rows]);

  const selectedVisible = filtered.filter(r => selected.has(r.id));
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length;

  // ── enable switch ──
  const onToggleEnabled = (on: boolean) => {
    if (!data) return;
    if (!on) { settings.mutate({ enabled: false }); return; }
    if (!levelProblems(data.linkedSteps.map(s => s.level)).ready) {
      setStepsOpen(true);
      setPendingEnable(true);
      toast({ title: "Link your journey steps first", description: "Choose which journey step shows Dealer, City, Store and EMI scheme, then save." });
      setTimeout(() => document.getElementById("linked-steps")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    setConfirmEnable(true);
  };

  // ── Excel upload ──
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const first = wb.SheetNames[0];
      if (!first) throw new Error("This file has no sheets");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first], { defval: "" });
      if (json.length === 0) throw new Error("The first sheet has no rows under the header");
      const headers: string[] = [];
      for (const r of json) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
      setImportFile({ fileName: f.name, headers, rows: json, mapping: autoMap(headers) });
    } catch (err) {
      toast({ title: "Couldn't read the file", description: (err as Error).message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  // ── render ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
            <p className="font-medium">Couldn't load Dealers &amp; Stores</p>
            <p className="text-sm text-muted-foreground">{(error as Error | null)?.message}</p>
            <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const colCount = 11 + (showLos ? 2 : 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col xl:flex-row xl:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shrink-0">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Dealers &amp; Stores</h1>
              <p className="text-sm text-muted-foreground">
                One sheet for every store: the names customers see in WhatsApp, their EMI schemes, and the LOS details used when leads are sent to the CRM.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 xl:max-w-sm">
            <div className="flex-1">
              <Label htmlFor="use-for-journey" className="font-medium">Use for WhatsApp journey dropdowns</Label>
              <p className="text-xs text-muted-foreground">
                {data.enabled ? "On — Dealer, City, Store and EMI lists come from this sheet." : "Off — the journey uses the lists typed into it."}
              </p>
            </div>
            <Switch id="use-for-journey" checked={data.enabled} disabled={settings.isPending} onCheckedChange={onToggleEnabled} />
          </div>
        </CardContent>
      </Card>

      <LinkedStepsPanel
        data={data}
        open={stepsOpen}
        onOpenChange={setStepsOpen}
        onSaved={next => {
          if (pendingEnable && !next.enabled && levelProblems(next.linkedSteps.map(s => s.level)).ready) setConfirmEnable(true);
          setPendingEnable(false);
        }}
      />

      {(rows.length === 0 || (data.journeyStoresNotInSheet > 0 && !seedHidden)) && (
        <SeedCard isEmpty={rows.length === 0} onHide={() => setSeedHidden(true)} />
      )}

      {/* Sheet */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Stores</CardTitle>
              <CardDescription>
                {plural(rows.length, "store")} · {plural(dealers.length, "dealer")} · {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
                {isFetching && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadTemplate().catch(showError)}>
                <Download className="h-4 w-4 mr-1" /> Download template
              </Button>
              <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => exportRows(filtered.length ? filtered : rows).catch(showError)}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
              </Button>
              <Button variant="outline" size="sm" disabled={parsing} onClick={() => fileInput.current?.click()}>
                {parsing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Upload Excel
              </Button>
              <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Upload Excel file" onChange={onFile} />
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add store
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search dealer, city, store or LOS names…"
                aria-label="Search stores"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={dealerFilter} onValueChange={v => { setDealerFilter(v); setCityFilter("all"); }}>
                <SelectTrigger className="w-44" aria-label="Filter by dealer"><SelectValue placeholder="All dealers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dealers</SelectItem>
                  {dealers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-40" aria-label="Filter by city"><SelectValue placeholder="All cities" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cities</SelectItem>
                  {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={chip === "attention" ? "default" : "outline"}
              className={chip === "attention" ? "bg-amber-500 hover:bg-amber-600" : "text-amber-700 border-amber-200"}
              aria-pressed={chip === "attention"}
              onClick={() => setChip(c => (c === "attention" ? null : "attention"))}
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Needs attention ({attentionCount})
            </Button>
            <Button
              size="sm"
              variant={chip === "notInJourney" ? "default" : "outline"}
              aria-pressed={chip === "notInJourney"}
              onClick={() => setChip(c => (c === "notInJourney" ? null : "notInJourney"))}
            >
              Not in journey ({notInJourneyCount})
            </Button>
            <label className="flex items-center gap-2 text-sm ml-auto">
              <Switch checked={showLos} onCheckedChange={setShowLos} aria-label="Show LOS names" /> Show LOS names
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X className="h-4 w-4" /></Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleteIds(Array.from(selected))}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete selected
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto max-h-[70vh] border-t">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <Th className="w-10 px-3">
                    <Checkbox
                      aria-label="Select all shown stores"
                      checked={allSelected ? true : selectedVisible.length > 0 ? "indeterminate" : false}
                      onCheckedChange={() => setSelected(s => {
                        const next = new Set(s);
                        if (allSelected) filtered.forEach(r => next.delete(r.id)); else filtered.forEach(r => next.add(r.id));
                        return next;
                      })}
                    />
                  </Th>
                  <Th className="w-6"><span className="sr-only">Issues</span></Th>
                  <Th className="min-w-[9rem]">Dealer</Th>
                  <Th className="min-w-[8rem]">City</Th>
                  <Th className="min-w-[10rem]">Store</Th>
                  <Th className="min-w-[11rem]">EMI schemes</Th>
                  {showLos && <Th className="min-w-[10rem]">LOS dealer name</Th>}
                  {showLos && <Th className="min-w-[10rem]">LOS store name</Th>}
                  <Th className="min-w-[6rem]">LOS store ID</Th>
                  <Th className="min-w-[8rem]">SID</Th>
                  <Th className="min-w-[11rem]">Secret</Th>
                  <Th className="w-20">Active</Th>
                  <Th className="w-20">In journey</Th>
                  <Th className="w-10"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="py-12 text-center text-muted-foreground">
                      {rows.length === 0
                        ? <><Store className="h-8 w-8 mx-auto mb-2 opacity-40" />No stores yet. Build the sheet from your journey, upload an Excel file, or add a store.</>
                        : "No stores match your filters."}
                    </td>
                  </tr>
                )}
                {filtered.map(r => {
                  const secret = revealed[r.id];
                  return (
                    <tr key={r.id} className={`align-middle hover:bg-muted/30 ${!r.isActive ? "opacity-60" : ""} ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-3">
                        <Checkbox
                          aria-label={`Select ${r.store}`}
                          checked={selected.has(r.id)}
                          onCheckedChange={() => setSelected(s => { const next = new Set(s); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; })}
                        />
                      </td>
                      <td className="px-1"><IssuesIcon issues={r.issues} /></td>
                      <td className="px-1 py-1"><EditableCell value={r.dealer} required ariaLabel="Dealer" onSave={v => patch(r, { dealer: v })} /></td>
                      <td className="px-1 py-1"><EditableCell value={r.city} required ariaLabel="City" onSave={v => patch(r, { city: v })} /></td>
                      <td className="px-1 py-1"><EditableCell value={r.store} required ariaLabel="Store" className="font-medium" onSave={v => patch(r, { store: v })} /></td>
                      <td className="px-1 py-1"><EmiSchemesEditor schemes={r.emiSchemes} storeName={r.store} onSave={s => patch(r, { emiSchemes: s })} /></td>
                      {showLos && (
                        <>
                          <td className="px-1 py-1"><EditableCell value={r.losDealerName} placeholder="Same as dealer" ariaLabel="LOS dealer name" onSave={v => patch(r, { losDealerName: v || null })} /></td>
                          <td className="px-1 py-1"><EditableCell value={r.losStoreName} placeholder="Same as store" ariaLabel="LOS store name" onSave={v => patch(r, { losStoreName: v || null })} /></td>
                        </>
                      )}
                      <td className="px-1 py-1"><EditableCell value={r.losStoreId == null ? "" : String(r.losStoreId)} numeric placeholder="Not set" ariaLabel="LOS store ID" className="font-mono" onSave={v => patch(r, { losStoreId: v || null })} /></td>
                      <td className="px-1 py-1"><EditableCell value={r.sid} placeholder="Not set" ariaLabel="SID" className="font-mono" onSave={v => patch(r, { sid: v || null })} /></td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          {secret ? (
                            <>
                              <code className="text-xs bg-muted rounded px-1.5 py-0.5 max-w-[8rem] truncate" title="Hidden again after 30 seconds">{secret}</code>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7" aria-label={`Copy secret for ${r.store}`}
                                onClick={() => navigator.clipboard.writeText(secret).then(() => toast({ title: "Secret copied" }), () => showError(new Error("Couldn't copy")))}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : r.hasSecret
                            ? <span className="tracking-widest text-muted-foreground" aria-label="Secret is set">●●●●●●</span>
                            : <span className="text-amber-600 text-xs font-medium">Not set</span>}
                          <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`Set secret for ${r.store}`} onClick={() => { setSecretRow(r); setSecretDraft(""); }}>
                            <KeyRound className="h-3.5 w-3.5 mr-1" /> Set
                          </Button>
                          {data.canRevealSecrets && r.hasSecret && !secret && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2" aria-label={`Show secret for ${r.store}`}
                              disabled={reveal.isPending && reveal.variables === r.id}
                              onClick={() => reveal.mutate(r.id)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Show
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-2"><Switch checked={r.isActive} aria-label={`${r.store} active`} onCheckedChange={v => patch(r, { isActive: v })} /></td>
                      <td className="px-2"><Switch checked={r.inJourney} aria-label={`Show ${r.store} in WhatsApp journey`} onCheckedChange={v => patch(r, { inJourney: v })} /></td>
                      <td className="px-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600" aria-label={`Delete ${r.store}`} onClick={() => setDeleteIds([r.id])}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <p className="text-xs text-muted-foreground px-4 py-2 border-t">
              Click any cell to edit. Enter saves, Esc cancels. {filtered.length !== rows.length && `Showing ${filtered.length} of ${rows.length}.`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddStoreDialog open={addOpen} onOpenChange={setAddOpen} rows={rows} />
      <ImportFlow file={importFile} onClose={() => setImportFile(null)} />

      <Dialog open={!!secretRow} onOpenChange={o => !o && setSecretRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set secret</DialogTitle>
            <DialogDescription>
              {secretRow && <>New secret for <span className="font-medium">{secretRow.store}</span> ({secretRow.dealer}, {secretRow.city}). {secretRow.hasSecret && "This replaces the current secret."}</>}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              if (!secretRow || !secretDraft.trim()) return;
              patch(secretRow, { secret: secretDraft.trim() });
              setSecretRow(null);
              setSecretDraft("");
            }}
          >
            <Input
              autoFocus type="password" autoComplete="new-password" aria-label="New secret"
              placeholder="Paste the secret from the LOS" value={secretDraft} onChange={e => setSecretDraft(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSecretRow(null)}>Cancel</Button>
              <Button type="submit" disabled={!secretDraft.trim()}>Save secret</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteIds} onOpenChange={o => !o && setDeleteIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteIds && deleteIds.length > 1 ? plural(deleteIds.length, "store") : "this store"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIds?.length === 1
                ? (() => { const r = rows.find(x => x.id === deleteIds[0]); return r ? `${r.store} (${r.dealer}, ${r.city}) and its SID and secret will be removed.` : "This store will be removed."; })()
                : "These stores and their SIDs and secrets will be removed."}
              {" "}They will no longer appear in the WhatsApp journey or be used for the CRM. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={remove.isPending}
              onClick={e => { e.preventDefault(); if (deleteIds) remove.mutate(deleteIds); }}
            >
              {remove.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEnable} onOpenChange={setConfirmEnable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this sheet for the WhatsApp journey?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>The journey's Dealer, City, Store and EMI scheme dropdowns will be built from this sheet, using only stores that are Active and In journey.</p>
                <p>The lists typed into the journey by hand are kept — they just won't be used. Switch this off any time to bring them back.</p>
                {attentionCount > 0 && <p className="text-amber-700">{plural(attentionCount, "store")} still need{attentionCount === 1 ? "s" : ""} attention.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => settings.mutate({ enabled: true })}>Switch on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
