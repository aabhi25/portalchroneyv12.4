import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, Key, DollarSign, Building2, CheckCircle, Loader2, Search, ChevronsUpDown, Check, Camera, Trash2, Cpu, CloudCog, Sparkles, HelpCircle, ExternalLink, Power, PowerOff, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "INR", label: "INR - Indian Rupee" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "JPY", label: "JPY - Japanese Yen" },
  { value: "CNY", label: "CNY - Chinese Yuan" },
];

const apiKeySchema = z.object({
  openaiApiKey: z.string().optional(),
});

const elevenlabsKeySchema = z.object({
  elevenlabsApiKey: z.string().optional(),
});

const currencySchema = z.object({
  currency: z.string().min(3, "Currency code must be 3 letters"),
});

type ApiKeyFormData = z.infer<typeof apiKeySchema>;
type ElevenLabsKeyFormData = z.infer<typeof elevenlabsKeySchema>;
type CurrencyFormData = z.infer<typeof currencySchema>;

interface BusinessAccount {
  id: string;
  name: string;
  website: string | null;
}

interface ApiSettings {
  businessAccountId: string;
  businessName: string;
  openaiApiKey: string | null;
  hasOpenAIKey: boolean;
  elevenlabsApiKey: string | null;
  hasElevenLabsKey: boolean;
  currency: string;
}

interface VisionWarehouseSettings {
  projectNumber: string;
  corpusId: string;
  indexId: string;
  endpointId: string;
  hasCredentials: boolean;
  visualSearchModel: 'google_vision_warehouse' | 'google_product_search';
}

interface ProductSearchSettings {
  projectId: string;
  location: string;
  productSetId: string;
  hasCredentials: boolean;
  syncPhase: string;
  syncProgress: number;
  syncTotal: number;
  syncError: string | null;
  lastSyncedAt: string | null;
}

interface EndpointStatus {
  state: string;
  isDeployed: boolean;
  deployedIndexes: any[];
}


