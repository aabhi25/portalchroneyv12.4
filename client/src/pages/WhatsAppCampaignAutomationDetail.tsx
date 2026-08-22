import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Pencil, Play, Upload, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseSpreadsheetFile, pickDefaultSheet } from "@/lib/spreadsheetImport";
import { buildSheetData } from "@shared/contactImport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import type { CampaignAutomation } from "./WhatsAppCampaignAutomations";

type Preview = {
  targetDate: string;
  summary: { totalRows: number; eligibleRows: number; excludedRows: number; invalidRows: number; duplicateRows: number };
  invalid: { rowNumber: number; reason: string }[];
  previewRecipients: { rowNumber: number; recordKey: string; phone: string; name: string; params: string[] }[];
};
type Run = {
  id: string; sourceFileName: string; status: string; scheduledAt: string | null; totalRows: number; eligibleRows: number;
  excludedRows: number; invalidRows: number; duplicateRows: number; createdAt: string;
  campaignId: string | null; campaign?: { status: string; id: string } | null;
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  awaiting_review: "outline", scheduled: "secondary", completed: "default", failed: "destructive", cancelled: "destructive",
};

export default function WhatsAppCampaignAutomationDetail({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<any>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const { data: automation, isLoading } = useQuery<CampaignAutomation & Record<string, any>>({
    queryKey: ["/api/whatsapp/campaign-automations", id],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}`),
  });
  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["/api/whatsapp/campaign-automations", id, "runs"],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}/runs`),
    refetchInterval: 20_000,
  });

  const previewMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/upload-preview`, payload),
    onSuccess: (result: Preview) => setPreview(result),
    onError: (error: any) => toast({ title: "Could not validate file", description: error.message, variant: "destructive" }),
  });
  const createRunMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/runs`, { ...payload, sourceFileName: fileName }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] });
      setPayload(null); setPreview(null); setFileName("");
      if (fileInput.current) fileInput.current.value = "";
      toast({ title: result.run.status === "scheduled" ? "Campaign scheduled" : "Run created for review" });
    },
    onError: (error: any) => toast({ title: "Could not create run", description: error.message, variant: "destructive" }),
  });
  const approveMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/runs/${runId}/approve`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] }); toast({ title: "Run approved and scheduled" }); },
    onError: (error: any) => toast({ title: "Could not schedule run", description: error.message, variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/runs/${runId}/cancel`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] }); toast({ title: "Run cancelled" }); },
    onError: (error: any) => toast({ title: "Could not cancel run", description: error.message, variant: "destructive" }),
  });

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      const sheetName = pickDefaultSheet(parsed);
      const sheet = buildSheetData(parsed.recordsBySheet[sheetName] || []);
      if (!sheet.columns.length || !sheet.rows.length) throw new Error("The selected sheet has no header and data rows");
      setFileName(file.name);
      setPayload({ columns: sheet.columns, rows: sheet.rows });
      setPreview(null);
    } catch (error: any) {
      toast({ title: "Could not read spreadsheet", description: error.message, variant: "destructive" });
      setPayload(null); setPreview(null);
    }
  };

  if (isLoading) return <div className="p-6 text-center text-gray-500">Loading automation...</div>;
  if (!automation) return <div className="p-6 text-center text-gray-500">Automation not found.</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/whatsapp-campaign-automations")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to automations
      </Button>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{automation.name}</h1><Badge variant={automation.enabled ? "default" : "outline"}>{automation.enabled ? "Active" : "Paused"}</Badge></div>
          <p className="text-sm text-gray-600 mt-1">
            {automation.dateOffsetDays > 0 ? `${automation.dateOffsetDays} days after` : automation.dateOffsetDays < 0 ? `${Math.abs(automation.dateOffsetDays)} days before` : "On"} <span className="font-medium">{automation.dateColumn}</span> · send at {automation.sendTime} {automation.timezone}
          </p>
        </div>
        <Button variant="outline" onClick={() => setLocation(`/admin/whatsapp-campaign-automations/${id}/edit`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4 text-emerald-600" /> Daily spreadsheet upload</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">Upload the refreshed client file. We validate the configured fields and calculate today’s eligible recipients before creating any campaign.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileInput.current?.click()}><FileSpreadsheet className="h-4 w-4 mr-1" /> Choose spreadsheet</Button>
            {fileName && <span className="text-sm text-gray-600">{fileName}</span>}
            {payload && <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}><CheckCircle2 className="h-4 w-4 mr-1" /> {previewMutation.isPending ? "Validating..." : "Validate upload"}</Button>}
          </div>

          {preview && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <div>
                <h3 className="font-medium">Validation result</h3>
                <p className="text-sm text-gray-600">Target date: <span className="font-medium">{preview.targetDate}</span></p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <div><span className="block text-gray-500">Rows</span><strong>{preview.summary.totalRows}</strong></div>
                <div><span className="block text-gray-500">Eligible</span><strong className="text-emerald-700">{preview.summary.eligibleRows}</strong></div>
                <div><span className="block text-gray-500">Date/status excluded</span><strong>{preview.summary.excludedRows}</strong></div>
                <div><span className="block text-gray-500">Already sent</span><strong>{preview.summary.duplicateRows}</strong></div>
                <div><span className="block text-gray-500">Invalid</span><strong className="text-red-700">{preview.summary.invalidRows}</strong></div>
              </div>
              {preview.summary.eligibleRows > 0 ? (
                <Button onClick={() => createRunMutation.mutate()} disabled={createRunMutation.isPending} data-testid="button-create-automation-run">
                  <Play className="h-4 w-4 mr-1" /> {createRunMutation.isPending ? "Creating..." : automation.sendMode === "automatic" ? "Create and schedule campaign" : "Create run for review"}
                </Button>
              ) : <Alert variant="destructive"><AlertTitle>No recipients ready</AlertTitle><AlertDescription>Correct the date rule, upload data, or duplicate history before creating a run.</AlertDescription></Alert>}
              {preview.previewRecipients.length > 0 && (
                <div className="rounded-md border bg-white overflow-hidden">
                  <div className="px-3 py-2 text-sm font-medium border-b">Recipient preview (first {preview.previewRecipients.length})</div>
                  <div className="max-h-52 overflow-auto text-xs">
                    {preview.previewRecipients.map(recipient => (
                      <div key={`${recipient.rowNumber}-${recipient.recordKey}`} className="grid grid-cols-[64px_1fr_1fr_1fr] gap-2 px-3 py-2 border-b last:border-b-0">
                        <span className="text-gray-500">Row {recipient.rowNumber}</span>
                        <span className="truncate">{recipient.name || "—"}</span>
                        <span className="truncate">{recipient.phone}</span>
                        <span className="truncate text-gray-500">{recipient.recordKey}</span>
                        {recipient.params.length > 0 && <span className="col-span-4 text-gray-500 truncate">Template values: {recipient.params.join(" · ")}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {preview.invalid.length > 0 && <div className="text-xs text-red-700 space-y-1"><p className="font-medium">First invalid rows</p>{preview.invalid.map(problem => <p key={`${problem.rowNumber}-${problem.reason}`}>Row {problem.rowNumber}: {problem.reason}</p>)}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Run history</CardTitle></CardHeader>
        <CardContent>
          {!runs.length ? <p className="text-sm text-gray-500 py-4">No uploaded runs yet.</p> : (
            <div className="space-y-3">
              {runs.map(run => (
                <div key={run.id} className="border rounded-lg p-3 flex flex-wrap gap-3 items-center">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2"><span className="font-medium text-sm">{run.sourceFileName}</span><Badge variant={statusVariant[run.status] || "outline"}>{run.status.replace("_", " ")}</Badge>{run.campaign && <Badge variant={statusVariant[run.campaign.status] || "outline"}>Campaign: {run.campaign.status}</Badge>}</div>
                    <div className="text-xs text-gray-500 mt-1">{run.eligibleRows} eligible · {run.excludedRows} excluded · {run.duplicateRows} already sent · {run.invalidRows} invalid · uploaded {new Date(run.createdAt).toLocaleString()}</div>
                    {run.scheduledAt && <div className="text-xs text-gray-500">Scheduled: {new Date(run.scheduledAt).toLocaleString()}</div>}
                  </div>
                  <div className="flex gap-2">
                    {run.status === "awaiting_review" && <Button size="sm" onClick={() => approveMutation.mutate(run.id)} disabled={approveMutation.isPending}><CheckCircle2 className="h-4 w-4 mr-1" /> Approve & schedule</Button>}
                    {["awaiting_review", "scheduled"].includes(run.status) && <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(run.id)} disabled={cancelMutation.isPending}><XCircle className="h-4 w-4 mr-1" /> Cancel</Button>}
                    {run.campaignId && <Button size="sm" variant="ghost" onClick={() => setLocation(`/admin/whatsapp-campaigns/${run.campaignId}`)}>Campaign</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}