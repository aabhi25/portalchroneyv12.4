import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Eye, SlidersHorizontal, Sparkles, Database, ChevronRight, CloudCog } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface WidgetSettings {
  perfectMatchThreshold?: string;
  verySimilarThreshold?: string;
  somewhatSimilarThreshold?: string;
  showMatchPercentage?: string;
  backgroundRemovalEnabled?: string;
  visualSearchModel?: string;
  googleVisionWarehouseCorpusId?: string;
  googleVisionWarehouseIndexId?: string;
  googleVisionWarehouseEndpointId?: string;
  googleVisionWarehouseCredentialsConfigured?: boolean;
  googleVisionWarehouseProjectNumber?: string;
}

export default function VisualSearchSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  
  const [perfectMatchThreshold, setPerfectMatchThreshold] = useState(96);
  const [verySimilarThreshold, setVerySimilarThreshold] = useState(85);
  const [somewhatSimilarThreshold, setSomewhatSimilarThreshold] = useState(70);
  const [showMatchPercentage, setShowMatchPercentage] = useState(false);
  const [visualSearchModel, setVisualSearchModel] = useState<string>("google_vision_warehouse");
  const [corpusId, setCorpusId] = useState("");
  const [indexId, setIndexId] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [isUndeploying, setIsUndeploying] = useState(false);
  const [endpointStatus, setEndpointStatus] = useState<{ state: string; isDeployed: boolean } | null>(null);
  const [credentialsJson, setCredentialsJson] = useState("");
  const [credentialsConfigured, setCredentialsConfigured] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [isTestingCredentials, setIsTestingCredentials] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const { data: widgetSettings, isLoading: settingsLoading } = useQuery<WidgetSettings>({
    queryKey: ['/api/widget-settings'],
    queryFn: async () => {
      const response = await fetch('/api/widget-settings', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch settings');
      return response.json();
    }
  });

  useEffect(() => {
    if (widgetSettings) {
      if (widgetSettings.perfectMatchThreshold) {
        setPerfectMatchThreshold(parseInt(widgetSettings.perfectMatchThreshold));
      }
      if (widgetSettings.verySimilarThreshold) {
        setVerySimilarThreshold(parseInt(widgetSettings.verySimilarThreshold));
      }
      if (widgetSettings.somewhatSimilarThreshold) {
        setSomewhatSimilarThreshold(parseInt(widgetSettings.somewhatSimilarThreshold));
      }
      if (widgetSettings.showMatchPercentage) {
        setShowMatchPercentage(widgetSettings.showMatchPercentage === 'true');
      }
      if (widgetSettings.visualSearchModel) {
        setVisualSearchModel(widgetSettings.visualSearchModel);
      }
      if (widgetSettings.googleVisionWarehouseCorpusId) {
        setCorpusId(widgetSettings.googleVisionWarehouseCorpusId);
      }
      if (widgetSettings.googleVisionWarehouseIndexId) {
        setIndexId(widgetSettings.googleVisionWarehouseIndexId);
      }
      if (widgetSettings.googleVisionWarehouseEndpointId) {
        setEndpointId(widgetSettings.googleVisionWarehouseEndpointId);
      }
      if (widgetSettings.googleVisionWarehouseProjectNumber) {
        setProjectNumber(widgetSettings.googleVisionWarehouseProjectNumber);
      }
      if (widgetSettings.googleVisionWarehouseCredentialsConfigured) {
        setCredentialsConfigured(true);
      }
    }
  }, [widgetSettings]);

  const handleSaveCredentials = async () => {
    if (!credentialsJson.trim()) {
      toast({
        title: "Missing Credentials",
        description: "Please paste your service account JSON.",
        variant: "destructive"
      });
      return;
    }

    setIsSavingCredentials(true);
    try {
      const response = await fetch('/api/vision-warehouse/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: credentialsJson })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save credentials');
      }

      const result = await response.json();
      setCredentialsConfigured(true);
      setCredentialsJson(""); // Clear after saving for security
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });

      toast({
        title: "Credentials Saved",
        description: `Connected to project: ${result.projectId}`
      });
    } catch (error: any) {
      toast({
        title: "Failed to Save",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSavingCredentials(false);
    }
  };

  const handleTestCredentials = async () => {
    setIsTestingCredentials(true);
    try {
      const response = await fetch('/api/vision-warehouse/test-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentials: credentialsJson || undefined })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Credentials test failed');
      }

      const result = await response.json();
      toast({
        title: "Credentials Valid",
        description: `Successfully connected to project: ${result.projectId}`
      });
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsTestingCredentials(false);
    }
  };

  const handleSaveVisionWarehouseConfig = async () => {
    setIsSavingConfig(true);
    try {
      const response = await fetch('/api/widget-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          googleVisionWarehouseCorpusId: corpusId.trim() || null,
          googleVisionWarehouseIndexId: indexId.trim() || null,
          googleVisionWarehouseEndpointId: endpointId.trim() || null,
          googleVisionWarehouseProjectNumber: projectNumber.trim() || null
        })
      });

      if (!response.ok) throw new Error('Failed to save configuration');

      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });

      toast({
        title: "Configuration Saved",
        description: "Vision Warehouse configuration has been updated."
      });
    } catch (error: any) {
      toast({
        title: "Failed to Save",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const saveVisualSearchSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<WidgetSettings>) => {
      const response = await fetch('/api/widget-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings)
      });
      if (!response.ok) throw new Error('Failed to save settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });
      toast({
        title: "Settings saved",
        description: "Visual search settings have been updated."
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save visual search settings.",
        variant: "destructive"
      });
    }
  });

  const handleSaveSettings = () => {
    saveVisualSearchSettingsMutation.mutate({
      perfectMatchThreshold: perfectMatchThreshold.toString(),
      verySimilarThreshold: verySimilarThreshold.toString(),
      somewhatSimilarThreshold: somewhatSimilarThreshold.toString(),
      showMatchPercentage: showMatchPercentage ? 'true' : 'false',
      backgroundRemovalEnabled: 'true',
      visualSearchModel,
      googleVisionWarehouseCorpusId: corpusId || undefined,
      googleVisionWarehouseIndexId: indexId || undefined,
      googleVisionWarehouseEndpointId: endpointId || undefined,
    });
  };

  const handleDeployIndex = async () => {
    if (!corpusId) {
      toast({
        title: "Missing Corpus ID",
        description: "Please enter a Corpus ID before deploying.",
        variant: "destructive"
      });
      return;
    }

    setIsDeploying(true);
    try {
      const response = await fetch('/api/vision-warehouse/deploy-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to deploy index');
      }

      const result = await response.json();
      
      if (result.indexId) setIndexId(result.indexId);
      if (result.endpointId) setEndpointId(result.endpointId);
      
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });
      
      toast({
        title: "Index Deployed",
        description: result.isNewlyCreated 
          ? "Search index and endpoint have been created and deployed."
          : "Search index has been deployed successfully."
      });
    } catch (error: any) {
      toast({
        title: "Deployment Failed",
        description: error.message || "Failed to deploy search index.",
        variant: "destructive"
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleUndeployIndex = async () => {
    setIsUndeploying(true);
    try {
      const response = await fetch('/api/vision-warehouse/undeploy-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to undeploy index');
      }
      
      toast({
        title: "Index Undeployed",
        description: "Search index has been undeployed. Serving costs have stopped."
      });
      
      setEndpointStatus({ state: 'UNDEPLOYED', isDeployed: false });
    } catch (error: any) {
      toast({
        title: "Undeploy Failed",
        description: error.message || "Failed to undeploy search index.",
        variant: "destructive"
      });
    } finally {
      setIsUndeploying(false);
    }
  };

  const checkEndpointStatus = async () => {
    try {
      const response = await fetch('/api/vision-warehouse/endpoint-status', {
        credentials: 'include',
      });
      if (response.ok) {
        const status = await response.json();
        setEndpointStatus(status);
      }
    } catch (error) {
      console.error('Failed to check endpoint status:', error);
    }
  };

  useEffect(() => {
    if (visualSearchModel === 'google_vision_warehouse' && endpointId && credentialsConfigured) {
      checkEndpointStatus();
    }
  }, [visualSearchModel, endpointId, credentialsConfigured]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => setLocation("/admin/settings")}
          className="gap-2 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SlidersHorizontal className="w-6 h-6 text-purple-600" />
          Visual Search Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure matching thresholds and quality ranges for visual product search
        </p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Match Quality Labels
              </CardTitle>
              <CardDescription className="mt-1">
                Define similarity ranges for match quality badges
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
                  <div>
                    <Label className="text-sm font-medium">Display Mode</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {showMatchPercentage 
                        ? "Showing exact match percentage on products (e.g., 92% match)" 
                        : "Showing friendly labels on products (Perfect Match, Very Similar)"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${!showMatchPercentage ? 'font-semibold text-purple-600' : 'text-gray-500'}`}>Labels</span>
                    <Switch
                      checked={showMatchPercentage}
                      onCheckedChange={setShowMatchPercentage}
                    />
                    <span className={`text-xs ${showMatchPercentage ? 'font-semibold text-purple-600' : 'text-gray-500'}`}>Percentage</span>
                  </div>
                </div>

                {!showMatchPercentage && (
                  <>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-sm flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Perfect Match</span>
                    </Label>
                    <span className="text-sm font-semibold text-green-600">{perfectMatchThreshold}%+</span>
                  </div>
                  <Slider
                    value={[perfectMatchThreshold]}
                    onValueChange={(value) => setPerfectMatchThreshold(value[0])}
                    min={80}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum similarity for "Perfect Match" label (default: 96%)
                  </p>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-sm flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">Very Similar</span>
                    </Label>
                    <span className="text-sm font-semibold text-purple-600">{verySimilarThreshold}% - {perfectMatchThreshold - 1}%</span>
                  </div>
                  <Slider
                    value={[verySimilarThreshold]}
                    onValueChange={(value) => setVerySimilarThreshold(value[0])}
                    min={50}
                    max={perfectMatchThreshold - 1}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum similarity for "Very Similar" label (default: 85%)
                  </p>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-sm flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Somewhat Similar</span>
                    </Label>
                    <span className="text-sm font-semibold text-blue-600">{somewhatSimilarThreshold}% - {verySimilarThreshold - 1}%</span>
                  </div>
                  <Slider
                    value={[somewhatSimilarThreshold]}
                    onValueChange={(value) => setSomewhatSimilarThreshold(value[0])}
                    min={30}
                    max={verySimilarThreshold - 1}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum similarity for "Somewhat Similar" label (default: 70%)
                  </p>
                </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveSettings}
              disabled={saveVisualSearchSettingsMutation.isPending}
              size="lg"
            >
              {saveVisualSearchSettingsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
