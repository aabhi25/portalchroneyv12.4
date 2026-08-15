import OpenAI from 'openai';
import { storage } from '../storage';

export interface ParsedProductQuery {
  productType?: string;
  colors?: string[];
  minPrice?: number;
  maxPrice?: number;
  gender?: 'men' | 'women' | 'unisex' | 'kids';
  searchTerms: string;
}

class ProductQueryParserService {
  async parseQuery(query: string, businessAccountId: string): Promise<ParsedProductQuery> {
    const startTime = Date.now();
    
    const result: ParsedProductQuery = {
      searchTerms: query
    };

    try {
      const account = await storage.getBusinessAccount(businessAccountId);
      const apiKey = account?.openaiApiKey || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        console.log('[QueryParser] No OpenAI API key - returning raw query');
        return result;
      }

      const openai = new OpenAI({ apiKey });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract product search attributes from user queries. Return JSON only.

IMPORTANT: Extract ANY product type the user mentions - clothing, jewelry, electronics, furniture, etc.
Examples:
- "bangles", "bracelets", "rings", "necklaces", "earrings" → extract as productType
- "tshirts", "shorts", "trousers", "jeans", "dresses" → extract as productType
- "phones", "laptops", "watches" → extract as productType

Understand synonyms:
- "tshirts", "t-shirts", "tees" → productType: "t-shirt"
- "bermudas" → productType: "shorts"
- "chinos" → productType: "trousers"
- Color synonyms: "cerulean"/"navy"/"azure" → "blue", "burgundy"/"maroon" → "red"
- Gender: "gents"/"gentleman" → "men", "ladies" → "women"

Price patterns:
- "under 500", "below ₹500" → maxPrice: 500
- "above 1000" → minPrice: 1000
- "200 to 500" → minPrice: 200, maxPrice: 500

Return ONLY valid JSON:
{
  "productType": "string or null",
  "colors": ["array of standard color names"] or null,
  "minPrice": number or null,
  "maxPrice": number or null,
  "gender": "men|women|kids|unisex" or null
}

Only include fields you detect. Return {} if nothing specific detected.`
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0,
        max_tokens: 150
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (content) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.productType) result.productType = parsed.productType;
          if (parsed.colors && parsed.colors.length > 0) result.colors = parsed.colors;
          if (parsed.minPrice !== undefined && parsed.minPrice !== null) result.minPrice = parsed.minPrice;
          if (parsed.maxPrice !== undefined && parsed.maxPrice !== null) result.maxPrice = parsed.maxPrice;
          if (parsed.gender) result.gender = parsed.gender;
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[QueryParser] AI parsed "${query.substring(0, 50)}..." → type: ${result.productType || 'none'}, colors: ${result.colors?.join(',') || 'none'}, price: ${result.minPrice || 'any'}-${result.maxPrice || 'any'} in ${elapsed}ms`);

    } catch (error) {
      console.error('[QueryParser] AI parsing failed:', error);
    }

    return result;
  }

  filterProductsByParsedQuery(
    products: any[],
    parsedQuery: ParsedProductQuery
  ): any[] {
    let filtered = [...products];

    if (parsedQuery.colors && parsedQuery.colors.length > 0) {
      const beforeCount = filtered.length;
      filtered = filtered.filter(p => {
        const nameLower = (p.name || '').toLowerCase();
        return parsedQuery.colors!.some(color => nameLower.includes(color.toLowerCase()));
      });
      console.log(`[QueryParser] Color filter [${parsedQuery.colors.join(', ')}]: ${beforeCount} → ${filtered.length} products`);
    }

    if (parsedQuery.minPrice !== undefined || parsedQuery.maxPrice !== undefined) {
      const beforeCount = filtered.length;
      filtered = filtered.filter(p => {
        const price = parseFloat(p.price) || 0;
        if (parsedQuery.minPrice !== undefined && price < parsedQuery.minPrice) return false;
        if (parsedQuery.maxPrice !== undefined && price > parsedQuery.maxPrice) return false;
        return true;
      });
      console.log(`[QueryParser] Price filter ${parsedQuery.minPrice || 0}-${parsedQuery.maxPrice || '∞'}: ${beforeCount} → ${filtered.length} products`);
    }

    return filtered;
  }
}

export const productQueryParserService = new ProductQueryParserService();
