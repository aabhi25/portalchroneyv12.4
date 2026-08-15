import { X, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Product {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
}

interface ProductComparisonViewProps {
  products: Product[];
  currencySymbol?: string;
  onRemove: (productId: string) => void;
  onClose: () => void;
  chatColor?: string;
  whatsappNumber?: string;
  whatsappMessage?: string;
}

export function ProductComparisonView({
  products,
  currencySymbol = "$",
  onRemove,
  onClose,
  chatColor = "#9333ea",
  whatsappNumber,
  whatsappMessage
}: ProductComparisonViewProps) {
  if (products.length === 0) return null;

  const handleWhatsAppOrder = (product: Product) => {
    if (!whatsappNumber) return;
    
    const message = (whatsappMessage || "Hi! I'm interested in ordering: {product_name} - {product_price}")
      .replace("{product_name}", product.name)
      .replace("{product_price}", product.price ? `${currencySymbol}${parseFloat(product.price).toLocaleString('en-IN')}` : "Price on inquiry");
    
    const cleanNumber = whatsappNumber.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-2">
      <div className="bg-white dark:bg-gray-900 w-full h-[90%] rounded-xl overflow-hidden flex flex-col animate-in fade-in duration-200">
        <div 
          className="flex items-center justify-between p-3 border-b flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${chatColor}15, ${chatColor}05)` }}
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Compare Products ({products.length})
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="flex gap-4 min-w-max">
            {products.map((product) => (
              <div 
                key={product.id} 
                className="w-[200px] flex-shrink-0 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 relative"
              >
                <button
                  onClick={() => onRemove(product.id)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>

                <div className="w-full h-[120px] bg-white dark:bg-gray-900 rounded-lg flex items-center justify-center mb-3">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-contain p-2"
                    />
                  ) : (
                    <ShoppingBag className="w-10 h-10 text-gray-300" />
                  )}
                </div>

                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1 line-clamp-2">
                  {product.name}
                </h3>

                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-3">
                  {product.description}
                </p>

                <div className="mb-3">
                  {product.price ? (
                    <span className="text-lg font-bold" style={{ color: chatColor }}>
                      {currencySymbol}{parseFloat(product.price).toLocaleString('en-IN')}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">Price on inquiry</span>
                  )}
                </div>

                {whatsappNumber && (
                  <Button
                    onClick={() => handleWhatsAppOrder(product)}
                    className="w-full text-white text-xs"
                    style={{ background: '#25D366' }}
                  >
                    Order via WhatsApp
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
