import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Table2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { WizardCtx, WorkbookSheet, WorkbookSummary } from "./context";

interface WorkbookDetail {
  id: string;
  name: string;
  currentVersion: { id: string; versionNumber: number; sheets: WorkbookSheet[] } | null;
}

const PHONE_GUESS = /phone|mobile|whatsapp|number|contact/i;
const NAME_GUESS = /^name$|full.?name|customer|student/i;

/**
 * Send a one-off campaign to the people in an AI Workbook.
 *
 * Turns the workbook's sheet into an audience straight away (the same thing "Create audience &
 * campaign" does inside the workbook) and ticks it, so counts, sample values and sending all work
 * exactly as for any other audience. Only the ticked columns are copied onto each person: those are
 * what the message blanks and the campaign AI can use, so a column left out stays private.
 *
 * Fetches the workbook list itself because it is only needed once someone opens this panel.
 */
export function WorkbookAudiencePicker({ ctx }: { ctx: WizardCtx }) {
  const { v, set } = ctx;
  const { toast } = useToast();
  const [workbookId, setWorkbookId] = useState("");
  const [phoneColumn, setPhoneColumn] = useState("");
  const [nameColumn, setNameColumn] = useState("");
  const [included, setIncluded] = useState<string[]>([]);
  // Bumped after adding people, so the workbook dropdown starts empty again.
  const [round, setRound] = useState(0);

  const { data: workbooks = [] } = useQuery<WorkbookSummary[]>({ queryKey: ["/api/whatsapp/ai-workbooks"] });
  const active = workbooks.filter(w => w.status === "active");
  const { data: workbook } = useQuery<WorkbookDetail>({
    queryKey: ["/api/whatsapp/ai-workbooks", workbookId],
    queryFn: () => apiRequest("GET", `/api/whatsapp/ai-workbooks/${workbookId}`),
    enabled: Boolean(workbookId),
  });
  const sheet = workbook?.currentVersion?.sheets[0];
  const columns = sheet?.columns ?? [];
  const rowCount = sheet?.rows?.length ?? 0;

  // A new workbook: guess the phone and name columns, and offer every other column.
  useEffect(() => {
    if (!sheet) return;
    const phone = sheet.columns.find(c => c.key === "phone") ?? sheet.columns.find(c => PHONE_GUESS.test(c.key) || PHONE_GUESS.test(c.label));
    const name = sheet.columns.find(c => c.key === "name") ?? sheet.columns.find(c => NAME_GUESS.test(c.key) || NAME_GUESS.test(c.label));
    setPhoneColumn(phone?.key ?? "");
    setNameColumn(name?.key ?? "");
    setIncluded(sheet.columns.map(c => c.key).filter(k => k !== phone?.key && k !== name?.key));
  }, [sheet?.id, workbookId]);

  const create = useMutation({
    mutationFn: () => apiRequest<{ group: { id: string }; importedContacts: number; skippedRows: number }>(
      "POST",
      `/api/whatsapp/ai-workbooks/${workbookId}/audience`,
      {
        sheetId: sheet!.id,
        phoneColumn,
        nameColumn: nameColumn || undefined,
        includeColumns: included,
        groupName: `${v.name.trim() || workbook?.name || "AI Workbook"} (from workbook)`,
      },
    ),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
      set({ groupIds: Array.from(new Set([...v.groupIds, result.group.id])) });
      toast({
        title: `${result.importedContacts.toLocaleString()} people added from ${workbook?.name ?? "the workbook"}`,
        description: result.skippedRows ? `${result.skippedRows.toLocaleString()} rows had no valid phone number and were left out.` : undefined,
      });
      setWorkbookId("");
      setRound(r => r + 1);
    },
    onError: (error: Error) => toast({ title: "Couldn't use this workbook", description: error.message, variant: "destructive" }),
  });

  if (active.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-violet-100 bg-violet-50/40 p-3" data-testid="workbook-audience-picker">
      <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <Table2 className="h-4 w-4 text-violet-600" /> Or send to the people in an AI Workbook
      </p>
      <Select key={round} value={workbookId || undefined} onValueChange={setWorkbookId}>
        <SelectTrigger data-testid="select-campaign-workbook"><SelectValue placeholder="Choose a workbook" /></SelectTrigger>
        <SelectContent>
          {active.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {workbookId && !sheet && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Opening the workbook…</p>}

      {sheet && (
        <>
          <p className="text-xs text-gray-600">{rowCount.toLocaleString()} rows in “{sheet.name}”.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-700">Mobile number column</label>
              <Select value={phoneColumn || undefined} onValueChange={key => { setPhoneColumn(key); setIncluded(i => i.filter(k => k !== key)); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a column" /></SelectTrigger>
                <SelectContent>{columns.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Name column (optional)</label>
              <Select value={nameColumn || "__none__"} onValueChange={key => { const next = key === "__none__" ? "" : key; setNameColumn(next); setIncluded(i => i.filter(k => k !== next)); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No name column</SelectItem>
                  {columns.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {columns.length > 2 && (
            <div>
              <p className="text-xs font-medium text-gray-700">Details the message and the AI may use</p>
              <p className="text-xs text-gray-500">For example amount due or course. Unticked columns are not copied.</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {columns.filter(c => c.key !== phoneColumn && c.key !== nameColumn).map(c => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={included.includes(c.key)}
                      onCheckedChange={on => setIncluded(i => (on ? [...i, c.key] : i.filter(k => k !== c.key)))}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Button
            size="sm"
            onClick={() => create.mutate()}
            disabled={!phoneColumn || rowCount === 0 || create.isPending}
            data-testid="button-use-workbook"
          >
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Add these {rowCount.toLocaleString()} people
          </Button>
          <p className="text-xs text-gray-500">
            To pick only some rows, or to have replies and outcomes written back into the sheet, open the workbook and use
            “Create audience &amp; campaign” there.
          </p>
        </>
      )}
    </div>
  );
}
