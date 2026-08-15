import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Product, type InsertProduct, type Category, type Tag } from "@shared/schema";
import { ImportJobMonitor } from "@/components/ImportJobMonitor";

interface ProductWithMeta extends Product {
  categories?: Category[];
  tags?: Tag[];
}
import { Button } from "@/components/ui/button";
import CategoryManager from "@/components/admin/CategoryManager";
import TagManager from "@/components/admin/TagManager";
import VisionWarehouseSync from "@/components/admin/VisionWarehouseSync";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Package, Upload, Check, ShoppingBag, X, FolderTree, Tags as TagsIcon, FileSpreadsheet, ChevronDown, Loader2, CheckSquare, Square, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  currency: string;
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

export default function AdminProducts() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("products");
  
  const [showForm, setShowForm] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageInputMethod, setImageInputMethod] = useState<"upload" | "url">("upload");
  const [formData, setFormData] = useState<Partial<InsertProduct>>({
    name: "",
    description: "",
    price: "0",
    imageUrl: "",
  });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [relationshipsDialogOpen, setRelationshipsDialogOpen] = useState(false);
  const [productRelationships, setProductRelationships] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  
  // Infinite scroll state
  const PRODUCTS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Initial products fetch with pagination
  const { data: productsData, isLoading, refetch: refetchProducts } = useQuery<{
    products: Product[];
    pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
  }>({
    queryKey: ["/api/products", "paginated", currentPage],
    queryFn: async () => {
      const response = await apiRequest<{
        products: Product[];
        pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
      }>("GET", `/api/products?page=${currentPage}&limit=${PRODUCTS_PER_PAGE}&source=manual`);
      return response;
    },
  });

  // Update allProducts when new data arrives
  useEffect(() => {
    if (productsData?.products) {
      if (currentPage === 1) {
        setAllProducts(productsData.products);
      } else {
        setAllProducts(prev => {
          // Avoid duplicates
          const existingIds = new Set(prev.map(p => p.id));
          const newProducts = productsData.products.filter(p => !existingIds.has(p.id));
          return [...prev, ...newProducts];
        });
      }
      setHasMore(productsData.pagination.hasMore);
      setIsLoadingMore(false);
    }
  }, [productsData, currentPage]);

  // Reset pagination when products are modified
  const resetPagination = useCallback(() => {
    // Remove all paginated queries to prevent stale data
    queryClient.removeQueries({ queryKey: ["/api/products", "paginated"] });
    setCurrentPage(1);
    setAllProducts([]);
    setHasMore(true);
    setIsLoadingMore(false);
  }, []);

  // Infinite scroll observer
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoading && !isLoadingMore) {
            setIsLoadingMore(true);
            setCurrentPage(prev => prev + 1);
          }
        },
        { threshold: 0.1, rootMargin: '0px 0px 200px 0px' }
      );
      observerRef.current.observe(node);
    }
  }, [hasMore, isLoading, isLoadingMore]);

  // Filter to only show manually added products (already filtered by API, but keep for safety)
  const manualProducts = useMemo(() => {
    return allProducts.filter(product => product.source !== 'shopify');
  }, [allProducts]);

  // Use useQueries to fetch categories and tags for all products in parallel
  const productMetaQueries = useQueries({
    queries: manualProducts.map((product) => ({
      queryKey: [`/api/products/${product.id}/meta`],
      queryFn: async () => {
        const [categories, tags] = await Promise.all([
          apiRequest<Category[]>("GET", `/api/products/${product.id}/categories`),
          apiRequest<Tag[]>("GET", `/api/products/${product.id}/tags`)
        ]);
        return { productId: product.id, categories, tags };
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    })),
  });

  // Combine products with their metadata (manual products only)
  const productsWithMeta: ProductWithMeta[] = useMemo(() => {
    // Check if all queries have finished loading
    const allLoaded = productMetaQueries.every(q => q.isSuccess || q.isError);
    
    if (!allLoaded && productMetaQueries.length > 0) {
      // Still loading, return manual products without metadata
      return manualProducts.map(p => ({ ...p, categories: [], tags: [] }));
    }
    
    return manualProducts.map((product, index) => {
      const meta = productMetaQueries[index]?.data;
      return {
        ...product,
        categories: meta?.categories || [],
        tags: meta?.tags || [],
      };
    });
  }, [manualProducts, productMetaQueries.map(q => q.dataUpdatedAt).join(',')]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ["/api/tags"],
  });

  const { data: widgetSettings } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  const currencySymbol = widgetSettings ? CURRENCY_SYMBOLS[widgetSettings.currency] || "$" : "$";

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      resetPagination();
      setDeleteDialogOpen(false);
      setProductToDelete(null);
      toast({
        title: "Product deleted",
        description: "Product has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete product",
        variant: "destructive",
      });
    },
  });

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const selectAllProducts = () => {
    setSelectedProductIds(new Set(manualProducts.map(p => p.id)));
  };

  const deselectAllProducts = () => {
    setSelectedProductIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedProductIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.size === 0) return;
    
    setIsBulkDeleting(true);
    try {
      const result = await apiRequest<{ success: boolean; deletedCount: number; errors?: string[] }>(
        "POST", 
        "/api/products/bulk-delete",
        { productIds: Array.from(selectedProductIds) }
      );
      
      resetPagination();
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
      
      toast({
        title: "Products deleted",
        description: `Successfully deleted ${result.deletedCount} product${result.deletedCount !== 1 ? 's' : ''}.`,
      });
      
      if (result.errors && result.errors.length > 0) {
        console.error("Some products failed to delete:", result.errors);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete products",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      price: "",
      imageUrl: "",
    });
    setEditingProduct(null);
    setSelectedCategoryIds([]);
    setSelectedTagIds([]);
  };

  const handleSubmit = async () => {
    // Prevent double submission
    if (isSubmitting) return;
    
    // Convert empty price string to null for database
    const submitData = {
      ...formData,
      price: formData.price === "" ? null : formData.price
    };
    
    setIsSubmitting(true);
    try {
      let productId: string;
      
      if (editingProduct) {
        await apiRequest("PATCH", `/api/products/${editingProduct.id}`, submitData);
        productId = editingProduct.id;
      } else {
        const result = await apiRequest<Product>("POST", "/api/products", submitData);
        productId = result.id;
      }

      // Update category associations
      await apiRequest("PUT", `/api/products/${productId}/categories`, { categoryIds: selectedCategoryIds });

      // Update tag associations
      await apiRequest("PUT", `/api/products/${productId}/tags`, { tagIds: selectedTagIds });

      // Invalidate product list and all product metadata queries
      resetPagination();
      allProducts.forEach(p => {
        queryClient.invalidateQueries({ queryKey: [`/api/products/${p.id}/meta`] });
      });
      
      setShowForm(false);
      resetForm();
      toast({
        title: editingProduct ? "Product updated" : "Product created",
        description: `Product has been ${editingProduct ? "updated" : "created"} successfully.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save product",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description,
      price: product.price || "",
      imageUrl: product.imageUrl || "",
    });

    // Fetch existing category and tag associations
    try {
      const productCategories = await apiRequest<Category[]>("GET", `/api/products/${product.id}/categories`);
      const productTags = await apiRequest<Tag[]>("GET", `/api/products/${product.id}/tags`);
      
      setSelectedCategoryIds(productCategories.map(pc => pc.id));
      setSelectedTagIds(productTags.map(pt => pt.id));
    } catch (error) {
      console.error("Failed to load product associations:", error);
      setSelectedCategoryIds([]);
      setSelectedTagIds([]);
    }

    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    setProductToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (productToDelete) {
      deleteMutation.mutate(productToDelete);
    }
  };

  const handleAddNew = () => {
    resetForm();
    setShowForm(true);
  };

  const handleView = (product: Product) => {
    setViewingProduct(product);
    setViewDialogOpen(true);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      setUploadingImage(true);

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/upload-image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      setFormData(prev => ({ ...prev, imageUrl: data.imageUrl }));

      toast({
        title: "Image uploaded",
        description: "Product image uploaded successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploadingImage(false);
      // Reset the file input
      event.target.value = '';
    }
  };

  const handleRemoveImage = async () => {
    try {
      if (!formData.imageUrl) return;

      const response = await fetch('/api/delete-image', {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageUrl: formData.imageUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete image');
      }

      setFormData(prev => ({ ...prev, imageUrl: '' }));

      toast({
        title: "Image removed",
        description: "Product image has been removed.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove image",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <ImportJobMonitor />
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <Package className="w-6 h-6 text-purple-600" />
            Product Catalog Management
          </CardTitle>
          <CardDescription>Manage your products, categories, and tags</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
              <TabsTrigger value="products" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
                <ShoppingBag className="w-4 h-4 mr-2" />
                Products
                {(productsData?.pagination?.total ?? allProducts.length) > 0 && (
                  <span className="ml-2 text-xs font-semibold text-purple-600 data-[state=active]:text-purple-900">({productsData?.pagination?.total ?? allProducts.length})</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="categories" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
                <FolderTree className="w-4 h-4 mr-2" />
                Categories
              </TabsTrigger>
              <TabsTrigger value="tags" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
                <TagsIcon className="w-4 h-4 mr-2" />
                Tags
              </TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="mt-6">
              <VisionWarehouseSync />
              {!showForm && (
                <div className="flex justify-between items-center gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    {selectionMode ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={exitSelectionMode}
                          className="border-gray-300"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Cancel
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={selectedProductIds.size === manualProducts.length ? deselectAllProducts : selectAllProducts}
                          className="border-purple-200"
                        >
                          {selectedProductIds.size === manualProducts.length ? (
                            <>
                              <Square className="h-4 w-4 mr-2" />
                              Deselect All
                            </>
                          ) : (
                            <>
                              <CheckSquare className="h-4 w-4 mr-2" />
                              Select All
                            </>
                          )}
                        </Button>
                        {selectedProductIds.size > 0 && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setBulkDeleteDialogOpen(true)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete {selectedProductIds.size} Selected
                          </Button>
                        )}
                      </>
                    ) : (
                      manualProducts.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectionMode(true)}
                          className="border-purple-200"
                        >
                          <CheckSquare className="h-4 w-4 mr-2" />
                          Select
                        </Button>
                      )
                    )}
                  </div>
                  <div className="flex gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="outline"
                          disabled={isImporting}
                          className="border-purple-200 dark:border-purple-800"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {isImporting ? "Importing..." : "Import"}
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            window.location.href = '/products/import-excel';
                          }}
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Import from Excel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button onClick={handleAddNew} data-testid="button-add-product" className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Product
                    </Button>
                  </div>
                </div>
              )}

              <Dialog open={showForm} onOpenChange={setShowForm}>
                <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                  <DialogHeader className="relative bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 shrink-0">
                    <div className="flex items-center justify-between">
                      <DialogTitle className="text-lg font-medium flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                          <Package className="w-4 h-4" />
                        </div>
                        {editingProduct ? "Edit Product" : "Add New Product"}
                      </DialogTitle>
                      <span className="px-2.5 py-1 text-[10px] font-medium bg-white/20 rounded-full">
                        {editingProduct ? "Editing" : "New"}
                      </span>
                    </div>
                    <DialogDescription className="sr-only">
                      {editingProduct ? "Update your product details" : "Create a new product listing"}
                    </DialogDescription>
                  </DialogHeader>

                  <ScrollArea className="flex-1 max-h-[65vh]">
                    <div className="p-6">
                      <div className="grid md:grid-cols-[280px,1fr] gap-8">
                        <div className="space-y-4">
                          <div className="relative aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 border-2 border-dashed border-gray-200 dark:border-gray-700 group">
                            {formData.imageUrl ? (
                              <>
                                <img 
                                  src={formData.imageUrl} 
                                  alt="Product preview"
                                  className="w-full h-full object-contain p-4"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                    if (fallback) fallback.style.display = 'flex';
                                  }}
                                />
                                <div 
                                  className="w-full h-full flex items-center justify-center"
                                  style={{ display: 'none' }}
                                >
                                  <div className="text-center p-4">
                                    <ShoppingBag className="w-12 h-12 text-purple-300 mx-auto mb-2" />
                                    <p className="text-xs text-muted-foreground">Image failed to load</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleRemoveImage}
                                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/50 dark:to-blue-900/50 flex items-center justify-center mb-4">
                                  <Upload className="w-7 h-7 text-purple-500" />
                                </div>
                                <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Product Image</p>
                                <p className="text-xs text-muted-foreground">Upload or enter URL below</p>
                              </div>
                            )}
                          </div>

                          {!formData.imageUrl && (
                            <div className="space-y-3">
                              <Input
                                type="file"
                                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                                onChange={handleImageUpload}
                                disabled={uploadingImage}
                                className="cursor-pointer text-sm border-2 border-gray-300 dark:border-gray-600 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-purple-600 file:text-white hover:file:bg-purple-700"
                              />
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
                                <span className="text-xs text-muted-foreground font-medium">OR</span>
                                <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
                              </div>
                              <Input
                                type="url"
                                placeholder="Paste image URL here"
                                value={formData.imageUrl || ""}
                                onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                                className="text-sm border-2 border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500"
                              />
                            </div>
                          )}

                          {uploadingImage && (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-purple-600">
                              <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                              <span>Uploading...</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-6">
                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-medium flex items-center gap-2">
                              Product Name
                              <span className="text-[10px] text-red-400 font-normal">Required</span>
                            </Label>
                            <Input
                              id="name"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              placeholder="e.g., Diamond Solitaire Ring"
                              data-testid="input-product-name"
                              className="h-11 text-sm border-2 border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="description" className="text-sm font-medium flex items-center gap-2">
                              Description
                              <span className="text-[10px] text-red-400 font-normal">Required</span>
                            </Label>
                            <Textarea
                              id="description"
                              value={formData.description}
                              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                              placeholder="Describe your product's features, materials, and unique qualities..."
                              rows={4}
                              data-testid="input-product-description"
                              className="text-sm border-2 border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500 resize-none"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="price" className="text-sm font-medium">
                              Price
                              <span className="text-[10px] text-muted-foreground font-normal ml-2">Optional</span>
                            </Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{currencySymbol}</span>
                              <Input
                                id="price"
                                type="number"
                                step="0.01"
                                value={formData.price || ""}
                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                placeholder="0.00"
                                data-testid="input-product-price"
                                className="h-11 text-sm pl-8 border-2 border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500"
                              />
                            </div>
                          </div>

                          {(categories.length > 0 || tags.length > 0) && (
                            <div className={`grid gap-4 ${categories.length > 0 && tags.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                              {categories.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium">
                                      Categories
                                      <span className="text-[10px] text-muted-foreground font-normal ml-2">Optional</span>
                                    </Label>
                                    {selectedCategoryIds.length > 0 && (
                                      <span className="text-[10px] text-purple-600 font-medium">{selectedCategoryIds.length} selected</span>
                                    )}
                                  </div>
                                  <div className="max-h-[100px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                                    <div className="flex flex-wrap gap-1.5">
                                      {categories.map((category) => {
                                        const isSelected = selectedCategoryIds.includes(category.id);
                                        return (
                                          <button
                                            key={category.id}
                                            type="button"
                                            onClick={() => {
                                              if (isSelected) {
                                                setSelectedCategoryIds(selectedCategoryIds.filter(id => id !== category.id));
                                              } else {
                                                setSelectedCategoryIds([...selectedCategoryIds, category.id]);
                                              }
                                            }}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                                              isSelected
                                                ? "bg-purple-600 text-white shadow-sm"
                                                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-950"
                                            }`}
                                          >
                                            <FolderTree className="w-2.5 h-2.5" />
                                            {category.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {tags.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium">
                                      Tags
                                      <span className="text-[10px] text-muted-foreground font-normal ml-2">Optional</span>
                                    </Label>
                                    {selectedTagIds.length > 0 && (
                                      <span className="text-[10px] text-purple-600 font-medium">{selectedTagIds.length} selected</span>
                                    )}
                                  </div>
                                  <div className="max-h-[100px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                                    <div className="flex flex-wrap gap-1.5">
                                      {tags.map((tag) => {
                                        const isSelected = selectedTagIds.includes(tag.id);
                                        return (
                                          <button
                                            key={tag.id}
                                            type="button"
                                            onClick={() => {
                                              if (isSelected) {
                                                setSelectedTagIds(selectedTagIds.filter(id => id !== tag.id));
                                              } else {
                                                setSelectedTagIds([...selectedTagIds, tag.id]);
                                              }
                                            }}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                                              isSelected
                                                ? "shadow-sm"
                                                : "opacity-70 hover:opacity-100"
                                            }`}
                                            style={{
                                              backgroundColor: isSelected ? (tag.color || '#8B5CF6') : `${tag.color || '#8B5CF6'}15`,
                                              color: isSelected ? 'white' : (tag.color || '#8B5CF6'),
                                            }}
                                          >
                                            <span 
                                              className="w-1.5 h-1.5 rounded-full"
                                              style={{ backgroundColor: isSelected ? 'white' : (tag.color || '#8B5CF6') }}
                                            />
                                            {tag.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>

                  <DialogFooter className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 shrink-0">
                    <div className="flex items-center justify-end gap-3 w-full">
                      <Button 
                        variant="ghost" 
                        onClick={() => {
                          setShowForm(false);
                          resetForm();
                        }}
                        className="h-9"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSubmit}
                        disabled={!formData.name || !formData.description || isSubmitting}
                        data-testid="button-submit-product"
                        className="h-9 px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                      >
                        {isSubmitting ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                            Saving...
                          </>
                        ) : editingProduct ? "Update Product" : "Create Product"}
                      </Button>
                    </div>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
          {isLoading && currentPage === 1 && allProducts.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-sm text-muted-foreground">Loading products...</p>
              </div>
            </div>
          ) : !isLoading && manualProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 flex items-center justify-center mb-4">
                <Package className="w-10 h-10 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Add your first product
              </h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm text-center">
                Get started by creating your first product. You can add images, descriptions, prices, and more.
              </p>
              <Button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {productsWithMeta.map((product) => (
                <div 
                  key={product.id}
                  className={`group relative bg-card rounded-2xl overflow-hidden border shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer ${
                    selectionMode && selectedProductIds.has(product.id) 
                      ? 'border-purple-500 ring-2 ring-purple-500/50' 
                      : 'border-border/50 hover:border-purple-200 dark:hover:border-purple-800'
                  }`}
                  onClick={() => {
                    if (selectionMode) {
                      toggleProductSelection(product.id);
                    } else {
                      handleView(product);
                    }
                  }}
                >
                  <div className="aspect-square relative overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
                    {product.imageUrl ? (
                      <>
                        <img 
                          src={product.imageUrl} 
                          alt={product.name}
                          className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <div 
                          className="w-full h-full flex items-center justify-center"
                          style={{ display: 'none' }}
                        >
                          <div className="text-center">
                            <ShoppingBag className="w-16 h-16 text-purple-300 dark:text-purple-700 mx-auto" />
                            <p className="text-xs text-muted-foreground mt-2">Image unavailable</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/50 dark:to-blue-900/50 flex items-center justify-center mx-auto">
                            <ShoppingBag className="w-10 h-10 text-purple-400 dark:text-purple-500" />
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">No image</p>
                        </div>
                      </div>
                    )}
                    
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      {selectionMode ? (
                        <div 
                          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                            selectedProductIds.has(product.id) 
                              ? 'bg-purple-600 text-white' 
                              : 'bg-white/90 dark:bg-gray-800/90 border border-gray-300 dark:border-gray-600'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleProductSelection(product.id);
                          }}
                        >
                          {selectedProductIds.has(product.id) && <Check className="w-4 h-4" />}
                        </div>
                      ) : (
                        <>
                          {product.source === 'shopify' && (
                            <Badge className="text-[10px] bg-emerald-500/90 hover:bg-emerald-500 text-white border-0 shadow-sm backdrop-blur-sm">
                              <ShoppingBag className="w-2.5 h-2.5 mr-1" />
                              Shopify
                            </Badge>
                          )}
                          {product.source === 'manual' && (
                            <Badge className="text-[10px] bg-gray-500/80 hover:bg-gray-500 text-white border-0 shadow-sm backdrop-blur-sm">
                              Manual
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    
                    {!selectionMode && (
                      <div className="absolute top-3 right-3 flex gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleEdit(product)}
                          data-testid={`button-edit-${product.id}`}
                          className="h-8 w-8 p-0 rounded-full shadow-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-800"
                          disabled={product.isEditable === 'false' || product.source === 'shopify'}
                          title={product.source === 'shopify' ? 'Shopify products are read-only' : 'Edit product'}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDelete(product.id)}
                          data-testid={`button-delete-${product.id}`}
                          className="h-8 w-8 p-0 rounded-full shadow-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4 space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                        {product.name}
                      </h3>
                    </div>
                    
                    {product.categories && product.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {product.categories.slice(0, 2).map((category) => (
                          <Badge 
                            key={category.id} 
                            variant="outline" 
                            className="text-[10px] px-2 py-0.5 bg-purple-50/50 text-purple-600 border-purple-200/50 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800/50"
                          >
                            {category.name}
                          </Badge>
                        ))}
                        {product.categories.length > 2 && (
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                            +{product.categories.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    {product.tags && product.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {product.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: tag.color ? `${tag.color}15` : 'rgba(128,128,128,0.1)',
                              color: tag.color || 'inherit',
                            }}
                          >
                            <span 
                              className="w-1.5 h-1.5 rounded-full mr-1"
                              style={{ backgroundColor: tag.color || '#888' }}
                            />
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    <div className="pt-2 border-t border-border/50">
                      <p className="font-bold text-lg bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                        {product.price ? `${currencySymbol}${parseFloat(product.price).toLocaleString()}` : (
                          <span className="text-sm font-normal text-muted-foreground italic">Price on request</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Infinite scroll trigger */}
          {hasMore && manualProducts.length > 0 && (
            <div 
              ref={loadMoreRef}
              className="flex items-center justify-center py-8"
            >
              {isLoadingMore && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading more products...</span>
                </div>
              )}
            </div>
          )}
          
          {/* Product count indicator */}
          {productsData?.pagination && manualProducts.length > 0 && (
            <div className="text-center text-sm text-muted-foreground py-2">
              Showing {manualProducts.length} of {productsData.pagination.total} products
            </div>
          )}
            </TabsContent>

            <TabsContent value="categories" className="mt-6">
              <CategoryManager />
            </TabsContent>

            <TabsContent value="tags" className="mt-6">
              <TagManager />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedProductIds.size} Products</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedProductIds.size} selected product{selectedProductIds.size !== 1 ? 's' : ''}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete} 
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedProductIds.size} Products`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Package className="w-5 h-5 text-purple-600" />
              Product Details
            </DialogTitle>
            <DialogDescription>
              Complete information about this product
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[55vh] -mx-6 px-6">
            {viewingProduct && (
              <div className="space-y-6 py-4">
                <div className="flex justify-center">
                  {viewingProduct.imageUrl && viewingProduct.imageUrl.trim() !== "" ? (
                    <>
                      <img 
                        src={viewingProduct.imageUrl} 
                        alt={viewingProduct.name}
                        className="w-48 h-48 object-cover rounded-lg border shadow-sm"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <div className="w-48 h-48 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 rounded-lg border border-purple-200 dark:border-purple-800 items-center justify-center" style={{ display: 'none' }}>
                        <ShoppingBag className="w-20 h-20 text-purple-500" />
                      </div>
                    </>
                  ) : (
                    <div className="w-48 h-48 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 rounded-lg border border-purple-200 dark:border-purple-800 flex items-center justify-center">
                      <ShoppingBag className="w-20 h-20 text-purple-500" />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Product Name</Label>
                  <p className="text-base font-medium leading-relaxed">{viewingProduct.name}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Description</Label>
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">{viewingProduct.description}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Price</Label>
                  <p className="text-base text-muted-foreground">
                    {viewingProduct.price ? `${currencySymbol}${viewingProduct.price}` : "Price available upon inquiry"}
                  </p>
                </div>
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
            <Button 
              onClick={() => {
                if (viewingProduct) {
                  setViewDialogOpen(false);
                  handleEdit(viewingProduct);
                }
              }}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
