import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  Loader2,
  RefreshCw,
  Check,
  AlertCircle,
  Save,
  Settings2,
  Activity,
  Clock,
  Package,
  PlayCircle,
  History,
  Link2,
  Key,
  Globe,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface ErpConfig {
  id: string;
  name: string;
  erpType: string;
  baseUrl: string;
  authType: string;
  apiKey: string | null;
  accessToken: string | null;
  basicAuthUsername: string | null;
  basicAuthPassword: string | null;
  productsEndpoint: string;
  productDetailEndpoint: string;
  categoriesEndpoint: string;
  deltaSyncEndpoint: string | null;
  syncEnabled: string;
  syncFrequencyHours: number;
  fullSyncDayOfWeek: number;
  batchSize: number;
  cacheEnabled: string;
  cacheTtlMinutes: number;
  isActive: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
}

interface SyncStatus {
  lastSyncTime: string | null;
  embeddingCount: number;
  cachedProductCount: number;
  isRunning: boolean;
  currentSync: any;
  recentLogs: any[];
}

interface SyncLog {
  id: string;
  syncType: string;
  status: string;
  totalProducts: number;
  processedProducts: number;
  newEmbeddings: number;
  updatedEmbeddings: number;
  failedProducts: number;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
}

export default function ErpSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("config");

  const [formData, setFormData] = useState({
    name: "",
    erpType: "generic",
    baseUrl: "",
    authType: "api_key",
    apiKey: "",
    accessToken: "",
    basicAuthUsername: "",
    basicAuthPassword: "",
    productsEndpoint: "/products",
    productDetailEndpoint: "/products/{id}",
    categoriesEndpoint: "/categories",
    deltaSyncEndpoint: "",
    syncEnabled: true,
    syncFrequencyHours: 12,
    fullSyncDayOfWeek: 0,
    batchSize: 500,
    cacheEnabled: true,
    cacheTtlMinutes: 30,
    isActive: true,
  });

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ["/api/erp/config"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/erp/config");
      return response.json();
    },
  });

  const { data: syncStatus, isLoading: syncLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["/api/erp/sync/status"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/erp/sync/status");
      return response.json() as Promise<SyncStatus>;
    },
    refetchInterval: 5000,
  });

  const { data: syncLogs } = useQuery({
    queryKey: ["/api/erp/sync/logs"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/erp/sync/logs?limit=10");
      return response.json();
    },
  });

  useEffect(() => {
    if (configData?.config) {
      const c = configData.config;
      setFormData({
        name: c.name || "",
        erpType: c.erpType || "generic",
        baseUrl: c.baseUrl || "",
        authType: c.authType || "api_key",
        apiKey: c.apiKey || "",
        accessToken: c.accessToken || "",
        basicAuthUsername: c.basicAuthUsername || "",
        basicAuthPassword: c.basicAuthPassword || "",
        productsEndpoint: c.productsEndpoint || "/products",
        productDetailEndpoint: c.productDetailEndpoint || "/products/{id}",
        categoriesEndpoint: c.categoriesEndpoint || "/categories",
        deltaSyncEndpoint: c.deltaSyncEndpoint || "",
        syncEnabled: c.syncEnabled === "true",
        syncFrequencyHours: c.syncFrequencyHours || 12,
        fullSyncDayOfWeek: c.fullSyncDayOfWeek ?? 0,
        batchSize: c.batchSize || 500,
        cacheEnabled: c.cacheEnabled === "true",
        cacheTtlMinutes: c.cacheTtlMinutes || 30,
        isActive: c.isActive === "true",
      });
    }
  }, [configData]);

  const saveConfigMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/erp/config", {
        ...data,
        syncEnabled: data.syncEnabled ? "true" : "false",
        cacheEnabled: data.cacheEnabled ? "true" : "false",
        isActive: data.isActive ? "true" : "false",
      });
      return response.json();
    },
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      toast({ title: "Configuration saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/config"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save configuration", description: error.message, variant: "destructive" });
      setSaveStatus("idle");
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/erp/test-connection");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ 
          title: "Connection successful", 
          description: data.productCount ? `Found ${data.productCount} products` : "API is reachable" 
        });
      } else {
        toast({ title: "Connection failed", description: data.message, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/erp/config"] });
    },
    onError: (error: any) => {
      toast({ title: "Connection test failed", description: error.message, variant: "destructive" });
    },
  });

  const fullSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/erp/sync/full");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Full sync started", description: "This may take a while for large catalogs" });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/sync/status"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to start sync", description: error.message, variant: "destructive" });
    },
  });

  const deltaSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/erp/sync/delta");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Delta sync started", description: "Only syncing changed products" });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/sync/status"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to start sync", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    setSaveStatus("saving");
    saveConfigMutation.mutate(formData);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-blue-500">Running</Badge>;
      case "completed":
        return <Badge className="bg-green-500">Completed</Badge>;
      case "failed":
        return <Badge className="bg-red-500">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="h-8 w-8" />
            ERP Integration
          </h1>
          <p className="text-muted-foreground mt-1">
            Connect your ERP system to sync products for visual search
          </p>
        </div>
        <div className="flex items-center gap-2">
          {configData?.configured && (
            <>
              <Badge variant={formData.isActive ? "default" : "secondary"}>
                {formData.isActive ? "Active" : "Inactive"}
              </Badge>
              <Button
                variant="outline"
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Sync Status
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Sync Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Connection Settings
              </CardTitle>
              <CardDescription>
                Configure the connection to your ERP API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Connection Name</Label>
                  <Input
                    id="name"
                    placeholder="My ERP Connection"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="erpType">ERP Type</Label>
                  <Select
                    value={formData.erpType}
                    onValueChange={(value) => setFormData({ ...formData, erpType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generic">Generic REST API</SelectItem>
                      <SelectItem value="sap">SAP</SelectItem>
                      <SelectItem value="oracle">Oracle</SelectItem>
                      <SelectItem value="microsoft_dynamics">Microsoft Dynamics</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseUrl">API Base URL</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://your-erp.com/api/v1"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Authentication
              </CardTitle>
              <CardDescription>
                Configure how to authenticate with the ERP API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="authType">Authentication Type</Label>
                <Select
                  value={formData.authType}
                  onValueChange={(value) => setFormData({ ...formData, authType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="bearer_token">Bearer Token</SelectItem>
                    <SelectItem value="basic">Basic Auth</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.authType === "api_key" && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Enter API key"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  />
                </div>
              )}

              {formData.authType === "bearer_token" && (
                <div className="space-y-2">
                  <Label htmlFor="accessToken">Access Token</Label>
                  <Input
                    id="accessToken"
                    type="password"
                    placeholder="Enter access token"
                    value={formData.accessToken}
                    onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                  />
                </div>
              )}

              {formData.authType === "basic" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="basicAuthUsername">Username</Label>
                    <Input
                      id="basicAuthUsername"
                      placeholder="Username"
                      value={formData.basicAuthUsername}
                      onChange={(e) => setFormData({ ...formData, basicAuthUsername: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="basicAuthPassword">Password</Label>
                    <Input
                      id="basicAuthPassword"
                      type="password"
                      placeholder="Password"
                      value={formData.basicAuthPassword}
                      onChange={(e) => setFormData({ ...formData, basicAuthPassword: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                API Endpoints
              </CardTitle>
              <CardDescription>
                Configure the API endpoints for fetching products
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="productsEndpoint">Products Endpoint</Label>
                  <Input
                    id="productsEndpoint"
                    placeholder="/products"
                    value={formData.productsEndpoint}
                    onChange={(e) => setFormData({ ...formData, productsEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="productDetailEndpoint">Product Detail Endpoint</Label>
                  <Input
                    id="productDetailEndpoint"
                    placeholder="/products/{id}"
                    value={formData.productDetailEndpoint}
                    onChange={(e) => setFormData({ ...formData, productDetailEndpoint: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="categoriesEndpoint">Categories Endpoint</Label>
                  <Input
                    id="categoriesEndpoint"
                    placeholder="/categories"
                    value={formData.categoriesEndpoint}
                    onChange={(e) => setFormData({ ...formData, categoriesEndpoint: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="deltaSyncEndpoint">Delta Sync Endpoint (optional)</Label>
                  <Input
                    id="deltaSyncEndpoint"
                    placeholder="/products/updated"
                    value={formData.deltaSyncEndpoint}
                    onChange={(e) => setFormData({ ...formData, deltaSyncEndpoint: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Sync Settings
              </CardTitle>
              <CardDescription>
                Configure how and when products are synced
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Sync</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically sync products from ERP
                  </p>
                </div>
                <Switch
                  checked={formData.syncEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, syncEnabled: checked })}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="syncFrequencyHours">Sync Frequency (hours)</Label>
                  <Select
                    value={String(formData.syncFrequencyHours)}
                    onValueChange={(value) => setFormData({ ...formData, syncFrequencyHours: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6">Every 6 hours</SelectItem>
                      <SelectItem value="12">Every 12 hours</SelectItem>
                      <SelectItem value="24">Every 24 hours</SelectItem>
                      <SelectItem value="48">Every 48 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="batchSize">Batch Size</Label>
                  <Select
                    value={String(formData.batchSize)}
                    onValueChange={(value) => setFormData({ ...formData, batchSize: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100">100 products</SelectItem>
                      <SelectItem value="250">250 products</SelectItem>
                      <SelectItem value="500">500 products</SelectItem>
                      <SelectItem value="1000">1000 products</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cacheTtlMinutes">Cache TTL (minutes)</Label>
                  <Select
                    value={String(formData.cacheTtlMinutes)}
                    onValueChange={(value) => setFormData({ ...formData, cacheTtlMinutes: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Cache</Label>
                  <p className="text-sm text-muted-foreground">
                    Cache product data for faster listing
                  </p>
                </div>
                <Switch
                  checked={formData.cacheEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, cacheEnabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Connection Active</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable or disable the ERP connection
                  </p>
                </div>
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saveConfigMutation.isPending}>
              {saveStatus === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saveStatus === "saved" ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saveStatus === "saved" ? "Saved!" : "Save Configuration"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="sync" className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Cached Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {syncStatus?.cachedProductCount || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Image Embeddings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {syncStatus?.embeddingCount || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Last Sync
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-medium">
                  {syncStatus?.lastSyncTime
                    ? formatDistanceToNow(new Date(syncStatus.lastSyncTime), { addSuffix: true })
                    : "Never"}
                </div>
              </CardContent>
            </Card>
          </div>

          {syncStatus?.isRunning && syncStatus.currentSync && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription className="ml-2">
                Sync in progress: {syncStatus.currentSync.processedProducts || 0} / {syncStatus.currentSync.totalProducts || "?"} products processed
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Manual Sync</CardTitle>
              <CardDescription>
                Trigger a sync manually instead of waiting for the scheduled sync
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <Button
                  onClick={() => fullSyncMutation.mutate()}
                  disabled={fullSyncMutation.isPending || syncStatus?.isRunning}
                >
                  {fullSyncMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <PlayCircle className="h-4 w-4 mr-2" />
                  )}
                  Full Sync
                </Button>
                <Button
                  variant="outline"
                  onClick={() => deltaSyncMutation.mutate()}
                  disabled={deltaSyncMutation.isPending || syncStatus?.isRunning || !syncStatus?.lastSyncTime}
                >
                  {deltaSyncMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Delta Sync
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Full sync processes all products. Delta sync only processes products updated since the last sync.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Sync Logs</CardTitle>
              <CardDescription>
                History of recent sync operations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {syncLogs?.logs?.length > 0 ? (
                <div className="space-y-4">
                  {syncLogs.logs.map((log: SyncLog) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{log.syncType}</Badge>
                          {getStatusBadge(log.status)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Started {format(new Date(log.startedAt), "PPp")}
                        </p>
                        {log.errorMessage && (
                          <p className="text-sm text-red-500">{log.errorMessage}</p>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        <p>
                          {log.processedProducts} / {log.totalProducts} products
                        </p>
                        <p className="text-muted-foreground">
                          {log.newEmbeddings} new, {log.updatedEmbeddings} updated
                        </p>
                        {log.durationSeconds && (
                          <p className="text-muted-foreground">
                            Duration: {Math.floor(log.durationSeconds / 60)}m {log.durationSeconds % 60}s
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sync logs yet. Run a sync to see the history.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
