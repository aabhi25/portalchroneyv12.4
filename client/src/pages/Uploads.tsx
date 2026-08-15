import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Trash2, ImageIcon, Clock, Loader2, AlertCircle, Sparkles, Search, CheckSquare, X, Square, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface ProcessedImage {
  label: string;
  dataUrl: string;
}

interface UploadedImage {
  id: string;
  businessAccountId: string;
  imageUrl: string;
  processedImageUrl: string | null;
  processedImages: string | null;
  r2Key: string | null;
  originalFilename: string | null;
  fileSize: number | null;
  source: string;
  createdAt: string;
}

interface PaginatedResponse {
  images: UploadedImage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

const IMAGES_PER_PAGE = 20;

function ImageCarousel({ originalUrl, processedImages, altText }: { originalUrl: string; processedImages: ProcessedImage[]; altText: string }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const totalSlides = 1 + processedImages.length;
  
  const goToSlide = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentSlide(index);
  };
  
  const goNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentSlide((prev) => Math.min(prev + 1, totalSlides - 1));
  };
  
  const goPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  };
  
  return (
    <div className="relative h-full w-full">
      <div 
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        <div className="relative w-full h-full flex-shrink-0">
          <img
            src={originalUrl}
            alt={`${altText} - Original`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute bottom-2 left-2 px-2 py-1 text-[10px] font-medium bg-black/70 text-white rounded-full">
            Original
          </span>
        </div>
        {processedImages.map((processed, idx) => (
          <div key={idx} className="relative w-full h-full flex-shrink-0">
            <img
              src={processed.dataUrl}
              alt={`${altText} - ${processed.label}`}
              className="w-full h-full object-contain bg-[#f5f5f5] dark:bg-[#1a1a1a]"
              loading="lazy"
            />
            <span className="absolute bottom-2 left-2 px-2 py-1 text-[10px] font-medium bg-violet-600 text-white rounded-full">
              {processed.label}
            </span>
          </div>
        ))}
      </div>
      
      {currentSlide > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 dark:bg-black/70 shadow-lg flex items-center justify-center hover:bg-white dark:hover:bg-black transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        </button>
      )}
      
      {currentSlide < totalSlides - 1 && (
        <button
          onClick={goNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 dark:bg-black/70 shadow-lg flex items-center justify-center hover:bg-white dark:hover:bg-black transition-colors"
          aria-label="Next image"
        >
          <ChevronRight className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        </button>
      )}
      
      <div className="absolute bottom-2 right-2 flex gap-1">
        {Array.from({ length: totalSlides }).map((_, idx) => (
          <button
            key={idx}
            onClick={(e) => goToSlide(idx, e)}
            className={`w-2 h-2 rounded-full transition-colors ${
              currentSlide === idx 
                ? (idx === 0 ? 'bg-white' : 'bg-violet-500') 
                : 'bg-white/50'
            }`}
            aria-label={idx === 0 ? 'Original image' : `Processed image ${idx}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function Uploads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<UploadedImage | null>(null);
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  
  // Infinite scroll state
  const [currentPage, setCurrentPage] = useState(1);
  const [allImages, setAllImages] = useState<UploadedImage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleViewSimilar = (image: UploadedImage) => {
    setLocation(`/jewelry-showcase?matchHistory=${image.id}`);
  };

  const { data: imagesData, isLoading, error } = useQuery<PaginatedResponse>({
    queryKey: ['/api/uploaded-images', 'paginated', currentPage],
    queryFn: async () => {
      const response = await fetch(`/api/uploaded-images?page=${currentPage}&limit=${IMAGES_PER_PAGE}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch uploaded images');
      return response.json();
    }
  });

  // Update allImages when new data arrives
  useEffect(() => {
    if (imagesData?.images) {
      if (currentPage === 1) {
        setAllImages(imagesData.images);
      } else {
        setAllImages(prev => {
          const existingIds = new Set(prev.map(img => img.id));
          const newImages = imagesData.images.filter(img => !existingIds.has(img.id));
          return [...prev, ...newImages];
        });
      }
      setHasMore(imagesData.pagination.hasMore);
      setIsLoadingMore(false);
    }
  }, [imagesData, currentPage]);

  // Reset pagination when images are modified
  const resetPagination = useCallback(() => {
    // Remove all paginated queries to prevent stale data
    queryClient.removeQueries({ queryKey: ['/api/uploaded-images', 'paginated'] });
    setCurrentPage(1);
    setAllImages([]);
    setHasMore(true);
    setIsLoadingMore(false);
  }, [queryClient]);

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/uploaded-images/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete image');
      return response.json();
    },
    onSuccess: () => {
      resetPagination();
      toast({
        title: "Image deleted",
        description: "The image has been removed from storage.",
      });
      setDeleteDialogOpen(false);
      setImageToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const response = await fetch('/api/uploaded-images/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete images');
      return response.json();
    },
    onSuccess: (data) => {
      resetPagination();
      toast({
        title: "Images deleted",
        description: `Successfully deleted ${data.deletedCount} images.`,
      });
      setBulkDeleteDialogOpen(false);
      setSelectedImages(new Set());
      setSelectionMode(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Bulk delete failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleDeleteClick = (image: UploadedImage) => {
    setImageToDelete(image);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (imageToDelete) {
      deleteMutation.mutate(imageToDelete.id);
    }
  };

  const toggleImageSelection = (imageId: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  };

  const selectAllImages = () => {
    setSelectedImages(new Set(allImages.map(img => img.id)));
  };

  const deselectAllImages = () => {
    setSelectedImages(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedImages.size > 0) {
      bulkDeleteMutation.mutate(Array.from(selectedImages));
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedImages(new Set());
  };

  if (isLoading && currentPage === 1 && allImages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary/60" />
          <p className="text-sm text-muted-foreground">Loading your gallery...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-6 w-6" />
              <div>
                <p className="font-medium">Failed to load images</p>
                <p className="text-sm text-muted-foreground">Please try refreshing the page</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <ImageIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Match History</h1>
            <p className="text-xs text-muted-foreground">{imagesData?.pagination?.total || allImages.length} images uploaded</p>
          </div>
        </div>
        
        {/* Selection Mode Controls */}
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={exitSelectionMode}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={selectedImages.size === allImages.length ? deselectAllImages : selectAllImages}
              >
                {selectedImages.size === allImages.length ? (
                  <>
                    <Square className="h-4 w-4 mr-1" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <CheckSquare className="h-4 w-4 mr-1" />
                    Select All
                  </>
                )}
              </Button>
              {selectedImages.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete ({selectedImages.size})
                </Button>
              )}
            </>
          ) : (
            allImages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectionMode(true)}
              >
                <CheckSquare className="h-4 w-4 mr-1" />
                Select
              </Button>
            )
          )}
        </div>
      </div>

      {!isLoading && allImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6">
          <div className="relative">
            <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-violet-400/20 to-purple-400/20 rounded-full" />
            <div className="relative p-6 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30">
              <Sparkles className="h-12 w-12 text-violet-500" />
            </div>
          </div>
          <h3 className="mt-6 text-lg font-semibold text-foreground">No images uploaded yet</h3>
          <p className="mt-2 text-center text-muted-foreground max-w-sm">
            Images from visual product search will appear here. Start exploring with image-based search in Vista!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {allImages.map((image, index) => {
            const isSelected = selectedImages.has(image.id);
            return (
              <div 
                key={image.id} 
                className={`group relative bg-card rounded-2xl overflow-hidden border transition-all duration-300 hover:shadow-xl hover:shadow-violet-500/10 ${
                  selectionMode 
                    ? isSelected 
                      ? 'border-violet-500 ring-2 ring-violet-500/30' 
                      : 'border-border/50 hover:border-violet-300 dark:hover:border-violet-700 cursor-pointer'
                    : 'border-border/50 hover:border-violet-300 dark:hover:border-violet-700'
                }`}
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={selectionMode ? () => toggleImageSelection(image.id) : undefined}
              >
                <div className="aspect-square overflow-hidden bg-muted/30">
                  {(() => {
                    let processedImages: ProcessedImage[] = [];
                    if (image.processedImages) {
                      try {
                        processedImages = JSON.parse(image.processedImages);
                      } catch (e) {
                        processedImages = [];
                      }
                    }
                    if (image.processedImageUrl && processedImages.length === 0) {
                      processedImages = [{ label: 'Processed', dataUrl: image.processedImageUrl }];
                    }
                    
                    return processedImages.length > 0 ? (
                      <ImageCarousel 
                        originalUrl={image.imageUrl}
                        processedImages={processedImages}
                        altText={image.originalFilename || 'Image'}
                      />
                    ) : (
                      <img
                        src={image.imageUrl}
                        alt={image.originalFilename || 'Uploaded image'}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    );
                  })()}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  
                  {/* Selection checkbox */}
                  {selectionMode && (
                    <div 
                      className="absolute top-3 left-3 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleImageSelection(image.id)}
                        className="h-6 w-6 rounded-md border-2 border-white bg-white/90 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500 shadow-lg"
                      />
                    </div>
                  )}
                  
                  {!selectionMode && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-3 right-3 h-9 w-9 bg-white/90 dark:bg-black/70 hover:bg-red-500 hover:text-white text-red-500 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-lg backdrop-blur-sm"
                      onClick={() => handleDeleteClick(image)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}

                  {image.source === 'visual_search' && !selectionMode && (
                    <Badge className="absolute top-3 left-3 bg-violet-500/90 hover:bg-violet-500 text-white border-0 backdrop-blur-sm">
                      Visual Search
                    </Badge>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="space-y-1">
                    <p className="font-medium text-sm truncate text-foreground" title={image.originalFilename || undefined}>
                      {image.originalFilename || 'Unnamed image'}
                    </p>
                    
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{formatDistanceToNow(new Date(image.createdAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                  
                  {!selectionMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs font-medium border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950"
                      onClick={() => handleViewSimilar(image)}
                    >
                      <Search className="h-3 w-3 mr-1.5" />
                      View Matches
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Infinite scroll trigger */}
      {hasMore && allImages.length > 0 && (
        <div 
          ref={loadMoreRef}
          className="flex items-center justify-center py-8"
        >
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading more images...</span>
            </div>
          )}
        </div>
      )}
      
      {/* Image count indicator */}
      {imagesData?.pagination && allImages.length > 0 && (
        <div className="text-center text-sm text-muted-foreground py-2">
          Showing {allImages.length} of {imagesData.pagination.total} images
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete Image
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The image will be permanently removed from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {imageToDelete && (
            <div className="py-4">
              <div className="relative rounded-xl overflow-hidden bg-muted/30 aspect-video flex items-center justify-center">
                <img
                  src={imageToDelete.imageUrl}
                  alt={imageToDelete.originalFilename || 'Image to delete'}
                  className="max-h-40 rounded-lg object-contain"
                />
              </div>
              <p className="mt-3 text-sm text-center font-medium truncate">
                {imageToDelete.originalFilename || 'Unnamed image'}
              </p>
            </div>
          )}
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deleteMutation.isPending} className="rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Image'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete {selectedImages.size} Images
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. {selectedImages.size} images will be permanently removed from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending} className="rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedImages.size} Images`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
