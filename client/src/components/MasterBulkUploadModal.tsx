import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, CheckCircle2, FileSpreadsheet, Store, Building2, MapPin, Key } from "lucide-react";

interface FlowInfo {
  flowId: string;
  flowName: string;
  allSteps: { id: string; stepOrder: number; type: string; prompt: string }[];
  suggestedStep3Id: string;
  suggestedStep4Id: string;
  suggestedStep5Id: string;
}

interface PreviewData {
  step3Options: { dropdownItems: { id: string; title: string; value: string }[] };
  step4Options: { dependsOnFields: string[]; conditionalOptions: Record<string, { id: string; title: string; value: string }[]> };
  step5Options: { dependsOnFields: string[]; conditionalOptions: Record<string, { id: string; title: string; value: string }[]> };
  credentials: { dealerName: string; city: string | null; storeName: string; storeId: number | null; sid: string; secret: string }[];
  flowInfo: FlowInfo[];
  stats: { dealers: number; cities: number; stores: number; credentials: number };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

function maskSecret(secret: string): string {
  if (!secret) return "—";
  const visible = secret.slice(0, 4);
  return `${visible}${"•".repeat(Math.min(8, Math.max(3, secret.length - 4)))}`;
}

export default function MasterBulkUploadModal({ open, onClose, onApplied }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<"upload" | "review" | "applying" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selectedFlowIdx, setSelectedFlowIdx] = useState(0);
  const [step3Id, setStep3Id] = useState("");
  const [step4Id, setStep4Id] = useState("");
  const [step5Id, setStep5Id] = useState("");
  const [results, setResults] = useState<any>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setFileName(file.name);
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const headers = (data[0] || []).map((h: any) => String(h).toLowerCase().trim());
      const dealerIdx = headers.findIndex((h: string) => h.includes("dealer"));
      const cityIdx = headers.findIndex((h: string) => h.includes("city") || h.includes("location"));
      const storeNameIdx = headers.findIndex((h: string) => h.includes("store") && h.includes("name"));
      const storeIdIdx = headers.findIndex((h: string) => h.includes("store") && h.includes("id"));
      const sidIdx = headers.findIndex((h: string) => h === "sid" || h === "s_id" || h === "s id");
      const secretIdx = headers.findIndex((h: string) => h.includes("secret") || (h.includes("key") && !h.includes("api")));
      const parsed = data
        .slice(1)
        .filter((r: any[]) => r.some((c) => String(c).trim() !== ""))
        .map((r: any[]) => ({
          dealerName: dealerIdx >= 0 ? String(r[dealerIdx]).trim() : "",
          city: cityIdx >= 0 ? String(r[cityIdx]).trim() : "",
          storeName: storeNameIdx >= 0 ? String(r[storeNameIdx]).trim() : "",
          storeId: storeIdIdx >= 0 ? r[storeIdIdx] : null,
          sid: sidIdx >= 0 ? String(r[sidIdx]).trim() : "",
          secret: secretIdx >= 0 ? String(r[secretIdx]).trim() : "",
        }));
      setRows(parsed);
    } catch (err: any) {
      toast({ title: "File error", description: err.message, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  const handlePreview = async () => {
    if (rows.length === 0) {
      toast({ title: "No data", description: "Please select a valid Excel file first", variant: "destructive" });
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/custom-crm/master-bulk-upload/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Preview failed");
      setPreview(data);
      setSelectedFlowIdx(0);
      if (data.flowInfo?.length > 0) {
        setStep3Id(data.flowInfo[0].suggestedStep3Id);
        setStep4Id(data.flowInfo[0].suggestedStep4Id);
        setStep5Id(data.flowInfo[0].suggestedStep5Id);
      }
      setStage("review");
    } catch (err: any) {
      toast({ title: "Preview Failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    setStage("applying");
    try {
      const flow = preview.flowInfo[selectedFlowIdx];
      const res = await fetch("/api/custom-crm/master-bulk-upload/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          flowId: flow?.flowId,
          step3Id,
          step4Id,
          step5Id,
          rows,
          credentials: preview.credentials,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Apply failed");
      setResults(data.results);
      setStage("done");
      onApplied?.();
    } catch (err: any) {
      toast({ title: "Apply Failed", description: err.message, variant: "destructive" });
      setStage("review");
    }
  };

  const handleClose = () => {
    setStage("upload");
    setFileName("");
    setRows([]);
    setPreview(null);
    setResults(null);
    onClose();
  };

  const flow = preview?.flowInfo[selectedFlowIdx];
  const dropdownSteps = flow?.allSteps.filter((s) => s.type === "dropdown") || [];

  const statCards = [
    { label: "Dealers", value: preview?.stats.dealers ?? 0, icon: Building2, bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-400", iconCls: "text-blue-600" },
    { label: "Cities", value: preview?.stats.cities ?? 0, icon: MapPin, bg: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800", text: "text-green-700 dark:text-green-400", iconCls: "text-green-600" },
    { label: "Stores", value: preview?.stats.stores ?? 0, icon: Store, bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800", text: "text-orange-700 dark:text-orange-400", iconCls: "text-orange-600" },
    { label: "Credentials", value: preview?.stats.credentials ?? 0, icon: Key, bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800", text: "text-violet-700 dark:text-violet-400", iconCls: "text-violet-600" },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-violet-600" />
            Master Bulk Upload
          </DialogTitle>
        </DialogHeader>

        {/* Stage 1: Upload */}
        {stage === "upload" && (
          <div className="flex flex-col items-center gap-6 py-8">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-12 w-full text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              {fileName ? (
                <div>
                  <p className="font-medium text-violet-700 dark:text-violet-400">{fileName}</p>
                  <p className="text-sm text-muted-foreground mt-1">{rows.length} rows detected · Click to change file</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">Drop your Excel file here, or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-2">Supported: .xlsx · .xls</p>
                  <p className="text-xs text-muted-foreground mt-1">Columns: Dealer Name · City · Store Name · Store ID · SID · Secret Key</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <Button
              onClick={handlePreview}
              disabled={rows.length === 0 || previewing}
              className="w-full max-w-xs bg-violet-600 hover:bg-violet-700 text-white"
            >
              {previewing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</> : "Preview Changes"}
            </Button>
          </div>
        )}

        {/* Stage 2: Review */}
        {stage === "review" && preview && (
          <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
            <div className="grid grid-cols-4 gap-2 shrink-0">
              {statCards.map(({ label, value, icon: Icon, bg, text, iconCls }) => (
                <div key={label} className={`rounded-lg border p-3 text-center ${bg}`}>
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${iconCls}`} />
                  <div className={`text-xl font-bold ${text}`}>{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            {preview.flowInfo.length > 0 ? (
              <div className="shrink-0 p-3 bg-muted/40 rounded-lg border space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp Flow Step Assignment</p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Flow</p>
                    <Select
                      value={String(selectedFlowIdx)}
                      onValueChange={(v) => {
                        const idx = parseInt(v);
                        setSelectedFlowIdx(idx);
                        setStep3Id(preview.flowInfo[idx].suggestedStep3Id);
                        setStep4Id(preview.flowInfo[idx].suggestedStep4Id);
                        setStep5Id(preview.flowInfo[idx].suggestedStep5Id);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {preview.flowInfo.map((f, i) => (
                          <SelectItem key={f.flowId} value={String(i)}>{f.flowName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(["Dealer (Step 3)", "City (Step 4)", "Store (Step 5)"] as const).map((label, idx) => {
                    const val = [step3Id, step4Id, step5Id][idx];
                    const setter = [setStep3Id, setStep4Id, setStep5Id][idx];
                    return (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <Select value={val} onValueChange={setter}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick step" /></SelectTrigger>
                          <SelectContent>
                            {dropdownSteps.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                Step {s.stepOrder + 1}: {(s.prompt || "").substring(0, 22)}…
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="shrink-0 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                ⚠ No WhatsApp flow with 3+ dropdown steps found. Only CRM credentials will be imported.
              </div>
            )}

            <Tabs defaultValue="dealers" className="flex flex-col min-h-0 flex-1 overflow-hidden">
              <TabsList className="w-full shrink-0">
                <TabsTrigger value="dealers" className="flex-1">Dealers ({preview.stats.dealers})</TabsTrigger>
                <TabsTrigger value="cities" className="flex-1">Cities ({preview.stats.cities})</TabsTrigger>
                <TabsTrigger value="stores" className="flex-1">Stores ({preview.stats.stores})</TabsTrigger>
                <TabsTrigger value="credentials" className="flex-1">Credentials ({preview.stats.credentials})</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-hidden mt-2 min-h-0">
                <TabsContent value="dealers" className="mt-0 h-full">
                  <ScrollArea className="h-44">
                    <div className="space-y-1.5 p-1">
                      {preview.step3Options.dropdownItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg border text-sm">
                          <span className="font-medium">{item.title}</span>
                          <Badge variant="outline" className="text-xs font-mono">{item.value}</Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="cities" className="mt-0 h-full">
                  <ScrollArea className="h-44">
                    <div className="space-y-3 p-1">
                      {Object.entries(preview.step4Options.conditionalOptions).map(([dealer, cities]) => (
                        <div key={dealer}>
                          <p className="text-xs font-semibold text-muted-foreground mb-1 px-1">{dealer}</p>
                          <div className="grid grid-cols-3 gap-1">
                            {cities.map((c) => (
                              <div key={c.id} className="p-2 bg-muted/40 rounded border text-xs text-center">{c.title}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="stores" className="mt-0 h-full">
                  <ScrollArea className="h-44">
                    <div className="space-y-3 p-1">
                      {Object.entries(preview.step5Options.conditionalOptions).map(([cityKey, stores]) => (
                        <div key={cityKey}>
                          <p className="text-xs font-semibold text-muted-foreground mb-1 px-1">{cityKey}</p>
                          <div className="grid grid-cols-3 gap-1">
                            {(stores as any[]).map((s) => (
                              <div key={s.id} className="p-2 bg-muted/40 rounded border text-xs truncate">{s.title}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="credentials" className="mt-0 h-full">
                  <ScrollArea className="h-44">
                    <div className="space-y-1 p-1">
                      <div className="grid grid-cols-6 gap-2 px-2 py-1 text-xs font-semibold text-muted-foreground border-b">
                        <span>Dealer</span><span>City</span><span>Store</span><span>Store ID</span><span>SID</span><span>Secret Key</span>
                      </div>
                      {preview.credentials.map((c, i) => (
                        <div key={i} className="grid grid-cols-6 gap-2 p-2 bg-muted/40 rounded border text-xs">
                          <span className="font-medium truncate">{c.dealerName}</span>
                          <span className="truncate text-muted-foreground">{c.city}</span>
                          <span className="truncate">{c.storeName}</span>
                          <span className="font-mono text-muted-foreground">{c.storeId ?? "—"}</span>
                          <span className="font-mono text-blue-600 dark:text-blue-400 truncate">{c.sid}</span>
                          <span className="font-mono text-muted-foreground truncate" title="Hidden for security">{maskSecret(c.secret)}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </div>
            </Tabs>

            <div className="flex justify-between pt-2 border-t shrink-0">
              <Button variant="outline" onClick={() => setStage("upload")}>← Back</Button>
              <Button onClick={handleApply} className="bg-violet-600 hover:bg-violet-700 text-white">
                Apply All Changes
              </Button>
            </div>
          </div>
        )}

        {/* Stage: Applying */}
        {stage === "applying" && (
          <div className="flex flex-col items-center gap-4 py-16">
            <Loader2 className="h-12 w-12 animate-spin text-violet-600" />
            <p className="text-lg font-medium">Applying changes…</p>
            <p className="text-sm text-muted-foreground">Updating flow steps and importing credentials</p>
          </div>
        )}

        {/* Stage: Done */}
        {stage === "done" && results && (
          <div className="flex flex-col items-center gap-6 py-8">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div className="text-center">
              <p className="text-xl font-bold text-green-700 dark:text-green-400">All done!</p>
              <p className="text-sm text-muted-foreground mt-1">Here's what was applied</p>
            </div>
            <div className="w-full space-y-2 max-w-sm">
              <div className="flex justify-between items-center p-3 bg-muted/40 rounded-lg border text-sm">
                <span>Flow steps updated</span>
                <Badge variant="outline" className="text-green-600 border-green-300">{results.flowSteps.updated} / 3</Badge>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/40 rounded-lg border text-sm">
                <span>Credentials created</span>
                <Badge variant="outline" className="text-blue-600 border-blue-300">{results.credentials.created}</Badge>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/40 rounded-lg border text-sm">
                <span>Credentials updated</span>
                <Badge variant="outline" className="text-violet-600 border-violet-300">{results.credentials.updated}</Badge>
              </div>
              {results.credentials.failed > 0 && (
                <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-200 text-sm">
                  <span>Failed</span>
                  <Badge variant="destructive">{results.credentials.failed}</Badge>
                </div>
              )}
              {results.flowSteps.errors?.length > 0 && (
                <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-xs text-red-700 space-y-0.5">
                  {results.flowSteps.errors.map((e: string, i: number) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
            <Button onClick={handleClose} className="w-full max-w-xs">Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
