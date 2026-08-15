import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Settings, Loader2, Plus, Trash2,
  FileText, ChevronDown, ChevronUp, Pencil, Shield, Sparkles, ShieldCheck
} from "lucide-react";
import { VerificationRulesSection } from "@/components/VerificationRulesSection";

interface WhatsappSettings {
  whatsappEnabled: string;
  /** Presence only — the server never sends WhatsApp credentials to the browser. */
  msg91AuthKeyConfigured: boolean;
  whatsappNumber: string | null;
  extractionFields: string[];
  customPrompt: string | null;
  autoSyncToLeadsquared: boolean;
  webhookSecretConfigured: boolean;
  leadCaptureEnabled: boolean;
  leadGenerationMode: string;
  requireName: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  minFieldsRequired: number;
  autoReplyEnabled: boolean;
  msg91IntegratedNumberId: string;
  newApplicationCooldownDays: number;
  phoneNumberLength: number;
  updateLeadEnabled: boolean;
  useMasterTraining: boolean;
  useLeadTraining: boolean;
  sessionTemplateName: string | null;
  sessionTemplateNamespace: string | null;
  docConfirmationEnabled: string;
  docConfirmationMode: string;
  docConfirmationHeader: string | null;
  docConfirmationFooter: string | null;
}

interface ExtractionField {
  key: string;
  label: string;
  required: boolean;
  formatRegex?: string;
  formatDescription?: string;
}

interface ValidationRules {
  duplicateCheck?: boolean;
  duplicateField?: string;
}

interface DocumentTypeConfig {
  id: string;
  businessAccountId: string;
  key: string;
  name: string;
  isSystemDefault: boolean;
  isActive: boolean;
  promptTemplate: string | null;
  extractionFields: ExtractionField[];
  validationRules: ValidationRules | null;
  version: number;
}

function DocumentTypesSection() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/whatsapp/document-types"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/document-types", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch document types");
      return res.json() as Promise<{ documentTypes: DocumentTypeConfig[] }>;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/whatsapp/document-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/document-types"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/whatsapp/document-types/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document type deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/document-types"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const docTypes = data?.documentTypes || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {docTypes.map((dt) => (
        <div key={dt.id} className="border rounded-lg overflow-hidden">
          <div
            className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${!dt.isActive ? "opacity-60" : ""}`}
            onClick={() => {
              setExpandedId(expandedId === dt.id ? null : dt.id);
            }}
          >
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-purple-500" />
              <div>
                <span className="font-medium text-sm">{dt.name}</span>
                <span className="text-xs text-gray-400 ml-2">({dt.key})</span>
                {dt.isSystemDefault && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>
                )}
                {!dt.isActive && (
                  <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Disabled</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {dt.extractionFields.filter((f) => f.required).length} required,{" "}
                {dt.extractionFields.filter((f) => !f.required).length} optional fields
              </span>
              <Switch
                checked={dt.isActive}
                onCheckedChange={(val) => {
                  toggleMutation.mutate({ id: dt.id, isActive: val });
                }}
                onClick={(e) => e.stopPropagation()}
                className="scale-75"
              />
              {expandedId === dt.id ? (
                <ChevronUp className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              )}
            </div>
          </div>

          {expandedId === dt.id && (
            <div className="border-t p-3 bg-gray-50 space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Extraction Fields:</p>
                <div className="flex flex-wrap gap-1.5">
                  {dt.extractionFields.map((f) => (
                    <span
                      key={f.key}
                      className={`text-xs px-2 py-1 rounded ${
                        f.required
                          ? "bg-purple-100 text-purple-700 border border-purple-200"
                          : "bg-gray-100 text-gray-600 border border-gray-200"
                      }`}
                      title={f.formatDescription ? `Format: ${f.formatDescription}` : f.formatRegex ? `Regex: ${f.formatRegex}` : undefined}
                    >
                      {f.label} {f.required ? "*" : ""}
                      {(f.formatRegex || f.formatDescription) && (
                        <Shield className="h-2.5 w-2.5 inline ml-1 opacity-60" />
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {dt.promptTemplate && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">AI Prompt:</p>
                  <p className="text-xs text-gray-600 bg-white p-2 rounded border line-clamp-3">{dt.promptTemplate}</p>
                </div>
              )}

              {dt.validationRules?.duplicateCheck && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Duplicate Detection:</p>
                  <p className="text-xs text-gray-600">Check field: {dt.validationRules.duplicateField}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => navigate(`/admin/document-type-editor/${dt.id}`)}
                >
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
                {!dt.isSystemDefault && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-red-500 hover:text-red-700"
                    onClick={() => {
                      if (confirm(`Delete "${dt.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(dt.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                  </Button>
                )}
                <span className="text-xs text-gray-400 ml-auto">v{dt.version}</span>
              </div>
            </div>
          )}

        </div>
      ))}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => navigate("/admin/document-type-editor")}
      >
        <Plus className="h-4 w-4 mr-2" /> Add Custom Document Type
      </Button>
    </div>
  );
}

