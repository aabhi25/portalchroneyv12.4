import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { useQuery } from "@tanstack/react-query";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Plus, Trash2, Pencil, Bot, ArrowLeft, KeyRound, Zap, TableProperties, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface UrlRule {
  id: string;
  urlPattern: string;
  university: string | null;
  product: string | null;
  isEnabled: string;
  createdAt: string;
}

interface FieldMapping {
  id: string;
  leadsquaredField: string;
  sourceType: 'dynamic' | 'custom';
  sourceField: string | null;
  customValue: string | null;
  fallbackValue: string | null;
  valueWhenPresent: string | null;
  displayName: string;
  isEnabled: string;
  sortOrder: number;
}

const DYNAMIC_SOURCE_OPTIONS = [
  { value: 'lead.name', label: 'Lead Name' },
  { value: 'lead.email', label: 'Lead Email' },
  { value: 'lead.phone', label: 'Lead Phone' },
  { value: 'lead.whatsapp', label: 'Lead WhatsApp' },
  { value: 'lead.createdAt', label: 'Lead Created At' },
  { value: 'lead.sourceUrl', label: 'Lead Source URL (Page URL)' },
  { value: 'lead.captchaStatus', label: 'CAPTCHA Status (verified/unverified)' },
  { value: 'session.city', label: 'Visitor City' },
  { value: 'session.utmCampaign', label: 'UTM Campaign' },
  { value: 'session.utmSource', label: 'UTM Source' },
  { value: 'session.utmMedium', label: 'UTM Medium' },
  { value: 'session.pageUrl', label: 'Page URL' },
  { value: 'business.name', label: 'Business Name' },
  { value: 'business.website', label: 'Business Website URL' },
  { value: 'urlLookup.university', label: 'AI Extracted - University (from Page URL)' },
  { value: 'urlLookup.product', label: 'AI Extracted - Product/Course (from Page URL)' },
  { value: 'conversation.summary', label: 'Conversation Summary' },
  { value: 'conversation.topics', label: 'Conversation Topics' },
];

