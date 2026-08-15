import { ShoppingBag, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

interface Product {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
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

interface ProductCarouselProps {
  products: Product[];
  title?: string;
  currencySymbol?: string;
  onProductClick?: (product: Product) => void;
  chatColor?: string;
  whatsappNumber?: string;
  whatsappMessage?: string;
  pagination?: ProductPagination;
  searchQuery?: string;
  businessAccountId?: string;
  onLoadMore?: (newProducts: Product[], newPagination: ProductPagination) => void;
}

function formatWhatsAppUrl(phone: string, message: string, product: Product, currencySymbol: string): string {
  const formattedPrice = product.price 
    ? `${currencySymbol}${parseFloat(product.price).toLocaleString('en-IN')}`
    : 'Price on inquiry';
  
  const finalMessage = message
    .replace(/{product_name}/g, product.name)
    .replace(/{product_price}/g, formattedPrice);
  
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMessage)}`;
}

export function ProductCarousel({ 
  products, 
  title = "Featured Products",
  currencySymbol = "$",
  onProductClick,
  chatColor = "#9333ea",
  whatsappNumber,
  whatsappMessage = "Hi, I'm interested in ordering {product_name} ({product_price})",
  pagination,
  searchQuery,
  businessAccountId,
  onLoadMore
}: ProductCarouselProps) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  if (!products || products.length === 0) return null;

  const handleLoadMore = async () => {
    if (!pagination?.hasMore || !pagination?.nextOffset || !businessAccountId) return;
    
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
      }
    } catch (error) {
      console.error('Failed to load more products:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const hasMore = pagination?.hasMore && searchQuery && businessAccountId;

  return (
    <div className="w-full my-3">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4" style={{ color: chatColor }} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</span>
        </div>
        {pagination && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {products.length} of {pagination.total}
          </span>
        )}
      </div>
      
      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
        {products.map((product) => (
          <div
            key={product.id}
            onClick={() => onProductClick?.(product)}
            className="group relative flex-shrink-0 w-[140px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700 transition-all duration-200 snap-start cursor-pointer"
          >
            <div className="relative w-full h-[100px] bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ShoppingBag className="w-8 h-8 text-purple-300 dark:text-purple-700" />
                </div>
              )}
            </div>

            <div className="p-2">
              <h3 className="font-medium text-xs text-gray-900 dark:text-gray-100 mb-0.5 line-clamp-2 leading-tight">
                {product.name}
              </h3>
              
              <div className="flex items-center justify-between gap-1">
                {product.price ? (
                  <span className="text-sm font-bold" style={{ color: chatColor }}>
                    {currencySymbol}{parseFloat(product.price).toLocaleString('en-IN')}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Price on inquiry
                  </span>
                )}
                
                {whatsappNumber && (
                  <a
                    href={formatWhatsAppUrl(whatsappNumber, whatsappMessage, product, currencySymbol)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors"
                    title="Order via WhatsApp"
                  >
                    <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Show More button */}
        {hasMore && (
          <div
            onClick={!isLoadingMore ? handleLoadMore : undefined}
            className={`flex-shrink-0 w-[100px] h-[156px] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-2 snap-start transition-all duration-200 ${
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
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${chatColor}15` }}
                >
                  <ChevronRight className="w-5 h-5" style={{ color: chatColor }} />
                </div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Show More</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  +{pagination.total - products.length} more
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
