import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Cloud, RefreshCw, CheckSquare, Square, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";

interface VisionWarehouseAsset {
  id: string;
  assetId: string;
  productName: string;
  imageUrl: string | null;
  syncedAt: string | null;
}

export default function GooglePhotos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<{ assets: VisionWarehouseAsset[]; total: number }>({
    queryKey: ["/api/vision-warehouse/assets"],
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (productId: string) => {
      return apiRequest("DELETE", `/api/vision-warehouse/assets/${productId}`);
    },
    onSuccess: () => {
      toast({ title: "Asset deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/vision-warehouse/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vision-warehouse/sync-status"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete asset", description: error.message, variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/vision-warehouse/assets");
    },
    onSuccess: (data: any) => {
      toast({ title: "Assets deleted", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/vision-warehouse/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vision-warehouse/sync-status"] });
      setSelectedAssets(new Set());
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete assets", description: error.message, variant: "destructive" });
    },
  });

  const assets = data?.assets || [];
  const isDeleting = deleteAssetMutation.isPending || deleteAllMutation.isPending;

  const toggleAsset = (id: string) => {
    const newSelected = new Set(selectedAssets);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAssets(newSelected);
  };

  const toggleAll = () => {
    if (selectedAssets.size === assets.length) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(assets.map(a => a.id)));
    }
  };

  const deleteSelected = async () => {
    const idsToDelete = Array.from(selectedAssets);
    for (const id of idsToDelete) {
      await deleteAssetMutation.mutateAsync(id);
    }
    setSelectedAssets(new Set());
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="w-6 h-6 text-primary" />
            Google Photos
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage photos synced to Google Vision Warehouse
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {assets.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All ({assets.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete All Photos?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all {assets.length} photos from Google Vision Warehouse. 
                    The products will remain in your catalog but will need to be re-synced for visual search.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteAllMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteAllMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete All"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {selectedAssets.size > 0 && (
        <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedAssets.size} selected</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={isDeleting}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Selected Photos?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove {selectedAssets.size} selected photos from Google Vision Warehouse.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={deleteSelected}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete Selected
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" variant="ghost" onClick={() => setSelectedAssets(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Synced Photos</CardTitle>
              <CardDescription>
                {assets.length} {assets.length === 1 ? 'photo' : 'photos'} synced to Vision Warehouse
              </CardDescription>
            </div>
            {assets.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {selectedAssets.size === assets.length ? (
                  <>
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4 mr-2" />
                    Select All
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Cloud className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No photos synced yet</p>
              <p className="text-sm">Sync your products from the Product Catalog to see them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className={`relative group rounded-lg overflow-hidden border transition-all ${
                    selectedAssets.has(asset.id) ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/50'
                  }`}
                >
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={selectedAssets.has(asset.id)}
                      onCheckedChange={() => toggleAsset(asset.id)}
                      className="bg-white/80 backdrop-blur-sm"
                    />
                  </div>
                  <div className="aspect-square bg-muted">
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt={asset.productName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Cloud className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="p-2 bg-background">
                    <p className="text-sm font-medium truncate" title={asset.productName}>
                      {asset.productName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {asset.syncedAt ? format(new Date(asset.syncedAt), 'MMM d, yyyy h:mm a') : 'Unknown'}
                    </p>
                  </div>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="destructive"
                          className="w-7 h-7"
                          disabled={isDeleting}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Photo?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove "{asset.productName}" from Google Vision Warehouse.
                            The product will remain in your catalog but won't appear in visual search results.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteAssetMutation.mutate(asset.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
