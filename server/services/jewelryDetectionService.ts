import OpenAI from 'openai';
import { storage } from '../storage';

export interface JewelryAttributes {
  metalType?: string;
  finish?: string;
  designComplexity?: string;
  style?: string;
  hasStones?: boolean;
  stoneTypes?: string[];
  stoneColors?: string[];
  stoneSetting?: string;
  dangleElements?: string;
  layers?: string;
  motifs?: string[];
  centerpiece?: string;
  edgeStyle?: string;
  necklineStyle?: string;
  earringStyle?: string;
  bangleStyle?: string;
  // Sub-type detection attributes for better necklace classification
  hasBlackBeads?: boolean;
  chainType?: string; // "thin" | "medium" | "heavy" | "elaborate-chain"
  pendantSize?: string; // "none" | "small" | "medium" | "large" | "elaborate"
  necklaceSubType?: string; // Derived: "mangalsutra" | "bridal-necklace" | "chain-necklace" | "standard-necklace"
  isPlainGold?: boolean; // No stones, no enamel, plain gold
}

export interface DetectedJewelry {
  type: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
    bottomAnchorY?: number; // For necklaces: exact Y% where the lowest point ends (pendant tip, chain end)
  };
  confidence: number;
  description: string;
  attributes?: JewelryAttributes;
}

export interface JewelryDetectionResult {
  success: boolean;
  detectedItems: DetectedJewelry[];
  imageWidth: number;
  imageHeight: number;
  error?: string;
}

class JewelryDetectionService {
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI | null> {
    const openaiApiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
    
    if (!openaiApiKey) {
      return null;
    }
    
    return new OpenAI({ apiKey: openaiApiKey });
  }

