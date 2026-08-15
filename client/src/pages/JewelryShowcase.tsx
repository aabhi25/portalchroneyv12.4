import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Utility: Downscale image to max dimension for faster upload & GPT-4o processing
async function downscaleImage(file: File, maxDimension: number = 1024): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const { width, height } = img;
      
      // If image is already small enough, return original
      if (width <= maxDimension && height <= maxDimension) {
        resolve(file);
        return;
      }
      
      // Calculate new dimensions maintaining aspect ratio
      let newWidth: number, newHeight: number;
      if (width > height) {
        newWidth = maxDimension;
        newHeight = Math.round((height / width) * maxDimension);
      } else {
        newHeight = maxDimension;
        newWidth = Math.round((width / height) * maxDimension);
      }
      
      // Create canvas and draw resized image
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Use high-quality image smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // Convert to blob with JPEG compression for smaller file size
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          
          // Create new file with same name but jpg extension
          const newFileName = file.name.replace(/\.[^.]+$/, '.jpg');
          const resizedFile = new File([blob], newFileName, { type: 'image/jpeg' });
          
          console.log(`[Image Downscale] ${width}x${height} (${(file.size/1024).toFixed(0)}KB) → ${newWidth}x${newHeight} (${(resizedFile.size/1024).toFixed(0)}KB)`);
          resolve(resizedFile);
        },
        'image/jpeg',
        0.85 // Quality: 85%
      );
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import type { MeResponseDto } from "@shared/dto";
import { motion, AnimatePresence } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { 
  Camera, 
  Image as ImageIcon, 
  Search, 
  Filter, 
  X, 
  RotateCcw, 
  Presentation, 
  Package,
  Loader2,
  Sparkles,
  Diamond,
  GitCompare,
  Check,
  Minus
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ManualCropTool } from "@/components/ManualCropTool";
import { DetectedJewelryOverlay } from "@/components/DetectedJewelryOverlay";
import type { Area } from 'react-easy-crop';

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
  similarity?: number;
  categories?: Category[];
  tags?: Tag[];
}

interface SearchResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  priceRange: {
    min: number;
    max: number;
  };
}

interface WidgetSettings {
  currency: string;
  showcaseLogo?: string | null;
  showcaseThemeColor?: string;
  showcaseThemePreset?: string;
  perfectMatchThreshold?: string;
  verySimilarThreshold?: string;
  showMatchPercentage?: string;
  visualSearchModel?: string;
}

type ThemePreset = 'noir_luxe' | 'champagne_glow' | 'amethyst_aurora';

interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  priceColor: string;
  bg: string;
  bgGradient: string;
  text: string;
  textMuted: string;
  cardBg: string;
  cardBorder: string;
  glassBg: string;
  glassBorder: string;
  buttonGradient: string;
  buttonHover: string;
  shimmer: string;
}

const LUXE_THEMES: Record<ThemePreset, ThemeColors> = {
  noir_luxe: {
    primary: "#000000",
    secondary: "#1a1a1a",
    accent: "#d4af37",
    priceColor: "#d4af37",
    bg: "#0a0a0a",
    bgGradient: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)",
    text: "#ffffff",
    textMuted: "rgba(255, 255, 255, 0.6)",
    cardBg: "rgba(26, 26, 26, 0.8)",
    cardBorder: "rgba(212, 175, 55, 0.2)",
    glassBg: "rgba(26, 26, 26, 0.7)",
    glassBorder: "rgba(212, 175, 55, 0.15)",
    buttonGradient: "linear-gradient(135deg, #d4af37 0%, #b8962e 100%)",
    buttonHover: "linear-gradient(135deg, #e5c04a 0%, #c9a73f 100%)",
    shimmer: "linear-gradient(90deg, transparent 0%, rgba(212, 175, 55, 0.3) 50%, transparent 100%)"
  },
  champagne_glow: {
    primary: "#c4a35a",
    secondary: "#8b7355",
    accent: "#f5e6c8",
    priceColor: "#c4a35a",
    bg: "#faf8f5",
    bgGradient: "linear-gradient(135deg, #faf8f5 0%, #f5efe6 50%, #faf8f5 100%)",
    text: "#2c2416",
    textMuted: "rgba(44, 36, 22, 0.6)",
    cardBg: "rgba(255, 255, 255, 0.9)",
    cardBorder: "rgba(196, 163, 90, 0.25)",
    glassBg: "rgba(255, 255, 255, 0.8)",
    glassBorder: "rgba(196, 163, 90, 0.2)",
    buttonGradient: "linear-gradient(135deg, #c4a35a 0%, #a88b45 100%)",
    buttonHover: "linear-gradient(135deg, #d5b46b 0%, #b99c56 100%)",
    shimmer: "linear-gradient(90deg, transparent 0%, rgba(196, 163, 90, 0.4) 50%, transparent 100%)"
  },
  amethyst_aurora: {
    primary: "#7c3aed",
    secondary: "#a855f7",
    accent: "#e9d5ff",
    priceColor: "#7c3aed",
    bg: "#faf5ff",
    bgGradient: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #faf5ff 100%)",
    text: "#1e1b4b",
    textMuted: "rgba(30, 27, 75, 0.6)",
    cardBg: "rgba(255, 255, 255, 0.9)",
    cardBorder: "rgba(124, 58, 237, 0.2)",
    glassBg: "rgba(255, 255, 255, 0.8)",
    glassBorder: "rgba(124, 58, 237, 0.15)",
    buttonGradient: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
    buttonHover: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
    shimmer: "linear-gradient(90deg, transparent 0%, rgba(124, 58, 237, 0.3) 50%, transparent 100%)"
  }
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  AED: "د.إ",
  EUR: "€",
  GBP: "£",
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.08,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94]
    }
  }),
  hover: {
    y: -8,
    scale: 1.02,
    transition: {
      duration: 0.3,
      ease: "easeOut"
    }
  }
};

const shimmerVariants = {
  animate: {
    x: ["0%", "200%"],
    transition: {
      repeat: Infinity,
      repeatType: "loop" as const,
      duration: 2,
      ease: "linear"
    }
  }
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  }
};

// Memoized product card with ref forwarding for AnimatePresence compatibility
interface ProductCardProps {
  product: Product;
  index: number;
  theme: typeof LUXE_THEMES[keyof typeof LUXE_THEMES];
  currencySymbol: string;
  onSelect: (product: Product) => void;
  onViewDetails?: (product: Product, e: React.MouseEvent) => void;
  compareMode?: boolean;
  isSelectedForCompare?: boolean;
  perfectMatchThreshold?: number;
  verySimilarThreshold?: number;
  showMatchPercentage?: boolean;
}