export default function SuperAdminApiKeys() {
  const { toast } = useToast();
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);
  const [isTestingGoogleKey, setIsTestingGoogleKey] = useState(false);
  
  // Vision Warehouse state
  const [vwProjectNumber, setVwProjectNumber] = useState("");
  const [vwCorpusId, setVwCorpusId] = useState("");
  const [vwIndexId, setVwIndexId] = useState("");
  const [vwEndpointId, setVwEndpointId] = useState("");
  const [vwCredentialsJson, setVwCredentialsJson] = useState("");
  const [isSavingVwConfig, setIsSavingVwConfig] = useState(false);
  const [isSavingVwCredentials, setIsSavingVwCredentials] = useState(false);
  const [isTestingVwCredentials, setIsTestingVwCredentials] = useState(false);

  // Product Search state
  const [psProjectId, setPsProjectId] = useState("");
  const [psLocation, setPsLocation] = useState("us-east1");
  const [psProductSetId, setPsProductSetId] = useState("");
  const [psCredentialsJson, setPsCredentialsJson] = useState("");
  const [isSavingPsConfig, setIsSavingPsConfig] = useState(false);
  const [isSavingPsCredentials, setIsSavingPsCredentials] = useState(false);
  const [isTestingPsCredentials, setIsTestingPsCredentials] = useState(false);
  const [isCreatingProductSet, setIsCreatingProductSet] = useState(false);
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);
  
  // Visual Search Model selector
  const [visualSearchModel, setVisualSearchModel] = useState<'google_vision_warehouse' | 'google_product_search'>('google_vision_warehouse');
  
  // Endpoint deploy/undeploy state
  const [isDeploying, setIsDeploying] = useState(false);
  const [isUndeploying, setIsUndeploying] = useState(false);

  const { data: businessAccounts = [] } = useQuery<BusinessAccount[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const response = await fetch("/api/business-accounts?limit=1000", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch business accounts");
      const data = await response.json();
      // API returns { accounts: [...], total, hasMore } - extract accounts array
      return data.accounts || data;
    },
  });

  const selectedAccount = useMemo(() => 
    businessAccounts.find(b => b.id === selectedBusinessId),
    [businessAccounts, selectedBusinessId]
  );

  const filteredAccounts = useMemo(() => 
    [...businessAccounts]
      .filter(account => 
        account.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (account.website && account.website.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    [businessAccounts, searchQuery]
  );

  const { data: apiSettings, isLoading: apiSettingsLoading } = useQuery<ApiSettings>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"],
    enabled: !!selectedBusinessId,
  });


  const { data: vistaSettings } = useQuery<{ provider: string; hasGoogleApiKey: boolean; hasOpenaiApiKey: boolean }>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "vista-settings"],
    enabled: !!selectedBusinessId,
  });

  const { data: vwSettings } = useQuery<VisionWarehouseSettings>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "vision-warehouse-settings"],
    enabled: !!selectedBusinessId,
  });

  const { data: psSettings, refetch: refetchPsSettings } = useQuery<ProductSearchSettings>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "product-search-settings"],
    enabled: !!selectedBusinessId,
  });

  // Endpoint status query (for deploy/undeploy controls)
  const { data: endpointStatus, refetch: refetchEndpointStatus, isLoading: isLoadingEndpointStatus } = useQuery<EndpointStatus>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "endpoint-status"],
    queryFn: async () => {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/vision-warehouse-endpoint-status`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch endpoint status');
      }
      return response.json();
    },
    enabled: !!selectedBusinessId && visualSearchModel === 'google_vision_warehouse' && !!vwSettings?.hasCredentials && !!vwSettings?.endpointId,
    refetchInterval: (isDeploying || isUndeploying) ? 5000 : false, // Poll while deploying/undeploying
  });

  const openAIKeyForm = useForm<ApiKeyFormData>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      openaiApiKey: "",
    },
  });

  const elevenLabsKeyForm = useForm<ElevenLabsKeyFormData>({
    resolver: zodResolver(elevenlabsKeySchema),
    defaultValues: {
      elevenlabsApiKey: "",
    },
  });

  const currencyForm = useForm<CurrencyFormData>({
    resolver: zodResolver(currencySchema),
    defaultValues: {
      currency: "USD",
    },
  });

  useEffect(() => {
    if (apiSettings) {
      currencyForm.reset({ currency: apiSettings.currency || "USD" });
      openAIKeyForm.reset({ openaiApiKey: "" });
      elevenLabsKeyForm.reset({ elevenlabsApiKey: "" });
    }
  }, [apiSettings]);

  useEffect(() => {
    if (vwSettings) {
      setVwProjectNumber(vwSettings.projectNumber || "");
      setVwCorpusId(vwSettings.corpusId || "");
      setVwIndexId(vwSettings.indexId || "");
      setVwEndpointId(vwSettings.endpointId || "");
      setVisualSearchModel(vwSettings.visualSearchModel || 'google_vision_warehouse');
    }
  }, [vwSettings]);

  useEffect(() => {
    if (psSettings) {
      setPsProjectId(psSettings.projectId || "");
      setPsLocation(psSettings.location || "us-east1");
      setPsProductSetId(psSettings.productSetId || "");
    }
  }, [psSettings]);


  const updateOpenAIKeyMutation = useMutation({
    mutationFn: async (data: { openaiApiKey?: string }) => {
      const payload: { openaiApiKey?: string } = {};
      if (data.openaiApiKey && data.openaiApiKey.trim()) {
        payload.openaiApiKey = data.openaiApiKey.trim();
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("Please enter an API key to update");
      }
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "OpenAI API key updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
      openAIKeyForm.reset({ openaiApiKey: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update OpenAI API key",
        variant: "destructive",
      });
    },
  });

  const updateElevenLabsKeyMutation = useMutation({
    mutationFn: async (data: { elevenlabsApiKey?: string }) => {
      const payload: { elevenlabsApiKey?: string } = {};
      if (data.elevenlabsApiKey && data.elevenlabsApiKey.trim()) {
        payload.elevenlabsApiKey = data.elevenlabsApiKey.trim();
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("Please enter an API key to update");
      }
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "ElevenLabs API key updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
      elevenLabsKeyForm.reset({ elevenlabsApiKey: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update ElevenLabs API key",
        variant: "destructive",
      });
    },
  });

  const updateCurrencyMutation = useMutation({
    mutationFn: async (data: CurrencyFormData) => {
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Currency updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update currency",
        variant: "destructive",
      });
    },
  });

  const updateVistaSettingsMutation = useMutation({
    mutationFn: async (data: { provider?: string; googleApiKey?: string | null }) => {
      return apiRequest("PUT", `/api/business-accounts/${selectedBusinessId}/vista-settings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "vista-settings"] });
      setGoogleApiKey('');
      toast({
        title: "Settings saved",
        description: "Vista Studio settings have been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update Vista settings",
        variant: "destructive",
      });
    },
  });

  const updateVisualSearchModelMutation = useMutation({
    mutationFn: async (model: string) => {
      return apiRequest("PUT", `/api/business-accounts/${selectedBusinessId}/visual-search-model`, { model });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "vision-warehouse-settings"] });
      toast({ title: "Visual Search Model Updated", description: "The active visual search model has been changed." });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message || "Failed to update visual search model", variant: "destructive" });
    },
  });

  const handleVisualSearchModelChange = (model: 'google_vision_warehouse' | 'google_product_search') => {
    setVisualSearchModel(model);
    updateVisualSearchModelMutation.mutate(model);
  };

  const testGoogleApiKey = async () => {
    if (!googleApiKey) {
      toast({ title: "Please enter an API key", variant: "destructive" });
      return;
    }
    setIsTestingGoogleKey(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/test-google-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: googleApiKey })
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "API key is valid!", description: "You can now save this key." });
      } else {
        toast({ title: "Invalid API key", description: data.error || "Please check your key.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Test failed", description: "Could not verify the API key.", variant: "destructive" });
    } finally {
      setIsTestingGoogleKey(false);
    }
  };


  const handleOpenAIKeySubmit = openAIKeyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateOpenAIKeyMutation.mutate({ openaiApiKey: data.openaiApiKey });
  });

  const handleElevenLabsKeySubmit = elevenLabsKeyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateElevenLabsKeyMutation.mutate({ elevenlabsApiKey: data.elevenlabsApiKey });
  });

  const handleCurrencySubmit = currencyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateCurrencyMutation.mutate(data);
  });

  const handleSaveVwConfig = async () => {
    if (!selectedBusinessId) return;
    setIsSavingVwConfig(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/vision-warehouse-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectNumber: vwProjectNumber.trim() || null,
          corpusId: vwCorpusId.trim() || null,
          indexId: vwIndexId.trim() || null,
          endpointId: vwEndpointId.trim() || null,
        })
      });
      if (!response.ok) throw new Error('Failed to save configuration');
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "vision-warehouse-settings"] });
      toast({ title: "Configuration Saved", description: "Vision Warehouse configuration has been updated." });
    } catch (error: any) {
      toast({ title: "Failed to Save", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingVwConfig(false);
    }
  };

  const handleSaveVwCredentials = async () => {
    if (!selectedBusinessId || !vwCredentialsJson.trim()) {
      toast({ title: "Missing Credentials", description: "Please paste your service account JSON.", variant: "destructive" });
      return;
    }
    setIsSavingVwCredentials(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/vision-warehouse-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: vwCredentialsJson })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save credentials');
      }
      const result = await response.json();
      setVwCredentialsJson("");
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "vision-warehouse-settings"] });
      toast({ title: "Credentials Saved", description: `Connected to project: ${result.projectId}` });
    } catch (error: any) {
      toast({ title: "Failed to Save", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingVwCredentials(false);
    }
  };

  const handleTestVwCredentials = async () => {
    if (!selectedBusinessId) return;
    setIsTestingVwCredentials(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/test-vision-warehouse-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: vwCredentialsJson || undefined })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Credentials test failed');
      }
      const result = await response.json();
      toast({ title: "Credentials Valid", description: `Successfully connected to project: ${result.projectId}` });
    } catch (error: any) {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsTestingVwCredentials(false);
    }
  };

  const handleDeployIndex = async () => {
    if (!selectedBusinessId) return;
    setIsDeploying(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/vision-warehouse-deploy-index`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to deploy index');
      }
      const result = await response.json();
      
      if (result.alreadyDeployed) {
        // Index was already deployed - just update status
        toast({ title: "Already Deployed", description: result.message });
        setIsDeploying(false);
        refetchEndpointStatus();
      } else {
        toast({ title: "Deploying Index", description: "Index deployment started. This may take 5-15 minutes." });
        // Start polling for status
        refetchEndpointStatus();
      }
    } catch (error: any) {
      toast({ title: "Deploy Failed", description: error.message, variant: "destructive" });
      setIsDeploying(false);
    }
  };

  const handleUndeployIndex = async () => {
    if (!selectedBusinessId) return;
    setIsUndeploying(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/vision-warehouse-undeploy-index`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to undeploy index');
      }
      toast({ title: "Undeploying Index", description: "Index is being undeployed. Visual search will be offline." });
      // Start polling for status
      refetchEndpointStatus();
    } catch (error: any) {
      toast({ title: "Undeploy Failed", description: error.message, variant: "destructive" });
      setIsUndeploying(false);
    }
  };

  // Stop polling when operation completes
  useEffect(() => {
    if (endpointStatus) {
      if (isDeploying && endpointStatus.isDeployed) {
        setIsDeploying(false);
        toast({ title: "Index Deployed", description: "Visual search is now active!" });
      }
      if (isUndeploying && !endpointStatus.isDeployed) {
        setIsUndeploying(false);
        toast({ title: "Index Undeployed", description: "Visual search is now offline. Serving costs stopped." });
      }
    }
  }, [endpointStatus, isDeploying, isUndeploying]);

  const handleSavePsConfig = async () => {
    if (!selectedBusinessId) return;
    setIsSavingPsConfig(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/product-search-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId: psProjectId.trim() || null,
          location: psLocation.trim() || 'us-east1',
          productSetId: psProductSetId.trim() || null,
        })
      });
      if (!response.ok) throw new Error('Failed to save configuration');
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "product-search-settings"] });
      toast({ title: "Configuration Saved", description: "Product Search configuration has been updated." });
    } catch (error: any) {
      toast({ title: "Failed to Save", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingPsConfig(false);
    }
  };

  const handleSavePsCredentials = async () => {
    if (!selectedBusinessId || !psCredentialsJson.trim()) {
      toast({ title: "Missing Credentials", description: "Please paste your service account JSON.", variant: "destructive" });
      return;
    }
    setIsSavingPsCredentials(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/product-search-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: psCredentialsJson })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save credentials');
      }
      const result = await response.json();
      setPsCredentialsJson("");
      setPsProjectId(result.projectId);
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "product-search-settings"] });
      toast({ title: "Credentials Saved", description: `Connected to project: ${result.projectId}` });
    } catch (error: any) {
      toast({ title: "Failed to Save", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingPsCredentials(false);
    }
  };

  const handleTestPsCredentials = async () => {
    if (!selectedBusinessId) return;
    setIsTestingPsCredentials(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/test-product-search-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: psCredentialsJson || undefined })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Credentials test failed');
      }
      const result = await response.json();
      toast({ title: "Credentials Valid", description: result.message });
    } catch (error: any) {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsTestingPsCredentials(false);
    }
  };

  const handleCreateProductSet = async () => {
    if (!selectedBusinessId) return;
    setIsCreatingProductSet(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/product-search-create-product-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productSetId: `ps-${selectedBusinessId.substring(0, 8)}`,
          displayName: selectedAccount?.name || 'Product Set'
        })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create product set');
      }
      const result = await response.json();
      setPsProductSetId(result.productSetId);
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "product-search-settings"] });
      toast({ title: "Product Set Created", description: `Created product set: ${result.productSetId}` });
    } catch (error: any) {
      toast({ title: "Failed to Create", description: error.message, variant: "destructive" });
    } finally {
      setIsCreatingProductSet(false);
    }
  };

  const handleSyncProducts = async () => {
    if (!selectedBusinessId) return;
    setIsSyncingProducts(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/product-search-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start sync');
      }
      const result = await response.json();
      toast({ title: "Sync Started", description: result.message });
      
      const pollInterval = setInterval(async () => {
        const statusRes = await refetchPsSettings();
        if (statusRes.data?.syncPhase === 'completed' || statusRes.data?.syncPhase === 'failed') {
          clearInterval(pollInterval);
          setIsSyncingProducts(false);
          if (statusRes.data.syncPhase === 'completed') {
            toast({ title: "Sync Complete", description: "Products synced to Google Product Search" });
          } else {
            toast({ title: "Sync Failed", description: statusRes.data.syncError || "Unknown error", variant: "destructive" });
          }
        }
      }, 3000);
    } catch (error: any) {
      toast({ title: "Failed to Sync", description: error.message, variant: "destructive" });
      setIsSyncingProducts(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">API Keys & Settings</h1>
        <p className="text-muted-foreground">
          Manage OpenAI API keys and currency settings for business accounts
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Select Business Account
          </CardTitle>
          <CardDescription>
            Choose a business account to configure its API settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={searchOpen}
                className="w-full justify-between"
                data-testid="select-business-account"
              >
                {selectedAccount ? (
                  <span className="truncate">{selectedAccount.name}</span>
                ) : (
                  <span className="text-muted-foreground">Search business accounts...</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput 
                  placeholder="Search by name or website..." 
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>No business account found.</CommandEmpty>
                  <CommandGroup>
                    {filteredAccounts.map((account) => (
                      <CommandItem
                        key={account.id}
                        value={account.id}
                        onSelect={(value) => {
                          setSelectedBusinessId(value);
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedBusinessId === account.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{account.name}</span>
                          {account.website && (
                            <span className="text-xs text-muted-foreground">{account.website}</span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          
          {selectedBusinessId && selectedAccount && (
            <div className="mt-4 p-3 bg-muted/50 rounded-md border">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Website:</span>{" "}
                {selectedAccount.website || "Not specified"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedBusinessId && !apiSettingsLoading && apiSettings && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                OpenAI API Key
              </CardTitle>
              <CardDescription>
                Configure the OpenAI API key for this business account's chatbot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiSettings?.hasOpenAIKey && (
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <p className="text-sm font-medium">Current API Key</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {apiSettings.openaiApiKey}
                  </p>
                </div>
              )}

              <form onSubmit={handleOpenAIKeySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openaiApiKey">
                    {apiSettings?.hasOpenAIKey ? "New API Key (leave blank to keep existing)" : "API Key"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="openaiApiKey"
                      type={showOpenAIKey ? "text" : "password"}
                      placeholder="sk-..."
                      data-testid="input-openai-api-key"
                      {...openAIKeyForm.register("openaiApiKey")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      data-testid="button-toggle-openai-key-visibility"
                    >
                      {showOpenAIKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {openAIKeyForm.formState.errors.openaiApiKey && (
                    <p className="text-sm text-destructive">
                      {openAIKeyForm.formState.errors.openaiApiKey.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateOpenAIKeyMutation.isPending || apiSettingsLoading}
                  data-testid="button-save-openai-key"
                >
                  {updateOpenAIKeyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save API Key"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                ElevenLabs API Key
              </CardTitle>
              <CardDescription>
                Configure the ElevenLabs API key for premium TTS voices (optional)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiSettings?.hasElevenLabsKey && (
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <p className="text-sm font-medium">Current API Key</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {apiSettings.elevenlabsApiKey}
                  </p>
                </div>
              )}

              <form onSubmit={handleElevenLabsKeySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="elevenlabsApiKey">
                    {apiSettings?.hasElevenLabsKey ? "New API Key (leave blank to keep existing)" : "API Key"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="elevenlabsApiKey"
                      type={showElevenLabsKey ? "text" : "password"}
                      placeholder="sk_..."
                      {...elevenLabsKeyForm.register("elevenlabsApiKey")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                    >
                      {showElevenLabsKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {elevenLabsKeyForm.formState.errors.elevenlabsApiKey && (
                    <p className="text-sm text-destructive">
                      {elevenLabsKeyForm.formState.errors.elevenlabsApiKey.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateElevenLabsKeyMutation.isPending || apiSettingsLoading}
                >
                  {updateElevenLabsKeyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save API Key"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Currency Settings
              </CardTitle>
              <CardDescription>
                Configure the display currency for products and pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCurrencySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select
                    value={currencyForm.watch("currency")}
                    onValueChange={(value) => currencyForm.setValue("currency", value)}
                  >
                    <SelectTrigger data-testid="select-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currencyForm.formState.errors.currency && (
                    <p className="text-sm text-destructive">
                      {currencyForm.formState.errors.currency.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateCurrencyMutation.isPending || apiSettingsLoading}
                  data-testid="button-save-currency"
                >
                  {updateCurrencyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save Currency"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Vista Studio
              </CardTitle>
              <CardDescription>
                Configure the AI model for product image generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-sm font-medium mb-3 block">AI Image Provider</Label>
                <RadioGroup
                  value={vistaSettings?.provider || 'openai'}
                  onValueChange={(value) => updateVistaSettingsMutation.mutate({ provider: value })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                    <RadioGroupItem value="openai" id="openai" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="openai" className="cursor-pointer flex items-center gap-2">
                        <span className="font-medium">OpenAI DALL-E</span>
                        {vistaSettings?.hasOpenaiApiKey && (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Configured</span>
                        )}
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">
                        Uses the configured OpenAI API key. No additional setup needed.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                    <RadioGroupItem value="google" id="google" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="google" className="cursor-pointer flex items-center gap-2">
                        <span className="font-medium">Google Nano Banana Pro</span>
                        {vistaSettings?.hasGoogleApiKey && (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Key saved</span>
                        )}
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">
                        Powered by Gemini 3 Pro Image. Requires a Google AI API key.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {vistaSettings?.provider === 'google' && (
                <div className="border-t pt-4">
                  <Label className="text-sm font-medium mb-2 block">Google AI API Key</Label>
                  <p className="text-xs text-gray-500 mb-3">
                    Get the API key from <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Google AI Studio</a>
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showGoogleApiKey ? 'text' : 'password'}
                        placeholder={vistaSettings?.hasGoogleApiKey ? '••••••••••••••••' : 'Enter Google AI API key'}
                        value={googleApiKey}
                        onChange={(e) => setGoogleApiKey(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                      >
                        {showGoogleApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      onClick={testGoogleApiKey}
                      disabled={!googleApiKey || isTestingGoogleKey}
                    >
                      {isTestingGoogleKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                    </Button>
                    <Button
                      onClick={() => updateVistaSettingsMutation.mutate({ googleApiKey })}
                      disabled={!googleApiKey || updateVistaSettingsMutation.isPending}
                    >
                      {updateVistaSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Key'}
                    </Button>
                  </div>
                  {vistaSettings?.hasGoogleApiKey && (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        API key is saved and encrypted
                      </p>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 px-2"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete Key
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Google API Key?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the Google API key and switch Vista Studio back to using OpenAI DALL-E for image generation.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-500 hover:bg-red-600"
                              onClick={() => updateVistaSettingsMutation.mutate({ provider: 'openai', googleApiKey: null })}
                            >
                              Delete Key
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-indigo-50 to-blue-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-600" />
                Visual Search Engine
              </CardTitle>
              <CardDescription className="mt-1">
                Choose which visual search model to use for product matching
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4 mb-6">
                <Label className="text-sm font-medium">Select Visual Search Model</Label>
                <RadioGroup
                  value={visualSearchModel}
                  onValueChange={(value) => handleVisualSearchModelChange(value as 'google_vision_warehouse' | 'google_product_search')}
                  className="grid gap-3"
                >
                  <div 
                    className={cn(
                      "flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                      visualSearchModel === 'google_vision_warehouse' 
                        ? "border-indigo-500 bg-indigo-50/50" 
                        : "border-gray-200 hover:border-gray-300"
                    )}
                    onClick={() => handleVisualSearchModelChange('google_vision_warehouse')}
                  >
                    <RadioGroupItem value="google_vision_warehouse" id="google_vision_warehouse" className="mt-1" />
                    <div className="flex-1">
                      <label htmlFor="google_vision_warehouse" className="text-base font-medium flex items-center gap-2 cursor-pointer">
                        Google Vision Warehouse
                        {visualSearchModel === 'google_vision_warehouse' && <Badge className="text-xs bg-gradient-to-r from-blue-500 to-green-500">Active</Badge>}
                      </label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Google Cloud's managed visual search. Best accuracy for jewelry with complex backgrounds and mannequins.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">Best Accuracy</Badge>
                        <Badge variant="outline" className="text-xs">Always-on Infrastructure</Badge>
                        <Badge variant="outline" className="text-xs">~$6/hour</Badge>
                      </div>
                      
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs">
                        <p className="font-semibold text-amber-800 mb-2">Complete Cost Breakdown (Official Google Pricing):</p>
                        <div className="space-y-1 text-amber-700">
                          <div className="flex justify-between">
                            <span>Image Storage:</span>
                            <span className="font-medium">$0.02/GB/month</span>
                          </div>
                          <div className="flex justify-between">
                            <span>One-time Index Build:</span>
                            <span className="font-medium">~$0.13 per 1,000 images</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Index Serving (2 nodes required):</span>
                            <span className="font-medium text-red-600">~$6/hour (~$4,320/month)</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Search Queries:</span>
                            <span className="font-medium">$3 per 1,000 searches</span>
                          </div>
                        </div>
                        <p className="mt-2 text-amber-600 italic">Tip: Undeploy when not using visual search to stop the $6/hour serving charge.</p>
                      </div>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {visualSearchModel === 'google_vision_warehouse' && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg border space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <CloudCog className="w-4 h-4" />
                    Google Vision Warehouse Configuration
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" aria-label="Open Google Vision Warehouse setup guide">
                        <HelpCircle className="w-4 h-4" />
                        Setup Guide
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <CloudCog className="w-5 h-5" />
                          Google Vision Warehouse Setup Guide
                        </DialogTitle>
                        <DialogDescription>
                          Follow these steps to configure Google Vision Warehouse for visual product search
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-6 py-4">
                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                            Create a Google Cloud Project
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Go to the Google Cloud Console and create a new project or use an existing one.
                          </p>
                          <a 
                            href="https://console.cloud.google.com/projectcreate" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            Open Google Cloud Console <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                            Enable Vision AI Warehouse API
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Enable the "Vertex AI Vision" API for your project. This allows you to create warehouses for visual search.
                          </p>
                          <a 
                            href="https://console.cloud.google.com/apis/library/visionai.googleapis.com" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            Enable Vision AI API <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                            Find Your Project Number
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Go to your project's settings page. The <strong>Project Number</strong> is a numeric ID (e.g., 1059444719642), different from the project name.
                          </p>
                          <a 
                            href="https://console.cloud.google.com/iam-admin/settings" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            View Project Settings <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
                            Create a Warehouse (Corpus)
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Navigate to Vertex AI Vision → Warehouses and create a new warehouse. Copy the <strong>Corpus ID</strong> (a long numeric string like 5175842903476491062).
                          </p>
                          <a 
                            href="https://console.cloud.google.com/vertex-ai/vision/warehouses" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            Open Vision Warehouses <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">5</span>
                            Create an Index & Deploy an Endpoint
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Within your warehouse, create an index for search, then deploy it to an endpoint. Copy the <strong>Index ID</strong> and <strong>Endpoint ID</strong> once created. The endpoint is required to perform searches.
                          </p>
                          <a 
                            href="https://console.cloud.google.com/vertex-ai/vision/warehouses" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            Manage Indexes & Endpoints <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">6</span>
                            Create a Service Account
                          </h3>
                          <p className="text-sm text-muted-foreground ml-8">
                            Create a service account with the "Vision AI Editor" role. Download the JSON key file - you'll paste its contents in the credentials field below.
                          </p>
                          <a 
                            href="https://console.cloud.google.com/iam-admin/serviceaccounts/create" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-8 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            Create Service Account <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
                          <h4 className="font-medium text-amber-800 flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Tip: Required IAM Roles
                          </h4>
                          <p className="text-sm text-amber-700 mt-1">
                            Your service account needs these roles: <strong>Vision AI Editor</strong> and <strong>Storage Object Viewer</strong> (if images are in Cloud Storage).
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                
                <div className="grid gap-4">
                  <div>
                    <Label htmlFor="vwProjectNumber" className="text-sm">Project Number *</Label>
                    <Input
                      id="vwProjectNumber"
                      value={vwProjectNumber}
                      onChange={(e) => setVwProjectNumber(e.target.value)}
                      placeholder="e.g., 1059444719642"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Find this in Google Cloud Console → Project Settings (it's the numeric ID, not the project name)
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="vwCorpusId" className="text-sm">Corpus ID</Label>
                    <Input
                      id="vwCorpusId"
                      value={vwCorpusId}
                      onChange={(e) => setVwCorpusId(e.target.value)}
                      placeholder="e.g., 5175842903476491062"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Find this in Google Cloud Console → Vertex AI Vision → Warehouses
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="vwIndexId" className="text-sm">Index ID (Optional)</Label>
                    <Input
                      id="vwIndexId"
                      value={vwIndexId}
                      onChange={(e) => setVwIndexId(e.target.value)}
                      placeholder="Index ID for search"
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="vwEndpointId" className="text-sm">Endpoint ID (Optional)</Label>
                    <Input
                      id="vwEndpointId"
                      value={vwEndpointId}
                      onChange={(e) => setVwEndpointId(e.target.value)}
                      placeholder="Deployed endpoint ID"
                      className="mt-1"
                    />
                  </div>

                  <Button
                    onClick={handleSaveVwConfig}
                    disabled={isSavingVwConfig}
                    variant="outline"
                    className="w-full"
                  >
                    {isSavingVwConfig ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Configuration"
                    )}
                  </Button>
                </div>
                
                <div className="border-t pt-4 mt-2">
                  <Label className="text-sm font-medium">Service Account Credentials</Label>
                  
                  {vwSettings?.hasCredentials ? (
                    <div className="mt-2">
                      <div className="flex items-start gap-2 p-3 bg-green-50 rounded-lg text-sm border border-green-200">
                        <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <div className="text-green-800 flex-1">
                          <strong>Credentials Configured</strong>
                          <p className="text-xs mt-1">Google service account is connected and working.</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleTestVwCredentials}
                          disabled={isTestingVwCredentials}
                        >
                          {isTestingVwCredentials ? <Loader2 className="w-3 h-3 animate-spin" /> : "Test"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        To update credentials, paste new JSON below and save.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-sm border border-amber-200">
                      <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="text-amber-800">
                        <strong>Credentials Required</strong>
                        <p className="text-xs mt-1">Paste your Google Cloud service account JSON below to enable Vision Warehouse.</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="mt-3">
                    <textarea
                      value={vwCredentialsJson}
                      onChange={(e) => setVwCredentialsJson(e.target.value)}
                      placeholder='Paste your service account JSON here...'
                      className="w-full h-32 p-3 text-xs font-mono border rounded-lg resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  <div className="flex gap-2 mt-2">
                    <Button
                      onClick={handleSaveVwCredentials}
                      disabled={!vwCredentialsJson.trim() || isSavingVwCredentials}
                      className="flex-1"
                    >
                      {isSavingVwCredentials ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Credentials"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleTestVwCredentials}
                      disabled={!vwCredentialsJson.trim() || isTestingVwCredentials}
                    >
                      {isTestingVwCredentials ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>

                {/* Deploy/Undeploy Controls */}
                {vwSettings?.hasCredentials && vwSettings?.endpointId && (
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <Label className="text-sm font-medium">Index Endpoint Control</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Control serving costs by deploying/undeploying the search index
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isLoadingEndpointStatus ? (
                          <Badge variant="outline" className="text-xs">
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            Checking...
                          </Badge>
                        ) : endpointStatus?.isDeployed ? (
                          <Badge className="text-xs bg-green-500">
                            <Power className="w-3 h-3 mr-1" />
                            Deployed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            <PowerOff className="w-3 h-3 mr-1" />
                            Not Deployed
                          </Badge>
                        )}
                      </div>
                    </div>

                    {!endpointStatus?.isDeployed && !isDeploying && !isUndeploying && (
                      <div className="mb-3 p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-amber-800">
                          <strong>Visual Search Offline</strong>
                          <p className="text-xs mt-1">The search index appears not deployed. Click "Deploy Index" to verify and activate visual search.</p>
                        </div>
                      </div>
                    )}

                    {(isDeploying || isUndeploying) && (
                      <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <div className="text-sm text-blue-800">
                          {isDeploying ? "Deploying index... This may take 5-15 minutes." : "Undeploying index..."}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {endpointStatus?.isDeployed ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                              disabled={isUndeploying || isDeploying}
                            >
                              <PowerOff className="w-4 h-4 mr-2" />
                              Undeploy to Save Costs
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Undeploy Search Index?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will stop the visual search service and save ~$4,320/month in serving costs. 
                                Visual product search will be unavailable until you deploy again (takes 5-15 minutes to redeploy).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleUndeployIndex} className="bg-amber-600 hover:bg-amber-700">
                                Yes, Undeploy
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Button
                          onClick={handleDeployIndex}
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          disabled={isDeploying || isUndeploying}
                        >
                          {isDeploying ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Verifying...
                            </>
                          ) : (
                            <>
                              <Power className="w-4 h-4 mr-2" />
                              Deploy / Verify Status
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {endpointStatus?.isDeployed 
                        ? "Deployed endpoints incur ~$6/hour (~$4,320/month) in serving costs" 
                        : "Deploy to enable visual product search (takes 5-15 minutes)"}
                    </p>
                  </div>
                )}
              </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {selectedBusinessId && apiSettingsLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading settings...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedBusinessId && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              Please select a business account to manage its API settings
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