  async detectJewelry(imageUrl: string, businessAccountId: string): Promise<JewelryDetectionResult> {
    try {
      console.log('[Jewelry Detection] Analyzing image:', imageUrl.substring(0, 100) + '...');

      // In development, ensure image URLs are absolute for OpenAI
      let finalImageUrl = imageUrl;
      if (process.env.NODE_ENV === 'development' && imageUrl.startsWith('/')) {
        const domain = process.env.APP_DOMAIN || process.env.REPLIT_DEV_DOMAIN || 'localhost:5000';
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        finalImageUrl = `${protocol}://${domain}${imageUrl}`;
        console.log('[Jewelry Detection] Mapping relative URL to absolute for OpenAI:', finalImageUrl);
      }

      const openai = await this.getOpenAIClient(businessAccountId);
      if (!openai) {
        console.log('[Jewelry Detection] No OpenAI API key configured');
        return {
          success: false,
          detectedItems: [],
          imageWidth: 100,
          imageHeight: 100,
          error: 'OpenAI API key not configured'
        };
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert jewelry detection and description AI specializing in Indian jewelry. Analyze images and identify individual jewelry pieces with detailed descriptions AND structured attributes.
            
For each jewelry item found, provide:
1. type: The jewelry category (necklace, earring, ring, bracelet, bangle, pendant, chain, anklet, brooch, maang-tikka, nose-ring, waist-chain)
2. boundingBox: Approximate region as percentages of image (x, y from top-left, width, height)
   - For NECKLACES: Also include "bottomAnchorY" - the exact Y percentage where the necklace's lowest physical point ends (pendant tip, decorative element, or chain end). This is CRITICAL for accurate cropping.
3. confidence: How confident you are (0.0 to 1.0)
4. description: A DETAILED description including ONLY what you can clearly see
5. attributes: Structured attributes for precise matching:

ATTRIBUTE DEFINITIONS (use ONLY these values):
- metalType: "yellow gold" | "white gold" | "rose gold" | "silver" | "platinum" | "oxidized" | "mixed"
- finish: "polished" | "matte" | "antique" | "oxidized" | "textured"
- designComplexity: "minimal" (simple, plain) | "moderate" (some details) | "elaborate" (rich details) | "intricate" (highly detailed)
- style: "traditional" | "contemporary" | "fusion" | "temple" | "kundan" | "meenakari" | "antique" | "bridal"
- hasStones: true | false
- stoneTypes: ["diamond", "ruby", "emerald", "pearl", "kundan", "polki", "cz", "meenakari"] (array, only visible stones)
- stoneColors: ["red", "green", "blue", "white", "pink", "multicolor"] (array, only visible colors)
- stoneSetting: "prong" | "bezel" | "pave" | "channel" | "kundan" | "none"
- dangleElements: "none" | "few" (1-3) | "moderate" (4-8) | "many" (9+)
- layers: "single" | "double" | "multi-tier"
- motifs: ["floral", "paisley", "coin", "temple", "geometric", "leaf", "peacock", "elephant", "lakshmi", "om"] (array)
- centerpiece: "none" | "small pendant" | "large medallion" | "elaborate focal"
- edgeStyle: "smooth" | "scalloped" | "beaded" | "fringed"
- necklineStyle (necklaces only): "choker" | "collar" | "princess" | "matinee" | "opera"
- earringStyle (earrings only): "stud" | "jhumka" | "chandbali" | "hoop" | "drop" | "chandelier"
- bangleStyle (bangles only): "solid" | "openable" | "kada" | "thin stack"
- ringProfile (rings only): "openwork" (hollow/cutout center) | "solid-face" (filled top surface) | "solitaire" (single center stone) | "halo" (center stone with surrounding stones) | "band" (uniform around circumference)
- ringFaceShape (rings only): "star" | "petal" | "flower" | "round" | "oval" | "rectangular" | "square" | "heart" | "geometric" | "irregular"

SUB-TYPE DETECTION (CRITICAL for necklaces - MUST INCLUDE):
- hasBlackBeads: true | false (IMPORTANT: Look carefully for black beads - common in mangalsutra)
- chainType: "thin" (delicate, single strand) | "medium" (standard width) | "heavy" (thick, substantial) | "elaborate-chain" (intricate chain work)
- pendantSize: "none" (no pendant) | "small" (small charm/pendant) | "medium" (moderate pendant) | "large" (prominent pendant) | "elaborate" (large ornate focal piece)
- isPlainGold: true | false (no stones, no enamel, no meenakari - pure gold only)

NECKLACE SUB-TYPE RULES (derive necklaceSubType based on these):
- "mangalsutra": hasBlackBeads=true, OR (thin chain + small pendant + traditional married woman's necklace)
- "bridal-necklace": elaborate chain + large/elaborate pendant + heavy/intricate design + bridal style
- "chain-necklace": no pendant or very minimal, focus is on the chain itself
- "standard-necklace": everything else (typical necklace with pendant)

ACCURACY RULES:
- Only describe what you can clearly see - never guess or fabricate details
- If you cannot identify something clearly, OMIT that attribute
- Prefer fewer accurate attributes over many guessed ones

IMPORTANT:
- Focus ONLY on jewelry items, ignore mannequins, hands, backgrounds, tags, labels
- If earrings appear as a pair, list them as ONE item with type "earring-pair"
- If a necklace has a pendant, treat as ONE necklace (not separate pendant)
- Bounding boxes should be in percentages (0-100) of image dimensions

NECKLACE BOTTOM BOUNDARY (CRITICAL - READ CAREFULLY):
- For necklaces, you MUST trace down the entire necklace to find where it TRULY ENDS
- SCAN FROM TOP TO BOTTOM: Start at the clasp/neck and follow the chain/design all the way down
- The bottomAnchorY is the Y% of the ABSOLUTE LOWEST PIXEL of any necklace element:
  * Pendant tip (if pendant hangs down)
  * Decorative elements at the bottom
  * The lowest point of the chain curve
  * Beads, coins, or dangles at the bottom
- COMMON MISTAKE: Do NOT stop at the main body of the necklace - check if there are hanging elements below
- Example: If a necklace curves down to 65% of the image, bottomAnchorY should be 65, NOT 50
- The bottomAnchorY should ALWAYS be greater than (y + height) of the boundingBox
- This ensures cropping captures the COMPLETE necklace including all hanging elements

Respond in JSON format only:
{
  "detectedItems": [
    {
      "type": "necklace",
      "boundingBox": { "x": 10, "y": 20, "width": 80, "height": 60, "bottomAnchorY": 75 },
      "confidence": 0.95,
      "description": "Yellow gold choker necklace with elaborate floral and coin motifs, multiple dangling teardrops, kundan work with red and green stones",
      "attributes": {
        "metalType": "yellow gold",
        "finish": "polished",
        "designComplexity": "elaborate",
        "style": "traditional",
        "hasStones": true,
        "stoneTypes": ["kundan"],
        "stoneColors": ["red", "green"],
        "stoneSetting": "kundan",
        "dangleElements": "many",
        "layers": "multi-tier",
        "motifs": ["floral", "coin"],
        "centerpiece": "large medallion",
        "edgeStyle": "fringed",
        "necklineStyle": "choker",
        "hasBlackBeads": false,
        "chainType": "elaborate-chain",
        "pendantSize": "elaborate",
        "necklaceSubType": "bridal-necklace",
        "isPlainGold": false
      }
    }
  ],
  "imageWidth": 100,
  "imageHeight": 100
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Detect all jewelry items in this image. Return JSON with bounding boxes as percentages.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: finalImageUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || '';
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Jewelry Detection] Could not parse JSON from response:', content);
        return {
          success: false,
          detectedItems: [],
          imageWidth: 100,
          imageHeight: 100,
          error: 'Failed to parse detection response'
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      console.log(`[Jewelry Detection] Found ${parsed.detectedItems?.length || 0} jewelry items`);

      return {
        success: true,
        detectedItems: parsed.detectedItems || [],
        imageWidth: parsed.imageWidth || 100,
        imageHeight: parsed.imageHeight || 100
      };
    } catch (error: any) {
      console.error('[Jewelry Detection] Error:', error);
      return {
        success: false,
        detectedItems: [],
        imageWidth: 100,
        imageHeight: 100,
        error: error.message
      };
    }
  }

  mapTypeToCategory(type: string): string {
    const typeMap: Record<string, string> = {
      'necklace': 'necklaces',
      'earring': 'earrings',
      'earring-pair': 'earrings',
      'ring': 'rings',
      'bracelet': 'bracelets',
      'bangle': 'bangles',
      'pendant': 'pendants',
      'chain': 'chains',
      'anklet': 'anklets',
      'brooch': 'others',
      'maang-tikka': 'others',
      'nose-ring': 'others',
      'waist-chain': 'others',
    };
    return typeMap[type.toLowerCase()] || 'others';
  }

  async extractAttributesFromCroppedImage(
    croppedImageDataUrl: string, 
    businessAccountId: string
  ): Promise<{ 
    success: boolean; 
    type?: string;
    description?: string; 
    attributes?: JewelryAttributes;
    error?: string;
  }> {
    try {
      console.log('[Jewelry Attributes] Extracting attributes from cropped image');

      const openai = await this.getOpenAIClient(businessAccountId);
      if (!openai) {
        console.log('[Jewelry Attributes] No OpenAI API key configured');
        return { success: false, error: 'OpenAI API key not configured' };
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert jewelry analysis AI specializing in Indian jewelry. Analyze this already-cropped jewelry image and extract detailed attributes.

Provide:
1. type: The jewelry category (necklace, earring, ring, bracelet, bangle, pendant, chain, anklet, brooch, maang-tikka, nose-ring, waist-chain)
2. description: A DETAILED description of the jewelry item
3. attributes: Structured attributes for precise matching

ATTRIBUTE DEFINITIONS (use ONLY these values):
- metalType: "yellow gold" | "white gold" | "rose gold" | "silver" | "platinum" | "oxidized" | "mixed"
- finish: "polished" | "matte" | "antique" | "oxidized" | "textured"
- designComplexity: "minimal" (simple, plain) | "moderate" (some details) | "elaborate" (rich details) | "intricate" (highly detailed)
- style: "traditional" | "contemporary" | "fusion" | "temple" | "kundan" | "meenakari" | "antique" | "bridal"
- hasStones: true | false
- stoneTypes: ["diamond", "ruby", "emerald", "pearl", "kundan", "polki", "cz", "meenakari"] (array, only visible stones)
- stoneColors: ["red", "green", "blue", "white", "pink", "multicolor"] (array, only visible colors)
- stoneSetting: "prong" | "bezel" | "pave" | "channel" | "kundan" | "none"
- dangleElements: "none" | "few" (1-3) | "moderate" (4-8) | "many" (9+)
- layers: "single" | "double" | "multi-tier"
- motifs: ["floral", "paisley", "coin", "temple", "geometric", "leaf", "peacock", "elephant", "lakshmi", "om"] (array)
- centerpiece: "none" | "small pendant" | "large medallion" | "elaborate focal"
- edgeStyle: "smooth" | "scalloped" | "beaded" | "fringed"
- necklineStyle (necklaces only): "choker" | "collar" | "princess" | "matinee" | "opera"
- earringStyle (earrings only): "stud" | "jhumka" | "chandbali" | "hoop" | "drop" | "chandelier"
- bangleStyle (bangles only): "solid" | "openable" | "kada" | "thin stack"
- ringProfile (rings only): "openwork" (hollow/cutout center) | "solid-face" (filled top surface) | "solitaire" (single center stone) | "halo" (center stone with surrounding stones) | "band" (uniform around circumference)
- ringFaceShape (rings only): "star" | "petal" | "flower" | "round" | "oval" | "rectangular" | "square" | "heart" | "geometric" | "irregular"

SUB-TYPE DETECTION (CRITICAL for necklaces - MUST INCLUDE):
- hasBlackBeads: true | false (IMPORTANT: Look carefully for black beads - common in mangalsutra)
- chainType: "thin" (delicate, single strand) | "medium" (standard width) | "heavy" (thick, substantial) | "elaborate-chain" (intricate chain work)
- pendantSize: "none" (no pendant) | "small" (small charm/pendant) | "medium" (moderate pendant) | "large" (prominent pendant) | "elaborate" (large ornate focal piece)
- isPlainGold: true | false (no stones, no enamel, no meenakari - pure gold only)
- necklaceSubType (necklaces only): "mangalsutra" (has black beads OR thin chain + small pendant) | "bridal-necklace" (elaborate + heavy + bridal) | "chain-necklace" (no pendant) | "standard-necklace" (everything else)

ACCURACY RULES:
- Only describe what you can clearly see - never guess or fabricate details
- If you cannot identify something clearly, OMIT that attribute

Respond in JSON format only:
{
  "type": "necklace",
  "description": "Yellow gold choker necklace with elaborate floral and coin motifs...",
  "attributes": {
    "metalType": "yellow gold",
    "finish": "polished",
    "designComplexity": "elaborate",
    "hasBlackBeads": false,
    "chainType": "elaborate-chain",
    "pendantSize": "elaborate",
    "necklaceSubType": "bridal-necklace",
    "isPlainGold": false,
    ...
  }
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this jewelry image and extract its type, description, and attributes.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: croppedImageDataUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || '';
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Jewelry Attributes] Could not parse JSON from response:', content);
        return { success: false, error: 'Failed to parse attributes response' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      console.log(`[Jewelry Attributes] Extracted: type=${parsed.type}, description length=${parsed.description?.length || 0}`);

      return {
        success: true,
        type: parsed.type,
        description: parsed.description,
        attributes: parsed.attributes
      };
    } catch (error: any) {
      console.error('[Jewelry Attributes] Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export const jewelryDetectionService = new JewelryDetectionService();
