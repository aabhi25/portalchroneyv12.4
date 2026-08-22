import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, CalendarClock, FileSpreadsheet, Save, SlidersHorizontal } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { CampaignAutomation } from "./WhatsAppCampaignAutomations";

type Template = { id: string; name: string; status: string; paramCount: number; bodyText: string };

const EMPTY = {
  name: "",
  templateId: "",
  templateParams: [] as string[],
  phoneColumn: "phone",
  nameColumn: "customer name",
  recordKeyColumn: "loan id",
  dateColumn: "emi due date",
  dateOffsetDays: 0,
  statusColumn: "payment status",
  eligibleStatusesText: "pending, overdue",
  defaultCountryCode: "91",
  sendMode: "review" as "review" | "automatic",
  sendTime: "10:00",
  timezone: "Asia/Kolkata",
  enabled: true,
};

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default function WhatsAppCampaignAutomationForm({ id }: { id?: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const { data: templates = [] } = useQuery<Template[]>({ queryKey: ["/api/whatsapp/templates"] });
  const { data: existing, isLoading } = useQuery<CampaignAutomation & Record<string, any>>({
    queryKey: ["/api/whatsapp/campaign-automations", id],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      templateId: existing.templateId,
      templateParams: Array.isArray(existing.templateParams) ? existing.templateParams : [],
      phoneColumn: existing.phoneColumn,
      nameColumn: existing.nameColumn || "",
      recordKeyColumn: existing.recordKeyColumn,
      dateColumn: existing.dateColumn,
      dateOffsetDays: existing.dateOffsetDays,
      statusColumn: existing.statusColumn || "",
      eligibleStatusesText: Array.isArray(existing.eligibleStatuses) ? existing.eligibleStatuses.join(", ") : "",
      defaultCountryCode: existing.defaultCountryCode || "91",
      sendMode: existing.sendMode,
      sendTime: existing.sendTime,
      timezone: existing.timezone,
      enabled: existing.enabled,
    });
  }, [existing]);

  const selectedTemplate = templates.find(template => template.id === form.templateId);
  const approvedTemplates = templates.filter(template => template.status === "approved");
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(current => ({ ...current, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        eligibleStatuses: form.eligibleStatusesText.split(",").map(value => value.trim()).filter(Boolean),
      };
      return id
        ? apiRequest("PATCH", `/api/whatsapp/campaign-automations/${id}`, payload)
        : apiRequest("POST", "/api/whatsapp/campaign-automations", payload);
    },
    onSuccess: (saved: CampaignAutomation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations"] });
      toast({ title: id ? "Automation updated" : "Automation created" });
      setLocation(`/admin/whatsapp-campaign-automations/${saved.id}`);
    },
    onError: (error: any) => toast({ title: "Could not save automation", description: error.message, variant: "destructive" }),
  });

  if (id && isLoading) return <div className="p-6 text-center text-gray-500">Loading automation...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => setLocation(id ? `/admin/whatsapp-campaign-automations/${id}` : "/admin/whatsapp-campaign-automations")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to automations
      </Button>
      <div>
        <h1 className="text-2xl font-bold">{id ? "Edit spreadsheet automation" : "New spreadsheet automation"}</h1>
        <p className="text-sm text-gray-600 mt-1">Map your client’s spreadsheet once, then upload a refreshed file whenever it is ready.</p>
      </div>

      <Section title="Campaign and template" icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}>
        <div className="space-y-2">
          <Label htmlFor="automation-name">Automation name</Label>
          <Input id="automation-name" value={form.name} onChange={event => update("name", event.target.value)} placeholder="EMI reminder — 3 days before due date" />
        </div>
        <div className="space-y-2">
          <Label>Approved WhatsApp template</Label>
          <Select value={form.templateId} onValueChange={templateId => update("templateId", templateId)}>
            <SelectTrigger><SelectValue placeholder="Choose an approved template" /></SelectTrigger>
            <SelectContent>
              {approvedTemplates.map(template => <SelectItem key={template.id} value={template.id}>{template.name} · {template.paramCount} fields</SelectItem>)}
            </SelectContent>
          </Select>
          {!approvedTemplates.length && <p className="text-xs text-amber-700">Sync an approved MSG91 template before creating an automation.</p>}
          {selectedTemplate && <p className="text-xs text-gray-500">{selectedTemplate.bodyText}</p>}
        </div>
        {selectedTemplate && selectedTemplate.paramCount > 0 && (
          <div className="rounded-md border bg-gray-50 p-3 space-y-2">
            <p className="text-sm font-medium">Template field mappings</p>
            <p className="text-xs text-gray-500">Use spreadsheet fields like <code>{"{{customer name}}"}</code> or static text. Field names must match the sheet headers after lowercasing.</p>
            {Array.from({ length: selectedTemplate.paramCount }, (_, index) => (
              <Input
                key={index}
                value={form.templateParams[index] || ""}
                onChange={event => {
                  const templateParams = [...form.templateParams];
                  templateParams[index] = event.target.value;
                  update("templateParams", templateParams);
                }}
                placeholder={`Template field ${index + 1}, e.g. {{emi amount}}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Spreadsheet matching rule" icon={<SlidersHorizontal className="h-4 w-4 text-emerald-600" />}>
        <p className="text-sm text-gray-600">Enter normalized spreadsheet headers. For example, “EMI Due Date” becomes <code>emi due date</code>; use the exact lower-case header text shown in the upload preview if validation asks you to correct it.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Phone column</Label><Input value={form.phoneColumn} onChange={event => update("phoneColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Name column (optional)</Label><Input value={form.nameColumn} onChange={event => update("nameColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Unique record key column(s)</Label><Input value={form.recordKeyColumn} onChange={event => update("recordKeyColumn", event.target.value)} /><p className="text-xs text-gray-500">Use one column, or comma-separated values such as loan id, installment id.</p></div>
          <div className="space-y-2"><Label>Date column</Label><Input value={form.dateColumn} onChange={event => update("dateColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Days relative to date</Label><Input type="number" min={-366} max={366} value={form.dateOffsetDays} onChange={event => update("dateOffsetDays", Number(event.target.value))} /><p className="text-xs text-gray-500">-3 sends three days before; 0 sends on the date; +1 sends one day after.</p></div>
          <div className="space-y-2"><Label>Status column (optional)</Label><Input value={form.statusColumn} onChange={event => update("statusColumn", event.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <Label>Allowed status values (optional, comma separated)</Label>
          <Input value={form.eligibleStatusesText} onChange={event => update("eligibleStatusesText", event.target.value)} placeholder="pending, overdue" />
          <p className="text-xs text-gray-500">Leave blank to include every record that matches the date rule.</p>
        </div>
      </Section>

      <Section title="Delivery control" icon={<CalendarClock className="h-4 w-4 text-emerald-600" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Send time</Label><Input type="time" value={form.sendTime} onChange={event => update("sendTime", event.target.value)} /></div>
          <div className="space-y-2"><Label>Timezone</Label><Input value={form.timezone} onChange={event => update("timezone", event.target.value)} placeholder="Asia/Kolkata" /></div>
          <div className="space-y-2"><Label>Default country calling code</Label><Input value={form.defaultCountryCode} onChange={event => update("defaultCountryCode", event.target.value)} placeholder="91" /></div>
          <div className="space-y-2"><Label>After a valid upload</Label>
            <Select value={form.sendMode} onValueChange={(sendMode: "review" | "automatic") => update("sendMode", sendMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="review">Wait for review before scheduling</SelectItem>
                <SelectItem value="automatic">Schedule automatically</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t pt-4">
          <Switch checked={form.enabled} onCheckedChange={enabled => update("enabled", enabled)} id="automation-enabled" />
          <div><Label htmlFor="automation-enabled">Automation is active</Label><p className="text-xs text-gray-500">Paused automations keep their history but reject new uploads.</p></div>
        </div>
      </Section>

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="outline" onClick={() => setLocation("/admin/whatsapp-campaign-automations")}>Cancel</Button>
        <Button disabled={saveMutation.isPending || !form.name || !form.templateId} onClick={() => saveMutation.mutate()} data-testid="button-save-campaign-automation">
          <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving..." : id ? "Save changes" : "Create automation"}
        </Button>
      </div>
    </div>
  );
}