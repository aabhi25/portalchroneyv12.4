import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Cloud, CloudOff, RefreshCw, CheckCircle, XCircle, Loader2, AlertCircle, StopCircle } from "lucide-react";

interface SyncProgress {
  status: 'idle' | 'uploading' | 'syncing' | 'analyzing' | 'indexing' | 'completed' | 'failed';
  phase?: 'upload' | 'analyze' | 'index' | 'done';
  currentProduct: number;
  totalProducts: number;
  successCount: number;
  failedCount: number;
  currentProductName?: string;
  error?: string;
  analyzeOperationName?: string;
  indexOperationName?: string;
  indexOperationType?: 'create_index' | 'create_endpoint' | 'deploy_index' | 'update_index';
  failedPhase?: 'upload' | 'analyze' | 'index';
  startedAt?: string;
}

interface SyncStatus {
  totalProducts: number;
  syncedProducts: number;
  unsyncedProducts: number;
  isSyncing: boolean;
  persistedProgress?: SyncProgress | null;
}

interface WidgetSettings {
  visualSearchModel?: 'google_vision_warehouse' | 'google_product_search';
  googleVisionWarehouseCorpusId?: string;
}

const SYNC_CONFIG = {
  google_vision_warehouse: {
    title: 'Vista Image Sync',
    description: "Sync products for visual search with Vista AI",
    icon: 'blue',
    gradient: 'from-blue-500 to-indigo-600',
    buttonGradient: 'from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700',
    bgGradient: 'from-blue-50/50 to-indigo-50/50 dark:from-blue-900/20 dark:to-indigo-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
};

interface Operation {
  name: string;
  done: boolean;
  error?: string;
  createTime?: string;
  updateTime?: string;
}

interface OperationsResponse {
  operations: Operation[];
  runningCount: number;
  configured: boolean;
}

export default function VisionWarehouseSync() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const { data: widgetSettings } = useQuery<WidgetSettings>({
    queryKey: ['/api/widget-settings'],
    queryFn: async () => {
      const response = await fetch('/api/widget-settings', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch settings');
      return response.json();
    }
  });

  const isGoogleModel = widgetSettings?.visualSearchModel === 'google_vision_warehouse';
  const currentModel = widgetSettings?.visualSearchModel;
  const config = currentModel === 'google_vision_warehouse' 
    ? SYNC_CONFIG[currentModel] 
    : null;

  const { data: syncStatus, refetch: refetchStatus } = useQuery<SyncStatus>({
    queryKey: ['/api/vision-warehouse/sync-status'],
    queryFn: async () => {
      const response = await fetch('/api/vision-warehouse/sync-status', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch sync status');
      return response.json();
    },
    enabled: widgetSettings?.visualSearchModel === 'google_vision_warehouse',
    refetchInterval: isSyncing ? 5000 : 10000,
  });

  const { data: operationsData, refetch: refetchOperations } = useQuery<OperationsResponse>({
    queryKey: ['/api/vision-warehouse/operations'],
    queryFn: async () => {
      const response = await fetch('/api/vision-warehouse/operations', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch operations');
      return response.json();
    },
    enabled: widgetSettings?.visualSearchModel === 'google_vision_warehouse',
    refetchInterval: isSyncing ? 5000 : 15000,
  });

  const cancelOperation = useCallback(async (operationName: string) => {
    if (!operationName) return;

    setIsCancelling(true);
    try {
      const response = await fetch('/api/vision-warehouse/cancel-operation', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operationName }),
      });
      
      if (response.ok) {
        toast({
          title: "Operation Cancelled",
          description: "The operation has been cancelled.",
        });
        setIsSyncing(false);
        setProgress(null);
        refetchStatus();
        refetchOperations();
      } else {
        const data = await response.json();
        toast({
          title: "Cancel Failed",
          description: data.error || "Failed to cancel operation",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Cancel Failed",
        description: error.message || "Failed to cancel operation",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  }, [toast, refetchStatus, refetchOperations]);

  useEffect(() => {
    if (syncStatus?.persistedProgress) {
      const persistedStatus = syncStatus.persistedProgress.status;
      const isActiveSync = persistedStatus === 'uploading' || persistedStatus === 'syncing' || 
                           persistedStatus === 'analyzing' || persistedStatus === 'indexing';
      
      if (isActiveSync) {
        setProgress(syncStatus.persistedProgress);
        if (!isSyncing) {
          setIsSyncing(true);
        }
      } else if (persistedStatus === 'failed') {
        // Set progress for failed status so we can show cancel button for operation names
        setProgress(syncStatus.persistedProgress);
        if (isSyncing) {
          setIsSyncing(false);
        }
      } else if (persistedStatus === 'completed') {
        if (isSyncing) {
          setIsSyncing(false);
        }
      }
    } else if (syncStatus?.isSyncing && !isSyncing) {
      setIsSyncing(true);
      setProgress({
        status: 'syncing',
        currentProduct: 0,
        totalProducts: syncStatus.unsyncedProducts || 0,
        successCount: syncStatus.syncedProducts || 0,
        failedCount: 0,
      });
    } else if (syncStatus && !syncStatus.isSyncing && isSyncing && !progress) {
      setIsSyncing(false);
    }
  }, [syncStatus]);

  const startSync = useCallback(async () => {
    setIsSyncing(true);
    setProgress({
      status: 'syncing',
      currentProduct: 0,
      totalProducts: syncStatus?.unsyncedProducts || 0,
      successCount: 0,
      failedCount: 0,
    });

    try {
      const eventSource = new EventSource('/api/vision-warehouse/sync-progress');
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProgress(data);
        
        if (data.status === 'completed' || data.status === 'failed') {
          eventSource.close();
          setIsSyncing(false);
          refetchStatus();
          queryClient.invalidateQueries({ queryKey: ['/api/products'] });
          
          if (data.status === 'completed') {
            toast({
              title: "Sync Complete",
              description: `Successfully synced ${data.successCount} products${data.failedCount > 0 ? `, ${data.failedCount} failed` : ''}.`,
            });
          } else {
            toast({
              title: "Sync Failed",
              description: data.error || "An error occurred during sync.",
              variant: "destructive",
            });
          }
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsSyncing(false);
        setProgress(prev => prev ? { ...prev, status: 'failed', error: 'Connection lost' } : null);
        toast({
          title: "Sync Error",
          description: "Lost connection to server. Please try again.",
          variant: "destructive",
        });
      };
    } catch (error: any) {
      setIsSyncing(false);
      toast({
        title: "Sync Error",
        description: error.message || "Failed to start sync.",
        variant: "destructive",
      });
    }
  }, [syncStatus, toast, refetchStatus, queryClient]);

  // Only show for Google models (Vision Warehouse or Product Search)
  if (!isGoogleModel) {
    return null;
  }

  // For Vision Warehouse, require corpus ID to be configured
  if (currentModel === 'google_vision_warehouse' && !widgetSettings?.googleVisionWarehouseCorpusId) {
    return (
      <Card className="mb-6 border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            Google Vision Warehouse Not Configured
          </CardTitle>
          <CardDescription>
            Please configure your Vision Warehouse Corpus ID in Visual Search Settings before syncing products.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const syncPercentage = syncStatus?.totalProducts 
    ? Math.round((syncStatus.syncedProducts / syncStatus.totalProducts) * 100) 
    : 0;

  const progressPercentage = progress?.totalProducts 
    ? Math.round((progress.currentProduct / progress.totalProducts) * 100) 
    : 0;

  // Disable sync buttons when there's an active sync operation (persisted or in-memory)
  const persistedPhase = syncStatus?.persistedProgress?.status;
  const isSyncActive = isSyncing || 
    persistedPhase === 'uploading' || 
    persistedPhase === 'syncing' || 
    persistedPhase === 'analyzing' || 
    persistedPhase === 'indexing';

  if (!config) {
    if (widgetSettings?.visualSearchModel === 'google_product_search') {
      return (
        <Card className="mb-6 border-amber-200 bg-gradient-to-r from-amber-50/50 to-orange-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
                <Cloud className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-base">Visual Search Migration Required</CardTitle>
                <CardDescription className="text-sm">
                  Google Product Search has been deprecated. Please switch to Google Vision Warehouse.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="p-3 bg-white/50 rounded-lg border text-sm text-muted-foreground">
              Go to <strong>SuperAdmin → API Keys</strong> and select "Google Vision Warehouse" as your visual search engine to continue using visual product search.
            </div>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  return (
    <Card className={`mb-6 ${config.borderColor} bg-gradient-to-r ${config.bgGradient}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-gradient-to-br ${config.gradient}`}>
              <Cloud className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">{config.title}</CardTitle>
              <CardDescription className="text-sm">
                {config.description}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isSyncing && syncStatus && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {syncStatus.syncedProducts} / {syncStatus.totalProducts} synced
                </Badge>
                {syncStatus.unsyncedProducts > 0 ? (
                  <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-200">
                    {syncStatus.unsyncedProducts} pending
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    All synced
                  </Badge>
                )}
              </div>
            )}
            {syncStatus?.unsyncedProducts === 0 ? (
              <Button
                onClick={async () => {
                  try {
                    await fetch('/api/vision-warehouse/reset-sync', {
                      method: 'POST',
                      credentials: 'include',
                    });
                    refetchStatus();
                    toast({
                      title: "Sync Reset",
                      description: "All products marked for re-sync. Click Sync to start.",
                    });
                  } catch (e) {
                    toast({
                      title: "Error",
                      description: "Failed to reset sync status.",
                      variant: "destructive",
                    });
                  }
                }}
                disabled={isSyncActive}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Resync All
              </Button>
            ) : (
              <Button
                onClick={startSync}
                disabled={isSyncActive}
                size="sm"
                className={`bg-gradient-to-r ${config.buttonGradient}`}
              >
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
            )}
          </div>
        </div>
      </CardHeader>
      
      {(isSyncing || progress?.status === 'failed') && progress && (
        <CardContent className="pt-0 pb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {progress.status === 'failed' ? (
                  <span className="text-red-600 flex items-center gap-1">
                    <XCircle className="w-4 h-4" />
                    Failed{progress.failedPhase ? ` at ${progress.failedPhase} phase` : ''}: {progress.error || 'Unknown error'}
                  </span>
                ) : progress.phase === 'analyze' || progress.status === 'analyzing' ? (
                  'Analyzing images...'
                ) : (progress.phase === 'index' || progress.status === 'indexing') ? (
                  progress.indexOperationType === 'create_index' ? 'Building search index...' :
                  progress.indexOperationType === 'create_endpoint' ? 'Creating search endpoint...' :
                  progress.indexOperationType === 'deploy_index' ? 'Deploying search index...' :
                  progress.indexOperationType === 'update_index' ? 'Updating search index...' :
                  'Building search index...'
                ) : progress.currentProductName ? (
                  `Uploading: ${progress.currentProductName.substring(0, 40)}${progress.currentProductName.length > 40 ? '...' : ''}`
                ) : (
                  'Preparing...'
                )}
              </span>
              {progress.phase === 'upload' && (
                <span className="font-medium">
                  {progress.currentProduct} / {progress.totalProducts}
                </span>
              )}
            </div>
            {progress.phase === 'upload' && (
              <Progress value={progressPercentage} className="h-2" />
            )}
            {(progress.phase === 'analyze' || progress.phase === 'index' ||
              progress.status === 'analyzing' || progress.status === 'indexing') && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>This may take a few minutes...</span>
              </div>
            )}
            {isSyncing && (
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={isCancelling}
                  onClick={async () => {
                    setIsCancelling(true);
                    try {
                      // First try to cancel any running operation
                      const operationName = progress?.phase === 'analyze' 
                        ? progress.analyzeOperationName 
                        : progress?.indexOperationName;
                      
                      if (operationName) {
                        await fetch('/api/vision-warehouse/cancel-operation', {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ operationName }),
                        });
                      }
                      
                      // Always force-clear local state
                      const response = await fetch('/api/vision-warehouse/force-cancel', {
                        method: 'POST',
                        credentials: 'include',
                      });
                      
                      if (response.ok) {
                        toast({
                          title: "Sync Cancelled",
                          description: "The sync has been cancelled and reset.",
                        });
                        setIsSyncing(false);
                        setProgress(null);
                        refetchStatus();
                        refetchOperations();
                      } else {
                        const data = await response.json();
                        throw new Error(data.error || 'Failed to cancel');
                      }
                    } catch (error: any) {
                      toast({
                        title: "Cancel Failed",
                        description: error.message || "Failed to cancel sync",
                        variant: "destructive",
                      });
                    } finally {
                      setIsCancelling(false);
                    }
                  }}
                >
                  {isCancelling ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <StopCircle className="w-3 h-3 mr-1" />
                  )}
                  Cancel
                </Button>
              </div>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-green-600" />
                {progress.successCount} uploaded
              </span>
              {progress.failedCount > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-red-600" />
                  {progress.failedCount} failed
                </span>
              )}
            </div>
            {progress.status === 'failed' && (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  onClick={async () => {
                    try {
                      await fetch('/api/vision-warehouse/clear-sync-flag', {
                        method: 'POST',
                        credentials: 'include',
                      });
                    } catch (e) {
                    }
                    setProgress(null);
                    startSync();
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Sync
                </Button>
                {(progress.analyzeOperationName || progress.indexOperationName) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    disabled={isCancelling}
                    onClick={() => {
                      const operationName = progress.analyzeOperationName || progress.indexOperationName;
                      if (operationName) {
                        cancelOperation(operationName);
                      }
                    }}
                  >
                    {isCancelling ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <StopCircle className="w-4 h-4 mr-2" />
                    )}
                    Cancel Running Operation
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
