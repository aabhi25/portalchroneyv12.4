import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { SHORT_NAME_LIMIT, type LosChoices, type LosImportSummary, type LosPreview, type LosPreviewStore } from "@shared/storeSheetLos";
import { formatEmiSchemes } from "@shared/storeSheet";
import { waLength } from "@shared/whatsappLimits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * Upload in the LOS layout: everything the file would change, with what is missing or unclear
 * settled here. Nothing is saved until "Save". Each choice asks the server for a fresh preview.
 */
export interface LosImportFile { fileName: string; rows: Record<string, unknown>[] }

type Api = <T>(method: string, url: string, body?: unknown) => Promise<T>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 100;

/** An input that reports its value when the person leaves it or presses Enter. */
function TextField({ value, onSave, label, placeholder, limit, className = "" }: {
  value: string; onSave: (v: string) => void; label: string; placeholder?: string; limit?: number; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const over = limit !== undefined && waLength(draft.trim()) > limit;
  const save = () => { if (draft.trim() !== value) onSave(draft.trim()); };
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Input
        value={draft} aria-label={label} placeholder={placeholder} className={`h-8 min-w-0 ${over ? "border-amber-400" : ""}`}
        onChange={e => setDraft(e.target.value)} onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
      />
      {limit !== undefined && <span className={`text-xs tabular-nums shrink-0 ${over ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>{waLength(draft.trim())}/{limit}</span>}
    </div>
  );
}

function Note({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "slate" }) {
  return (
    <p className={`text-sm rounded-lg px-3 py-2 flex gap-2 ${tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>
      {tone === "amber" && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) =>
  <th className={`p-2 text-left text-xs font-medium text-muted-foreground bg-muted sticky top-0 z-10 ${className}`}>{children}</th>;

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="max-h-[46vh] overflow-auto rounded-lg border">
      <table className="w-full text-sm"><thead><tr>{head}</tr></thead><tbody className="divide-y">{children}</tbody></table>
    </div>
  );
}

export function LosImportDialog({ file, api, onClose, onSaved }: { file: LosImportFile | null; api: Api; onClose: () => void; onSaved: () => void }) {
  const [choices, setChoices] = useState<LosChoices>({});
  const [data, setData] = useState<LosPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("dealers");
  const [dealer, setDealer] = useState("all");
  const [show, setShow] = useState("all");
  const request = useRef(0);

  const load = (next: LosChoices) => {
    if (!file) return;
    const mine = ++request.current;
    setLoading(true);
    api<LosPreview>("POST", "/api/store-sheet/los-import/preview", { rows: file.rows, choices: next })
      .then(p => { if (mine === request.current) { setData(p); setError(""); } })
      .catch((e: Error) => { if (mine === request.current) setError(e.message); })
      .finally(() => { if (mine === request.current) setLoading(false); });
  };
  useEffect(() => {
    request.current++;
    setChoices({}); setData(null); setError(""); setTab("dealers"); setDealer("all"); setShow("all");
    if (file) load({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const change = (patch: (c: LosChoices) => LosChoices) => { const next = patch(choices); setChoices(next); load(next); };
  const setText = (field: "cities" | "storeNames" | "dealerNames" | "join" | "sameAs", entries: Record<string, string>) =>
    change(c => ({ ...c, [field]: { ...c[field], ...entries } }));
  const toggle = (field: "renameDealers" | "useFileSchemes" | "keepOff" | "switchOff", keys: string[], on: boolean) =>
    change(c => { const set = new Set(c[field]); keys.forEach(k => (on ? set.add(k) : set.delete(k))); return { ...c, [field]: Array.from(set) }; });

  const save = useMutation({
    mutationFn: () => api<LosImportSummary>("POST", "/api/store-sheet/los-import/apply", { rows: file!.rows, choices, stamp: data!.stamp, fileName: file!.fileName }),
    onSuccess: r => {
      toast({ title: "Stores saved", description: `${r.added} added, ${r.updated} updated, ${r.intoJourney} switched on in the journey${r.held ? `, ${r.held} held back` : ""}. You can undo this upload.` });
      onSaved();
      onClose();
    },
    onError: (e: Error) => { toast({ title: "Couldn't save", description: e.message, variant: "destructive" }); load(choices); },
  });

  const noCity = useMemo(() => {
    if (!data) return [];
    const added = data.held.filter(h => h.kind === "city").map(h => ({ key: h.key, dealer: h.dealer, store: h.store, suggestion: h.citySuggestion || "", isNew: true }));
    const inApp = data.stores.filter(s => !s.city).map(s => ({ key: s.key, dealer: s.losDealer, store: s.losStore, suggestion: s.citySuggestion, isNew: false }));
    return [...added, ...inApp].sort((a, b) => a.dealer.localeCompare(b.dealer) || a.store.localeCompare(b.store));
  }, [data]);
  const dealersWithoutCity = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of noCity) m.set(s.dealer, [...(m.get(s.dealer) || []), s.key]);
    return Array.from(m);
  }, [noCity]);

  if (!file) return null;

  const conflicts = data?.held.filter(h => h.kind !== "city") ?? [];
  const newWithoutCity = noCity.filter(s => s.isNew).length;
  const suggestedCities = noCity.filter(s => s.suggestion);
  const schemeDealers = data?.dealers.filter(d => d.schemeChanges.length) ?? [];
  const undecided = data?.unlinked.filter(u => !u.chosen) ?? [];
  const tooLong = data?.stores.filter(s => s.nameIsNew && s.tooLong) ?? [];
  const visible = (s: LosPreviewStore) =>
    (dealer === "all" || s.losDealer.toLowerCase() === dealer.toLowerCase()) &&
    (show === "all" || (show === "add" && s.action === "add") || (show === "update" && s.action === "update") || (show === "on" && s.inJourney && !s.wasInJourney)
      || (show === "missing" && s.missing.length > 0) || (show === "long" && s.nameIsNew && s.tooLong));
  const list = data?.stores.filter(visible) ?? [];
  const canJourney = list.filter(s => !s.wasInJourney && !s.missing.length && (s.inJourney || choices.keepOff?.includes(s.key)));
  const nothing = !!data && !data.counts.add && !data.counts.update && !data.counts.joined && !data.counts.switchedOff;

  return (
    <Dialog open onOpenChange={o => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check the changes before saving</DialogTitle>
          <DialogDescription>
            From “{file.fileName}”{data && <> · {plural(data.rowCount, "row")}</>}. Nothing is saved until you click Save, and no store is deleted.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            {error || <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Checking your file…</>}
          </div>
        ) : (
          <div className="space-y-3 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              {([
                ["New", data.counts.add, "text-green-700"], ["Updated", data.counts.update, "text-blue-700"], ["No change", data.counts.unchanged, "text-muted-foreground"],
                ["Into the journey", data.counts.intoJourney, "text-green-700"], ["Held back", data.counts.held, data.counts.held ? "text-amber-700" : "text-muted-foreground"],
              ] as [string, number, string][]).map(([name, n, cls]) => (
                <div key={name} className="rounded-lg border p-2"><p className={`text-xl font-semibold ${cls}`}>{n}</p><p className="text-xs text-muted-foreground">{name}</p></div>
              ))}
            </div>

            {data.cutOff && <Note>This file has exactly {data.rowCount.toLocaleString("en-IN")} rows, so the download was probably cut off. Ask for the full file. You can still save what is here.</Note>}
            {newWithoutCity > 0 && tab !== "cities" && (
              <Note>
                {plural(newWithoutCity, "new store needs a city", "new stores need a city")} before {newWithoutCity === 1 ? "it" : "they"} can be added.{" "}
                <button type="button" className="underline font-medium" onClick={() => setTab("cities")}>Add cities</button>
              </Note>
            )}
            {data.blockers.map(b => <Note key={b}>{b}</Note>)}
            {error && <Note>{error}</Note>}
            {(data.repeatedRows > 0 || data.inactiveStores.length > 0) && (
              <Note tone="slate">
                {data.repeatedRows > 0 && <>{plural(data.repeatedRows, "repeated row")} counted once. </>}
                {data.inactiveStores.length > 0 && <>Marked inactive in the file, so not added: {data.inactiveStores.slice(0, 5).map(s => s.store).join(", ")}{data.inactiveStores.length > 5 && ` and ${data.inactiveStores.length - 5} more`}.</>}
              </Note>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="dealers">Dealers ({data.dealers.length})</TabsTrigger>
                <TabsTrigger value="cities">City missing ({noCity.length})</TabsTrigger>
                <TabsTrigger value="stores">Stores ({data.stores.length})</TabsTrigger>
                {schemeDealers.length > 0 && <TabsTrigger value="schemes">EMI schemes ({schemeDealers.reduce((n, d) => n + d.schemeChanges.length, 0)})</TabsTrigger>}
                {data.unlinked.length + data.spares.length > 0 && <TabsTrigger value="same">Same store? ({undecided.length + data.spares.filter(s => !s.chosen).length})</TabsTrigger>}
                {conflicts.length > 0 && <TabsTrigger value="held">To fix ({conflicts.length})</TabsTrigger>}
                <TabsTrigger value="rest">Not in file ({data.notInFile.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="dealers" className="space-y-2">
                <p className="text-sm text-muted-foreground">The LOS name stays saved. Customers see the short name, up to {SHORT_NAME_LIMIT} characters.</p>
                <Table head={<><Th>Dealer in the LOS</Th><Th className="min-w-[15rem]">Name on WhatsApp</Th><Th>Stores</Th><Th>In the journey</Th></>}>
                  {data.dealers.map(d => {
                    const mine = data.stores.filter(s => s.losDealer.toLowerCase() === d.losDealer.toLowerCase());
                    const open = mine.filter(s => !s.wasInJourney && !s.missing.length && (s.inJourney || choices.keepOff?.includes(s.key)));
                    return (
                      <tr key={d.key} className="align-top">
                        <td className="p-2">{d.losDealer}</td>
                        <td className="p-2 space-y-1">
                          <TextField value={d.name} limit={SHORT_NAME_LIMIT} label={`Name on WhatsApp for ${d.losDealer}`} onSave={v => setText("dealerNames", { [d.key]: v })} />
                          {d.suggested && <p className="text-xs text-muted-foreground">Suggested</p>}
                          {d.problem && <p className="text-xs text-red-700">{d.problem}</p>}
                          {d.warning && <p className="text-xs text-amber-700">{d.warning}</p>}
                          {d.differing > 0 && (
                            <label className="flex items-start gap-2 text-xs cursor-pointer">
                              <Checkbox checked={d.renamed} onCheckedChange={v => toggle("renameDealers", [d.key], v === true)} aria-label={`Rename stores of ${d.losDealer} already in the app`} />
                              <span>Also rename {plural(d.differing, "store")} now under {d.current.filter(c => c.name !== d.name).map(c => `“${c.name}”`).join(", ")}</span>
                            </label>
                          )}
                        </td>
                        <td className="p-2 tabular-nums">{d.stores}</td>
                        <td className="p-2">
                          <span className="tabular-nums">{mine.filter(s => s.inJourney).length}</span>
                          {open.length > 0 && (
                            <label className="flex items-center gap-2 text-xs mt-1 cursor-pointer">
                              <Switch checked={open.some(s => s.inJourney)} onCheckedChange={v => toggle("keepOff", open.map(s => s.key), !v)} aria-label={`Switch on new stores of ${d.losDealer} in the journey`} />
                              Switch on {open.length}
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              </TabsContent>

              <TabsContent value="cities" className="space-y-2">
                {noCity.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center flex items-center justify-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Every store has a city.</p> : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-muted-foreground flex-1 min-w-[16rem]">New stores without a city are not added. Stores in the app stay out of the journey until they have one.</p>
                      {suggestedCities.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => setText("cities", Object.fromEntries(suggestedCities.map(s => [s.key, s.suggestion])))}>Use {plural(suggestedCities.length, "suggested city", "suggested cities")}</Button>
                      )}
                    </div>
                    <details className="rounded-lg border p-2 text-sm">
                      <summary className="cursor-pointer font-medium">One city for a whole dealer</summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-2 max-h-48 overflow-auto">
                        {dealersWithoutCity.map(([name, keys]) => (
                          <div key={name} className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 truncate" title={name}>{name} ({keys.length})</span>
                            <TextField value="" label={`City for every store of ${name}`} placeholder="e.g. Online" className="w-36" onSave={v => v && setText("cities", Object.fromEntries(keys.map(k => [k, v])))} />
                          </div>
                        ))}
                      </div>
                    </details>
                    <Table head={<><Th>Dealer</Th><Th>Store</Th><Th className="min-w-[14rem]">City</Th></>}>
                      {noCity.slice(0, 400).map(s => (
                        <tr key={s.key}>
                          <td className="p-2">{s.dealer}</td>
                          <td className="p-2">{s.store}{!s.isNew && <span className="text-xs text-muted-foreground"> · in the app</span>}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <TextField value="" label={`City for ${s.store}`} placeholder="City" className="flex-1" onSave={v => setText("cities", { [s.key]: v })} />
                              {s.suggestion && <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setText("cities", { [s.key]: s.suggestion })}>{s.suggestion}?</Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
              </TabsContent>

              <TabsContent value="stores" className="space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <Select value={dealer} onValueChange={setDealer}>
                    <SelectTrigger className="w-56 h-8" aria-label="Filter by dealer"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All dealers</SelectItem>{data.dealers.map(d => <SelectItem key={d.key} value={d.losDealer}>{d.name || d.losDealer}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={show} onValueChange={setShow}>
                    <SelectTrigger className="w-52 h-8" aria-label="Which stores to show"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stores</SelectItem><SelectItem value="add">New</SelectItem><SelectItem value="update">Updated</SelectItem>
                      <SelectItem value="on">Going into the journey</SelectItem><SelectItem value="missing">Something missing</SelectItem><SelectItem value="long">Name too long ({tooLong.length})</SelectItem>
                    </SelectContent>
                  </Select>
                  {canJourney.length > 1 && (
                    <span className="text-xs text-muted-foreground flex gap-1 items-center ml-auto">Journey, {canJourney.length} shown:
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggle("keepOff", canJourney.map(s => s.key), false)}>All on</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggle("keepOff", canJourney.map(s => s.key), true)}>All off</Button>
                    </span>
                  )}
                </div>
                <Table head={<><Th>Dealer</Th><Th>City</Th><Th className="min-w-[15rem]">Store on WhatsApp</Th><Th className="min-w-[9rem]">EMI schemes</Th><Th className="min-w-[9rem]">Change</Th><Th>Journey</Th></>}>
                  {list.slice(0, SHOWN).map(s => (
                    <tr key={s.key} className="align-top">
                      <td className="p-2">{s.dealer}</td>
                      <td className="p-2">
                        {choices.cities?.[s.key] !== undefined
                          ? <TextField value={choices.cities[s.key]} label={`City for ${s.losStore}`} placeholder="City" className="w-36" onSave={v => setText("cities", { [s.key]: v })} />
                          : s.city || <span className="text-amber-700">Missing</span>}
                        {s.cityNote && <p className="text-xs text-amber-700">{s.cityNote}</p>}
                      </td>
                      <td className="p-2">
                        {s.nameIsNew
                          ? <TextField value={s.store} limit={SHORT_NAME_LIMIT} label={`Name on WhatsApp for ${s.losStore}`} onSave={v => setText("storeNames", { [s.key]: v })} />
                          : <span className="font-medium">{s.store}</span>}
                        {s.store !== s.losStore && <p className="text-xs text-muted-foreground mt-0.5">{s.losStore}</p>}
                        {s.nameIsNew && s.tooLong && <p className="text-xs text-amber-700">Cut on WhatsApp, with the full name underneath</p>}
                      </td>
                      <td className="p-2 text-xs">{s.schemes.length ? s.schemes.map(x => x.label).join(", ") : <span className="text-amber-700">None</span>}</td>
                      <td className="p-2 text-xs">{s.action === "add" ? <span className="text-green-700 font-medium">New</span> : s.fields.length ? s.fields.join(", ") : <span className="text-muted-foreground">No change</span>}</td>
                      <td className="p-2 text-xs">
                        {s.wasInJourney ? "On"
                          : s.missing.length ? <span className="text-amber-700">Off: no {s.missing.join(", ")}</span>
                            : s.leftOff && !choices.keepOff?.includes(s.key) ? <span className="text-muted-foreground">Off: switched off earlier</span>
                              : <Switch checked={s.inJourney} onCheckedChange={v => toggle("keepOff", [s.key], !v)} aria-label={`Put ${s.store} in the journey`} />}
                      </td>
                    </tr>
                  ))}
                </Table>
                {list.length > SHOWN && <p className="text-xs text-muted-foreground">First {SHOWN} of {list.length}. Pick a dealer to see the others.</p>}
              </TabsContent>

              <TabsContent value="schemes" className="space-y-2">
                <p className="text-sm text-muted-foreground">These stores have scheme IDs in the app that are not in the file. They keep today's schemes unless you choose the file's.</p>
                {schemeDealers.map(d => (
                  <div key={d.key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium flex-1">{d.name} · {plural(d.schemeChanges.length, "store")}</p>
                      <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label={`EMI schemes for ${d.name}`}>
                        {([[false, "Keep today's"], [true, "Use the file's"]] as [boolean, string][]).map(([v, name]) => (
                          <button key={name} type="button" role="radio" aria-checked={d.useFileSchemes === v} onClick={() => toggle("useFileSchemes", [d.key], v)}
                            className={`rounded-md px-3 py-1 text-sm ${d.useFileSchemes === v ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{name}</button>
                        ))}
                      </div>
                    </div>
                    <ul className="text-xs divide-y max-h-40 overflow-auto">
                      {d.schemeChanges.map(c => (
                        <li key={c.key} className="py-1.5"><p className="font-medium">{c.store}</p><p>Today: {formatEmiSchemes(c.now)}</p><p>File: {formatEmiSchemes(c.file)}</p></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="same" className="space-y-3">
                {data.unlinked.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-muted-foreground flex-1 min-w-[16rem]">Customers can pick these stores, but they have no SID. Choose the LOS store each one is: it keeps the name and city customers see and gets that store's SID and secret. The spare entry is switched off.</p>
                      {undecided.some(u => u.suggestion) && (
                        <Button size="sm" variant="outline" onClick={() => setText("join", Object.fromEntries(undecided.filter(u => u.suggestion).map(u => [u.id, u.suggestion])))}>Use {plural(undecided.filter(u => u.suggestion).length, "suggestion")}</Button>
                      )}
                    </div>
                    <Table head={<><Th>Store customers see</Th><Th className="min-w-[18rem]">LOS store</Th></>}>
                      {data.unlinked.map(u => (
                        <tr key={u.id}>
                          <td className="p-2">{u.dealer} · {u.city} · <span className="font-medium">{u.store}</span></td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <Select value={u.chosen || "none"} onValueChange={v => setText("join", { [u.id]: v })}>
                                <SelectTrigger className="h-8" aria-label={`LOS store for ${u.store}`}><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="none">Not joined</SelectItem>{u.options.map(o => <SelectItem key={o.key} value={o.key}>{o.store}</SelectItem>)}</SelectContent>
                              </Select>
                              {!u.chosen && u.suggestion && <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setText("join", { [u.id]: u.suggestion })}>{u.options.find(o => o.key === u.suggestion)?.store}?</Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
                {data.spares.map(s => (
                  <label key={s.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer">
                    <Checkbox checked={s.chosen} onCheckedChange={v => toggle("switchOff", [s.id], v === true)} aria-label={`Switch off the repeated ${s.store}`} />
                    <span>Switch off the repeated “{s.store}” ({s.dealer}). {s.reason}.</span>
                  </label>
                ))}
              </TabsContent>

              <TabsContent value="held" className="space-y-2">
                <p className="text-sm text-muted-foreground">These stores are left exactly as they are. The rest can still be saved.</p>
                <Table head={<><Th>Row</Th><Th>Store</Th><Th>Why</Th></>}>
                  {conflicts.map(h => {
                    const s = h.kind === "name" ? choices.storeNames?.[h.key] : undefined;
                    return (
                      <tr key={`${h.key}-${h.rowNumber}`} className="align-top">
                        <td className="p-2 tabular-nums text-muted-foreground">{h.rowNumber}</td>
                        <td className="p-2">{h.dealer} · {h.store}</td>
                        <td className="p-2 space-y-1">
                          <p>{h.reason}</p>
                          {h.kind === "name" && <TextField value={s ?? ""} limit={SHORT_NAME_LIMIT} placeholder="Another name for WhatsApp" label={`Name on WhatsApp for ${h.store}`} onSave={v => setText("storeNames", { [h.key]: v })} />}
                          {h.kind === "same" && (
                            <div className="flex flex-wrap gap-2">
                              {h.sameAs?.map(c => <Button key={c.id} size="sm" variant="outline" className="h-7" onClick={() => setText("sameAs", { [h.key]: c.id })}>Same store: {c.store}</Button>)}
                              <Button size="sm" variant="outline" className="h-7" onClick={() => setText("sameAs", { [h.key]: "different" })}>Different store</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              </TabsContent>

              <TabsContent value="rest" className="space-y-2">
                <p className="text-sm text-muted-foreground">In the app but not in the file. They stay as they are.</p>
                <Table head={<><Th>Dealer</Th><Th>City</Th><Th>Store</Th><Th>In the journey</Th></>}>
                  {data.notInFile.map(s => <tr key={s.id}><td className="p-2">{s.dealer}</td><td className="p-2">{s.city || "—"}</td><td className="p-2">{s.store}</td><td className="p-2">{s.inJourney ? "Yes" : "No"}</td></tr>)}
                </Table>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {loading && data && <span className="text-xs text-muted-foreground flex items-center mr-auto"><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Checking…</span>}
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!data || loading || !!error || save.isPending || nothing || data.blockers.length > 0}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {nothing ? "Nothing to change" : data ? `Save ${plural(data.counts.add + data.counts.update, "store")}` : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