export default function LeadSquaredSettings() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: currentUser } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const businessId = currentUser?.businessAccountId || currentUser?.activeBusinessAccountId;

  // Journey CRM field keys configured on this business's journey steps.
  const { data: journeyFieldKeys = [] } = useQuery<string[]>({ queryKey: ["/api/leadsquared/journey-field-keys"] });
  const dynamicSourceOptions = useMemo(() => [
    ...DYNAMIC_SOURCE_OPTIONS,
    ...journeyFieldKeys.map((key) => ({ value: `journey.${key}`, label: `Journey Answer - ${key}` })),
  ], [journeyFieldKeys]);
  const [activeSection, setActiveSection] = useState<'connection' | 'sync' | 'mappings' | 'extraction' | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'error' | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string>("");
  const [showSecretKey, setShowSecretKey] = useState(false);
  
  const [settings, setSettings] = useState({
    enabled: false,
    accessKey: "",
    secretKey: "",
    region: "india" as "india" | "us" | "other",
    customHost: "",
    hasCredentials: false,
  });
  const [secretKeyChanged, setSecretKeyChanged] = useState(false);
  const [credentialsCorrupted, setCredentialsCorrupted] = useState(false);
  const [savingExtraction, setSavingExtraction] = useState(false);
  const [extractionSettings, setExtractionSettings] = useState({
    extractionDomain: '',
    extractionUniversities: '',
    extractionProducts: '',
    extractionFallbackUniversity: 'Any',
    extractionFallbackProduct: 'All Product',
  });

  // Field mappings state
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [editingMapping, setEditingMapping] = useState<FieldMapping | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newMapping, setNewMapping] = useState({
    leadsquaredField: '',
    sourceType: 'dynamic' as 'dynamic' | 'custom',
    sourceField: '',
    customValue: '',
    fallbackValue: '',
    valueWhenPresent: '',
    displayName: '',
  });

  const [urlRules, setUrlRules] = useState<UrlRule[]>([]);
  const [loadingUrlRules, setLoadingUrlRules] = useState(false);
  const [showUrlRuleDialog, setShowUrlRuleDialog] = useState(false);
  const [editingUrlRule, setEditingUrlRule] = useState<UrlRule | null>(null);
  const [savingUrlRule, setSavingUrlRule] = useState(false);
  const [showDeleteUrlRuleDialog, setShowDeleteUrlRuleDialog] = useState(false);
  const [deletingUrlRuleId, setDeletingUrlRuleId] = useState<string | null>(null);
  const [newUrlRule, setNewUrlRule] = useState({ urlPattern: '', university: '', product: '' });

  useEffect(() => {
    fetchSettings();
    fetchFieldMappings();
    fetchUrlRules();
  }, []);

  const fetchFieldMappings = async () => {
    try {
      setLoadingMappings(true);
      const response = await fetch("/api/leadsquared/field-mappings", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setFieldMappings(data);
      }
    } catch (error) {
      console.error("Error fetching field mappings:", error);
    } finally {
      setLoadingMappings(false);
    }
  };

  const saveFieldMapping = async () => {
    if (!newMapping.leadsquaredField || !newMapping.displayName) {
      toast({
        title: "Missing Fields",
        description: "LeadSquared field name and display name are required",
        variant: "destructive",
      });
      return;
    }

    if (newMapping.sourceType === 'dynamic' && !newMapping.sourceField) {
      toast({
        title: "Missing Source",
        description: "Please select a data source for dynamic mapping",
        variant: "destructive",
      });
      return;
    }

    if (newMapping.sourceType === 'custom' && !newMapping.customValue) {
      toast({
        title: "Missing Value",
        description: "Please enter a custom value",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingMapping(true);
      const url = editingMapping 
        ? `/api/leadsquared/field-mappings/${editingMapping.id}`
        : "/api/leadsquared/field-mappings";
      const method = editingMapping ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadsquaredField: newMapping.leadsquaredField,
          sourceType: newMapping.sourceType,
          sourceField: newMapping.sourceType === 'dynamic' ? newMapping.sourceField : null,
          customValue: newMapping.sourceType === 'custom' ? newMapping.customValue : null,
          fallbackValue: newMapping.sourceType === 'dynamic' ? (newMapping.fallbackValue || null) : null,
          valueWhenPresent: newMapping.sourceType === 'dynamic' ? (newMapping.valueWhenPresent || null) : null,
          displayName: newMapping.displayName,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save field mapping");
      }

      toast({
        title: "Success",
        description: editingMapping ? "Field mapping updated" : "Field mapping added",
      });

      setShowMappingDialog(false);
      setEditingMapping(null);
      setNewMapping({
        leadsquaredField: '',
        sourceType: 'dynamic',
        sourceField: '',
        customValue: '',
        fallbackValue: '',
        valueWhenPresent: '',
        displayName: '',
      });
      fetchFieldMappings();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSavingMapping(false);
    }
  };

  const confirmDeleteMapping = (id: string) => {
    setDeletingMappingId(id);
    setShowDeleteDialog(true);
  };

  const deleteFieldMapping = async () => {
    if (!deletingMappingId) return;

    try {
      const response = await fetch(`/api/leadsquared/field-mappings/${deletingMappingId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete field mapping");
      }

      toast({
        title: "Deleted",
        description: "Field mapping removed",
      });
      fetchFieldMappings();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setShowDeleteDialog(false);
      setDeletingMappingId(null);
    }
  };

  const toggleMappingEnabled = async (mapping: FieldMapping) => {
    try {
      const newEnabled = mapping.isEnabled === 'true' ? 'false' : 'true';
      const response = await fetch(`/api/leadsquared/field-mappings/${mapping.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: newEnabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to toggle field mapping");
      }

      fetchFieldMappings();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (mapping: FieldMapping) => {
    setEditingMapping(mapping);
    setNewMapping({
      leadsquaredField: mapping.leadsquaredField,
      sourceType: mapping.sourceType,
      sourceField: mapping.sourceField || '',
      customValue: mapping.customValue || '',
      fallbackValue: mapping.fallbackValue || '',
      valueWhenPresent: mapping.valueWhenPresent || '',
      displayName: mapping.displayName,
    });
    setShowMappingDialog(true);
  };

  const openAddDialog = () => {
    setEditingMapping(null);
    setNewMapping({
      leadsquaredField: '',
      sourceType: 'dynamic',
      sourceField: '',
      customValue: '',
      fallbackValue: '',
      valueWhenPresent: '',
      displayName: '',
    });
    setShowMappingDialog(true);
  };

  const saveExtractionSettings = async () => {
    try {
      setSavingExtraction(true);
      const response = await fetch("/api/leadsquared/extraction-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(extractionSettings),
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: "Saved", description: "AI extraction settings saved successfully." });
      } else {
        toast({ title: "Error", description: data.error || "Failed to save", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSavingExtraction(false);
    }
  };

  const fetchUrlRules = async () => {
    try {
      setLoadingUrlRules(true);
      const response = await fetch("/api/leadsquared/url-rules", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setUrlRules(data);
      }
    } catch (error) {
      console.error('Failed to fetch URL rules:', error);
    } finally {
      setLoadingUrlRules(false);
    }
  };

  const openAddUrlRuleDialog = () => {
    setEditingUrlRule(null);
    setNewUrlRule({ urlPattern: '', university: '', product: '' });
    setShowUrlRuleDialog(true);
  };

  const openEditUrlRuleDialog = (rule: UrlRule) => {
    setEditingUrlRule(rule);
    setNewUrlRule({
      urlPattern: rule.urlPattern,
      university: rule.university || '',
      product: rule.product || '',
    });
    setShowUrlRuleDialog(true);
  };

  const saveUrlRule = async () => {
    if (!newUrlRule.urlPattern.trim()) {
      toast({ title: "Error", description: "URL is required", variant: "destructive" });
      return;
    }
    try {
      setSavingUrlRule(true);
      const url = editingUrlRule
        ? `/api/leadsquared/url-rules/${editingUrlRule.id}`
        : '/api/leadsquared/url-rules';
      const response = await fetch(url, {
        method: editingUrlRule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newUrlRule),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');
      toast({ title: "Saved", description: editingUrlRule ? "URL rule updated" : "URL rule created" });
      setShowUrlRuleDialog(false);
      fetchUrlRules();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSavingUrlRule(false);
    }
  };

  const toggleUrlRuleEnabled = async (rule: UrlRule) => {
    try {
      const newEnabled = rule.isEnabled === 'true' ? 'false' : 'true';
      await fetch(`/api/leadsquared/url-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isEnabled: newEnabled }),
      });
      fetchUrlRules();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const confirmDeleteUrlRule = (id: string) => {
    setDeletingUrlRuleId(id);
    setShowDeleteUrlRuleDialog(true);
  };

  const deleteUrlRule = async () => {
    if (!deletingUrlRuleId) return;
    try {
      await fetch(`/api/leadsquared/url-rules/${deletingUrlRuleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      toast({ title: "Deleted", description: "URL rule deleted" });
      setShowDeleteUrlRuleDialog(false);
      setDeletingUrlRuleId(null);
      fetchUrlRules();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/leadsquared/settings", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch LeadSquared settings");
      }
      
      const data = await response.json();
      setSettings({
        enabled: data.enabled || false,
        accessKey: data.accessKey || "",
        secretKey: "", // Never populate secret from backend for security
        region: data.region || "india",
        customHost: data.customHost || "",
        hasCredentials: data.hasCredentials || false,
      });
      setExtractionSettings({
        extractionDomain: data.extractionDomain || '',
        extractionUniversities: data.extractionUniversities || '',
        extractionProducts: data.extractionProducts || '',
        extractionFallbackUniversity: data.extractionFallbackUniversity || 'Any',
        extractionFallbackProduct: data.extractionFallbackProduct || 'All Product',
      });
      setSecretKeyChanged(false);
    } catch (error: any) {
      console.error("Error fetching settings:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    // Check if we have saved credentials or new credentials
    const hasNewCredentials = settings.accessKey && settings.secretKey;
    const hasSavedCredentials = settings.hasCredentials;
    
    if (!hasNewCredentials && !hasSavedCredentials) {
      toast({
        title: "Missing Information",
        description: "Please enter credentials before testing",
        variant: "destructive",
      });
      return;
    }

    if (settings.region === "other" && !settings.customHost) {
      toast({
        title: "Missing Custom Host",
        description: "Please enter a custom host URL for the 'Other' region",
        variant: "destructive",
      });
      return;
    }

    try {
      setTesting(true);
      setConnectionStatus(null);
      setConnectionMessage("");

      // Use existing saved credentials if no new secret provided
      const useExistingSecret = hasSavedCredentials && !secretKeyChanged;

      const response = await fetch("/api/leadsquared/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accessKey: settings.accessKey,
          secretKey: settings.secretKey,
          region: settings.region,
          customHost: settings.customHost || undefined,
          useExistingSecret,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setConnectionStatus("success");
        setConnectionMessage(data.message || "Connection successful!");
        toast({
          title: "Connection Successful",
          description: data.message,
        });
      } else {
        setConnectionStatus("error");
        if (data.error === "credentials_corrupted") {
          setCredentialsCorrupted(true);
          setConnectionMessage(data.message || "Saved Secret Key could not be read.");
          toast({
            title: "Re-enter Secret Key",
            description: "Please type your Secret Key in the field below and click Save Settings.",
            variant: "destructive",
          });
        } else {
          setConnectionMessage(data.error || "Connection failed");
          toast({
            title: "Connection Failed",
            description: data.error || "Unable to connect to LeadSquared",
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      setConnectionStatus("error");
      setConnectionMessage(error.message);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    // Validate required fields when enabling
    if (settings.enabled) {
      const needsAccessKey = !settings.accessKey && !settings.hasCredentials;
      const needsSecretKey = !settings.secretKey && !settings.hasCredentials;
      const needsRegion = !settings.region;
      
      if (needsAccessKey || needsSecretKey || needsRegion) {
        toast({
          title: "Missing Information",
          description: "Please enter all required credentials before enabling",
          variant: "destructive",
        });
        return;
      }
    }

    if (settings.enabled && settings.region === "other" && !settings.customHost) {
      toast({
        title: "Missing Custom Host",
        description: "Please enter a custom host URL for the 'Other' region",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);

      // SECURITY: Only send secret key if it was explicitly changed by user
      // Backend will preserve existing encrypted secret if not provided
      const payload: any = {
        accessKey: settings.accessKey,
        secretKey: secretKeyChanged ? settings.secretKey : null,
        region: settings.region,
        customHost: settings.customHost || undefined,
        enabled: settings.enabled,
      };

      const response = await fetch("/api/leadsquared/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: "Settings Saved",
          description: data.message,
        });
        fetchSettings(); // Refresh settings
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to save settings",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <MoreFeaturesNavTabs />
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const sectionTitles: Record<string, string> = {
    connection: 'Connection Settings',
    sync: 'Auto-Sync Settings',
    mappings: 'Field Mappings',
    extraction: 'AI URL Extraction',
  };

  const activeMappingsCount = fieldMappings.filter(m => m.isEnabled === 'true').length;

  const hasExtraction = !!(extractionSettings.extractionDomain || extractionSettings.extractionUniversities || extractionSettings.extractionProducts);

  return (
    <div>
      <MoreFeaturesNavTabs />
      <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        {activeSection ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
              onClick={() => setActiveSection(null)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Dashboard
            </Button>
            <h1 className="text-3xl font-bold mb-2">{sectionTitles[activeSection]}</h1>
            <p className="text-muted-foreground">
              LeadSquared CRM Integration
            </p>
          </div>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/admin/crm")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to CRM
            </Button>
            <h1 className="text-3xl font-bold mb-2">LeadSquared CRM Integration</h1>
            <p className="text-muted-foreground">
              Automatically sync captured leads to your LeadSquared CRM account
            </p>
          </>
        )}
      </div>

      {!activeSection && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card
            className="cursor-pointer transition-all hover:shadow-lg hover:border-purple-300 hover:-translate-y-0.5"
            onClick={() => setActiveSection('connection')}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-purple-100 p-3">
                  <KeyRound className="h-6 w-6 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg mb-1">Connection Settings</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Configure your LeadSquared API credentials and region
                  </p>
                  {settings.hasCredentials ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      Not Configured
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:shadow-lg hover:border-blue-300 hover:-translate-y-0.5"
            onClick={() => setActiveSection('sync')}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-blue-100 p-3">
                  <Zap className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg mb-1">Auto-Sync</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Enable automatic syncing of new leads to LeadSquared
                  </p>
                  {settings.enabled ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Enabled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      Disabled
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:shadow-lg hover:border-orange-300 hover:-translate-y-0.5"
            onClick={() => setActiveSection('mappings')}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-orange-100 p-3">
                  <TableProperties className="h-6 w-6 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg mb-1">Field Mappings</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Configure which fields are synced to LeadSquared
                  </p>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                    {activeMappingsCount} field{activeMappingsCount !== 1 ? 's' : ''} mapped
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {settings.hasCredentials && (
            <Card
              className="cursor-pointer transition-all hover:shadow-lg hover:border-pink-300 hover:-translate-y-0.5"
              onClick={() => setActiveSection('extraction')}
            >
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-pink-100 p-3">
                    <Bot className="h-6 w-6 text-pink-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1">AI URL Extraction</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Extract university and product names from visitor URLs using AI
                    </p>
                    {hasExtraction ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Not Configured
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeSection === 'connection' && (
        <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Connection Settings</CardTitle>
            <CardDescription>
              Configure your LeadSquared API credentials. You can find these in your LeadSquared account settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accessKey">Access Key *</Label>
              <Input
                id="accessKey"
                type="text"
                placeholder="Enter your LeadSquared Access Key"
                value={settings.accessKey}
                onChange={(e) => setSettings({ ...settings, accessKey: e.target.value })}
              />
            </div>

            {credentialsCorrupted && !secretKeyChanged && (
              <Alert variant="default" className="border-yellow-400 bg-yellow-50 text-yellow-900">
                <AlertDescription className="text-sm">
                  ⚠ Your saved Secret Key needs to be re-entered. Type it in the field below and click <strong>Save Settings</strong> — no need to test first.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="secretKey">
                Secret Key * 
                {settings.hasCredentials && !secretKeyChanged && (
                  <span className="text-xs text-muted-foreground ml-2">(leave blank to keep existing)</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="secretKey"
                  type={showSecretKey ? "text" : "password"}
                  placeholder={settings.hasCredentials && !secretKeyChanged ? "••••••••••••" : "Enter your LeadSquared Secret Key"}
                  value={settings.secretKey}
                  onChange={(e) => {
                    setSettings({ ...settings, secretKey: e.target.value });
                    setSecretKeyChanged(true);
                    setCredentialsCorrupted(false);
                  }}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                >
                  {showSecretKey ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region *</Label>
              <Select
                value={settings.region}
                onValueChange={(value: "india" | "us" | "other") => setSettings({ ...settings, region: value })}
              >
                <SelectTrigger id="region">
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="india">India (api.leadsquared.com)</SelectItem>
                  <SelectItem value="us">US (api-us.leadsquared.com)</SelectItem>
                  <SelectItem value="other">Other (Custom Host)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {settings.region === "other" && (
              <div className="space-y-2">
                <Label htmlFor="customHost">Custom Host *</Label>
                <Input
                  id="customHost"
                  type="text"
                  placeholder="e.g., api-custom.leadsquared.com"
                  value={settings.customHost}
                  onChange={(e) => setSettings({ ...settings, customHost: e.target.value })}
                />
              </div>
            )}

            <Button
              onClick={testConnection}
              disabled={testing}
              variant="default"
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>Test Connection</>
              )}
            </Button>

            {connectionStatus && (
              <Alert variant={connectionStatus === "success" ? "default" : "destructive"}>
                <div className="flex items-center gap-2">
                  {connectionStatus === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>{connectionMessage}</AlertDescription>
                </div>
              </Alert>
            )}

            <div className="pt-2 border-t">
              <Button
                onClick={saveSettings}
                disabled={saving}
                size="sm"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>Save Settings</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {activeSection === 'sync' && (
        <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Auto-Sync Settings</CardTitle>
            <CardDescription>
              Enable automatic syncing of new leads to LeadSquared
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enabled">Enable LeadSquared Integration</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, all new leads captured in chat will be automatically synced to LeadSquared
                </p>
              </div>
              <Switch
                id="enabled"
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
              />
            </div>

            <Button
              onClick={saveSettings}
              disabled={saving}
              size="sm"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>Save Settings</>
              )}
            </Button>
          </CardContent>
        </Card>
        </div>
      )}

      {activeSection === 'mappings' && (
        <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Data Synced to LeadSquared</CardTitle>
                <CardDescription>
                  Configure which fields are synced when a lead is captured
                </CardDescription>
              </div>
              <Button onClick={openAddDialog} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add Field
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMappings ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : fieldMappings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No field mappings configured.</p>
                <p className="text-sm mt-1">Click "Add Field" to create your first mapping, or enable LeadSquared integration to load defaults.</p>
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Display Name</th>
                      <th className="text-left p-3 font-medium">LeadSquared Field</th>
                      <th className="text-left p-3 font-medium">Source</th>
                      <th className="text-center p-3 font-medium w-20">Enabled</th>
                      <th className="text-center p-3 font-medium w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldMappings.map((mapping) => (
                      <tr key={mapping.id} className="border-b last:border-b-0">
                        <td className="p-3">{mapping.displayName}</td>
                        <td className="p-3 font-mono text-xs bg-muted/30">{mapping.leadsquaredField}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {mapping.sourceType === 'custom' ? (
                            <span className="text-purple-600">"{mapping.customValue}"</span>
                          ) : (
                            <span>
                              {dynamicSourceOptions.find(o => o.value === mapping.sourceField)?.label || mapping.sourceField}
                              {mapping.valueWhenPresent && (
                                <span className="ml-1 text-blue-600">(when present → "{mapping.valueWhenPresent}")</span>
                              )}
                              {mapping.fallbackValue && (
                                <span className="ml-1 text-gray-400">(fallback: "{mapping.fallbackValue}")</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <Switch
                            checked={mapping.isEnabled === 'true'}
                            onCheckedChange={() => toggleMappingEnabled(mapping)}
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(mapping)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => confirmDeleteMapping(mapping.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Note: Fields with "mx_" prefix are custom fields. They will be automatically created in LeadSquared if they don't exist.
            </p>
          </CardContent>
        </Card>

        {/* Field Mapping Dialog */}
        <Dialog open={showMappingDialog} onOpenChange={setShowMappingDialog}>
          <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col gap-0 p-0">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>{editingMapping ? 'Edit Field Mapping' : 'Add Field Mapping'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name *</Label>
                <Input
                  id="displayName"
                  placeholder="e.g., Full Name, City, Source"
                  value={newMapping.displayName}
                  onChange={(e) => setNewMapping({ ...newMapping, displayName: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="leadsquaredField">LeadSquared Field Name *</Label>
                <Input
                  id="leadsquaredField"
                  placeholder="e.g., FirstName, mx_City, mx_Custom_Field"
                  value={newMapping.leadsquaredField}
                  onChange={(e) => setNewMapping({ ...newMapping, leadsquaredField: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Use mx_ prefix for custom fields</p>
              </div>

              <div className="space-y-2">
                <Label>Value Type *</Label>
                <Select
                  value={newMapping.sourceType}
                  onValueChange={(value: 'dynamic' | 'custom') => setNewMapping({ ...newMapping, sourceType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dynamic">Dynamic (from lead/session data)</SelectItem>
                    <SelectItem value="custom">Custom (static value)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {newMapping.sourceType === 'dynamic' ? (
                <>
                  <div className="space-y-2">
                    <Label>Data Source *</Label>
                    <Select
                      value={newMapping.sourceField}
                      onValueChange={(value) => setNewMapping({ ...newMapping, sourceField: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select data source" />
                      </SelectTrigger>
                      <SelectContent>
                        {dynamicSourceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fallbackValue">Fallback Value</Label>
                    <Input
                      id="fallbackValue"
                      placeholder="Value to use when dynamic data is empty"
                      value={newMapping.fallbackValue}
                      onChange={(e) => setNewMapping({ ...newMapping, fallbackValue: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">If the dynamic value is empty, this value will be sent instead</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="valueWhenPresent">Value When Source Is Present</Label>
                    <Input
                      id="valueWhenPresent"
                      placeholder='e.g., "PRChat"'
                      value={newMapping.valueWhenPresent}
                      onChange={(e) => setNewMapping({ ...newMapping, valueWhenPresent: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">Optional. When set, this fixed value is sent whenever the data source has a value (e.g. send "PRChat" whenever a UTM source is present), instead of the raw source value. Leave blank to send the raw value.</p>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="customValue">Custom Value *</Label>
                  <Input
                    id="customValue"
                    placeholder='e.g., "AI Chroney", "Website Chat"'
                    value={newMapping.customValue}
                    onChange={(e) => setNewMapping({ ...newMapping, customValue: e.target.value })}
                  />
                </div>
              )}
            </div>
            <DialogFooter className="px-6 pb-6 pt-2 shrink-0 border-t">
              <Button variant="outline" onClick={() => setShowMappingDialog(false)}>
                Cancel
              </Button>
              <Button onClick={saveFieldMapping} disabled={savingMapping}>
                {savingMapping ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  editingMapping ? 'Update' : 'Add'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Field Mapping</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this field mapping? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeletingMappingId(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={deleteFieldMapping} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      )}

      {activeSection === 'extraction' && settings.hasCredentials && (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-purple-600" />
                <div>
                  <CardTitle>AI URL Extraction</CardTitle>
                  <CardDescription>
                    Configure how AI extracts university and product/course names from visitor page URLs when using "AI Extracted" field mappings
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="extractionDomain">Website Domain</Label>
                <Input
                  id="extractionDomain"
                  placeholder="e.g., jaroeducation.com"
                  value={extractionSettings.extractionDomain}
                  onChange={(e) => setExtractionSettings({ ...extractionSettings, extractionDomain: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Only extract from URLs on this domain. Leave blank to extract from all URLs.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="extractionUniversities">Valid Universities</Label>
                  <Textarea
                    id="extractionUniversities"
                    placeholder={"IIM Bangalore\nIIM Ahmedabad\nIIT Delhi"}
                    value={extractionSettings.extractionUniversities}
                    onChange={(e) => setExtractionSettings({ ...extractionSettings, extractionUniversities: e.target.value })}
                    rows={6}
                    className="font-mono text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">One university per line. AI will only pick from this list.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="extractionProducts">Valid Products / Courses</Label>
                  <Textarea
                    id="extractionProducts"
                    placeholder={"MBA\nData Science\nProduct Management"}
                    value={extractionSettings.extractionProducts}
                    onChange={(e) => setExtractionSettings({ ...extractionSettings, extractionProducts: e.target.value })}
                    rows={6}
                    className="font-mono text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">One product/course per line. AI will only pick from this list.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="extractionFallbackUniversity">Fallback University</Label>
                  <Input
                    id="extractionFallbackUniversity"
                    placeholder="Any"
                    value={extractionSettings.extractionFallbackUniversity}
                    onChange={(e) => setExtractionSettings({ ...extractionSettings, extractionFallbackUniversity: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Used when no university can be determined from the URL.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="extractionFallbackProduct">Fallback Product</Label>
                  <Input
                    id="extractionFallbackProduct"
                    placeholder="All Product"
                    value={extractionSettings.extractionFallbackProduct}
                    onChange={(e) => setExtractionSettings({ ...extractionSettings, extractionFallbackProduct: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Used when no product/course can be determined from the URL.</p>
                </div>
              </div>

              <div className="flex gap-3 items-center flex-wrap">
                <Button onClick={saveExtractionSettings} disabled={savingExtraction} size="sm">
                  {savingExtraction ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Extraction Settings"
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/lead-capture-test.html?business=${businessId}`, '_blank')}
                  disabled={!businessId}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Test Lead Capture
                </Button>
              </div>

              <div className="border-t pt-5 mt-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-semibold">URL Rules</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Define manual URL-to-value mappings. These take priority over AI extraction.
                    </p>
                  </div>
                  <Button onClick={openAddUrlRuleDialog} size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Rule
                  </Button>
                </div>

                {loadingUrlRules ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : urlRules.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground border rounded-lg bg-muted/20">
                    <p className="text-sm">No URL rules configured.</p>
                    <p className="text-xs mt-1">Add a rule to override AI extraction for specific URLs.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">URL</th>
                          <th className="text-left p-3 font-medium">University</th>
                          <th className="text-left p-3 font-medium">Product</th>
                          <th className="text-center p-3 font-medium w-20">Enabled</th>
                          <th className="text-center p-3 font-medium w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {urlRules.map((rule) => (
                          <tr key={rule.id} className="border-b last:border-b-0">
                            <td className="p-3 font-mono text-xs max-w-[200px] truncate" title={rule.urlPattern}>{rule.urlPattern}</td>
                            <td className="p-3 text-xs">{rule.university || <span className="text-muted-foreground italic">—</span>}</td>
                            <td className="p-3 text-xs">{rule.product || <span className="text-muted-foreground italic">—</span>}</td>
                            <td className="p-3 text-center">
                              <Switch
                                checked={rule.isEnabled === 'true'}
                                onCheckedChange={() => toggleUrlRuleEnabled(rule)}
                              />
                            </td>
                            <td className="p-3">
                              <div className="flex items-center justify-center gap-1">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditUrlRuleDialog(rule)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => confirmDeleteUrlRule(rule.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

          <Dialog open={showUrlRuleDialog} onOpenChange={setShowUrlRuleDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingUrlRule ? 'Edit URL Rule' : 'Add URL Rule'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="ruleUrl">URL *</Label>
                  <Input
                    id="ruleUrl"
                    placeholder="e.g., https://jaroeducation.com/iim-bangalore-mba"
                    value={newUrlRule.urlPattern}
                    onChange={(e) => setNewUrlRule({ ...newUrlRule, urlPattern: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">The URL to match. Partial matches are supported.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ruleUniversity">University</Label>
                  <Input
                    id="ruleUniversity"
                    placeholder="e.g., IIM Bangalore"
                    value={newUrlRule.university}
                    onChange={(e) => setNewUrlRule({ ...newUrlRule, university: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ruleProduct">Product / Course</Label>
                  <Input
                    id="ruleProduct"
                    placeholder="e.g., MBA"
                    value={newUrlRule.product}
                    onChange={(e) => setNewUrlRule({ ...newUrlRule, product: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowUrlRuleDialog(false)}>Cancel</Button>
                <Button onClick={saveUrlRule} disabled={savingUrlRule}>
                  {savingUrlRule ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    editingUrlRule ? 'Update' : 'Add'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={showDeleteUrlRuleDialog} onOpenChange={setShowDeleteUrlRuleDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete URL Rule</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this URL rule? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeletingUrlRuleId(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteUrlRule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
    </div>
  );
}