const ProductCard = React.memo(
  React.forwardRef<HTMLDivElement, ProductCardProps>(
    ({ product, index, theme, currencySymbol, onSelect, onViewDetails, compareMode, isSelectedForCompare, perfectMatchThreshold = 96, verySimilarThreshold = 85, showMatchPercentage = false }, ref) => {
      const getMatchQualityInfo = (similarity: number, isExactMatch?: boolean) => {
        const percent = similarity * 100;
        let label: string;
        let color: string;
        
        if (isExactMatch || percent >= perfectMatchThreshold) {
          label = 'Perfect Match';
          color = '#22c55e';
        } else if (percent >= verySimilarThreshold) {
          label = 'Very Similar';
          color = '#3b82f6';
        } else {
          label = 'Somewhat Similar';
          color = '#6b7280';
        }
        
        const display = showMatchPercentage ? `${Math.round(percent)}% match` : label;
        return { display, color };
      };
      
      return (
      <motion.div
        ref={ref}
        custom={index}
        variants={cardVariants}
        initial={false}
        animate="visible"
        whileHover="hover"
        layout
        onClick={() => onSelect(product)}
      >
        <Card 
          className="group overflow-hidden border-0 cursor-pointer h-full relative"
          style={{ 
            backgroundColor: theme.cardBg,
            boxShadow: isSelectedForCompare 
              ? `0 4px 24px rgba(0,0,0,0.06), 0 0 0 3px ${theme.accent}`
              : `0 4px 24px rgba(0,0,0,0.06), 0 0 0 1px ${theme.cardBorder}`,
            backdropFilter: 'blur(12px)'
          }}
        >
          {/* Compare mode selection indicator */}
          {compareMode && (
            <motion.div 
              className="absolute top-3 left-3 z-10"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <div 
                className="w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
                style={{ 
                  backgroundColor: isSelectedForCompare ? theme.accent : 'rgba(255,255,255,0.9)',
                  border: isSelectedForCompare ? 'none' : `2px solid ${theme.cardBorder}`
                }}
              >
                {isSelectedForCompare && <Check className="h-4 w-4 text-white" />}
              </div>
            </motion.div>
          )}
          {/* Info button for viewing details in compare mode - always visible for touch devices */}
          {compareMode && onViewDetails && (
            <motion.button
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
              style={{ 
                backgroundColor: 'rgba(255,255,255,0.95)',
                border: `1px solid ${theme.cardBorder}`
              }}
              onClick={(e) => onViewDetails(product, e)}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <Search className="h-4 w-4" style={{ color: theme.text }} />
            </motion.button>
          )}
          <div 
            className="aspect-square relative overflow-hidden"
            style={{ backgroundColor: theme.glassBg }}
          >
            {product.imageUrl ? (
              <motion.img
                src={product.imageUrl}
                alt={product.name}
                className="w-full h-full object-contain p-2"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center relative">
                <Sparkles className="h-20 w-20" style={{ color: `${theme.accent}60` }} />
                <motion.div
                  className="absolute inset-0"
                  style={{ background: theme.shimmer }}
                  variants={shimmerVariants}
                  animate="animate"
                />
              </div>
            )}
            {product.similarity !== undefined && (() => {
              const matchInfo = getMatchQualityInfo(product.similarity, (product as any).isExactMatch);
              return (
                <motion.div 
                  className="absolute top-4 right-4 px-3 py-1.5 rounded-full text-xs font-bold shadow-lg"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3, type: "spring" }}
                  style={{ backgroundColor: matchInfo.color, color: 'white' }}
                >
                  {matchInfo.display}
                </motion.div>
              );
            })()}
          </div>
          <CardContent className="p-5 flex flex-col space-y-2">
            <h3 
              className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]"
              style={{ color: theme.text }}
            >
              {product.name}
            </h3>
            
            {/* Categories */}
            {product.categories && product.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {product.categories.slice(0, 2).map((category) => (
                  <span 
                    key={category.id} 
                    className="text-[11px] px-2.5 py-1 rounded font-semibold uppercase tracking-wide"
                    style={{ 
                      backgroundColor: '#5c4a32',
                      color: '#ffffff'
                    }}
                  >
                    {category.name}
                  </span>
                ))}
                {product.categories.length > 2 && (
                  <span 
                    className="text-[11px] px-2 py-1 rounded font-medium"
                    style={{ 
                      backgroundColor: '#e5e5e5',
                      color: '#666666'
                    }}
                  >
                    +{product.categories.length - 2}
                  </span>
                )}
              </div>
            )}
            
            {/* Tags */}
            {product.tags && product.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {product.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: tag.color ? `${tag.color}15` : 'rgba(128,128,128,0.1)',
                      color: tag.color || theme.textMuted,
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
            
            <div className="pt-2 border-t mt-auto" style={{ borderColor: `${theme.cardBorder}50` }}>
              {product.price ? (
                <p 
                  className="text-xl font-bold tracking-tight"
                  style={{ color: theme.priceColor }}
                >
                  {currencySymbol}{parseFloat(product.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              ) : (
                <p 
                  className="text-sm italic"
                  style={{ color: theme.textMuted }}
                >
                  Price on request
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      );
    }
  )
);

ProductCard.displayName = 'ProductCard';

export default function JewelryShowcase() {
  const { setOpen: setSidebarOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const searchString = useSearch();
  
  const [presentationMode, setPresentationMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  
  // Pending filter states (UI state - changes immediately on user input)
  const [pendingCategory, setPendingCategory] = useState<string>("all");
  const [pendingPriceRange, setPendingPriceRange] = useState<[number, number]>([0, 100000]);
  
  // Applied filter states (only updates when Apply is clicked)
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100000]);
  
  const [maxPriceLimit, setMaxPriceLimit] = useState(100000);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [isSearchingByImage, setIsSearchingByImage] = useState(false);
  const [visualSearchResults, setVisualSearchResults] = useState<Product[] | null>(null);
  const [searchProgress, setSearchProgress] = useState<string>(''); // Progressive search status
  const eventSourceRef = useRef<EventSource | null>(null); // Track SSE connection for cleanup
  const [croppedJewelry, setCroppedJewelry] = useState<{
    detected: boolean;
    primaryImage?: string | null;
    type?: string | null;
    description?: string | null;
    imageWidth?: number;
    imageHeight?: number;
    allItems?: Array<{
      type: string;
      croppedDataUrl: string | null;
      confidence: number;
      description?: string;
      boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
        bottomAnchorY?: number;
      } | null;
      attributes?: any;
    }>;
  } | null>(null);
  const [selectedDetectedItem, setSelectedDetectedItem] = useState<number | null>(null);
  const [matchesByType, setMatchesByType] = useState<{ [key: string]: Product[] } | null>(null);
  const [activeJewelryType, setActiveJewelryType] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showUploadedImagePreview, setShowUploadedImagePreview] = useState(false);
  const [isManualCropMode, setIsManualCropMode] = useState(false);
  const [isManualCropSearching, setIsManualCropSearching] = useState(false);
  const [uploadedImageServerUrl, setUploadedImageServerUrl] = useState<string | null>(null);
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [shareProduct, setShareProduct] = useState<Product | null>(null);
  
  // Compare mode states
  const [compareMode, setCompareMode] = useState(false);
  const [compareProducts, setCompareProducts] = useState<Product[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [returnToCompare, setReturnToCompare] = useState(false);
  
  // Stable callback for product selection to prevent re-renders
  const handleProductSelect = useCallback((product: Product) => {
    if (compareMode) {
      // In compare mode, toggle product selection
      setCompareProducts(prev => {
        const isSelected = prev.some(p => p.id === product.id);
        if (isSelected) {
          return prev.filter(p => p.id !== product.id);
        } else if (prev.length < 3) {
          return [...prev, product];
        } else {
          return prev; // Max 3 products
        }
      });
    } else {
      setSelectedProduct(product);
    }
  }, [compareMode]);

  // Handle viewing product details (works in both normal and compare mode)
  const handleViewProductDetails = useCallback((product: Product, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedProduct(product);
  }, []);

  // Auto-exit compare mode when all products are removed
  useEffect(() => {
    if (compareMode && compareProducts.length === 0) {
      // Keep compare mode active but show empty state
    }
  }, [compareMode, compareProducts]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: currentUser } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });
  
  const businessAccountId = currentUser?.businessAccount?.id;

  const { data: widgetSettings } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  const theme = useMemo(() => {
    const preset = (widgetSettings?.showcaseThemePreset || 'noir_luxe') as ThemePreset;
    return LUXE_THEMES[preset] || LUXE_THEMES.noir_luxe;
  }, [widgetSettings?.showcaseThemePreset]);

  const currencySymbol = widgetSettings ? CURRENCY_SYMBOLS[widgetSettings.currency] || "$" : "$";

  // Match quality thresholds and display mode from settings
  const perfectMatchThreshold = widgetSettings?.perfectMatchThreshold ? parseFloat(widgetSettings.perfectMatchThreshold) : 96;
  const verySimilarThreshold = widgetSettings?.verySimilarThreshold ? parseFloat(widgetSettings.verySimilarThreshold) : 85;
  const showMatchPercentage = widgetSettings?.showMatchPercentage === 'true';

  const getMatchQualityInfo = (similarity: number, isExactMatch?: boolean) => {
    const percent = similarity * 100;
    let label: string;
    let color: string;
    
    if (isExactMatch || percent >= perfectMatchThreshold) {
      label = 'Perfect Match';
      color = '#22c55e';
    } else if (percent >= verySimilarThreshold) {
      label = 'Very Similar';
      color = '#3b82f6';
    } else {
      label = 'Somewhat Similar';
      color = '#6b7280';
    }
    
    const display = showMatchPercentage ? `${Math.round(percent)}% match` : label;
    return { display, color };
  };

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  interface PriceDistribution {
    buckets: { start: number; end: number; count: number }[];
    average: number;
    min: number;
    max: number;
    totalProducts: number;
  }

  const { data: priceDistribution } = useQuery<PriceDistribution>({
    queryKey: ["/api/products/price-distribution"],
  });

  const searchMutation = useMutation({
    mutationFn: async (params: {
      query?: string;
      categoryId?: string;
      minPrice?: number;
      maxPrice?: number;
      page?: number;
    }) => {
      return await apiRequest<SearchResponse>("POST", "/api/products/search", params);
    },
    onError: () => {
      toast({
        title: "Search failed",
        description: "Unable to search products. Please try again.",
        variant: "destructive",
      });
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!businessAccountId) throw new Error("Business account not found");
      
      const formData = new FormData();
      formData.append("image", file);
      formData.append("businessAccountId", businessAccountId);
      
      const response = await fetch("/api/chat/widget/upload-image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to upload image");
      return response.json();
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Unable to upload image. Please try again.",
        variant: "destructive",
      });
      setIsSearchingByImage(false);
    },
  });

  const matchProductsMutation = useMutation({
    mutationFn: async (imageUrl: string) => {
      if (!businessAccountId) throw new Error("Business account not found");
      
      const response = await fetch("/api/chat/widget/match-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          businessAccountId,
          imageUrl 
        }),
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to match products");
      return response.json();
    },
    onError: () => {
      toast({
        title: "Visual search failed",
        description: "Unable to find matching products. Please try again.",
        variant: "destructive",
      });
      setIsSearchingByImage(false);
    },
  });

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Reset pagination and clear accumulated products for new search
      setCurrentPage(1);
      setAllProducts([]);
      searchMutation.mutate({
        query: searchQuery || undefined,
        categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
        minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
        maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
        page: 1,
      });
    }
  }, [searchQuery, selectedCategory, priceRange, maxPriceLimit, searchMutation]);

  // Load all products on initial mount
  useEffect(() => {
    if (!visualSearchResults && !searchMutation.data && searchMutation.status === 'idle') {
      searchMutation.mutate({
        query: undefined,
        categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
        minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
        maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
        page: currentPage,
      });
    }
  }, []);

  // Debounced search - automatically trigger search after 2 seconds of inactivity
  useEffect(() => {
    // Skip if visual search results are active (visual search takes priority)
    if (visualSearchResults) return;
    
    // Skip if search query is empty (handled by onChange to show all products)
    if (!searchQuery.trim()) return;
    
    const debounceTimer = setTimeout(() => {
      // Reset pagination and clear accumulated products for new search
      setCurrentPage(1);
      setAllProducts([]);
      searchMutation.mutate({
        query: searchQuery,
        categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
        minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
        maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
        page: 1,
      });
    }, 2000); // 2 second debounce
    
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, visualSearchResults, selectedCategory, priceRange, maxPriceLimit]);

  useEffect(() => {
    if (searchMutation.data?.priceRange) {
      const newMax = searchMutation.data.priceRange.max || 100000;
      setMaxPriceLimit(newMax);
      // Update both pending and applied price range on initial load
      if (priceRange[1] === 100000) {
        setPriceRange([priceRange[0], newMax]);
        setPendingPriceRange([pendingPriceRange[0], newMax]);
      }
    }
  }, [searchMutation.data?.priceRange]);

  useEffect(() => {
    if (presentationMode) {
      setSidebarOpen(false);
    } else {
      setSidebarOpen(true);
    }
  }, [presentationMode, setSidebarOpen]);

  // Handle matchHistory URL parameter from Uploads page - fetches stored matches
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const matchHistoryId = params.get('matchHistory');
    
    if (matchHistoryId && !uploadedImage) {
      setIsSearchingByImage(true);
      
      fetch(`/api/uploaded-images/${matchHistoryId}/matches`, {
        credentials: 'include'
      })
        .then(res => res.json())
        .then((data) => {
          if (data.imageUrl) {
            setUploadedImage(data.imageUrl);
            setUploadedImageServerUrl(data.imageUrl); // Also set server URL for manual crop
          }
          if (data.croppedJewelry) {
            setCroppedJewelry(data.croppedJewelry);
          }
          if (data.matches && data.matches.length > 0) {
            setVisualSearchResults(data.matches);
          } else {
            toast({
              title: "No matches found",
              description: "No similar products were found when this image was originally searched.",
            });
            setVisualSearchResults([]);
          }
        })
        .catch((error) => {
          console.error("Failed to load match history:", error);
          toast({
            title: "Error loading history",
            description: "Unable to load the previous search results.",
            variant: "destructive"
          });
        })
        .finally(() => {
          setIsSearchingByImage(false);
        });
    }
  }, [searchString]);

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const handleImageUpload = useCallback(async (file: File) => {
    // Close any existing SSE connection before starting a new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setUploadedImageFile(file);
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage(previewUrl);
    setIsSearchingByImage(true);
    setCroppedJewelry(null);
    setSearchProgress('Searching...');
    
    try {
      // Step 0: Downscale image client-side for faster upload
      const optimizedFile = await downscaleImage(file, 1024);
      
      // Check if Vision Warehouse is configured - use fast endpoint (no GPT Vision, no cropping)
      const useVisionWarehouse = (widgetSettings as any)?.visualSearchModel === 'google_vision_warehouse';
      
      if (useVisionWarehouse) {
        // VISION WAREHOUSE MODE: Show crop UI, then send cropped image to VW
        // No GPT Vision detection - user manually adjusts crop box
        
        setSearchProgress('Uploading image...');
        
        // Upload image to R2 for server-side cropping later
        const uploadFormData = new FormData();
        uploadFormData.append('image', optimizedFile);
        uploadFormData.append('businessAccountId', businessAccountId || '');
        
        const uploadResponse = await fetch('/api/chat/widget/upload-image', {
          method: 'POST',
          body: uploadFormData,
          credentials: 'include',
        });
        
        if (!uploadResponse.ok) {
          throw new Error('Failed to upload image');
        }
        
        const uploadResult = await uploadResponse.json();
        setUploadedImageServerUrl(uploadResult.imageUrl);
        
        // Get actual image dimensions for accurate crop UI
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = previewUrl;
        });
        
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        
        // Set default crop box (center 80% of image) for user adjustment
        setCroppedJewelry({
          detected: true,
          type: 'jewelry',
          description: 'Adjust the crop box to select the jewelry',
          imageWidth: imgWidth,
          imageHeight: imgHeight,
          allItems: [{
            type: 'jewelry',
            croppedDataUrl: null,
            confidence: 1.0,
            description: 'Adjust the crop box to select the jewelry',
            boundingBox: { x: 10, y: 10, width: 80, height: 80 },
            attributes: null
          }]
        });
        
        setSearchProgress('');
        setIsSearchingByImage(false);
        return;
      }
      
      // STANDARD MODE: GPT Vision detection with cropping UI
      setSearchProgress('Analyzing image...');
      
      const formData = new FormData();
      formData.append('image', optimizedFile);
      formData.append('businessAccountId', businessAccountId || '');
      
      let allMatches: Product[] = [];
      let updatedMatchesByType: { [key: string]: Product[] } = {};
      let exactMatchFound: Product | null = null;
      
      // Use fetch with ReadableStream for POST-based SSE
      const response = await fetch('/api/chat/widget/detect-stream', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Detection request failed');
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        let buffer = '';
        
        const processSSEBuffer = (text: string) => {
          const lines = text.split('\n');
          let eventType = '';
          let eventData = '';
          
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
              
              if (eventType && eventData) {
                try {
                  const data = JSON.parse(eventData);
                  
                  if (eventType === 'status') {
                    setSearchProgress(data.message || 'Searching...');
                  } else if (eventType === 'exactMatch') {
                    if (data.match) {
                      exactMatchFound = data.match;
                      allMatches = [data.match];
                      setSearchProgress('Detection complete. Select an item and click "Show Products".');
                    }
                  } else if (eventType === 'detection') {
                    if (data.detected && data.items && data.items.length > 0) {
                      setSearchProgress(`Found ${data.itemCount} jewelry item(s)...`);
                      setCroppedJewelry({
                        detected: true,
                        type: data.items[0]?.type,
                        description: data.items[0]?.description,
                        imageWidth: data.imageWidth || 100,
                        imageHeight: data.imageHeight || 100,
                        allItems: data.items.map((item: any) => ({
                          type: item.type,
                          croppedDataUrl: item.croppedDataUrl,
                          confidence: item.confidence,
                          description: item.description,
                          boundingBox: item.boundingBox || null,
                          attributes: item.attributes || null
                        }))
                      });
                    }
                  } else if (eventType === 'similarProducts') {
                    setSearchProgress('Detection complete. Select an item and click "Show Products".');
                  } else if (eventType === 'complete') {
                    setSearchProgress('');
                    // Store the server URL for manual crop functionality
                    if (data.imageUrl) {
                      setUploadedImageServerUrl(data.imageUrl);
                    }
                  }
                } catch (parseErr) {
                  console.error('Failed to parse SSE data:', parseErr);
                }
                
                eventType = '';
                eventData = '';
              }
            }
          }
        };
        
        // Read stream until done
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE events (separated by double newlines)
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || ''; // Keep incomplete part in buffer
          
          for (const part of parts) {
            if (part.trim()) {
              processSSEBuffer(part);
            }
          }
        }
        
        // Process any remaining buffer
        if (buffer.trim()) {
          processSSEBuffer(buffer);
        }
      } else {
        // Fallback to traditional API if streaming not supported
        const uploadResult = await uploadImageMutation.mutateAsync(optimizedFile);
        setUploadedImageServerUrl(uploadResult.imageUrl);
        const matchResult = await matchProductsMutation.mutateAsync(uploadResult.imageUrl);
        
        if (matchResult.croppedJewelry) {
          setCroppedJewelry(matchResult.croppedJewelry);
        }
        // Don't auto-populate results - wait for user to click "Show Products"
      }
      
      // Don't auto-populate results - wait for user to click "Show Products"
      // Detection is complete, user can now select an item and click "Show Products"
    } catch (error) {
      console.error("Visual search failed:", error);
      setSearchProgress('');
    } finally {
      setIsSearchingByImage(false);
      setSearchProgress('');
    }
  }, [businessAccountId, activeJewelryType, widgetSettings, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  }, [handleImageUpload]);

  const clearVisualSearch = useCallback(() => {
    setUploadedImage(null);
    setUploadedImageFile(null);
    setUploadedImageServerUrl(null);
    setVisualSearchResults(null);
    setCroppedJewelry(null);
    setMatchesByType(null);
    setActiveJewelryType(null);
    setSelectedDetectedItem(null);
    setIsManualCropMode(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const handleManualCropSearch = useCallback(async (croppedAreaPixels: Area) => {
    // Use server URL (R2) for cropping, not local blob URL
    const imageUrlToUse = uploadedImageServerUrl || uploadedImage;
    if (!imageUrlToUse || !businessAccountId) return;

    setIsManualCropSearching(true);
    try {
      const response = await fetch('/api/visual-search/manual-crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          imageUrl: imageUrlToUse,
          cropArea: {
            x: croppedAreaPixels.x,
            y: croppedAreaPixels.y,
            width: croppedAreaPixels.width,
            height: croppedAreaPixels.height
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Manual crop search failed');
      }

      const data = await response.json();
      
      if (data.matches && data.matches.length > 0) {
        // Clear matchesByType to ensure displayProducts shows the manual crop results
        setMatchesByType(null);
        setActiveJewelryType(null);
        setVisualSearchResults(data.matches);
        toast({
          title: "Search Complete",
          description: `Found ${data.matches.length} similar product${data.matches.length > 1 ? 's' : ''}`,
        });
      } else {
        setVisualSearchResults([]);
        toast({
          title: "No matches found",
          description: "Try selecting a different area",
          variant: "destructive"
        });
      }

      // Close dialog and reset crop mode
      setShowUploadedImagePreview(false);
      setIsManualCropMode(false);
    } catch (error: any) {
      console.error('[Manual Crop Search] Error:', error);
      toast({
        title: "Search failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsManualCropSearching(false);
    }
  }, [uploadedImage, uploadedImageServerUrl, businessAccountId, toast]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setPendingCategory("all");
    setPendingPriceRange([0, maxPriceLimit]);
    setSelectedCategory("all");
    setPriceRange([0, maxPriceLimit]);
    setCurrentPage(1);
    setAllProducts([]);
    setUploadedImage(null);
    setUploadedImageFile(null);
    setVisualSearchResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    
    // Load all products after resetting filters
    searchMutation.mutate({
      query: undefined,
      categoryId: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      page: 1,
    });
  }, [maxPriceLimit]);
  
  const applyFilters = useCallback(() => {
    setSelectedCategory(pendingCategory);
    setPriceRange(pendingPriceRange);
    setCurrentPage(1);
    setAllProducts([]);
    setFiltersOpen(false);
    
    // Trigger search with the new filters
    searchMutation.mutate({
      query: searchQuery || undefined,
      categoryId: pendingCategory !== "all" ? pendingCategory : undefined,
      minPrice: pendingPriceRange[0] > 0 ? pendingPriceRange[0] : undefined,
      maxPrice: pendingPriceRange[1] < maxPriceLimit ? pendingPriceRange[1] : undefined,
      page: 1,
    });
  }, [pendingCategory, pendingPriceRange, searchQuery, maxPriceLimit, searchMutation]);

  // Accumulate products for infinite scroll
  useEffect(() => {
    if (searchMutation.data?.products) {
      if (currentPage === 1) {
        setAllProducts(searchMutation.data.products);
      } else {
        setAllProducts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newProducts = searchMutation.data.products.filter(p => !existingIds.has(p.id));
          return [...prev, ...newProducts];
        });
      }
      setIsLoadingMore(false);
    }
  }, [searchMutation.data?.products, currentPage]);

  // Fetch next page when currentPage changes (for infinite scroll)
  useEffect(() => {
    if (currentPage > 1 && !visualSearchResults) {
      searchMutation.mutate({
        query: searchQuery || undefined,
        categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
        minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
        maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
        page: currentPage,
      });
    }
  }, [currentPage]);

  // Infinite scroll observer with callback ref for stability
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  const loadMoreCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const paginationData = searchMutation.data?.pagination;
          if (entries[0].isIntersecting && paginationData && currentPage < paginationData.totalPages && !searchMutation.isPending && !isLoadingMore) {
            setIsLoadingMore(true);
            setCurrentPage(prev => prev + 1);
          }
        },
        { threshold: 0.1, rootMargin: '0px 0px 50% 0px' }
      );
      observerRef.current.observe(node);
    }
  }, [searchMutation.data?.pagination, currentPage, searchMutation.isPending, isLoadingMore]);

  // Memoize products to prevent unnecessary re-renders when filter UI changes
  const products = useMemo(() => 
    visualSearchResults || allProducts,
    [visualSearchResults, allProducts]
  );
  const pagination = searchMutation.data?.pagination;
  const isLoading = searchMutation.isPending && currentPage === 1;

  const handleDetectedItemSelect = useCallback((index: number) => {
    setSelectedDetectedItem(index);
    if (croppedJewelry?.allItems?.[index]) {
      setActiveJewelryType(croppedJewelry.allItems[index].type);
    }
  }, [croppedJewelry]);

  const handleSearchDetectedItem = useCallback(async (
    item: { type: string; croppedDataUrl: string | null; description?: string; boundingBox?: { x: number; y: number; width: number; height: number } | null; attributes?: any },
    adjustedBox?: { x: number; y: number; width: number; height: number }
  ) => {
    if (!uploadedImageServerUrl || !businessAccountId) return;
    
    setIsSearchingByImage(true);
    setSearchProgress('Searching for similar products...');
    
    try {
      const boxToUse = adjustedBox || item.boundingBox;
      
      const response = await fetch('/api/visual-search/adjusted-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          imageUrl: uploadedImageServerUrl,
          businessAccountId,
          boundingBox: boxToUse,
          jewelryType: item.type,
          description: item.description,
          clearFirst: true,
          originalAttributes: item.attributes || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      
      if (data.products && data.products.length > 0) {
        setVisualSearchResults(data.products);
        // Set matchesByType so products display in the grid
        setMatchesByType({ [item.type]: data.products });
        setActiveJewelryType(item.type);
      } else {
        setVisualSearchResults([]);
        setMatchesByType({ [item.type]: [] });
        toast({
          title: "No matches found",
          description: "No similar products found for this jewelry item.",
        });
      }
    } catch (error) {
      console.error('Adjusted boundary search failed:', error);
    } finally {
      setIsSearchingByImage(false);
      setSearchProgress('');
    }
  }, [uploadedImageServerUrl, businessAccountId]);

  const handleSearchAllItems = useCallback(async (
    items: Array<{ 
      item: { type: string; croppedDataUrl: string | null; description?: string; boundingBox?: { x: number; y: number; width: number; height: number } | null; attributes?: any };
      adjustedBox?: { x: number; y: number; width: number; height: number };
    }>
  ) => {
    if (!uploadedImageServerUrl || !businessAccountId) return;
    
    setIsSearchingByImage(true);
    setSearchProgress('Searching for all detected items...');
    
    try {
      const allMatches: { [type: string]: any[] } = {};
      
      for (let i = 0; i < items.length; i++) {
        const { item, adjustedBox } = items[i];
        const boxToUse = adjustedBox || item.boundingBox;
        
        const response = await fetch('/api/visual-search/adjusted-boundary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            imageUrl: uploadedImageServerUrl,
            businessAccountId,
            boundingBox: boxToUse,
            jewelryType: item.type,
            description: item.description,
            clearFirst: i === 0,
            originalAttributes: item.attributes || null,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.products && data.products.length > 0) {
            if (!allMatches[item.type]) {
              allMatches[item.type] = [];
            }
            const existingIds = new Set(allMatches[item.type].map((p: any) => p.id));
            const newProducts = data.products.filter((p: any) => !existingIds.has(p.id));
            allMatches[item.type] = [...allMatches[item.type], ...newProducts];
          } else if (!allMatches[item.type]) {
            allMatches[item.type] = [];
          }
        } else if (!allMatches[item.type]) {
          allMatches[item.type] = [];
        }
      }
      
      setMatchesByType(allMatches);
      
      const types = Object.keys(allMatches);
      if (types.length > 0) {
        const typeWithMostMatches = types.reduce((a, b) => 
          (allMatches[a]?.length || 0) >= (allMatches[b]?.length || 0) ? a : b
        );
        setActiveJewelryType(typeWithMostMatches);
        
        const allProducts = Object.values(allMatches).flat();
        setVisualSearchResults(allProducts);
      }
      
      const totalMatches = Object.values(allMatches).reduce((sum, arr) => sum + arr.length, 0);
      if (totalMatches === 0) {
        toast({
          title: "No matches found",
          description: "No similar products found for any detected jewelry items.",
        });
      }
    } catch (error) {
      console.error('Search all items failed:', error);
      toast({
        title: "Search failed",
        description: "There was an error searching for products.",
        variant: "destructive",
      });
    } finally {
      setIsSearchingByImage(false);
      setSearchProgress('');
    }
  }, [uploadedImageServerUrl, businessAccountId, toast]);

  const showOverlay = uploadedImage && croppedJewelry?.detected && croppedJewelry.allItems && croppedJewelry.allItems.length > 0;

  const VisualSearchBar = useMemo(() => {
    if (showOverlay) {
      return (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelect}
          />
          <DetectedJewelryOverlay
            imageUrl={uploadedImage!}
            detectedItems={croppedJewelry!.allItems!}
            imageWidth={croppedJewelry!.imageWidth}
            imageHeight={croppedJewelry!.imageHeight}
            selectedIndex={selectedDetectedItem}
            onSelectItem={handleDetectedItemSelect}
            onSearchItem={handleSearchDetectedItem}
            onSearchAllItems={handleSearchAllItems}
            onClearSearch={clearVisualSearch}
            onManualCrop={() => setIsManualCropMode(true)}
            theme={theme}
            isSearching={isSearchingByImage}
          />
        </motion.div>
      );
    }

    return (
      <motion.div
        className="mb-6"
        initial={false}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card
          className="border-0 overflow-hidden relative"
          style={{
            backgroundColor: theme.glassBg,
            backdropFilter: 'blur(20px)',
            boxShadow: isSearchingByImage 
              ? `0 8px 48px ${theme.accent}40, 0 0 0 2px ${theme.accent}60` 
              : `0 8px 32px rgba(0,0,0,0.08), 0 0 0 1px ${theme.glassBorder}`
          }}
        >
          <AnimatePresence>
            {isSearchingByImage && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-lg pointer-events-none z-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${theme.accent}15 50%, transparent 100%)`,
                  }}
                >
                  <motion.div
                    className="absolute inset-0"
                    animate={{
                      background: [
                        `linear-gradient(0deg, ${theme.accent}00 0%, ${theme.accent}20 50%, ${theme.accent}00 100%)`,
                        `linear-gradient(180deg, ${theme.accent}00 0%, ${theme.accent}20 50%, ${theme.accent}00 100%)`,
                        `linear-gradient(360deg, ${theme.accent}00 0%, ${theme.accent}20 50%, ${theme.accent}00 100%)`
                      ]
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                </motion.div>
                
                <motion.div
                  className="absolute inset-0 pointer-events-none z-20 overflow-hidden rounded-lg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }}
                    animate={{ y: [0, 200, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                </motion.div>

                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute pointer-events-none z-30"
                    initial={{ 
                      opacity: 0, 
                      scale: 0,
                      x: `${10 + (i * 12)}%`,
                      y: `${20 + ((i % 3) * 30)}%`
                    }}
                    animate={{ 
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      y: [`${20 + ((i % 3) * 30)}%`, `${10 + ((i % 3) * 25)}%`, `${20 + ((i % 3) * 30)}%`]
                    }}
                    transition={{ 
                      duration: 2 + (i * 0.2),
                      repeat: Infinity,
                      delay: i * 0.3,
                      ease: "easeInOut"
                    }}
                  >
                    <Sparkles 
                      className="w-3 h-3" 
                      style={{ color: theme.accent, filter: `drop-shadow(0 0 4px ${theme.accent})` }} 
                    />
                  </motion.div>
                ))}

                <motion.div
                  className="absolute inset-0 pointer-events-none z-5 rounded-lg"
                  animate={{
                    boxShadow: [
                      `inset 0 0 20px ${theme.accent}20`,
                      `inset 0 0 40px ${theme.accent}30`,
                      `inset 0 0 20px ${theme.accent}20`
                    ]
                  }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
              </>
            )}
          </AnimatePresence>

          <CardContent className="p-5 relative z-40">
            <div className="flex flex-col md:flex-row items-center gap-5">
              <motion.div 
                className="relative rounded-2xl border-2 border-dashed p-4 flex-shrink-0 w-full md:w-48 h-32 flex flex-col items-center justify-center transition-all duration-300"
                style={{ 
                  borderColor: isSearchingByImage ? theme.accent : theme.cardBorder,
                  background: theme.glassBg,
                }}
                animate={isSearchingByImage ? {
                  borderColor: [theme.accent, `${theme.accent}80`, theme.accent],
                  boxShadow: [
                    `0 0 10px ${theme.accent}30`,
                    `0 0 20px ${theme.accent}50`,
                    `0 0 10px ${theme.accent}30`
                  ]
                } : {}}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              >
                {uploadedImage ? (
                  <div className="relative w-full h-full">
                    <motion.img 
                      src={uploadedImage} 
                      alt="Uploaded" 
                      className="w-full h-full object-contain rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setShowUploadedImagePreview(true)}
                      animate={isSearchingByImage ? { scale: [1, 1.02, 1] } : {}}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 right-0 h-5 w-5 rounded-full transition-all duration-200 z-10"
                      style={{ 
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        color: '#fff'
                      }}
                      onClick={(e) => { e.stopPropagation(); clearVisualSearch(); }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    {isSearchingByImage && (
                      <motion.div 
                        className="absolute inset-0 flex items-center justify-center rounded-xl overflow-hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        <motion.div
                          className="absolute inset-0"
                          style={{ 
                            background: `linear-gradient(90deg, transparent 0%, ${theme.accent}40 50%, transparent 100%)`
                          }}
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                        <motion.div
                          className="relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-full"
                          style={{ 
                            background: `${theme.glassBg}cc`,
                            backdropFilter: 'blur(8px)',
                            border: `1px solid ${theme.accent}40`
                          }}
                        >
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          >
                            <Sparkles className="h-4 w-4" style={{ color: theme.accent }} />
                          </motion.div>
                          <span className="text-xs font-medium" style={{ color: theme.text }}>
                            {searchProgress || 'Analyzing...'}
                          </span>
                        </motion.div>
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <motion.div 
                    className="text-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <div 
                      className="w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center relative overflow-hidden"
                      style={{ 
                        background: `linear-gradient(135deg, ${theme.primary}20, ${theme.accent}40)`,
                      }}
                    >
                      <Diamond className="h-5 w-5" style={{ color: theme.accent }} />
                      <motion.div
                        className="absolute inset-0"
                        style={{ background: theme.shimmer }}
                        variants={shimmerVariants}
                        animate="animate"
                      />
                    </div>
                    <p className="text-xs font-medium" style={{ color: theme.text }}>
                      Upload image
                    </p>
                  </motion.div>
                )}
              </motion.div>
              
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-lg font-semibold mb-1" style={{ color: theme.text }}>
                  Visual Product Search
                </h3>
                <p className="text-sm mb-3" style={{ color: theme.textMuted }}>
                  Upload a jewelry image to find similar designs in our collection
                </p>
                <div className="flex gap-2 justify-center md:justify-start">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button
                    variant="outline"
                    className="transition-all duration-300 hover:scale-[1.02]"
                    style={{ 
                      borderColor: theme.cardBorder,
                      color: theme.text,
                      backgroundColor: 'transparent'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="h-4 w-4 mr-2" />
                    Gallery
                  </Button>
                  <Button
                    variant="outline"
                    className="transition-all duration-300 hover:scale-[1.02]"
                    style={{ 
                      borderColor: theme.cardBorder,
                      color: theme.text,
                      backgroundColor: 'transparent'
                    }}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    Camera
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }, [theme, uploadedImage, isSearchingByImage, searchProgress, clearVisualSearch, handleFileSelect, setShowUploadedImagePreview, showOverlay, croppedJewelry, selectedDetectedItem, handleDetectedItemSelect, handleSearchDetectedItem]);

  const CroppedJewelryDisplay = useMemo(() => {
    if (!croppedJewelry?.detected || !croppedJewelry.allItems || croppedJewelry.allItems.length === 0) {
      return null;
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-4"
      >
        <Card
          className="overflow-hidden border-0"
          style={{
            background: theme.glassBg,
            boxShadow: `0 4px 20px rgba(0,0,0,0.08)`,
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div 
                className="w-1 h-4 rounded-full"
                style={{ background: `linear-gradient(to bottom, ${theme.accent}, ${theme.primary})` }}
              />
              <span className="text-sm font-medium" style={{ color: theme.text }}>
                Detected Jewelry Items
              </span>
              <span 
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ 
                  background: theme.primary,
                  color: 'white'
                }}
              >
                {croppedJewelry.allItems.length} {croppedJewelry.allItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            
            <div className="space-y-3">
              {croppedJewelry.allItems.map((item, index) => (
                <motion.div
                  key={`${item.type}-${index}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.01]"
                  style={{ 
                    background: activeJewelryType === item.type ? `${theme.primary}10` : theme.cardBg,
                    border: `1px solid ${activeJewelryType === item.type ? theme.primary : theme.glassBorder}`,
                    boxShadow: activeJewelryType === item.type 
                      ? `0 2px 12px ${theme.primary}20` 
                      : '0 1px 4px rgba(0,0,0,0.04)'
                  }}
                  onClick={() => setActiveJewelryType(item.type)}
                >
                  <div 
                    className="relative rounded-lg overflow-hidden flex-shrink-0"
                    style={{ 
                      border: `2px solid ${activeJewelryType === item.type ? theme.primary : theme.glassBorder}`,
                    }}
                  >
                    {item.croppedDataUrl ? (
                      <img 
                        src={item.croppedDataUrl} 
                        alt={`Detected ${item.type}`} 
                        className="w-16 h-16 object-contain"
                        style={{ background: theme.cardBg }}
                      />
                    ) : (
                      <div 
                        className="w-16 h-16 flex items-center justify-center"
                        style={{ background: theme.glassBg }}
                      >
                        <Diamond className="w-6 h-6" style={{ color: theme.textMuted }} />
                      </div>
                    )}
                    {activeJewelryType === item.type && (
                      <motion.div
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: theme.primary }}
                      >
                        <Check className="w-3 h-3 text-white" />
                      </motion.div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span 
                      className="text-sm capitalize font-semibold block"
                      style={{ color: activeJewelryType === item.type ? theme.primary : theme.text }}
                    >
                      {item.type}
                    </span>
                    {item.description && (
                      <p 
                        className="text-xs mt-1 line-clamp-2"
                        style={{ color: theme.text, opacity: 0.7 }}
                      >
                        {item.description}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }, [croppedJewelry, activeJewelryType, theme]);

  const FilterControls = useMemo(() => (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium tracking-wide uppercase" style={{ color: theme.textMuted, fontSize: '11px', letterSpacing: '0.05em' }}>
          Search by SKU, Design No, Wt
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: theme.textMuted }} />
          <Input
            ref={searchInputRef}
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => {
              const newValue = e.target.value;
              setSearchQuery(newValue);
              
              // If search is cleared, automatically show all products
              if (newValue === "" && !visualSearchResults) {
                searchMutation.mutate({
                  query: undefined,
                  categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
                  minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
                  maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
                  page: currentPage,
                });
              }
              
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
            onKeyDown={handleSearchKeyDown}
            className="pl-9 pr-9 border-0 transition-all duration-300 focus:ring-2"
            style={{ 
              backgroundColor: theme.glassBg,
              color: theme.text,
              boxShadow: `0 0 0 1px ${theme.glassBorder}`
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                // Reset pagination and clear accumulated products
                setCurrentPage(1);
                setAllProducts([]);
                // Show all products when clearing
                searchMutation.mutate({
                  query: undefined,
                  categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
                  minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
                  maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
                  page: 1,
                });
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:opacity-70 transition-opacity"
              type="button"
              title="Clear search"
            >
              <X className="h-4 w-4" style={{ color: theme.textMuted }} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium tracking-wide uppercase" style={{ color: theme.textMuted, fontSize: '11px', letterSpacing: '0.05em' }}>
          Filter by Product
        </label>
        <Select value={pendingCategory} onValueChange={(value) => {
          setPendingCategory(value);
          setSelectedCategory(value);
          setCurrentPage(1);
          setAllProducts([]);
          // Trigger search immediately with new category
          searchMutation.mutate({
            query: searchQuery || undefined,
            categoryId: value !== "all" ? value : undefined,
            minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
            maxPrice: priceRange[1] < maxPriceLimit ? priceRange[1] : undefined,
            page: 1,
          });
        }}>
          <SelectTrigger 
            className="border-0 transition-all duration-300"
            style={{ 
              backgroundColor: theme.glassBg,
              color: theme.text,
              boxShadow: `0 0 0 1px ${theme.glassBorder}`
            }}
          >
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium tracking-wide uppercase" style={{ color: theme.textMuted, fontSize: '11px', letterSpacing: '0.05em' }}>
            Filter by Price
          </label>
          {priceDistribution && priceDistribution.average > 0 && (
            <span className="text-xs" style={{ color: theme.textMuted }}>
              Avg: {currencySymbol}{priceDistribution.average.toLocaleString()}
            </span>
          )}
        </div>
        
        {/* Price Distribution Area Chart */}
        {priceDistribution && priceDistribution.buckets.length > 0 && (() => {
          const buckets = priceDistribution.buckets;
          const maxCount = Math.max(...buckets.map(b => b.count));
          const height = 48;
          const width = 100;
          
          const points = buckets.map((bucket, i) => {
            const x = (i / (buckets.length - 1)) * width;
            const y = maxCount > 0 ? height - (bucket.count / maxCount) * height * 0.9 : height;
            return { x, y, bucket };
          });
          
          const pathD = points.reduce((acc, point, i) => {
            if (i === 0) return `M ${point.x} ${point.y}`;
            const prev = points[i - 1];
            const cpX = (prev.x + point.x) / 2;
            return `${acc} C ${cpX} ${prev.y}, ${cpX} ${point.y}, ${point.x} ${point.y}`;
          }, '');
          
          const areaPath = `${pathD} L ${width} ${height} L 0 ${height} Z`;
          
          const minX = ((pendingPriceRange[0] - priceDistribution.min) / (priceDistribution.max - priceDistribution.min)) * width;
          const maxX = ((pendingPriceRange[1] - priceDistribution.min) / (priceDistribution.max - priceDistribution.min)) * width;
          
          return (
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12" preserveAspectRatio="none">
              <defs>
                <linearGradient id="areaGradientSelected" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={theme.accent} stopOpacity="0.7" />
                  <stop offset="100%" stopColor={theme.accent} stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="areaGradientBase" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={theme.accent} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={theme.accent} stopOpacity="0.05" />
                </linearGradient>
                <clipPath id="selectedRange">
                  <rect x={minX} y="0" width={maxX - minX} height={height} />
                </clipPath>
              </defs>
              <path d={areaPath} fill="url(#areaGradientBase)" />
              <path d={areaPath} fill="url(#areaGradientSelected)" clipPath="url(#selectedRange)" />
              <path d={pathD} fill="none" stroke={theme.accent} strokeWidth="1.5" opacity="0.4" />
              <path d={pathD} fill="none" stroke={theme.accent} strokeWidth="2" clipPath="url(#selectedRange)" />
            </svg>
          );
        })()}
        
        {/* Price Input Fields */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: theme.textMuted }}>Min Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: theme.textMuted }}>{currencySymbol}</span>
              <Input
                type="text"
                value={pendingPriceRange[0].toLocaleString()}
                onChange={(e) => {
                  const value = parseInt(e.target.value.replace(/,/g, '')) || 0;
                  if (value >= 0 && value <= pendingPriceRange[1]) {
                    setPendingPriceRange([value, pendingPriceRange[1]]);
                  }
                }}
                className="pl-7 border-0 text-sm font-medium"
                style={{ 
                  backgroundColor: theme.glassBg,
                  color: theme.text,
                  boxShadow: `0 0 0 1px ${theme.glassBorder}`
                }}
              />
            </div>
          </div>
          <div className="flex items-center pt-5">
            <span className="text-sm font-medium" style={{ color: theme.textMuted }}>to</span>
          </div>
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: theme.textMuted }}>Max Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: theme.textMuted }}>{currencySymbol}</span>
              <Input
                type="text"
                value={pendingPriceRange[1].toLocaleString()}
                onChange={(e) => {
                  const value = parseInt(e.target.value.replace(/,/g, '')) || 0;
                  if (value >= pendingPriceRange[0] && value <= maxPriceLimit) {
                    setPendingPriceRange([pendingPriceRange[0], value]);
                  }
                }}
                className="pl-7 border-0 text-sm font-medium"
                style={{ 
                  backgroundColor: theme.glassBg,
                  color: theme.text,
                  boxShadow: `0 0 0 1px ${theme.glassBorder}`
                }}
              />
            </div>
          </div>
        </div>

        {/* Price Range Slider */}
        <div className="pt-2">
          <Slider
            value={pendingPriceRange}
            min={0}
            max={maxPriceLimit}
            step={Math.max(100, Math.round(maxPriceLimit / 100))}
            onValueChange={(value) => setPendingPriceRange(value as [number, number])}
            className="w-full [&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[role=slider]]:border-2 [&_[role=slider]]:shadow-lg [&_[role=slider]]:cursor-grab [&_[role=slider]:active]:cursor-grabbing"
            style={{
              '--slider-track': theme.glassBorder,
              '--slider-range': theme.primary,
            } as React.CSSProperties}
          />
          <div className="flex justify-between text-xs mt-2" style={{ color: theme.textMuted }}>
            <span>{currencySymbol}0</span>
            <span>{currencySymbol}{maxPriceLimit.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          className="flex-1 transition-all duration-300 hover:scale-[1.02]"
          style={{ 
            borderColor: theme.cardBorder,
            color: theme.text,
            backgroundColor: 'transparent'
          }}
          onClick={resetFilters}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            className="w-full text-white font-medium transition-all duration-300"
            style={{ background: theme.buttonGradient }}
            onClick={applyFilters}
          >
            <Filter className="h-4 w-4 mr-2" />
            Apply
          </Button>
        </motion.div>
      </div>

      <div 
        className="mt-4 pt-4"
        style={{ borderTop: `1px solid ${theme.glassBorder}` }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: theme.textMuted }}>Products</span>
          <span 
            className="font-bold text-lg"
            style={{ color: theme.priceColor }}
          >
            {visualSearchResults ? visualSearchResults.length : (pagination?.totalCount || 0)}
          </span>
        </div>
      </div>
    </div>
  ), [theme, searchQuery, pendingCategory, pendingPriceRange, maxPriceLimit, currencySymbol, categories, visualSearchResults, pagination?.totalCount, priceDistribution, resetFilters, applyFilters]);

  const ProductDetailModal = () => {
    if (!selectedProduct) return null;
    
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            setSelectedProduct(null);
            if (returnToCompare) {
              setReturnToCompare(false);
              setCompareDialogOpen(true);
            }
          }}
        >
          <motion.div 
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          />
          <motion.div
            className="relative w-full max-w-5xl rounded-3xl"
            style={{ 
              background: theme.bg,
              boxShadow: `0 25px 100px rgba(0,0,0,0.3), 0 0 0 1px ${theme.glassBorder}`
            }}
            initial={false}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full transition-all duration-200 hover:scale-110 h-10 w-10 shadow-lg"
              style={{ 
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 50,
                backgroundColor: theme.cardBg,
                color: theme.text,
                border: `1px solid ${theme.glassBorder}`
              }}
              onClick={() => {
                setSelectedProduct(null);
                if (returnToCompare) {
                  setReturnToCompare(false);
                  setCompareDialogOpen(true);
                }
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="max-h-[90vh] overflow-y-auto rounded-3xl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                <div 
                  className="relative flex items-center justify-center p-6 md:p-8"
                  style={{ backgroundColor: theme.glassBg, minHeight: '400px', maxHeight: '70vh' }}
                >
                {selectedProduct.imageUrl ? (
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="w-full h-full object-contain"
                    style={{ maxHeight: '60vh' }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Sparkles className="h-32 w-32" style={{ color: `${theme.accent}40` }} />
                  </div>
                )}
                {selectedProduct.similarity !== undefined && (() => {
                  const matchInfo = getMatchQualityInfo(selectedProduct.similarity, (selectedProduct as any).isExactMatch);
                  return (
                    <div 
                      className="absolute top-6 left-6 px-4 py-2 rounded-full text-sm font-bold shadow-lg"
                      style={{ backgroundColor: matchInfo.color, color: 'white' }}
                    >
                      {matchInfo.display}
                    </div>
                  );
                })()}
              </div>
              
              <div className="p-8 md:p-10 flex flex-col">
                <div>
                  <h2 
                    className="text-2xl md:text-3xl font-bold mb-4 leading-tight"
                    style={{ color: theme.text }}
                  >
                    {selectedProduct.name}
                  </h2>
                  
                  {selectedProduct.price && (
                    <p 
                      className="text-3xl md:text-4xl font-bold mb-6"
                      style={{ color: theme.priceColor }}
                    >
                      {currencySymbol}{parseFloat(selectedProduct.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                  
                  <div 
                    className="mb-6 pb-6"
                    style={{ borderBottom: `1px solid ${theme.glassBorder}` }}
                  >
                    <h4 
                      className="text-sm font-medium uppercase tracking-wide mb-3"
                      style={{ color: theme.textMuted }}
                    >
                      Description
                    </h4>
                    <p 
                      className="text-base leading-relaxed"
                      style={{ color: theme.text }}
                    >
                      {selectedProduct.description || "No description available."}
                    </p>
                  </div>
                  
                  {(selectedProduct as any).sku && (
                    <div className="flex items-center gap-3 mb-4">
                      <span 
                        className="text-sm font-medium uppercase tracking-wide"
                        style={{ color: theme.textMuted }}
                      >
                        SKU:
                      </span>
                      <span 
                        className="text-sm font-semibold"
                        style={{ color: theme.text }}
                      >
                        {(selectedProduct as any).sku}
                      </span>
                    </div>
                  )}
                  
                  {(selectedProduct as any).weight && (
                    <div className="flex items-center gap-3 mb-4">
                      <span 
                        className="text-sm font-medium uppercase tracking-wide"
                        style={{ color: theme.textMuted }}
                      >
                        Weight:
                      </span>
                      <span 
                        className="text-sm font-semibold"
                        style={{ color: theme.text }}
                      >
                        {(selectedProduct as any).weight}
                      </span>
                    </div>
                  )}
                  
                  {!selectedProduct.price && (
                    <div className="mt-auto pt-6">
                      <p 
                        className="text-lg font-medium italic"
                        style={{ color: theme.textMuted }}
                      >
                        Price available on request
                      </p>
                    </div>
                  )}
                  
                  <div className="mt-6 pt-6" style={{ borderTop: `1px solid ${theme.glassBorder}` }}>
                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShareProduct(selectedProduct);
                        setWhatsappDialogOpen(true);
                      }}
                      className="w-full group relative overflow-hidden rounded-xl py-3.5 px-6 font-medium text-sm tracking-wide uppercase transition-all duration-300"
                      style={{ 
                        background: 'transparent',
                        border: `1px solid ${theme.glassBorder}`,
                        color: theme.text,
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div 
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                        style={{ 
                          background: `linear-gradient(135deg, ${theme.accent}15 0%, ${theme.accent}08 100%)`,
                        }}
                      />
                      <div className="relative flex items-center justify-center gap-3">
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                          style={{ 
                            background: `linear-gradient(135deg, #25D366 0%, #128C7E 100%)`,
                            boxShadow: '0 2px 8px rgba(37, 211, 102, 0.3)'
                          }}
                        >
                          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                        </div>
                        <span className="transition-colors duration-300" style={{ color: theme.text }}>
                          Share with Customer
                        </span>
                        <svg 
                          className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2"
                          style={{ color: theme.accent }}
                        >
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </motion.button>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  };

  const handleWhatsAppShare = () => {
    if (!shareProduct || !whatsappPhone.trim()) return;
    
    const phone = whatsappPhone.replace(/[^0-9]/g, '');
    const priceText = shareProduct.price 
      ? `${currencySymbol}${parseFloat(shareProduct.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
      : 'Price on request';
    
    // Use the product share page URL for better WhatsApp preview
    const productShareUrl = `${window.location.origin}/product/share/${shareProduct.id}`;
    
    const message = encodeURIComponent(
      `✨ *${shareProduct.name}*\n\n` +
      `💰 ${priceText}\n\n` +
      `${shareProduct.description || ''}\n\n` +
      `🔗 View product: ${productShareUrl}`
    );
    
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    
    setWhatsappDialogOpen(false);
    setWhatsappPhone("");
    setShareProduct(null);
    
    toast({
      title: "Opening WhatsApp",
      description: "Sharing product details with customer",
    });
  };

  // Get products to display based on active jewelry type tab
  const displayProducts = useMemo(() => {
    // If we have visual search results from matchesByType (multi-item Find Similar), show those
    if (matchesByType) {
      if (activeJewelryType) {
        return matchesByType[activeJewelryType] || [];
      }
      // If matchesByType is set but activeJewelryType isn't yet, show first type's results
      const firstType = Object.keys(matchesByType)[0];
      if (firstType) {
        return matchesByType[firstType] || [];
      }
    }
    // If we have visual search results from manual crop or single item search, show those
    if (visualSearchResults && visualSearchResults.length > 0) {
      return visualSearchResults;
    }
    // Otherwise show regular product catalog (including during detection phase before "Find Similar" is clicked)
    return products;
  }, [matchesByType, activeJewelryType, products, visualSearchResults]);

  // Jewelry type tabs component - only show after user clicks "Show Products" and there are matches
  const JewelryTypeTabs = useMemo(() => {
    // Don't show tabs until user has clicked "Show Products" (matchesByType is populated)
    if (!matchesByType) return null;
    
    // Only show types that were actually searched (from matchesByType keys)
    // This ensures removed items don't show up as tabs
    const allTypes = Object.keys(matchesByType);
    
    if (allTypes.length <= 1) return null;
    
    return (
      <div className="mb-6">
        <div className="flex flex-wrap gap-3">
          {allTypes.map((type) => {
            const isActive = activeJewelryType === type;
            const count = matchesByType?.[type]?.length || 0;
            const croppedItem = croppedJewelry?.allItems?.find(item => item.type === type);
            
            return (
              <motion.button
                key={type}
                onClick={() => setActiveJewelryType(type)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300"
                style={{
                  background: isActive 
                    ? '#B8860B' 
                    : 'white',
                  border: `2px solid ${isActive ? '#8B6914' : theme.cardBorder}`,
                  boxShadow: isActive 
                    ? '0 4px 15px rgba(184, 134, 11, 0.5)' 
                    : '0 2px 8px rgba(0,0,0,0.06)',
                }}
                whileHover={{ scale: 1.03, boxShadow: isActive ? '0 6px 20px rgba(184, 134, 11, 0.6)' : '0 4px 12px rgba(0,0,0,0.1)' }}
                whileTap={{ scale: 0.97 }}
              >
                {croppedItem?.croppedDataUrl && (
                  <div 
                    className="w-6 h-6 rounded-lg overflow-hidden flex-shrink-0"
                    style={{ 
                      border: isActive ? '1.5px solid rgba(255,255,255,0.5)' : `1px solid ${theme.cardBorder}`,
                    }}
                  >
                    <img 
                      src={croppedItem.croppedDataUrl} 
                      alt={type}
                      className="w-full h-full object-cover"
                      style={{ background: 'white' }}
                    />
                  </div>
                )}
                <span 
                  className="capitalize text-sm font-semibold"
                  style={{ color: isActive ? 'white' : theme.text }}
                >
                  {type}
                </span>
                <span 
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ 
                    background: isActive ? 'rgba(255,255,255,0.25)' : theme.primary,
                    color: 'white'
                  }}
                >
                  {count}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }, [matchesByType, activeJewelryType, croppedJewelry, theme]);

  const ProductGrid = () => {
    // Show helpful message when jewelry is detected but search hasn't been run yet
    const hasDetectedJewelry = uploadedImage && croppedJewelry?.detected && croppedJewelry.allItems && croppedJewelry.allItems.length > 0;
    const isInDetectionMode = hasDetectedJewelry && !visualSearchResults;
    
    if (isInDetectionMode) {
      return (
        <motion.div 
          className="flex flex-col items-center justify-center py-20 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div 
            className="w-24 h-24 rounded-full flex items-center justify-center mb-6 relative overflow-hidden"
            style={{ 
              background: `linear-gradient(135deg, ${theme.primary}15, ${theme.accent}30)`,
            }}
          >
            <Search className="h-12 w-12" style={{ color: theme.accent }} />
            <motion.div
              className="absolute inset-0"
              style={{ background: theme.shimmer }}
              variants={shimmerVariants}
              animate="animate"
            />
          </div>
          <h3 className="text-xl font-semibold mb-2" style={{ color: theme.text }}>
            Ready to Find Similar Products
          </h3>
          <p className="text-sm max-w-sm" style={{ color: theme.textMuted }}>
            Click "Find Similar" to search for products matching your uploaded image.
            You can also adjust the bounding box to focus on a specific item.
          </p>
        </motion.div>
      );
    }
    
    return (
    <>
      {JewelryTypeTabs}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={`skeleton-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card 
                className="overflow-hidden border-0"
                style={{ 
                  backgroundColor: theme.cardBg,
                  boxShadow: `0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px ${theme.cardBorder}`
                }}
              >
                <div 
                  className="aspect-square relative overflow-hidden"
                  style={{ backgroundColor: theme.glassBg }}
                >
                  <motion.div
                    className="absolute inset-0"
                    style={{ background: theme.shimmer }}
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  />
                </div>
                <CardContent className="p-5 space-y-3">
                  <div className="h-4 rounded-full w-3/4" style={{ backgroundColor: theme.glassBorder }} />
                  <div className="h-3 rounded-full w-1/2" style={{ backgroundColor: theme.glassBorder }} />
                  <div className="h-6 rounded-full w-1/3" style={{ backgroundColor: theme.glassBorder }} />
                </CardContent>
              </Card>
            </motion.div>
          ))
        ) : products.length === 0 ? (
          <motion.div 
            className="col-span-full flex flex-col items-center justify-center py-20 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div 
              className="w-24 h-24 rounded-full flex items-center justify-center mb-6 relative overflow-hidden"
              style={{ 
                background: `linear-gradient(135deg, ${theme.primary}15, ${theme.accent}30)`,
              }}
            >
              <Package className="h-12 w-12" style={{ color: theme.accent }} />
              <motion.div
                className="absolute inset-0"
                style={{ background: theme.shimmer }}
                variants={shimmerVariants}
                animate="animate"
              />
            </div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: theme.text }}>
              No products found
            </h3>
            <p className="text-sm max-w-sm" style={{ color: theme.textMuted }}>
              Try adjusting your search or filters to discover our exquisite collection.
            </p>
          </motion.div>
        ) : (
          displayProducts.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              index={i}
              theme={theme}
              currencySymbol={currencySymbol}
              onSelect={handleProductSelect}
              onViewDetails={handleViewProductDetails}
              compareMode={compareMode}
              isSelectedForCompare={compareProducts.some(p => p.id === product.id)}
              perfectMatchThreshold={perfectMatchThreshold}
              verySimilarThreshold={verySimilarThreshold}
              showMatchPercentage={showMatchPercentage}
            />
          ))
        )}
        </AnimatePresence>
      </div>
    </>
    );
  };

  const InfiniteScrollLoader = useMemo(() => {
    if (visualSearchResults) return null;
    
    // Don't show "Showing all products" when jewelry is detected but search hasn't been run yet
    const hasDetectedJewelry = uploadedImage && croppedJewelry?.detected && croppedJewelry.allItems && croppedJewelry.allItems.length > 0;
    if (hasDetectedJewelry) return null;
    
    const hasMore = pagination && currentPage < pagination.totalPages;
    
    return (
      <div ref={loadMoreCallbackRef} className="flex justify-center items-center py-8 mt-4">
        {(isLoadingMore || (searchMutation.isPending && currentPage > 1)) && (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: theme.accent }} />
            <span className="text-sm font-medium" style={{ color: theme.textMuted }}>
              Loading more products...
            </span>
          </div>
        )}
        {!hasMore && products.length > 0 && !isLoadingMore && (
          <span className="text-sm" style={{ color: theme.textMuted }}>
            Showing all {products.length} products
          </span>
        )}
      </div>
    );
  }, [visualSearchResults, uploadedImage, croppedJewelry, pagination, currentPage, isLoadingMore, searchMutation.isPending, products.length, theme, loadMoreCallbackRef]);

  if (presentationMode) {
    return (
      <motion.div 
        className="fixed inset-0 z-50"
        style={{ background: theme.bgGradient }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.header 
          className="h-16 flex items-center justify-between px-6"
          style={{ 
            background: theme.glassBg,
            backdropFilter: 'blur(20px)',
            borderBottom: `1px solid ${theme.glassBorder}`,
            boxShadow: '0 4px 30px rgba(0,0,0,0.1)'
          }}
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-3">
            {widgetSettings?.showcaseLogo ? (
              <img 
                src={widgetSettings.showcaseLogo} 
                alt="Brand logo" 
                className="h-10 w-auto max-w-32 object-contain"
              />
            ) : (
              <h1 
                className="text-xl font-bold tracking-wide"
                style={{ color: theme.text }}
              >
                {currentUser?.businessAccount?.name || 'Vista'}
              </h1>
            )}
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="ghost"
              className="transition-all duration-300"
              style={{ color: theme.text }}
              onClick={() => setPresentationMode(false)}
            >
              <X className="h-5 w-5 mr-2" />
              Exit
            </Button>
          </motion.div>
        </motion.header>

        <div className="flex flex-col h-[calc(100vh-4rem)]">
          <div className="px-6 pt-4">
            {VisualSearchBar}
            {!showOverlay && CroppedJewelryDisplay}
          </div>
          <div className="flex flex-1 overflow-hidden px-6 pb-6 gap-6">
            <motion.aside 
              className="w-72 flex-shrink-0 overflow-y-auto rounded-2xl p-5"
              style={{ 
                background: theme.glassBg,
                backdropFilter: 'blur(20px)',
                border: `1px solid ${theme.glassBorder}`
              }}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {FilterControls}
            </motion.aside>

            <main className="flex-1 overflow-y-auto">
              <ProductGrid />
              {InfiniteScrollLoader}
            </main>
          </div>
        </div>
        <ProductDetailModal />
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="min-h-screen"
      style={{ background: theme.bgGradient }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="p-6">
        <motion.div 
          className="flex items-center justify-between mb-8"
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
        >
          {widgetSettings?.showcaseLogo ? (
            <img 
              src={widgetSettings.showcaseLogo} 
              alt="Brand logo" 
              className="h-12 w-auto max-w-40 object-contain"
            />
          ) : (
            <h1 
              className="text-2xl font-bold tracking-wide"
              style={{ color: theme.text }}
            >
              {currentUser?.businessAccount?.name || 'Vista'}
            </h1>
          )}
          <div className="flex items-center gap-2">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                onClick={() => {
                  setCompareMode(!compareMode);
                  if (compareMode) {
                    setCompareProducts([]);
                  }
                }}
                className="font-medium transition-all duration-300 border"
                style={{ 
                  background: compareMode ? theme.buttonGradient : theme.glassBg,
                  borderColor: compareMode ? 'transparent' : theme.cardBorder,
                  color: compareMode ? 'white' : theme.text,
                  backdropFilter: compareMode ? 'none' : 'blur(12px)'
                }}
              >
                <GitCompare className="h-4 w-4 mr-2" />
                {compareMode ? 'Exit Compare' : 'Compare'}
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                onClick={() => setPresentationMode(true)}
                className="text-white font-medium shadow-lg transition-all duration-300"
                style={{ background: theme.buttonGradient }}
              >
                <Presentation className="h-4 w-4 mr-2" />
                Presentation Mode
              </Button>
            </motion.div>
          </div>
        </motion.div>

        {isMobile ? (
          <div className="space-y-4">
            {VisualSearchBar}
            {!showOverlay && CroppedJewelryDisplay}
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full transition-all duration-300"
                  style={{ 
                    borderColor: theme.cardBorder,
                    color: theme.text,
                    backgroundColor: theme.glassBg,
                    backdropFilter: 'blur(12px)'
                  }}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {(searchQuery || selectedCategory !== "all") && (
                    <span 
                      className="ml-2 w-2.5 h-2.5 rounded-full animate-pulse" 
                      style={{ backgroundColor: theme.accent }}
                    />
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent 
                side="left" 
                className="w-80 overflow-y-auto border-0"
                style={{ 
                  backgroundColor: theme.bg,
                  color: theme.text
                }}
              >
                <SheetHeader>
                  <SheetTitle style={{ color: theme.text }}>Filters</SheetTitle>
                </SheetHeader>
                <div className="mt-6">
                  {FilterControls}
                </div>
              </SheetContent>
            </Sheet>

            <ProductGrid />
            {InfiniteScrollLoader}
          </div>
        ) : (
          <div>
            {VisualSearchBar}
            {!showOverlay && CroppedJewelryDisplay}
            <div className="flex gap-6">
              <motion.aside 
                className="w-72 flex-shrink-0"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <Card 
                  className="border-0 overflow-hidden sticky top-6"
                  style={{ 
                    backgroundColor: theme.glassBg,
                    backdropFilter: 'blur(20px)',
                    boxShadow: `0 8px 32px rgba(0,0,0,0.08), 0 0 0 1px ${theme.glassBorder}`
                  }}
                >
                  <CardContent className="p-5">
                    {FilterControls}
                  </CardContent>
                </Card>
              </motion.aside>

              <main className="flex-1">
                <ProductGrid />
                {InfiniteScrollLoader}
              </main>
            </div>
          </div>
        )}
      </div>
      <ProductDetailModal />
      
      {/* Uploaded Image Preview Dialog with Manual Crop */}
      <Dialog 
        open={showUploadedImagePreview} 
        onOpenChange={(open) => {
          setShowUploadedImagePreview(open);
          if (!open) setIsManualCropMode(false);
        }}
      >
        <DialogContent 
          className="sm:max-w-2xl p-0 overflow-hidden"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.glassBorder }}
        >
          <DialogHeader className="p-4 pb-2">
            <DialogTitle style={{ color: theme.text }}>
              {isManualCropMode ? 'Select Area to Search' : 'Uploaded Image'}
            </DialogTitle>
          </DialogHeader>
          {uploadedImage && (
            <div className="p-4 pt-0">
              {isManualCropMode ? (
                <ManualCropTool
                  imageUrl={uploadedImage}
                  onCropComplete={handleManualCropSearch}
                  onCancel={() => setIsManualCropMode(false)}
                  isSearching={isManualCropSearching}
                  theme={{
                    text: theme.text,
                    textMuted: theme.textMuted,
                    accent: theme.accent,
                    glassBg: theme.glassBg,
                    glassBorder: theme.glassBorder,
                    cardBg: theme.cardBg
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div 
                    className="rounded-xl overflow-hidden"
                    style={{ backgroundColor: theme.glassBg }}
                  >
                    <img 
                      src={uploadedImage} 
                      alt="Uploaded image preview" 
                      className="w-full h-auto max-h-[60vh] object-contain"
                    />
                  </div>
                  <div className="flex justify-center">
                    <Button
                      onClick={() => setIsManualCropMode(true)}
                      disabled={!uploadedImageServerUrl}
                      className="flex items-center gap-2"
                      style={{ 
                        background: uploadedImageServerUrl 
                          ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)`
                          : theme.glassBorder,
                        color: uploadedImageServerUrl ? '#fff' : theme.textMuted
                      }}
                    >
                      <Camera className="w-4 h-4" />
                      Select Area to Search
                    </Button>
                  </div>
                  <p className="text-xs text-center" style={{ color: theme.textMuted }}>
                    {uploadedImageServerUrl 
                      ? "Not finding what you're looking for? Select a specific area of the image to search."
                      : "Please wait for the image to finish uploading before using manual crop."}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      <Dialog open={whatsappDialogOpen} onOpenChange={(open) => {
        setWhatsappDialogOpen(open);
        if (!open) {
          setWhatsappPhone("");
          setShareProduct(null);
        }
      }}>
        <DialogContent 
          className="sm:max-w-md"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.glassBorder }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: theme.text }}>
              Share on WhatsApp
            </DialogTitle>
            <DialogDescription style={{ color: theme.textMuted }}>
              Enter customer's WhatsApp number to share product details
            </DialogDescription>
          </DialogHeader>
          
          {shareProduct && (
            <div 
              className="flex items-center gap-4 p-3 rounded-lg"
              style={{ backgroundColor: theme.glassBg }}
            >
              {shareProduct.imageUrl ? (
                <img 
                  src={shareProduct.imageUrl} 
                  alt={shareProduct.name}
                  className="w-16 h-16 object-cover rounded-lg"
                />
              ) : (
                <div 
                  className="w-16 h-16 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: theme.glassBorder }}
                >
                  <Package className="w-8 h-8" style={{ color: theme.textMuted }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p 
                  className="font-medium truncate"
                  style={{ color: theme.text }}
                >
                  {shareProduct.name}
                </p>
                <p style={{ color: theme.priceColor }}>
                  {shareProduct.price 
                    ? `${currencySymbol}${parseFloat(shareProduct.price).toLocaleString('en-IN')}` 
                    : 'Price on request'}
                </p>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="phone" style={{ color: theme.text }}>
              Phone Number (with country code)
            </Label>
            <Input
              id="phone"
              placeholder="e.g., 919876543210"
              value={whatsappPhone}
              onChange={(e) => setWhatsappPhone(e.target.value)}
              className="font-mono"
              style={{ 
                backgroundColor: theme.glassBg, 
                borderColor: theme.glassBorder,
                color: theme.text 
              }}
            />
            <p className="text-xs" style={{ color: theme.textMuted }}>
              Include country code without + or 0 prefix
            </p>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setWhatsappDialogOpen(false)}
              style={{ borderColor: theme.glassBorder, color: theme.text }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleWhatsAppShare}
              disabled={!whatsappPhone.trim()}
              style={{ background: '#25D366', color: 'white' }}
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Compare Bar */}
      <AnimatePresence>
        {compareMode && compareProducts.length > 0 && (
          <motion.div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 p-4 rounded-2xl shadow-2xl"
            style={{ 
              backgroundColor: theme.glassBg,
              backdropFilter: 'blur(20px)',
              border: `1px solid ${theme.glassBorder}`,
              boxShadow: `0 20px 60px rgba(0,0,0,0.3)`
            }}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="flex items-center gap-4">
              {/* Selected product thumbnails */}
              <div className="flex items-center gap-2">
                {compareProducts.map((product, index) => (
                  <motion.div
                    key={product.id}
                    className="relative group"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div 
                      className="w-16 h-16 rounded-lg overflow-hidden"
                      style={{ border: `2px solid ${theme.accent}` }}
                    >
                      {product.imageUrl ? (
                        <img 
                          src={product.imageUrl} 
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div 
                          className="w-full h-full flex items-center justify-center"
                          style={{ backgroundColor: theme.glassBorder }}
                        >
                          <Package className="w-6 h-6" style={{ color: theme.textMuted }} />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCompareProducts(prev => prev.filter(p => p.id !== product.id));
                      }}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ backgroundColor: theme.accent }}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </motion.div>
                ))}
                
                {/* Empty slots */}
                {Array.from({ length: 3 - compareProducts.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center"
                    style={{ borderColor: theme.glassBorder }}
                  >
                    <span className="text-xs" style={{ color: theme.textMuted }}>+</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium px-3" style={{ color: theme.text }}>
                  {compareProducts.length}/3
                </span>
                <Button
                  onClick={() => setCompareDialogOpen(true)}
                  disabled={compareProducts.length < 2}
                  className="text-white font-medium"
                  style={{ background: theme.buttonGradient }}
                >
                  <GitCompare className="h-4 w-4 mr-2" />
                  Compare
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCompareProducts([])}
                  style={{ color: theme.textMuted }}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Dialog */}
      <Dialog open={compareDialogOpen} onOpenChange={setCompareDialogOpen}>
        <DialogContent 
          className="max-w-5xl max-h-[90vh] overflow-y-auto border-0"
          style={{ 
            backgroundColor: theme.bg,
            color: theme.text
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold" style={{ color: theme.text }}>
              <GitCompare className="inline-block w-5 h-5 mr-2" style={{ color: theme.accent }} />
              Compare Products
            </DialogTitle>
            <DialogDescription style={{ color: theme.textMuted }}>
              Side-by-side comparison of selected products
            </DialogDescription>
          </DialogHeader>
          
          <div className={`grid gap-6 mt-4 ${compareProducts.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {compareProducts.map((product, index) => (
              <motion.div
                key={product.id}
                className="rounded-xl overflow-hidden"
                style={{ 
                  backgroundColor: theme.cardBg,
                  border: `1px solid ${theme.cardBorder}`
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                {/* Product Image */}
                <div 
                  className="aspect-square relative"
                  style={{ backgroundColor: theme.glassBg }}
                >
                  {product.imageUrl ? (
                    <img 
                      src={product.imageUrl} 
                      alt={product.name}
                      className="w-full h-full object-contain p-4"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Sparkles className="h-16 w-16" style={{ color: `${theme.accent}60` }} />
                    </div>
                  )}
                </div>
                
                {/* Product Details */}
                <div className="p-4 space-y-3">
                  <h3 
                    className="font-semibold text-lg line-clamp-2"
                    style={{ color: theme.text }}
                  >
                    {product.name}
                  </h3>
                  
                  <p 
                    className="text-sm line-clamp-3"
                    style={{ color: theme.textMuted }}
                  >
                    {product.description}
                  </p>
                  
                  <div className="pt-2 border-t" style={{ borderColor: theme.glassBorder }}>
                    <p 
                      className="text-2xl font-bold"
                      style={{ color: theme.priceColor }}
                    >
                      {product.price 
                        ? `${currencySymbol}${parseFloat(product.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : 'Price on request'}
                    </p>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      style={{ borderColor: theme.glassBorder, color: theme.text }}
                      onClick={() => {
                        setReturnToCompare(true);
                        setCompareDialogOpen(false);
                        setSelectedProduct(product);
                      }}
                    >
                      View Details
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShareProduct(product);
                        setWhatsappDialogOpen(true);
                      }}
                      style={{ borderColor: theme.glassBorder, color: theme.text }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
