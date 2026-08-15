/**
 * Product Response Composer
 * 
 * Generates formatted responses for product queries WITHOUT needing a second AI call.
 * This dramatically reduces response time for product-related questions.
 * 
 * Used when:
 * 1. User asks about a specific product (name-based query)
 * 2. Vector search returns highly relevant matches (similarity > 0.6)
 * 3. Simple product information requests (price, description, specs)
 */

interface ProductData {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
  categories?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string; color?: string }>;
  similarity?: number;
}

interface ComposerOptions {
  businessName?: string;
  currencySymbol?: string;
  brandTone?: 'friendly' | 'professional' | 'casual';
  includeCallToAction?: boolean;
}

export class ProductResponseComposer {
  
  /**
   * Check if we can use direct composition instead of AI for this product query
   * Returns true ONLY when we have high confidence the product is relevant
   * 
   * Requires either:
   * 1. High vector similarity score (from semantic search)
   * 2. Query explicitly mentions product name
   */
  static canCompose(
    query: string, 
    products: ProductData[], 
    similarity?: number
  ): boolean {
    if (products.length === 0) {
      return false;
    }
    
    const topProduct = products[0];
    
    // STRICT: Only use composer when we have high confidence match
    // High similarity from vector search = semantic match confirmed
    if (similarity && similarity >= 0.6) {
      return true;
    }
    
    // Check if query explicitly mentions the product name (case-insensitive)
    const queryLower = query.toLowerCase();
    const productNameLower = topProduct.name.toLowerCase();
    
    // Extract significant words from product name (3+ chars)
    const productWords = productNameLower.split(/\s+/).filter(w => w.length >= 3);
    const matchingWords = productWords.filter(word => queryLower.includes(word));
    
    // Require at least 2 significant words from product name to match in query
    // OR the query contains a substantial portion of the product name
    if (matchingWords.length >= 2 || queryLower.includes(productNameLower.substring(0, 15))) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Compose a response for a single product
   */
  static composeSingleProduct(
    product: ProductData, 
    options: ComposerOptions = {}
  ): string {
    const { currencySymbol = '₹', includeCallToAction = true } = options;
    
    const parts: string[] = [];
    
    // Opening line
    parts.push(`Here's the information about the **${product.name}**:`);
    parts.push('');
    
    // Description
    if (product.description) {
      // Clean up description - remove excessive formatting
      const cleanDesc = product.description
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      parts.push(`**Description:** ${cleanDesc}`);
      parts.push('');
    }
    
    // Price
    if (product.price) {
      const formattedPrice = this.formatPrice(product.price, currencySymbol);
      parts.push(`**Price:** ${formattedPrice}`);
      parts.push('');
    }
    
    // Categories if available
    if (product.categories && product.categories.length > 0) {
      const categoryNames = product.categories.map(c => c.name).join(', ');
      parts.push(`**Category:** ${categoryNames}`);
      parts.push('');
    }
    
    // Call to action
    if (includeCallToAction) {
      parts.push('Would you like to know more about this product, or are you interested in placing an order?');
    }
    
    return parts.join('\n').trim();
  }

  /**
   * Compose a BRIEF response for a single product when product cards are displayed
   * Only includes intro and CTA - no description/price since card shows those
   */
  static composeBriefSingleProduct(
    product: ProductData,
    options: ComposerOptions = {}
  ): string {
    const parts: string[] = [];
    
    if (product.categories && product.categories.length > 0) {
      const categoryNames = product.categories.map(c => c.name).join(', ');
      parts.push(`**Category:** ${categoryNames}`);
      parts.push('');
    }
    
    parts.push('Would you like to know more about this product, or are you interested in placing an order?');
    
    return parts.join('\n').trim();
  }

  /**
   * Compose a BRIEF response for multiple products when product cards are displayed
   * Only includes intro and CTA - no detailed listings since cards show those
   */
  static composeBriefMultipleProducts(
    products: ProductData[],
    query: string,
    options: ComposerOptions = {}
  ): string {
    if (products.length === 0) {
      return "Let me help you find the right product! Could you describe what you're looking for in a bit more detail?";
    }
    
    const parts: string[] = [];
    parts.push(`I found ${products.length} product${products.length > 1 ? 's' : ''} that might interest you.`);
    parts.push('');
    parts.push('Would you like more details about any of these, or are you ready to place an order?');
    
    return parts.join('\n').trim();
  }
  
  /**
   * Compose a response for multiple products (comparison or list)
   */
  static composeMultipleProducts(
    products: ProductData[], 
    query: string,
    options: ComposerOptions = {}
  ): string {
    const { currencySymbol = '₹' } = options;
    
    if (products.length === 0) {
      return "Let me help you find the right product! Could you describe what you're looking for in a bit more detail?";
    }
    
    const parts: string[] = [];
    
    // Opening
    parts.push(`I found ${products.length} product${products.length > 1 ? 's' : ''} that might interest you:`);
    parts.push('');
    
    // List each product
    products.slice(0, 5).forEach((product, index) => {
      parts.push(`**${index + 1}. ${product.name}**`);
      
      if (product.price) {
        parts.push(`   Price: ${this.formatPrice(product.price, currencySymbol)}`);
      }
      
      if (product.description) {
        // Truncate long descriptions
        const shortDesc = product.description.length > 150 
          ? product.description.substring(0, 147) + '...'
          : product.description;
        parts.push(`   ${shortDesc}`);
      }
      
      parts.push('');
    });
    
    // If there are more products
    if (products.length > 5) {
      parts.push(`_...and ${products.length - 5} more products available._`);
      parts.push('');
    }
    
    parts.push('Would you like more details about any of these products?');
    
    return parts.join('\n').trim();
  }
  
  /**
   * Format price with currency symbol
   */
  private static formatPrice(price: string | number, symbol: string): string {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    
    if (isNaN(numPrice)) {
      return price.toString();
    }
    
    // Format with Indian numbering system for INR
    if (symbol === '₹') {
      return `${symbol}${numPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
    
    return `${symbol}${numPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  
  /**
   * Determine if a query is asking for price specifically
   */
  static isPriceQuery(query: string): boolean {
    const pricePatterns = [
      /price/i,
      /cost/i,
      /how much/i,
      /rate/i,
      /₹|rs|rupee/i,
      /\$/i,
    ];
    
    return pricePatterns.some(pattern => pattern.test(query));
  }
  
  /**
   * Compose a price-focused response
   */
  static composePriceResponse(
    product: ProductData,
    options: ComposerOptions = {}
  ): string {
    const { currencySymbol = '₹' } = options;
    
    if (!product.price) {
      return `The **${product.name}** is available! For the latest pricing, our team would be happy to provide you with a personalized quote. Would you like to connect with us?`;
    }
    
    const formattedPrice = this.formatPrice(product.price, currencySymbol);
    
    return `The **${product.name}** is priced at **${formattedPrice}**.\n\nWould you like to know more about this product or proceed with an order?`;
  }
}

export const productResponseComposer = new ProductResponseComposer();