export default function WhatsAppFlowSettings() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [cooldownDays, setCooldownDays] = useState(7);
  const [phoneNumberLength, setPhoneNumberLength] = useState(10);
  const [updateLeadEnabled, setUpdateLeadEnabled] = useState(true);
  const [useMasterTraining, setUseMasterTraining] = useState(true);
  const [useLeadTraining, setUseLeadTraining] = useState(true);
  const [docConfirmationEnabled, setDocConfirmationEnabled] = useState(false);
  const [docConfirmationMode, setDocConfirmationMode] = useState("per_document");
  const [docConfirmationHeader, setDocConfirmationHeader] = useState("Please review the details extracted from your document:");
  const [docConfirmationFooter, setDocConfirmationFooter] = useState("Are these details correct?");

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["/api/whatsapp/settings", "flow-settings"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json() as Promise<{ settings: WhatsappSettings }>;
    },
  });

  useEffect(() => {
    if (settingsData?.settings) {
      setCooldownDays(settingsData.settings.newApplicationCooldownDays ?? 7);
      setPhoneNumberLength(settingsData.settings.phoneNumberLength ?? 10);
      setUpdateLeadEnabled(settingsData.settings.updateLeadEnabled !== false);
      setUseMasterTraining(settingsData.settings.useMasterTraining !== false);
      setUseLeadTraining(settingsData.settings.useLeadTraining !== false);
      setDocConfirmationEnabled(settingsData.settings.docConfirmationEnabled === "true");
      setDocConfirmationMode(settingsData.settings.docConfirmationMode || "per_document");
      setDocConfirmationHeader(settingsData.settings.docConfirmationHeader || "Please review the details extracted from your document:");
      setDocConfirmationFooter(settingsData.settings.docConfirmationFooter || "Are these details correct?");
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch("/api/whatsapp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flow settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/settings"] });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      newApplicationCooldownDays: cooldownDays,
      phoneNumberLength: phoneNumberLength,
      updateLeadEnabled: updateLeadEnabled,
      useMasterTraining: useMasterTraining,
      useLeadTraining: useLeadTraining,
      docConfirmationEnabled: docConfirmationEnabled,
      docConfirmationMode: docConfirmationMode,
      docConfirmationHeader: docConfirmationHeader,
      docConfirmationFooter: docConfirmationFooter,
      // customPrompt is deliberately NOT saved here. AI Setup is the single owner of the AI
      // personality. This screen used to edit it too; the editor is gone but the value was
      // still being written back, so saving an unrelated setting here could overwrite a newer
      // prompt with whatever was loaded when this page opened.
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/whatsapp-flows")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-purple-600" />
            <CardTitle>Flow Settings</CardTitle>
          </div>
          <p className="text-sm text-gray-500">Configure global settings for conversation flows</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Update Lead Options</Label>
              <p className="text-sm text-gray-500">
                Show "Add Documents" and "Update Details" options when a duplicate phone number is detected
              </p>
            </div>
            <Switch
              checked={updateLeadEnabled}
              onCheckedChange={setUpdateLeadEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Use Master Training Instructions</Label>
              <p className="text-sm text-gray-500">
                Apply custom AI instructions (from Train Chroney) in WhatsApp flow responses
              </p>
            </div>
            <Switch
              checked={useMasterTraining}
              onCheckedChange={setUseMasterTraining}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Use Lead Training</Label>
              <p className="text-sm text-gray-500">
                Apply lead capture configuration in WhatsApp flow responses
              </p>
            </div>
            <Switch
              checked={useLeadTraining}
              onCheckedChange={setUseLeadTraining}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cooldownDays">New Application Cooldown (Days)</Label>
            <Input
              id="cooldownDays"
              type="number"
              min={0}
              value={cooldownDays}
              onChange={(e) => setCooldownDays(parseInt(e.target.value) || 0)}
            />
            <p className="text-sm text-gray-500">
              Minimum days before a new application can be started for the same phone number. Set to 0 to allow immediately.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phoneNumberLength">Phone Number Length</Label>
            <Input
              id="phoneNumberLength"
              type="number"
              min={1}
              max={20}
              value={phoneNumberLength}
              onChange={(e) => setPhoneNumberLength(parseInt(e.target.value) || 10)}
            />
            <p className="text-sm text-gray-500">
              Expected number of digits in a valid phone number (default: 10). Numbers with country code prefix will be auto-trimmed.
            </p>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Document Extraction Confirmation</h3>
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable Confirmation Step</Label>
                <p className="text-sm text-gray-500">
                  After extracting data from a document, show extracted fields and ask the user to confirm or update before proceeding
                </p>
              </div>
              <Switch
                checked={docConfirmationEnabled}
                onCheckedChange={setDocConfirmationEnabled}
              />
            </div>

            {docConfirmationEnabled && (
              <div className="space-y-4 pl-4 border-l-2 border-purple-200">
                <div className="space-y-2">
                  <Label>Confirmation Mode</Label>
                  <select
                    className="w-full border rounded-md p-2 text-sm"
                    value={docConfirmationMode}
                    onChange={(e) => setDocConfirmationMode(e.target.value)}
                  >
                    <option value="per_document">Per Document (confirm after each document)</option>
                    <option value="after_all_documents">After All Documents (confirm after all mandatory docs are collected)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="docConfirmationHeader">Confirmation Header Message</Label>
                  <Input
                    id="docConfirmationHeader"
                    value={docConfirmationHeader}
                    onChange={(e) => setDocConfirmationHeader(e.target.value)}
                    placeholder="Please review the details extracted from your document:"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="docConfirmationFooter">Confirmation Footer Message</Label>
                  <Input
                    id="docConfirmationFooter"
                    value={docConfirmationFooter}
                    onChange={(e) => setDocConfirmationFooter(e.target.value)}
                    placeholder="Are these details correct?"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => navigate("/admin/whatsapp-flows")}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50">
        <CardContent className="pt-6 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-purple-100">
            <Sparkles className="h-6 w-6 text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">AI Personality & Knowledge moved to AI Setup</h3>
            <p className="text-sm text-gray-600 mt-1">
              The AI agent's personality, goal, response mode and knowledge sources are now managed in one place.
            </p>
          </div>
          <Button
            onClick={() => navigate("/admin/whatsapp-ai-setup")}
            data-testid="button-open-ai-setup"
          >
            Open AI Setup
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-600" />
            <CardTitle>Document Types</CardTitle>
          </div>
          <p className="text-sm text-gray-500">
            Configure which document types can be processed and what fields to extract from each.
            System defaults come pre-configured but you can customize their fields or add new document types.
          </p>
        </CardHeader>
        <CardContent>
          <DocumentTypesSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <CardTitle>Verification Rules</CardTitle>
          </div>
          <p className="text-sm text-gray-500">
            Rule sets verify lead documents against admin-defined checks (required documents,
            cross-document matches, value thresholds, date chronology). When a flow is linked
            to a rule set, verification runs automatically as soon as the WhatsApp flow completes.
          </p>
        </CardHeader>
        <CardContent>
          <VerificationRulesSection />
        </CardContent>
      </Card>
    </div>
  );
}
