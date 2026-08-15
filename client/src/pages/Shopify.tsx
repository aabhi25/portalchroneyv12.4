import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Product } from "@shared/schema";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  ShoppingBag,
  Loader2,
  RefreshCw,
  Check,
  AlertCircle,
  Save,
  InfoIcon,
  Package,
  Clock,
  Settings2,
  Tag,
  Trash2,
  Copy,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  currency: string;
}

interface AutoSyncSettings {
  autoSyncEnabled: boolean;
  syncFrequency: string;
  lastSyncedAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'completed' | 'failed';
  lastSyncError: string | null;
}

interface SyncNowResponse {
  message: string;
  imported: number;
  updated: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  AED: "د.إ",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  CNY: "¥",
  JPY: "¥",
  KRW: "₩",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  BRL: "R$",
  MXN: "$",
  ZAR: "R",
  TRY: "₺",
  RUB: "₽",
};

export default function Shopify() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  // Product details dialog state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Shopify OAuth credentials state
  const [shopifyStoreUrl, setShopifyStoreUrl] = useState("");
  const [shopifyClientId, setShopifyClientId] = useState("");
  const [shopifyClientSecret, setShopifyClientSecret] = useState("");
  const [shopifyAccessToken, setShopifyAccessToken] = useState("");
  const [shopifyError, setShopifyError] = useState("");
  const [shopifySaveStatus, setShopifySaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isConnecting, setIsConnecting] = useState(false);

  // Auto-sync state
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncFrequency, setSyncFrequency] = useState<number>(24);
  const [autoSyncSaveStatus, setAutoSyncSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Disconnect dialog state
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [deleteProductsOnDisconnect, setDeleteProductsOnDisconnect] = useState(false);

  // Handle OAuth callback success/error from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');

    if (success === 'true') {
      toast({
        title: "Connected to Shopify!",
        description: "Your Shopify store has been successfully connected.",
      });
      // Clean up URL
      window.history.replaceState({}, '', '/shopify');
      // Switch to Settings tab to show connected status
      setActiveTab('settings');
    } else if (error) {
      toast({
        title: "Connection Failed",
        description: decodeURIComponent(error),
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, '', '/shopify');
      setActiveTab('settings');
    }
  }, [toast]);

  // Fetch all products
  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Filter Shopify products
  const shopifyProducts = products.filter(p => p.source === 'shopify');

  // Fetch widget settings for currency
  const { data: widgetSettings } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  // Fetch auto-sync settings
  const { data: autoSyncSettings } = useQuery<AutoSyncSettings>({
    queryKey: ["/api/shopify/auto-sync"],
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.syncStatus === 'syncing' ? 5000 : false;
    },
  });

  // Fetch Shopify credentials
  const { data: shopifyData, refetch: refetchShopifyData } = useQuery<{ 
    storeUrl: string | null; 
    hasToken: boolean; 
    maskedToken: string | null;
    hasClientCredentials: boolean;
    maskedClientId: string | null;
  }>({
    queryKey: ["/api/settings/shopify"],
  });

  useEffect(() => {
    if (shopifyData) {
      // Only populate store URL if it's a valid Shopify domain and not connected
      // This prevents showing corrupted data from previous bugs
      if (!shopifyData.hasToken && shopifyData.storeUrl && shopifyData.storeUrl.endsWith('.myshopify.com')) {
        setShopifyStoreUrl(shopifyData.storeUrl);
      }
      // Don't pre-fill Client ID and Secret - user should always enter fresh values for OAuth
    }
  }, [shopifyData]);

  useEffect(() => {
    if (autoSyncSettings) {
      setAutoSyncEnabled(autoSyncSettings.autoSyncEnabled);
      setSyncFrequency(parseInt(autoSyncSettings.syncFrequency) || 24);
    }
  }, [autoSyncSettings]);

  const currencySymbol = widgetSettings ? CURRENCY_SYMBOLS[widgetSettings.currency] || "$" : "$";
  const syncStatus = autoSyncSettings?.syncStatus || 'idle';
  const isSyncing = syncStatus === 'syncing';
  const lastSyncedAt = autoSyncSettings?.lastSyncedAt;

  // Sync Now mutation
  const syncNowMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<SyncNowResponse>("POST", "/api/shopify/sync-now");
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/shopify/auto-sync"] });
      const previousSettings = queryClient.getQueryData(["/api/shopify/auto-sync"]);
      queryClient.setQueryData(["/api/shopify/auto-sync"], (old: AutoSyncSettings | undefined) => {
        if (!old) return old;
        return { ...old, syncStatus: 'syncing' as const };
      });
      return { previousSettings };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopify/auto-sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Products synced successfully!",
        description: `${data.imported} new, ${data.updated} updated`,
      });
    },
    onError: (error: any, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(["/api/shopify/auto-sync"], context.previousSettings);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to sync products",
        variant: "destructive",
      });
    },
  });

  // Update Shopify credentials mutation
  const updateShopifyMutation = useMutation({
    mutationFn: async (data: { storeUrl: string; accessToken: string }) => {
      const response = await fetch("/api/settings/shopify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update Shopify settings");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/shopify"] });
      setShopifySaveStatus("saved");
      if (data.maskedToken) {
        setShopifyAccessToken(data.maskedToken);
      }
      setShopifyError("");
      setTimeout(() => setShopifySaveStatus("idle"), 2000);
      toast({
        title: "Success",
        description: "Shopify credentials saved successfully",
      });
    },
    onError: (error: any) => {
      setShopifyError(error.message || "Failed to save Shopify credentials");
      setShopifySaveStatus("idle");
    },
  });

  // Update auto-sync mutation
  const updateAutoSyncMutation = useMutation({
    mutationFn: async (data: { enabled: boolean; frequency: number }) => {
      const response = await fetch("/api/shopify/auto-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update auto-sync settings");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopify/auto-sync"] });
      setAutoSyncSaveStatus("saved");
      setTimeout(() => setAutoSyncSaveStatus("idle"), 2000);
      toast({
        title: "Success",
        description: "Auto-sync settings saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save auto-sync settings",
        variant: "destructive",
      });
      setAutoSyncSaveStatus("idle");
    },
  });

  // Disconnect Shopify mutation
  const disconnectShopifyMutation = useMutation({
    mutationFn: async (deleteProducts: boolean) => {
      const response = await fetch("/api/settings/shopify/disconnect", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deleteProducts }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to disconnect Shopify");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/shopify"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setShopifyStoreUrl("");
      setShopifyAccessToken("");
      setShopifyError("");
      setDisconnectDialogOpen(false);
      setDeleteProductsOnDisconnect(false);
      toast({
        title: "Shopify Disconnected",
        description: "Your Shopify integration has been removed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect Shopify",
        variant: "destructive",
      });
    },
  });

  const handleShopifySave = () => {
    setShopifyError("");

    if (!shopifyStoreUrl && !shopifyAccessToken) {
      setShopifySaveStatus("saving");
      updateShopifyMutation.mutate({ storeUrl: "", accessToken: "" });
      return;
    }

    if (!shopifyStoreUrl || !shopifyAccessToken) {
      setShopifyError("Both store URL and access token are required");
      return;
    }

    setShopifySaveStatus("saving");
    updateShopifyMutation.mutate({
      storeUrl: shopifyStoreUrl,
      accessToken: shopifyAccessToken,
    });
  };

  const handleShopifyConnect = async () => {
    setShopifyError("");
    setIsConnecting(true);

    try {
      // First save the OAuth credentials
      const response = await fetch("/api/shopify/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeUrl: shopifyStoreUrl,
          clientId: shopifyClientId,
          clientSecret: shopifyClientSecret,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setShopifyError(data.error || "Failed to start OAuth flow");
        setIsConnecting(false);
        return;
      }

      // Open Shopify OAuth in a new popup window (avoids iframe restrictions)
      if (data.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
          data.authUrl,
          'shopify_oauth',
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );

        // Handle postMessage from OAuth callback for reliable completion detection
        const handleOAuthMessage = async (event: MessageEvent) => {
          if (event.data?.type === 'shopify_oauth_success') {
            window.removeEventListener('message', handleOAuthMessage);
            setIsConnecting(false);
            await refetchShopifyData();
            toast({
              title: "Connected to Shopify!",
              description: "Your Shopify store has been successfully connected.",
            });
          }
        };
        window.addEventListener('message', handleOAuthMessage);

        // Also poll for popup close as fallback (in case postMessage fails)
        const pollTimer = setInterval(async () => {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            window.removeEventListener('message', handleOAuthMessage);
            setIsConnecting(false);
            // Refetch to check final state
            await refetchShopifyData();
          }
        }, 500);
      }
    } catch (error: any) {
      setShopifyError(error.message || "Failed to connect to Shopify");
      setIsConnecting(false);
    }
  };

  const handleAutoSyncSave = () => {
    setAutoSyncSaveStatus("saving");
    updateAutoSyncMutation.mutate({
      enabled: autoSyncEnabled,
      frequency: syncFrequency,
    });
  };

  const handleSyncNow = () => {
    if (isSyncing) {
      toast({
        title: "A sync is already in progress",
        variant: "default",
      });
      return;
    }
    syncNowMutation.mutate();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-purple-600" />
          Shopify Integration
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your Shopify store integration, products, and sync settings
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
          <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <Package className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="products" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <ShoppingBag className="w-4 h-4 mr-2" />
            Products
          </TabsTrigger>
          <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <Settings2 className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Sync Status Card */}
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-purple-600" />
                Sync Status
              </CardTitle>
              <CardDescription>Current synchronization status with your Shopify store</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  {syncStatus === 'idle' && (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      Ready
                    </Badge>
                  )}
                  {syncStatus === 'syncing' && (
                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Syncing...
                    </Badge>
                  )}
                  {syncStatus === 'completed' && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      <Check className="w-3 h-3 mr-1" />
                      Synced
                    </Badge>
                  )}
                  {syncStatus === 'failed' && (
                    <Badge variant="destructive" className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Failed
                    </Badge>
                  )}

                  {lastSyncedAt && (
                    <span className="text-sm text-muted-foreground">
                      Last synced: {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>

                <Button
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  variant="default"
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Sync Now
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Shopify Products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{shopifyProducts.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Synced from Shopify
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Auto-Sync Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {autoSyncEnabled ? (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Automatic synchronization
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sync Frequency
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  {syncFrequency}h
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Hours between syncs
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Benefits Alert */}
          <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950 dark:border-purple-800">
            <InfoIcon className="h-4 w-4 text-purple-600" />
            <AlertDescription className="text-sm text-purple-900 dark:text-purple-100">
              <strong>Shopify Integration Benefits:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Automatically sync products from your Shopify store</li>
                <li>Keep product information up-to-date with scheduled syncing</li>
                <li>Chroney can answer customer questions about your Shopify products</li>
                <li>No manual product entry required</li>
              </ul>
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products" className="mt-6">
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-purple-600" />
                    Shopify Products
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Products synced from your Shopify store (read-only)
                  </CardDescription>
                </div>
                <Badge variant="secondary">{shopifyProducts.length} products</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {productsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                  <span className="ml-2 text-muted-foreground">Loading products...</span>
                </div>
              ) : shopifyProducts.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Shopify Products</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    No products have been synced from Shopify yet.
                  </p>
                  <Button onClick={handleSyncNow} disabled={isSyncing}>
                    {isSyncing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Products
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Image</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="max-w-[300px]">Description</TableHead>
                        <TableHead className="w-[120px]">Price</TableHead>
                        <TableHead className="w-[150px]">Last Synced</TableHead>
                        <TableHead className="w-[100px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shopifyProducts.map((product) => (
                        <TableRow 
                          key={product.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            setSelectedProduct(product);
                            setIsDialogOpen(true);
                          }}
                        >
                          <TableCell>
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-12 h-12 object-cover rounded"
                              />
                            ) : (
                              <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                                <Package className="w-6 h-6 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="max-w-[300px]">
                            <div className="text-sm text-muted-foreground truncate" title={product.description || ""}>
                              {product.description || "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            {product.price ? `${currencySymbol}${product.price}` : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {product.updatedAt
                              ? formatDistanceToNow(new Date(product.updatedAt), {
                                  addSuffix: true,
                                })
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              Read-only
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-6 space-y-6">
          {/* Shopify Credentials Card */}
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-purple-600" />
                    Shopify Store Credentials
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Configure your Shopify store connection
                  </CardDescription>
                </div>
                {shopifySaveStatus === "saving" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Save className="w-4 h-4 animate-pulse" />
                    <span>Saving...</span>
                  </div>
                )}
                {shopifySaveStatus === "saved" && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Check className="w-4 h-4" />
                    <span>Saved</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <Alert className="mb-6 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
                <InfoIcon className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
                  <strong>Setup Instructions:</strong>
                  <ol className="list-decimal list-inside mt-2 space-y-1">
                    <li>Go to your Shopify Partners Dashboard</li>
                    <li>Create a new app or select an existing one</li>
                    <li>Copy the Client ID and Client Secret from Settings</li>
                    <li>Add the URLs below to your app configuration</li>
                    <li>Enter your credentials below and click "Connect with Shopify"</li>
                  </ol>
                  
                  <div className="mt-4 space-y-3 bg-white dark:bg-gray-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900">
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">App URL:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono">
                          https://portal.aichroney.com
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            navigator.clipboard.writeText("https://portal.aichroney.com");
                            toast({ title: "Copied!", description: "App URL copied to clipboard" });
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Allowed redirection URL:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono break-all">
                          https://portal.aichroney.com/api/shopify/auth/callback
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            navigator.clipboard.writeText("https://portal.aichroney.com/api/shopify/auth/callback");
                            toast({ title: "Copied!", description: "Callback URL copied to clipboard" });
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {shopifyData?.hasToken ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                      <Check className="w-5 h-5" />
                      <span className="font-medium">Connected to Shopify</span>
                    </div>
                    <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                      Store: {shopifyData.storeUrl}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setDisconnectDialogOpen(true)}
                    className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Disconnect Shopify
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="storeUrl" className="text-sm font-medium">
                      Store URL
                    </Label>
                    <Input
                      id="storeUrl"
                      type="text"
                      value={shopifyStoreUrl}
                      onChange={(e) => setShopifyStoreUrl(e.target.value)}
                      placeholder="your-store.myshopify.com"
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Your Shopify store URL (without https://)
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="clientId" className="text-sm font-medium">
                      Client ID
                    </Label>
                    <Input
                      id="clientId"
                      type="text"
                      value={shopifyClientId}
                      onChange={(e) => setShopifyClientId(e.target.value)}
                      placeholder="Enter your Shopify Client ID"
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      From your Shopify Partner Dashboard app settings
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="clientSecret" className="text-sm font-medium">
                      Client Secret
                    </Label>
                    <Input
                      id="clientSecret"
                      type="password"
                      value={shopifyClientSecret}
                      onChange={(e) => setShopifyClientSecret(e.target.value)}
                      placeholder="Enter your Shopify Client Secret"
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Keep this secret - never share it publicly
                    </p>
                  </div>

                  {shopifyError && (
                    <div className="flex items-center gap-2 text-sm text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      <span>{shopifyError}</span>
                    </div>
                  )}

                  <Button
                    onClick={handleShopifyConnect}
                    disabled={isConnecting || !shopifyStoreUrl || !shopifyClientId || !shopifyClientSecret}
                    className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="w-4 h-4 mr-2" />
                        Connect with Shopify
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Auto-Sync Settings Card */}
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-purple-600" />
                    Auto-Sync Configuration
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Configure automatic product synchronization
                  </CardDescription>
                </div>
                {autoSyncSaveStatus === "saving" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Save className="w-4 h-4 animate-pulse" />
                    <span>Saving...</span>
                  </div>
                )}
                {autoSyncSaveStatus === "saved" && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Check className="w-4 h-4" />
                    <span>Saved</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="autoSync" className="text-sm font-medium">
                      Enable Auto-Sync
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically sync products at regular intervals
                    </p>
                  </div>
                  <Switch
                    id="autoSync"
                    checked={autoSyncEnabled}
                    onCheckedChange={setAutoSyncEnabled}
                  />
                </div>

                <div>
                  <Label htmlFor="syncFrequency" className="text-sm font-medium">
                    Sync Frequency
                  </Label>
                  <Select
                    value={syncFrequency.toString()}
                    onValueChange={(value) => setSyncFrequency(parseInt(value))}
                    disabled={!autoSyncEnabled}
                  >
                    <SelectTrigger id="syncFrequency" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Every hour</SelectItem>
                      <SelectItem value="6">Every 6 hours</SelectItem>
                      <SelectItem value="12">Every 12 hours</SelectItem>
                      <SelectItem value="24">Every 24 hours</SelectItem>
                      <SelectItem value="168">Every week</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    How often to sync products from Shopify
                  </p>
                </div>

                {lastSyncedAt && (
                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Sync:</span>
                      <span className="font-medium">
                        {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-2">
                      <span className="text-muted-foreground">Status:</span>
                      {syncStatus === 'completed' && (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                          <Check className="w-3 h-3 mr-1" />
                          Completed
                        </Badge>
                      )}
                      {syncStatus === 'failed' && (
                        <Badge variant="destructive">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                      {syncStatus === 'syncing' && (
                        <Badge className="bg-blue-100 text-blue-700">
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          In Progress
                        </Badge>
                      )}
                      {syncStatus === 'idle' && (
                        <Badge variant="secondary">Idle</Badge>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleAutoSyncSave}
                  disabled={autoSyncSaveStatus === "saving"}
                  className="w-full"
                >
                  {autoSyncSaveStatus === "saving" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Auto-Sync Settings
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Product Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ShoppingBag className="w-5 h-5 text-purple-600" />
              Product Details
            </DialogTitle>
            <DialogDescription>
              Complete information from your Shopify store (read-only)
            </DialogDescription>
          </DialogHeader>

          {selectedProduct && (
            <div className="space-y-6 mt-4">
              {/* Product Image */}
              {selectedProduct.imageUrl && (
                <div className="flex justify-center bg-gradient-to-br from-gray-50 to-white rounded-lg border p-4">
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="max-w-sm max-h-80 object-contain rounded-lg shadow-md"
                  />
                </div>
              )}

              {/* Product Name */}
              <div>
                <Label className="text-sm font-semibold text-muted-foreground">Product Name</Label>
                <p className="text-lg font-bold mt-1">{selectedProduct.name}</p>
              </div>

              {/* Description */}
              <div>
                <Label className="text-sm font-semibold text-muted-foreground">Description</Label>
                <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap">
                  {selectedProduct.description || "No description available"}
                </p>
              </div>

              {/* Price */}
              <div>
                <Label className="text-sm font-semibold text-muted-foreground">Price</Label>
                <p className="text-2xl font-bold text-purple-600 mt-1">
                  {selectedProduct.price ? `${currencySymbol}${selectedProduct.price}` : "Not set"}
                </p>
              </div>

              {/* Shopify Product ID */}
              {selectedProduct.shopifyProductId && (
                <div>
                  <Label className="text-sm font-semibold text-muted-foreground">Shopify Product ID</Label>
                  <p className="text-sm mt-1 font-mono text-muted-foreground">
                    {selectedProduct.shopifyProductId}
                  </p>
                </div>
              )}

              {/* Metadata */}
              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Source:</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    Shopify
                  </Badge>
                </div>
                {selectedProduct.createdAt && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Added:</span>
                    <span className="font-medium">
                      {formatDistanceToNow(new Date(selectedProduct.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                )}
                {selectedProduct.updatedAt && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Last Updated:</span>
                    <span className="font-medium">
                      {formatDistanceToNow(new Date(selectedProduct.updatedAt), { addSuffix: true })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={(open) => {
        setDisconnectDialogOpen(open);
        if (!open) setDeleteProductsOnDisconnect(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Shopify Integration</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>Are you sure you want to disconnect your Shopify store? This will:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Remove your store URL and access token</li>
                  <li>Stop automatic product syncing</li>
                </ul>
                <p className="mt-3 text-sm">You can reconnect anytime by adding your credentials again.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-start space-x-3 py-4 px-1">
            <Checkbox 
              id="deleteProducts"
              checked={deleteProductsOnDisconnect}
              onCheckedChange={(checked) => setDeleteProductsOnDisconnect(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="deleteProducts"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Also delete all Shopify products ({shopifyProducts.length} products)
              </label>
              <p className="text-xs text-muted-foreground">
                This will permanently remove all products imported from Shopify
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectShopifyMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectShopifyMutation.mutate(deleteProductsOnDisconnect)}
              disabled={disconnectShopifyMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {disconnectShopifyMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
