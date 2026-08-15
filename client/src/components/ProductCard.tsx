import { useState } from "react";
import { ShoppingBag, ShoppingCart, Check, GitCompare, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Product {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
  similarity?: number;
  matchScore?: number;
  matchReason?: string;
  matchLabel?: string;
  matchQuality?: 'perfect_match' | 'very_similar' | 'somewhat_similar';
  displayLabel?: string;
}

interface ProductPagination {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
  showing: number;
  filters?: {
    search?: string | null;
    minPrice?: number | null;
    maxPrice?: number | null;
  };
}

interface ProductCardProps {
  products: Product[];
  currencySymbol?: string;
  whatsappEnabled?: boolean;
  whatsappNumber?: string;
  whatsappMessage?: string;
  comparisonEnabled?: boolean;
  compareProducts?: Set<string>;
  onCompareToggle?: (productId: string) => void;
  chatColor?: string;
  addToCartEnabled?: boolean;
  tryOnEnabled?: boolean;
  onTryOn?: (product: Product) => void;
  pagination?: ProductPagination;
  searchQuery?: string;
  businessAccountId?: string | null;
  onLoadMore?: (newProducts: Product[], newPagination: ProductPagination) => void;
  userMessage?: string;
  selectedLanguage?: string;
}

export function ProductCard({ 
  products, 
  currencySymbol = "$",
  whatsappEnabled = false,
  whatsappNumber,
  whatsappMessage = "Hi! I'm interested in ordering: {product_name} - {product_price}",
  comparisonEnabled = false,
  compareProducts = new Set(),
  onCompareToggle,
  chatColor = "#9333ea",
  addToCartEnabled = false,
  tryOnEnabled = false,
  onTryOn,
  pagination,
  searchQuery,
  businessAccountId,
  onLoadMore,
  userMessage,
  selectedLanguage
}: ProductCardProps) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [translatedDescriptions, setTranslatedDescriptions] = useState<Map<string, string>>(new Map());
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const handleTranslateDescription = async (product: Product) => {
    if (!businessAccountId || (!userMessage && !selectedLanguage)) return;
    if (translatedDescriptions.has(product.id)) return;
    setTranslatingId(product.id);
    try {
      const body: Record<string, string> = { productId: product.id, businessAccountId: businessAccountId! };
      if (selectedLanguage && selectedLanguage !== 'auto') {
        body.targetLanguage = selectedLanguage;
      }
      if (userMessage) body.userMessage = userMessage;
      const res = await fetch('/api/chat/widget/product/translate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.description) {
          setTranslatedDescriptions(prev => new Map(prev).set(product.id, data.description));
        }
      }
    } catch (_) {}
    finally { setTranslatingId(null); }
  };
  
  const handleLoadMore = async () => {
    if (!pagination?.hasMore || pagination?.nextOffset === null || pagination?.nextOffset === undefined || !businessAccountId) return;
    
    setIsLoadingMore(true);
    try {
      // Build request body including original filters from pagination
      const requestBody: Record<string, any> = {
        businessAccountId,
        search: pagination.filters?.search || searchQuery || '',
        offset: pagination.nextOffset
      };
      
      // Include price filters if they exist in the original search
      if (pagination.filters?.minPrice !== null && pagination.filters?.minPrice !== undefined) {
        requestBody.minPrice = pagination.filters.minPrice;
      }
      if (pagination.filters?.maxPrice !== null && pagination.filters?.maxPrice !== undefined) {
        requestBody.maxPrice = pagination.filters.maxPrice;
      }
      
      const response = await fetch('/api/chat/widget/products/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data && onLoadMore) {
          onLoadMore(data.data, data.pagination);
        }
      } else {
        console.error('Failed to load more products: HTTP', response.status);
      }
    } catch (error) {
      console.error('Failed to load more products:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const hasMore = pagination?.hasMore && businessAccountId && onLoadMore;

  const handleAddToCart = (productId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAddedToCart(prev => new Set(prev).add(productId));
    setTimeout(() => {
      setAddedToCart(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }, 2000);
  };

  const handleWhatsAppOrder = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!whatsappNumber) return;
    
    const priceText = product.price 
      ? `${currencySymbol}${parseFloat(product.price).toLocaleString('en-IN')}` 
      : "Price on inquiry";
    
    const message = whatsappMessage
      .replace("{product_name}", product.name)
      .replace("{product_price}", priceText);
    
    const cleanNumber = whatsappNumber.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const handleCompareToggle = (productId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onCompareToggle?.(productId);
  };

  const handleTryOn = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    onTryOn?.(product);
  };

  return (
    <>
      <div className="not-prose w-full">
        <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
          {products.map((product) => (
            <div
              key={product.id}
              onClick={() => { setSelectedProduct(product); handleTranslateDescription(product); }}
              className="group relative flex-shrink-0 w-[220px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-700 transition-all duration-200 snap-start cursor-pointer"
            >
              <div className="relative w-full h-[160px] bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-contain p-3"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ShoppingBag className="w-12 h-12 text-purple-300 dark:text-purple-700" />
                  </div>
                )}
                
                {(product.similarity !== undefined || product.displayLabel) && (
                  <div 
                    className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full text-xs font-bold shadow-md"
                    style={{ 
                      backgroundColor: product.matchQuality === 'perfect_match' 
                        ? '#22c55e' 
                        : product.matchQuality === 'very_similar' 
                          ? '#3b82f6' 
                          : (product.similarity || 0) >= 80 
                            ? '#22c55e' 
                            : (product.similarity || 0) >= 50 
                              ? '#eab308' 
                              : '#ef4444',
                      color: 'white'
                    }}
                  >
                    {product.displayLabel || `${product.similarity}% match`}
                  </div>
                )}

                {comparisonEnabled && (
                  <button
                    onClick={(e) => handleCompareToggle(product.id, e)}
                    className={`absolute top-1.5 left-1.5 p-1.5 rounded-full transition-all duration-200 ${
                      compareProducts.has(product.id)
                        ? 'bg-purple-600 text-white'
                        : 'bg-white/80 text-gray-600 hover:bg-purple-100'
                    }`}
                    title={compareProducts.has(product.id) ? "Remove from compare" : "Add to compare"}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="p-2.5">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-2 line-clamp-2 leading-tight">
                  {product.name}
                </h3>
                
                {product.price ? (
                  <div className="mb-2">
                    <span className="text-lg font-bold" style={{ color: chatColor }}>
                      {currencySymbol}{parseFloat(product.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ) : (
                  <div className="mb-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Price on inquiry
                    </span>
                  </div>
                )}

                <div className="flex gap-1.5">
                  {whatsappEnabled && whatsappNumber && (
                    <button
                      onClick={(e) => handleWhatsAppOrder(product, e)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
                      style={{ backgroundColor: '#25D366' }}
                    >
                      <FaWhatsapp className="w-3.5 h-3.5" />
                      Order
                    </button>
                  )}
                  
                  {addToCartEnabled && (
                    <button
                      onClick={(e) => handleAddToCart(product.id, e)}
                      disabled={addedToCart.has(product.id)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-white rounded-lg transition-all duration-200 shadow-sm ${
                        addedToCart.has(product.id)
                          ? 'bg-green-600 hover:bg-green-600 cursor-default'
                          : 'hover:shadow-md'
                      }`}
                      style={!addedToCart.has(product.id) ? { background: `linear-gradient(135deg, ${chatColor}, #3b82f6)` } : undefined}
                    >
                      {addedToCart.has(product.id) ? (
                        <>
                          <Check className="w-3 h-3" />
                          Added
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-3 h-3" />
                          Cart
                        </>
                      )}
                    </button>
                  )}
                  
                  {tryOnEnabled && product.imageUrl && (
                    <button
                      onClick={(e) => handleTryOn(product, e)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
                      style={{ background: `linear-gradient(135deg, #ec4899, #8b5cf6)` }}
                      title="Try this on virtually"
                    >
                      <Sparkles className="w-3 h-3" />
                      Try On
                    </button>
                  )}
                </div>
              </div>

              <div className="absolute inset-0 border-2 border-transparent group-hover:border-purple-400/50 dark:group-hover:border-purple-600/50 rounded-lg pointer-events-none transition-colors duration-200" />
            </div>
          ))}
          
          {/* Show More button */}
          {hasMore && (
            <div
              onClick={!isLoadingMore ? handleLoadMore : undefined}
              className={`flex-shrink-0 w-[120px] h-full min-h-[240px] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-2 snap-start transition-all duration-200 ${
                isLoadingMore 
                  ? 'opacity-60 cursor-wait' 
                  : 'cursor-pointer hover:shadow-md hover:border-purple-300 dark:hover:border-purple-600'
              }`}
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: chatColor }} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
                </>
              ) : (
                <>
                  <div 
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `${chatColor}15` }}
                  >
                    <ChevronRight className="w-6 h-6" style={{ color: chatColor }} />
                  </div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Show More</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    +{pagination!.total - products.length} more
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {selectedProduct?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedProduct && (
            <div className="space-y-6">
              <div className="relative w-full bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 rounded-lg overflow-hidden">
                {selectedProduct.imageUrl ? (
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="w-full max-h-80 object-contain p-6"
                  />
                ) : (
                  <div className="w-full h-80 flex items-center justify-center">
                    <ShoppingBag className="w-32 h-32 text-purple-300 dark:text-purple-700" />
                  </div>
                )}
              </div>

              {selectedProduct.price ? (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Price</p>
                  <p className="text-3xl font-bold" style={{ color: chatColor }}>
                    {currencySymbol}{parseFloat(selectedProduct.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Price</p>
                  <p className="text-lg text-gray-500 dark:text-gray-400">Price on inquiry</p>
                </div>
              )}

              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Description</p>
                {translatingId === selectedProduct.id ? (
                  <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Translating...</span>
                  </div>
                ) : (
                  <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {translatedDescriptions.get(selectedProduct.id) || selectedProduct.description}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                {whatsappEnabled && whatsappNumber && (
                  <Button
                    onClick={(e) => handleWhatsAppOrder(selectedProduct, e)}
                    className="flex-1 text-white"
                    style={{ backgroundColor: '#25D366' }}
                  >
                    <FaWhatsapp className="w-4 h-4 mr-2" />
                    Order via WhatsApp
                  </Button>
                )}
                
                {addToCartEnabled && (
                  <Button
                    onClick={(e) => handleAddToCart(selectedProduct.id, e)}
                    disabled={addedToCart.has(selectedProduct.id)}
                    className={`flex-1 text-white ${addedToCart.has(selectedProduct.id) ? 'bg-green-600' : ''}`}
                    style={!addedToCart.has(selectedProduct.id) ? { background: `linear-gradient(135deg, ${chatColor}, #3b82f6)` } : undefined}
                  >
                    {addedToCart.has(selectedProduct.id) ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Added to Cart
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        Add to Cart
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
