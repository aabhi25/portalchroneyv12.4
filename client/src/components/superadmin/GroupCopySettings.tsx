import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Loader2, RotateCcw, Search, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { COPY_ITEM_GROUPS, copyItem, type CopyPreviewTarget, type CopyRequest, type CopyResultTarget, type DetailRow, type DetailSection } from "@shared/settingsCopy";

interface Member { businessAccountId: string; name: string }
interface HistoryRow {
  id: string;
  sourceName: string;
  request: CopyRequest;
  results: CopyResultTarget[];
  createdByName: string | null;
  createdAt: string;
  undoneAt: string | null;
  undoneByName: string | null;
  canUndo: boolean;
}
interface SourceItem { key: string; group: string; label: string; description: string; summary: string; empty: boolean; sections: DetailSection[] }
interface SourceJourney { id: string; name: string; status: string; journeyType: string; startFromScratch: boolean; steps: number }

function StepTitle({ number, title, hint }: { number: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-semibold text-purple-700">{number}</span>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {hint && <p className="text-sm text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}

function DetailValue({ row }: { row: DetailRow }) {
  if (row.kind === "color") {
    return (
      <span className="flex items-center gap-2">
        <span className="h-4 w-4 shrink-0 rounded border border-gray-200" style={{ background: row.value }} />
        {row.value}
      </span>
    );
  }
  if (row.kind === "image") {
    return <img src={row.value} alt="" className="max-h-32 max-w-full rounded border border-gray-200 object-contain" />;
  }
  return <span className="whitespace-pre-wrap break-words">{row.value}</span>;
}

/** Copy settings tab of an account group: pick one account, what to copy, and which accounts get it. */
export default function GroupCopySettings({ groupId }: { groupId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const baseUrl = `/api/super-admin/account-groups/${groupId}/copy-settings`;
  const { data, isLoading } = useQuery<{ members: Member[]; history: HistoryRow[] }>({ queryKey: [baseUrl] });
  const members = data?.members ?? [];
  const history = data?.history ?? [];

  const [sourceId, setSourceId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [journeyIds, setJourneyIds] = useState<Set<string>>(new Set());
  const [instructionsMode, setInstructionsMode] = useState<"add" | "replace">("add");
  const [targetMode, setTargetMode] = useState<"all" | "some">("all");
  const [someIds, setSomeIds] = useState<Set<string>>(new Set());
  const [targetSearch, setTargetSearch] = useState("");
  const [preview, setPreview] = useState<CopyPreviewTarget[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [results, setResults] = useState<{ request: CopyRequest; rows: CopyResultTarget[] } | null>(null);
  const [undoRow, setUndoRow] = useState<HistoryRow | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const { data: source, isLoading: sourceLoading } = useQuery<{ items: SourceItem[]; journeys: SourceJourney[] }>({
    queryKey: [`${baseUrl}/source/${sourceId}`],
    enabled: !!sourceId,
  });

  // A new source starts clean; its journeys start ticked once it has loaded.
  useEffect(() => {
    setPicked(new Set());
    setJourneyIds(new Set());
    setPreview(null);
    setResults(null);
  }, [sourceId]);
  useEffect(() => {
    if (source) setJourneyIds(new Set(source.journeys.filter((j) => j.status === "active").map((j) => j.id)));
  }, [source]);
  const stale = () => { setPreview(null); setResults(null); };

  const others = useMemo(() => members.filter((m) => m.businessAccountId !== sourceId), [members, sourceId]);
  const targetIds = useMemo(
    () => (targetMode === "all" ? others.map((m) => m.businessAccountId) : others.filter((m) => someIds.has(m.businessAccountId)).map((m) => m.businessAccountId)),
    [targetMode, others, someIds],
  );
  const visibleOthers = others.filter((m) => m.name.toLowerCase().includes(targetSearch.trim().toLowerCase()));
  const request: CopyRequest = { sourceAccountId: sourceId, targetIds, items: Array.from(picked), instructionsMode, journeyIds: Array.from(journeyIds) };
  const needsJourney = picked.has("journeys") && journeyIds.size === 0;
  const detailItem = source?.items.find((item) => item.key === detailKey) ?? null;
  const sourceName = members.find((m) => m.businessAccountId === sourceId)?.name;
  const canReview = !!sourceId && picked.size > 0 && targetIds.length > 0 && !needsJourney;

  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value); else next.delete(value);
    return next;
  };

  const review = async () => {
    setPreviewing(true);
    setResults(null);
    try {
      const response = await apiRequest<{ targets: CopyPreviewTarget[] }>("POST", `${baseUrl}/preview`, request);
      setPreview(response.targets);
      setExpanded(null);
    } catch (error: any) {
      toast({ title: "Couldn't check the accounts", description: error.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const copy = async (toRun: CopyRequest) => {
    setCopying(true);
    try {
      const response = await apiRequest<{ results: CopyResultTarget[] }>("POST", baseUrl, toRun);
      setResults({ request: toRun, rows: response.results });
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: [baseUrl] });
    } catch (error: any) {
      toast({ title: "Copy failed", description: error.message, variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

  const undo = async () => {
    if (!undoRow) return;
    setUndoing(true);
    try {
      const response = await apiRequest<{ results: { ok: boolean; name: string; error?: string }[] }>("POST", `${baseUrl}/${undoRow.id}/undo`);
      const failed = response.results.filter((r) => !r.ok);
      if (failed.length) {
        toast({ title: `Undone, except on ${failed.length} account${failed.length === 1 ? "" : "s"}`, description: failed.map((f) => f.name).join(", "), variant: "destructive" });
      } else {
        toast({ title: "Copy undone", description: "Those accounts have their old settings back." });
      }
      setResults(null);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: [baseUrl] });
      if (sourceId) queryClient.invalidateQueries({ queryKey: [`${baseUrl}/source/${sourceId}`] });
    } catch (error: any) {
      toast({ title: "Couldn't undo", description: error.message, variant: "destructive" });
    } finally {
      setUndoing(false);
      setUndoRow(null);
    }
  };

  const willChange = preview?.filter((t) => t.changes.length > 0) ?? [];
  const warningGroups = useMemo(() => {
    const grouped = new Map<string, { label: string; message: string; accounts: string[] }>();
    for (const target of preview ?? []) {
      for (const warning of target.warnings) {
        const key = `${warning.key}|${warning.message}`;
        const entry = grouped.get(key) ?? { label: warning.label, message: warning.message, accounts: [] };
        entry.accounts.push(target.name);
        grouped.set(key, entry);
      }
    }
    return Array.from(grouped.values());
  }, [preview]);

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (members.length < 2) {
    return <p className="text-sm text-gray-500">This group needs at least two accounts before settings can be copied.</p>;
  }

  const failedRows = results?.rows.filter((r) => !r.ok) ?? [];

  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-sm text-gray-500">
        Set something up on one account, then copy it to the others. Passwords, API keys, CRM logins, WhatsApp and phone settings, products, knowledge, leads and chats are never copied. Publishing from the Training tab can later overwrite what you copy here.
      </p>

      <Card className="shadow-sm">
        <CardContent className="py-5 px-6">
          <StepTitle number={1} title="Copy from" hint="The account that is already set up the way you want" />
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="max-w-md" aria-label="Account to copy from"><SelectValue placeholder="Choose an account" /></SelectTrigger>
            <SelectContent>
              {members.map((m) => <SelectItem key={m.businessAccountId} value={m.businessAccountId}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {sourceId && (
        <Card className="shadow-sm">
          <CardContent className="py-5 px-6">
            <StepTitle number={2} title="What to copy" hint="Each line shows what this account has now" />
            {sourceLoading || !source ? (
              <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <div className="space-y-5">
                {COPY_ITEM_GROUPS.map((group) => (
                  <div key={group}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group}</p>
                    <div className="space-y-1">
                      {source.items.filter((item) => item.group === group).map((item) => (
                        <div key={item.key}>
                          <div className="flex items-start gap-3 rounded-lg p-2 hover:bg-gray-50">
                            <Checkbox
                              className="mt-0.5"
                              aria-label={item.label}
                              disabled={item.empty}
                              checked={picked.has(item.key)}
                              onCheckedChange={(on) => { setPicked((set) => toggle(set, item.key, !!on)); stale(); }}
                            />
                            <button
                              type="button"
                              onClick={() => setDetailKey(item.key)}
                              aria-label={`See details of ${item.label}`}
                              className={`flex min-w-0 flex-1 items-start gap-3 text-left ${item.empty ? "opacity-50" : ""}`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-gray-800">{item.label}</span>
                                <span className="block text-xs text-gray-500">{item.description}</span>
                              </span>
                              <span className="max-w-[40%] truncate text-right text-xs text-gray-500">{item.summary}</span>
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            </button>
                          </div>

                          {item.key === "instructions" && picked.has("instructions") && (
                            <RadioGroup
                              className="ml-9 mt-1 space-y-1"
                              value={instructionsMode}
                              onValueChange={(value) => { setInstructionsMode(value as "add" | "replace"); stale(); }}
                            >
                              <div className="flex items-center gap-2">
                                <RadioGroupItem value="add" id="instructions-add" />
                                <Label htmlFor="instructions-add" className="font-normal">Add to each account's own instructions</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <RadioGroupItem value="replace" id="instructions-replace" />
                                <Label htmlFor="instructions-replace" className="font-normal">Replace each account's instructions</Label>
                              </div>
                            </RadioGroup>
                          )}

                          {item.key === "journeys" && picked.has("journeys") && (
                            <div className="ml-9 mt-1 space-y-1">
                              {source.journeys.map((journey) => (
                                <label key={journey.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                                  <Checkbox
                                    aria-label={journey.name}
                                    checked={journeyIds.has(journey.id)}
                                    onCheckedChange={(on) => { setJourneyIds((set) => toggle(set, journey.id, !!on)); stale(); }}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{journey.name}</span>
                                  <span className="text-xs text-gray-500">
                                    {journey.steps} question{journey.steps === 1 ? "" : "s"}
                                    {journey.startFromScratch ? " · starts every chat" : ""}
                                    {journey.status !== "active" ? " · off" : ""}
                                  </span>
                                </label>
                              ))}
                              {needsJourney && <p className="text-xs text-amber-700">Choose at least one journey.</p>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sourceId && (
        <Card className="shadow-sm">
          <CardContent className="py-5 px-6">
            <StepTitle number={3} title="Copy to" />
            <RadioGroup
              className="space-y-1"
              value={targetMode}
              onValueChange={(value) => { setTargetMode(value as "all" | "some"); stale(); }}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="target-all" />
                <Label htmlFor="target-all" className="font-normal">All other accounts in this group ({others.length})</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="some" id="target-some" />
                <Label htmlFor="target-some" className="font-normal">Only the accounts I choose{targetMode === "some" ? ` (${targetIds.length} chosen)` : ""}</Label>
              </div>
            </RadioGroup>
            {targetMode === "some" && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input className="pl-8" placeholder="Find an account" value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSomeIds(new Set([...Array.from(someIds), ...visibleOthers.map((m) => m.businessAccountId)])); stale(); }}>Select shown</Button>
                  <Button variant="outline" size="sm" onClick={() => { setSomeIds(new Set()); stale(); }}>Clear</Button>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {visibleOthers.map((m) => (
                    <label key={m.businessAccountId} className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm text-gray-700 hover:bg-gray-50">
                      <Checkbox
                        aria-label={m.name}
                        checked={someIds.has(m.businessAccountId)}
                        onCheckedChange={(on) => { setSomeIds((set) => toggle(set, m.businessAccountId, !!on)); stale(); }}
                      />
                      <span className="truncate">{m.name}</span>
                    </label>
                  ))}
                  {visibleOthers.length === 0 && <p className="p-1 text-sm text-gray-500">No account matches.</p>}
                </div>
              </div>
            )}
            <div className="mt-5">
              <Button onClick={review} disabled={!canReview || previewing}>
                {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Review changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card className="shadow-sm">
          <CardContent className="py-5 px-6">
            <StepTitle
              number={4}
              title="Review"
              hint={`${willChange.length} of ${preview.length} account${preview.length === 1 ? "" : "s"} will change.${willChange.length < preview.length ? " The others already match." : ""}`}
            />
            {warningGroups.length > 0 && (
              <div className="mb-4 space-y-2">
                {warningGroups.map((warning) => (
                  <div key={`${warning.label}${warning.message}`} className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{warning.label}:</span> {warning.message}
                      <span className="block text-xs text-amber-800">
                        {warning.accounts.length === preview.length ? "All accounts" : warning.accounts.slice(0, 4).join(", ")}
                        {warning.accounts.length !== preview.length && warning.accounts.length > 4 ? ` and ${warning.accounts.length - 4} more` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {preview.map((target) => {
                const open = expanded === target.businessAccountId;
                const hasChanges = target.changes.length > 0;
                return (
                  <div key={target.businessAccountId}>
                    <button
                      type="button"
                      disabled={!hasChanges}
                      onClick={() => setExpanded(open ? null : target.businessAccountId)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-default"
                    >
                      {hasChanges ? (open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />) : <Check className="h-4 w-4 text-green-600" />}
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{target.name}</span>
                      <span className="text-xs text-gray-500">{hasChanges ? target.changes.map((c) => c.label).join(", ") : "Already matches"}</span>
                    </button>
                    {open && (
                      <div className="space-y-2 bg-gray-50 px-9 py-2">
                        {target.changes.map((change) => (
                          <div key={change.key} className="text-xs">
                            <p className="font-semibold text-gray-700">{change.label}</p>
                            {change.details.map((detail) => (
                              <p key={detail.field} className="text-gray-600">
                                {detail.field}: <span className="text-gray-400">{detail.from}</span> → <span className="text-gray-800">{detail.to}</span>
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <Button onClick={() => setConfirmCopy(true)} disabled={willChange.length === 0 || copying}>
                {copying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                Copy to {willChange.length} account{willChange.length === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card className="shadow-sm">
          <CardContent className="py-5 px-6">
            <h3 className="text-base font-semibold text-gray-900">Copied</h3>
            <p className="mt-1 text-sm text-gray-500">
              {results.rows.filter((r) => r.ok && r.changed.length).length} updated · {results.rows.filter((r) => r.ok && !r.changed.length).length} already matched · {failedRows.length} failed
            </p>
            {failedRows.length > 0 && (
              <div className="mt-3 space-y-2">
                {failedRows.map((row) => (
                  <p key={row.businessAccountId} className="text-sm text-red-700"><span className="font-medium">{row.name}:</span> {row.error}</p>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={copying}
                  onClick={() => copy({ ...results.request, targetIds: failedRows.map((r) => r.businessAccountId) })}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Try the {failedRows.length} failed again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card className="shadow-sm">
          <CardContent className="py-5 px-6">
            <h3 className="mb-3 text-base font-semibold text-gray-900">History</h3>
            <div className="divide-y divide-gray-100">
              {history.map((row) => {
                const updated = row.results.filter((r) => r.ok && r.changed.length).length;
                const failed = row.results.filter((r) => !r.ok).length;
                return (
                  <div key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800">
                        <span className="font-medium">{row.sourceName}</span>: {row.request.items.map((key) => copyItem(key)?.label ?? key).join(", ")}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(row.createdAt).toLocaleString()}{row.createdByName ? ` · ${row.createdByName}` : ""} · {updated} updated{failed ? ` · ${failed} failed` : ""}
                        {row.undoneAt ? ` · undone ${new Date(row.undoneAt).toLocaleString()}` : ""}
                      </p>
                    </div>
                    {row.canUndo && (
                      <Button variant="outline" size="sm" onClick={() => setUndoRow(row)}>
                        <Undo2 className="mr-2 h-4 w-4" /> Undo
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-gray-500">Only the newest copy can be undone. Undo it to reach the one before.</p>
          </CardContent>
        </Card>
      )}

      <Sheet open={!!detailItem} onOpenChange={(open) => { if (!open) setDetailKey(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {detailItem && (
            <>
              <SheetHeader className="border-b border-gray-100 p-6 text-left">
                <SheetTitle>{detailItem.label}</SheetTitle>
                <SheetDescription>{detailItem.description}. This is what {sourceName} has now.</SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-6 overflow-y-auto p-6">
                {detailItem.sections.length === 0 && <p className="text-sm text-gray-500">Nothing is set up here on this account, so there is nothing to copy.</p>}
                {detailItem.sections.map((section, index) => (
                  <div key={section.title ?? index}>
                    {section.title && <h4 className="mb-2 text-sm font-semibold text-gray-900">{section.title}</h4>}
                    <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                      {section.rows.map((row, rowIndex) => (
                        <div key={`${row.label}${rowIndex}`} className="px-3 py-2">
                          <dt className="text-xs text-gray-500">{row.label}</dt>
                          <dd className="mt-0.5 text-sm text-gray-900"><DetailValue row={row} /></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              {!detailItem.empty && (
                <div className="border-t border-gray-100 p-4">
                  <Button
                    className="w-full"
                    variant={picked.has(detailItem.key) ? "outline" : "default"}
                    onClick={() => { setPicked((set) => toggle(set, detailItem.key, !set.has(detailItem.key))); stale(); }}
                  >
                    {picked.has(detailItem.key) ? "Remove from this copy" : "Add to this copy"}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmCopy} onOpenChange={setConfirmCopy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy to {willChange.length} account{willChange.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              These settings change on live chats straight away. You can undo this from History.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCopy(false); copy(request); }}>Copy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!undoRow} onOpenChange={(open) => { if (!open) setUndoRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this copy?</AlertDialogTitle>
            <AlertDialogDescription>
              The accounts get back what they had before this copy. Any edits made to these same settings since then are lost. Journeys that were new stay switched off if visitors have already used them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={undoing} onClick={undo}>Undo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
