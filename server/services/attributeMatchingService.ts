import { JewelryAttributes } from './jewelryDetectionService';

export interface AttributeMatchResult {
  score: number;
  matchedAttributes: string[];
  mismatchedAttributes: string[];
  penalties: { attribute: string; reason: string; penalty: number }[];
  designAttributesMatched: number;
  designAttributesTotal: number;
}

const COMPLEXITY_ORDER = ['minimal', 'moderate', 'elaborate', 'intricate'];
const DANGLE_ORDER = ['none', 'few', 'moderate', 'many'];
const LAYERS_ORDER = ['single', 'double', 'multi-tier'];

const DESIGN_ATTRIBUTES = ['designComplexity', 'dangleElements', 'layers', 'motifs', 'centerpiece', 'silhouette'];
const COMMON_ATTRIBUTES = ['metalType', 'style', 'stoneColors', 'hasStones'];

const MOTIF_GROUPS: Record<string, string[]> = {
  'floral': ['floral', 'flower', 'lotus', 'rose', 'petal', 'leaf', 'vine'],
  'geometric': ['geometric', 'circle', 'square', 'triangle', 'hexagon', 'diamond-shape'],
  'traditional': ['peacock', 'temple', 'paisley', 'elephant', 'mango', 'kalash'],
  'abstract': ['abstract', 'swirl', 'wave', 'spiral', 'curve'],
  'nature': ['bird', 'butterfly', 'star', 'moon', 'sun']
};

const SILHOUETTE_TYPES = {
  'choker': ['choker', 'collar', 'tight'],
  'pendant': ['pendant', 'drop', 'lariat', 'y-chain'],
  'chain': ['chain', 'link', 'rope', 'box-chain'],
  'bib': ['bib', 'statement', 'layered'],
  'princess': ['princess', 'standard', 'classic']
};

class AttributeMatchingService {
  calculateAttributeScore(
    queryAttrs: JewelryAttributes | undefined,
    catalogAttrs: JewelryAttributes | undefined
  ): AttributeMatchResult {
    const NEUTRAL_SCORE = 0.4;
    
    const result: AttributeMatchResult = {
      score: NEUTRAL_SCORE,
      matchedAttributes: [],
      mismatchedAttributes: [],
      penalties: [],
      designAttributesMatched: 0,
      designAttributesTotal: 0
    };

    if (!queryAttrs || !catalogAttrs) {
      return result;
    }

    let totalWeight = 0;
    let weightedScore = 0;
    let designMatched = 0;
    let designTotal = 0;

    // DESIGN ATTRIBUTES - Higher weights (these define the jewelry's look)
    
    // NOTE: designComplexity is REMOVED from score calculation
    // This allows same-design products with different color variants to match
    // even if complexity was extracted differently by AI vision
    // (designComplexity is also non-blocking for disqualification)

    // dangleElements - CRITICAL design attribute (0.18)
    const dangleMatch = this.matchOrderedAttribute(
      queryAttrs.dangleElements,
      catalogAttrs.dangleElements,
      DANGLE_ORDER,
      'dangleElements',
      0.18,
      result
    );
    if (dangleMatch !== null) {
      totalWeight += 0.18;
      weightedScore += dangleMatch * 0.18;
      designTotal++;
      if (dangleMatch >= 0.7) designMatched++;
    }

    // motifs - CRITICAL design attribute (0.18)
    const motifsMatch = this.matchArrayAttribute(
      queryAttrs.motifs,
      catalogAttrs.motifs,
      'motifs',
      0.18,
      result
    );
    if (motifsMatch !== null) {
      totalWeight += 0.18;
      weightedScore += motifsMatch * 0.18;
      designTotal++;
      if (motifsMatch >= 0.3) designMatched++;
    }

    // centerpiece - Important design attribute (0.15)
    const centerpieceMatch = this.matchCenterpieceAttribute(
      queryAttrs.centerpiece,
      catalogAttrs.centerpiece,
      'centerpiece',
      0.15,
      result
    );
    if (centerpieceMatch !== null) {
      totalWeight += 0.15;
      weightedScore += centerpieceMatch * 0.15;
      designTotal++;
      if (centerpieceMatch >= 0.7) designMatched++;
    }

    // layers - Design attribute (0.10)
    const layersMatch = this.matchOrderedAttribute(
      queryAttrs.layers,
      catalogAttrs.layers,
      LAYERS_ORDER,
      'layers',
      0.10,
      result
    );
    if (layersMatch !== null) {
      totalWeight += 0.10;
      weightedScore += layersMatch * 0.10;
      designTotal++;
      if (layersMatch >= 0.7) designMatched++;
    }

    // silhouette - Design attribute for necklaces (0.08)
    const silhouetteMatch = this.matchSilhouetteAttribute(
      (queryAttrs as any).silhouette,
      (catalogAttrs as any).silhouette,
      'silhouette',
      0.08,
      result
    );
    if (silhouetteMatch !== null) {
      totalWeight += 0.08;
      weightedScore += silhouetteMatch * 0.08;
      designTotal++;
      if (silhouetteMatch >= 0.7) designMatched++;
    }

    // COMMON ATTRIBUTES - Lower weights (these are shared by many pieces)
    
    // metalType - Low weight (0.03) - most jewelry shares similar metal types
    // Use specialized matching that treats gold variants as same family
    const metalTypeMatch = this.matchMetalTypeAttribute(
      queryAttrs.metalType,
      catalogAttrs.metalType,
      'metalType',
      0.03,
      result
    );
    if (metalTypeMatch !== null) {
      totalWeight += 0.03;
      weightedScore += metalTypeMatch * 0.03;
    }

    // style - Low weight (0.04) - too broad to be discriminating
    const styleMatch = this.matchStringAttribute(
      queryAttrs.style,
      catalogAttrs.style,
      'style',
      0.04,
      result
    );
    if (styleMatch !== null) {
      totalWeight += 0.04;
      weightedScore += styleMatch * 0.04;
    }

    // stoneColors - Minimal weight (0.02) - color matching handled separately
    const stoneColorsMatch = this.matchArrayAttribute(
      queryAttrs.stoneColors,
      catalogAttrs.stoneColors,
      'stoneColors',
      0.02,
      result
    );
    if (stoneColorsMatch !== null) {
      totalWeight += 0.02;
      weightedScore += stoneColorsMatch * 0.02;
    }

    if (totalWeight > 0) {
      result.score = weightedScore / totalWeight;
    }

    result.designAttributesMatched = designMatched;
    result.designAttributesTotal = designTotal;

    return result;
  }

  private matchCenterpieceAttribute(
    query: string | undefined,
    catalog: string | undefined,
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query && !catalog) return null;
    
    const qHas = query && query.toLowerCase() !== 'none' && query.toLowerCase() !== 'no' && query.trim() !== '';
    const cHas = catalog && catalog.toLowerCase() !== 'none' && catalog.toLowerCase() !== 'no' && catalog.trim() !== '';
    
    if (qHas && !cHas) {
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `Has centerpiece vs No centerpiece`,
        penalty: weight
      });
      return 0.0;
    }
    if (!qHas && cHas) {
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `No centerpiece vs Has centerpiece`,
        penalty: weight
      });
      return 0.0;
    }
    if (qHas && cHas) {
      result.matchedAttributes.push(name);
      return 1.0;
    }
    if (!qHas && !cHas) {
      result.matchedAttributes.push(name);
      return 1.0;
    }
    return null;
  }

  private matchSilhouetteAttribute(
    query: string | undefined,
    catalog: string | undefined,
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query || !catalog) return null;

    const getAllCategories = (silhouette: string): Set<string> => {
      const lower = silhouette.toLowerCase();
      const categories = new Set<string>();
      for (const [category, keywords] of Object.entries(SILHOUETTE_TYPES)) {
        if (keywords.some(kw => lower.includes(kw))) {
          categories.add(category);
        }
      }
      return categories;
    };

    const qCategories = getAllCategories(query);
    const cCategories = getAllCategories(catalog);

    // If no categories detected, fall back to string matching
    if (qCategories.size === 0 || cCategories.size === 0) {
      return this.matchStringAttribute(query, catalog, name, weight, result);
    }

    // Check for ANY overlap between categories
    let hasOverlap = false;
    qCategories.forEach(cat => {
      if (cCategories.has(cat)) hasOverlap = true;
    });

    if (hasOverlap) {
      result.matchedAttributes.push(name);
      return 1.0;
    } else {
      // Partial score for compatible but different types (e.g., princess vs standard)
      // Only penalize extreme mismatches (choker vs pendant/chain)
      const qIsChoker = qCategories.has('choker');
      const cIsChoker = cCategories.has('choker');
      const qIsLong = qCategories.has('pendant') || qCategories.has('chain');
      const cIsLong = cCategories.has('pendant') || cCategories.has('chain');
      
      if ((qIsChoker && cIsLong) || (qIsLong && cIsChoker)) {
        result.mismatchedAttributes.push(name);
        result.penalties.push({
          attribute: name,
          reason: `${Array.from(qCategories).join('/')} vs ${Array.from(cCategories).join('/')}`,
          penalty: weight
        });
        return 0.0;
      }
      
      // Non-extreme mismatch gets partial score
      return 0.5;
    }
  }

  private matchStringAttribute(
    query: string | undefined,
    catalog: string | undefined,
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query || !catalog) return null;

    if (query.toLowerCase() === catalog.toLowerCase()) {
      result.matchedAttributes.push(name);
      return 1.0;
    } else {
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `${query} ≠ ${catalog}`,
        penalty: weight
      });
      return 0.0;
    }
  }

  /**
   * Specialized metal type matching that treats gold variants as same family.
   * White gold, yellow gold, and rose gold are considered equivalent (full score).
   * This prevents filtering out identical designs in different gold colors.
   */
  private matchMetalTypeAttribute(
    query: string | undefined,
    catalog: string | undefined,
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query || !catalog) return null;

    const qLower = query.toLowerCase().trim();
    const cLower = catalog.toLowerCase().trim();

    // Exact match
    if (qLower === cLower) {
      result.matchedAttributes.push(name);
      return 1.0;
    }

    // Define metal families - metals within same family get full score
    const GOLD_FAMILY = ['yellow gold', 'white gold', 'rose gold', 'gold'];
    const SILVER_FAMILY = ['silver', 'sterling silver'];
    const PLATINUM_FAMILY = ['platinum', 'white platinum'];

    const isInFamily = (metal: string, family: string[]) => 
      family.some(f => metal.includes(f) || f.includes(metal));

    // Check if both are in gold family
    const qIsGold = isInFamily(qLower, GOLD_FAMILY);
    const cIsGold = isInFamily(cLower, GOLD_FAMILY);
    
    if (qIsGold && cIsGold) {
      // Both are gold variants - treat as match
      result.matchedAttributes.push(name);
      return 1.0;
    }

    // Check silver family
    const qIsSilver = isInFamily(qLower, SILVER_FAMILY);
    const cIsSilver = isInFamily(cLower, SILVER_FAMILY);
    
    if (qIsSilver && cIsSilver) {
      result.matchedAttributes.push(name);
      return 1.0;
    }

    // Check platinum family  
    const qIsPlatinum = isInFamily(qLower, PLATINUM_FAMILY);
    const cIsPlatinum = isInFamily(cLower, PLATINUM_FAMILY);
    
    if (qIsPlatinum && cIsPlatinum) {
      result.matchedAttributes.push(name);
      return 1.0;
    }

    // White gold and platinum are visually similar - give partial score
    if ((qLower.includes('white gold') && cIsPlatinum) || 
        (cLower.includes('white gold') && qIsPlatinum)) {
      return 0.8;
    }

    // Different metal families - still give partial score (design matters more)
    // Don't add to mismatchedAttributes - metal color shouldn't heavily penalize
    return 0.5;
  }

  private matchOrderedAttribute(
    query: string | undefined,
    catalog: string | undefined,
    order: string[],
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query || !catalog) return null;

    const queryIdx = order.indexOf(query.toLowerCase());
    const catalogIdx = order.indexOf(catalog.toLowerCase());

    if (queryIdx === -1 || catalogIdx === -1) {
      return this.matchStringAttribute(query, catalog, name, weight, result);
    }

    const distance = Math.abs(queryIdx - catalogIdx);

    // Use custom similarity scoring:
    // - Distance 0 (exact match): 1.0
    // - Distance 1 (adjacent, e.g., intricate vs elaborate): 0.9 (high similarity)
    // - Distance 2 (one apart): 0.5
    // - Distance 3+ (extreme mismatch): 0.0
    let similarity: number;
    if (distance === 0) {
      similarity = 1.0;
      result.matchedAttributes.push(name);
    } else if (distance === 1) {
      // Adjacent levels are visually similar - give high score
      // e.g., intricate vs elaborate, moderate vs elaborate
      similarity = 0.9;
      result.matchedAttributes.push(name); // Count as matched for adjacent
    } else if (distance === 2) {
      similarity = 0.5;
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `${query} vs ${catalog} (${distance} steps apart)`,
        penalty: weight * (1 - similarity)
      });
    } else {
      similarity = 0.0;
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `${query} vs ${catalog} (${distance} steps apart)`,
        penalty: weight
      });
    }

    return similarity;
  }

  private matchArrayAttribute(
    query: string[] | undefined,
    catalog: string[] | undefined,
    name: string,
    weight: number,
    result: AttributeMatchResult
  ): number | null {
    if (!query || !catalog || query.length === 0 || catalog.length === 0) {
      return null;
    }

    const querySet = new Set(query.map(s => s.toLowerCase()));
    const catalogSet = new Set(catalog.map(s => s.toLowerCase()));

    let intersection = 0;
    querySet.forEach(item => {
      if (catalogSet.has(item)) intersection++;
    });

    const union = querySet.size + catalogSet.size - intersection;
    const jaccardSimilarity = union > 0 ? intersection / union : 0;

    if (intersection > 0) {
      result.matchedAttributes.push(name);
    }
    if (intersection === 0 && query.length > 0 && catalog.length > 0) {
      result.mismatchedAttributes.push(name);
      result.penalties.push({
        attribute: name,
        reason: `No overlap: [${query.join(', ')}] vs [${catalog.join(', ')}]`,
        penalty: weight
      });
    }

    return jaccardSimilarity;
  }

  combineScores(
    clipScore: number,
    attributeScore: number,
    clipWeight: number = 0.6,
    attributeWeight: number = 0.4
  ): number {
    return (clipScore * clipWeight) + (attributeScore * attributeWeight);
  }

  shouldDisqualify(
    queryAttrs: JewelryAttributes | undefined,
    catalogAttrs: JewelryAttributes | undefined,
    attributeMatchResult?: AttributeMatchResult,
    clipScore?: number,
    catalogProductName?: string
  ): { disqualify: boolean; reason?: string } {
    if (!queryAttrs || !catalogAttrs) {
      return { disqualify: false };
    }

    // HARD FILTER: Necklace sub-type mismatch (CANNOT be bypassed by high CLIP)
    // Mangalsutra vs Bridal/Traditional necklaces are fundamentally different product categories
    const queryNecklaceSubType = (queryAttrs as any).necklaceSubType?.toLowerCase();
    const catalogNecklaceSubType = (catalogAttrs as any).necklaceSubType?.toLowerCase();
    const queryHasBlackBeads = (queryAttrs as any).hasBlackBeads;
    const catalogHasBlackBeads = (catalogAttrs as any).hasBlackBeads;
    
    // Check if product name contains "mangalsutra" as fallback for catalog identification
    const catalogNameIsMangalsutra = catalogProductName?.toLowerCase().includes('mangalsutra') ?? false;
    
    // Detect mangalsutra: has black beads OR explicitly labeled as mangalsutra
    const qIsMangalsutra = queryHasBlackBeads === true || (queryNecklaceSubType && queryNecklaceSubType.includes('mangalsutra'));
    // For catalog: also check product name as fallback when attributes are missing
    const cIsMangalsutra = catalogHasBlackBeads === true || (catalogNecklaceSubType && catalogNecklaceSubType.includes('mangalsutra')) || catalogNameIsMangalsutra;
    
    // Detect bridal/elaborate necklace: explicit bridal label OR elaborate/intricate complexity with no black beads
    const qIsBridal = (queryNecklaceSubType && (queryNecklaceSubType.includes('bridal') || queryNecklaceSubType.includes('wedding'))) ||
                     (queryHasBlackBeads === false && queryAttrs.designComplexity && 
                      ['elaborate', 'intricate'].includes(queryAttrs.designComplexity.toLowerCase()));
    const cIsBridal = (catalogNecklaceSubType && (catalogNecklaceSubType.includes('bridal') || catalogNecklaceSubType.includes('wedding'))) ||
                     (catalogHasBlackBeads === false && catalogAttrs.designComplexity && 
                      ['elaborate', 'intricate'].includes(catalogAttrs.designComplexity.toLowerCase()));
    
    // Hard disqualify: mangalsutra vs ANY non-mangalsutra necklace
    // If query is mangalsutra, catalog must also be mangalsutra (strict category separation)
    if (qIsMangalsutra && !cIsMangalsutra) {
      return {
        disqualify: true,
        reason: `Necklace category mismatch: Mangalsutra vs Non-mangalsutra (catalog has no black beads and no mangalsutra subtype)`
      };
    }
    
    // Hard disqualify: bridal necklace vs mangalsutra
    if (qIsBridal && cIsMangalsutra) {
      return {
        disqualify: true,
        reason: `Necklace category mismatch: Bridal/Elaborate necklace vs Mangalsutra`
      };
    }

    // FIX 4: Require minimum 3 design attributes to match when we have enough data
    // BYPASS: Skip this check for high-CLIP matches (95%+) - visual similarity overrides attribute discrepancies
    const veryHighClipBypass = clipScore !== undefined && clipScore >= 0.95;
    if (attributeMatchResult && attributeMatchResult.designAttributesTotal >= 4 && !veryHighClipBypass) {
      if (attributeMatchResult.designAttributesMatched < 3) {
        return {
          disqualify: true,
          reason: `Insufficient design match: only ${attributeMatchResult.designAttributesMatched}/${attributeMatchResult.designAttributesTotal} design attributes match (need 3+)`
        };
      }
    }

    // NOTE: designComplexity is now NON-BLOCKING (only affects ranking score, not disqualification)
    // This allows same-design products with different color variants to match even if complexity was extracted differently
    // The complexity attribute still contributes to the score calculation in calculateAttributeMatchScore()

    // STRICT: Disqualify if dangle differs by 2+ levels
    // This prevents: none vs moderate, none vs many, few vs many
    // BUT: Skip this check if CLIP score is very high (>90%) - visual similarity overrides attribute mismatch
    const highClipBypass = clipScore !== undefined && clipScore > 0.90;
    if (queryAttrs.dangleElements && catalogAttrs.dangleElements && !highClipBypass) {
      const queryIdx = DANGLE_ORDER.indexOf(queryAttrs.dangleElements.toLowerCase());
      const catalogIdx = DANGLE_ORDER.indexOf(catalogAttrs.dangleElements.toLowerCase());
      if (queryIdx !== -1 && catalogIdx !== -1 && Math.abs(queryIdx - catalogIdx) >= 2) {
        return {
          disqualify: true,
          reason: `Dangle mismatch: ${queryAttrs.dangleElements} vs ${catalogAttrs.dangleElements}`
        };
      }
    }

    // Disqualify only if BOTH have motifs but categories conflict
    // If catalog has no motif data, treat as unknown and let CLIP similarity decide
    const getMotifCategory = (motif: string): string | null => {
      const lower = motif.toLowerCase();
      for (const [category, keywords] of Object.entries(MOTIF_GROUPS)) {
        if (keywords.some(kw => lower.includes(kw))) {
          return category;
        }
      }
      return null;
    };

    const queryHasMotifs = queryAttrs.motifs && queryAttrs.motifs.length > 0;
    const catalogHasMotifs = catalogAttrs.motifs && catalogAttrs.motifs.length > 0;
    
    // Only check for motif conflicts when BOTH have motif data
    // Missing motif data = unknown, not a mismatch (allows variants like gold/silver of same design)
    // BYPASS: Skip this check for high-CLIP matches (95%+) - visual similarity overrides attribute discrepancies
    if (queryHasMotifs && catalogHasMotifs && !veryHighClipBypass) {
      const qCategories = new Set(queryAttrs.motifs!.map(getMotifCategory).filter(Boolean));
      const cCategories = new Set(catalogAttrs.motifs!.map(getMotifCategory).filter(Boolean));
      
      // Check if there's ANY category overlap
      let hasOverlap = false;
      qCategories.forEach(cat => {
        if (cCategories.has(cat)) hasOverlap = true;
      });

      // Disqualify if both have categorized motifs but no overlap (e.g., floral vs geometric)
      if (qCategories.size > 0 && cCategories.size > 0 && !hasOverlap) {
        return {
          disqualify: true,
          reason: `Motif mismatch: [${Array.from(qCategories).join(', ')}] vs [${Array.from(cCategories).join(', ')}]`
        };
      }
    }

    // NEW: Disqualify if centerpiece presence differs (has elaborate pendant vs no centerpiece)
    // BYPASS: Skip this check for high-CLIP matches (>90%) - visual similarity overrides attribute discrepancies
    if ((queryAttrs.centerpiece || catalogAttrs.centerpiece) && !highClipBypass) {
      const qHas = queryAttrs.centerpiece && 
                   queryAttrs.centerpiece.toLowerCase() !== 'none' && 
                   queryAttrs.centerpiece.toLowerCase() !== 'no' &&
                   queryAttrs.centerpiece.trim() !== '';
      const cHas = catalogAttrs.centerpiece && 
                   catalogAttrs.centerpiece.toLowerCase() !== 'none' && 
                   catalogAttrs.centerpiece.toLowerCase() !== 'no' &&
                   catalogAttrs.centerpiece.trim() !== '';
      
      // Only disqualify if one has a prominent centerpiece and the other doesn't
      if (qHas && !cHas) {
        return {
          disqualify: true,
          reason: `Centerpiece mismatch: Has centerpiece vs No centerpiece`
        };
      }
      if (!qHas && cHas) {
        return {
          disqualify: true,
          reason: `Centerpiece mismatch: No centerpiece vs Has centerpiece`
        };
      }
    }

    // Bidirectional stone color disqualification
    // This prevents matching stone jewelry with plain jewelry in EITHER direction
    // BYPASS: Skip all stone checks for high-CLIP matches (95%+) - visual similarity overrides attribute discrepancies
    
    // Case 1: Uploaded has colored stones but product has no stones
    if (queryAttrs.stoneColors && queryAttrs.stoneColors.length > 0 && !veryHighClipBypass) {
      const catalogHasStones = catalogAttrs.hasStones === true || 
        (catalogAttrs.stoneColors && catalogAttrs.stoneColors.length > 0) ||
        (catalogAttrs.stoneTypes && catalogAttrs.stoneTypes.length > 0);
      
      if (!catalogHasStones) {
        return {
          disqualify: true,
          reason: `Stone mismatch: Has colored stones [${queryAttrs.stoneColors.join(', ')}] vs No stones`
        };
      }
    }
    
    // Case 2: Uploaded has NO stones but product has stones
    // Check for explicit hasStones: false, OR infer no stones from any falsy hasStones with empty stone metadata
    const queryHasNoStones = !queryAttrs.hasStones && 
       (!queryAttrs.stoneColors || queryAttrs.stoneColors.length === 0) &&
       (!queryAttrs.stoneTypes || queryAttrs.stoneTypes.length === 0);
    
    if (queryHasNoStones && !veryHighClipBypass) {
      const catalogHasStones = catalogAttrs.hasStones === true || 
        (catalogAttrs.stoneColors && catalogAttrs.stoneColors.length > 0) ||
        (catalogAttrs.stoneTypes && catalogAttrs.stoneTypes.length > 0);
      
      if (catalogHasStones) {
        const stoneDetail = catalogAttrs.stoneColors && catalogAttrs.stoneColors.length > 0
          ? `colored stones [${catalogAttrs.stoneColors.join(', ')}]`
          : catalogAttrs.stoneTypes && catalogAttrs.stoneTypes.length > 0
            ? `stones [${catalogAttrs.stoneTypes.join(', ')}]`
            : 'stones';
        return {
          disqualify: true,
          reason: `Stone mismatch: No stones vs Has ${stoneDetail}`
        };
      }
    }
    
    // Case 3: Both have stones but with different colors
    // Disqualify if query has only neutral colors (white/clear) but catalog has vibrant colors (or vice versa)
    const NEUTRAL_COLORS = ['white', 'clear', 'colorless', 'transparent'];
    const VIBRANT_COLORS = ['red', 'pink', 'blue', 'green', 'yellow', 'purple', 'orange', 'emerald', 'ruby', 'sapphire', 'aqua', 'turquoise'];
    
    // BYPASS: Skip stone color check for high-CLIP matches (95%+)
    if (queryAttrs.stoneColors && queryAttrs.stoneColors.length > 0 &&
        catalogAttrs.stoneColors && catalogAttrs.stoneColors.length > 0 && !veryHighClipBypass) {
      
      const normalizeColor = (color: string) => color.toLowerCase().trim();
      const queryColors = queryAttrs.stoneColors.map(normalizeColor);
      const catalogColors = catalogAttrs.stoneColors.map(normalizeColor);
      
      // Check if query has ONLY neutral colors
      const queryOnlyNeutral = queryColors.every(c => 
        NEUTRAL_COLORS.some(nc => c.includes(nc))
      );
      // Check if catalog has ANY vibrant colors
      const catalogHasVibrant = catalogColors.some(c => 
        VIBRANT_COLORS.some(vc => c.includes(vc))
      );
      
      // Check if catalog has ONLY neutral colors
      const catalogOnlyNeutral = catalogColors.every(c => 
        NEUTRAL_COLORS.some(nc => c.includes(nc))
      );
      // Check if query has ANY vibrant colors
      const queryHasVibrant = queryColors.some(c => 
        VIBRANT_COLORS.some(vc => c.includes(vc))
      );
      
      // Disqualify if one has only neutral and other has vibrant
      if (queryOnlyNeutral && catalogHasVibrant) {
        return {
          disqualify: true,
          reason: `Stone color mismatch: Neutral [${queryColors.join(', ')}] vs Vibrant [${catalogColors.join(', ')}]`
        };
      }
      if (catalogOnlyNeutral && queryHasVibrant) {
        return {
          disqualify: true,
          reason: `Stone color mismatch: Vibrant [${queryColors.join(', ')}] vs Neutral [${catalogColors.join(', ')}]`
        };
      }
    }

    // RELAXED: Only disqualify silhouettes that are truly incompatible (extreme mismatches)
    // e.g., choker (tight around neck) vs lariat/y-chain (long hanging chain)
    const qSilhouette = (queryAttrs as any).silhouette;
    const cSilhouette = (catalogAttrs as any).silhouette;
    if (qSilhouette && cSilhouette) {
      const getAllCategories = (silhouette: string): Set<string> => {
        const lower = silhouette.toLowerCase();
        const categories = new Set<string>();
        for (const [category, keywords] of Object.entries(SILHOUETTE_TYPES)) {
          if (keywords.some(kw => lower.includes(kw))) {
            categories.add(category);
          }
        }
        return categories;
      };

      const qCategories = getAllCategories(qSilhouette);
      const cCategories = getAllCategories(cSilhouette);

      // Only disqualify if BOTH have categories AND there's NO overlap
      // AND they are opposite extremes (choker vs pendant/chain)
      if (qCategories.size > 0 && cCategories.size > 0) {
        let hasOverlap = false;
        qCategories.forEach(cat => {
          if (cCategories.has(cat)) hasOverlap = true;
        });
        
        // Only disqualify for extreme mismatches: choker vs pendant/chain
        const qIsChoker = qCategories.has('choker');
        const cIsChoker = cCategories.has('choker');
        const qIsLong = qCategories.has('pendant') || qCategories.has('chain');
        const cIsLong = cCategories.has('pendant') || cCategories.has('chain');
        
        if (!hasOverlap && ((qIsChoker && cIsLong) || (qIsLong && cIsChoker))) {
          return {
            disqualify: true,
            reason: `Silhouette mismatch: ${Array.from(qCategories).join('/')} vs ${Array.from(cCategories).join('/')}`
          };
        }
      }
    }

    // STRICT: Disqualify if style is EXCLUSIVELY traditional vs EXCLUSIVELY modern
    if (queryAttrs.style && catalogAttrs.style) {
      const qStyle = queryAttrs.style.toLowerCase();
      const cStyle = catalogAttrs.style.toLowerCase();
      const traditionalKeywords = ['traditional', 'ethnic', 'heritage', 'antique', 'temple', 'bridal'];
      const modernKeywords = ['modern', 'minimalist', 'contemporary', 'sleek'];
      
      const qIsTraditional = traditionalKeywords.some(s => qStyle.includes(s));
      const qIsModern = modernKeywords.some(s => qStyle.includes(s));
      const cIsTraditional = traditionalKeywords.some(s => cStyle.includes(s));
      const cIsModern = modernKeywords.some(s => cStyle.includes(s));
      
      const qExclusivelyTraditional = qIsTraditional && !qIsModern;
      const qExclusivelyModern = qIsModern && !qIsTraditional;
      const cExclusivelyTraditional = cIsTraditional && !cIsModern;
      const cExclusivelyModern = cIsModern && !cIsTraditional;
      
      if ((qExclusivelyTraditional && cExclusivelyModern) || (qExclusivelyModern && cExclusivelyTraditional)) {
        return {
          disqualify: true,
          reason: `Style mismatch: ${queryAttrs.style} vs ${catalogAttrs.style}`
        };
      }
    }

    // CLIP-Attribute Discrepancy Check: High CLIP with low matched attributes = likely false positive
    // For rings and other items where we may have limited attribute data, 
    // focus on what we DO have: if we have at least 2 design attributes compared
    // and most of them DON'T match, that's a strong signal of different designs
    if (clipScore !== undefined && attributeMatchResult) {
      const { designAttributesTotal, designAttributesMatched, score } = attributeMatchResult;
      
      // If we have at least 2 design attributes compared and less than half matched,
      // AND CLIP is high (80-98%), this indicates visual surface similarity but different structure
      if (designAttributesTotal >= 2 && clipScore >= 0.80 && clipScore < 0.98) {
        const matchRatio = designAttributesMatched / designAttributesTotal;
        
        // Less than 40% of design attributes matched = likely different design
        if (matchRatio < 0.40 && score < 0.65) {
          return {
            disqualify: true,
            reason: `Design mismatch: only ${designAttributesMatched}/${designAttributesTotal} design attributes match (${(score * 100).toFixed(1)}% attr score)`
          };
        }
      }
    }

    // RING-SPECIFIC DISQUALIFICATION: Check ringProfile and ringFaceShape
    // These are critical for rings to differentiate openwork vs solid, star vs rectangular
    const qRingProfile = (queryAttrs as any).ringProfile;
    const cRingProfile = (catalogAttrs as any).ringProfile;
    const qRingFaceShape = (queryAttrs as any).ringFaceShape;
    const cRingFaceShape = (catalogAttrs as any).ringFaceShape;

    // FALLBACK: If query has distinctive ring shape but catalog has no ring attributes,
    // require higher CLIP (98%+) to match - prevents false positives from legacy catalog items
    const distinctiveQueryShapes = ['openwork', 'star', 'petal', 'flower', 'heart'];
    const qIsDistinctive = (qRingProfile && distinctiveQueryShapes.includes(qRingProfile.toLowerCase())) ||
                          (qRingFaceShape && distinctiveQueryShapes.includes(qRingFaceShape.toLowerCase()));
    
    if (qIsDistinctive && !cRingProfile && !cRingFaceShape) {
      // Query has distinctive shape but catalog has no ring data - suspicious match
      // Require high CLIP (85%+) to allow this, otherwise disqualify
      if (clipScore !== undefined && clipScore < 0.85) {
        return {
          disqualify: true,
          reason: `Distinctive ring shape (${qRingProfile || qRingFaceShape}) vs unknown catalog ring - requires 85%+ CLIP`
        };
      }
    }

    // Ring profile mismatch: openwork vs solid-face is a fundamental structural difference
    if (qRingProfile && cRingProfile) {
      const OPENWORK_PROFILES = ['openwork'];
      const SOLID_PROFILES = ['solid-face', 'solitaire', 'halo'];
      
      const qIsOpenwork = OPENWORK_PROFILES.includes(qRingProfile.toLowerCase());
      const qIsSolid = SOLID_PROFILES.includes(qRingProfile.toLowerCase());
      const cIsOpenwork = OPENWORK_PROFILES.includes(cRingProfile.toLowerCase());
      const cIsSolid = SOLID_PROFILES.includes(cRingProfile.toLowerCase());
      
      // Disqualify if one is openwork and other is solid
      if ((qIsOpenwork && cIsSolid) || (qIsSolid && cIsOpenwork)) {
        return {
          disqualify: true,
          reason: `Ring profile mismatch: ${qRingProfile} vs ${cRingProfile}`
        };
      }
    }

    // Ring face shape mismatch: star/petal vs rectangular/square is a clear visual difference
    if (qRingFaceShape && cRingFaceShape) {
      const ORGANIC_SHAPES = ['star', 'petal', 'flower', 'heart', 'irregular'];
      const GEOMETRIC_SHAPES = ['rectangular', 'square', 'geometric'];
      const ROUND_SHAPES = ['round', 'oval'];
      
      const getShapeCategory = (shape: string): string => {
        const lower = shape.toLowerCase();
        if (ORGANIC_SHAPES.includes(lower)) return 'organic';
        if (GEOMETRIC_SHAPES.includes(lower)) return 'geometric';
        if (ROUND_SHAPES.includes(lower)) return 'round';
        return 'other';
      };
      
      const qCategory = getShapeCategory(qRingFaceShape);
      const cCategory = getShapeCategory(cRingFaceShape);
      
      // Disqualify if shape categories are different (organic vs geometric, etc.)
      if (qCategory !== 'other' && cCategory !== 'other' && qCategory !== cCategory) {
        return {
          disqualify: true,
          reason: `Ring face shape mismatch: ${qRingFaceShape} (${qCategory}) vs ${cRingFaceShape} (${cCategory})`
        };
      }
    }

    // =============================================================================
    // NECKLACE SUB-TYPE DETECTION & ANTI-FEATURE MATCHING (NEW)
    // These rules only fire when BOTH query AND catalog have the relevant attributes
    // This ensures backward compatibility with catalog items that haven't been re-processed
    // =============================================================================

    // BLACK BEADS MISMATCH (CRITICAL for mangalsutra detection)
    // Only check if BOTH items have explicit hasBlackBeads attribute
    const qHasBlackBeadsAttr = (queryAttrs as any).hasBlackBeads;
    const cHasBlackBeadsAttr = (catalogAttrs as any).hasBlackBeads;
    const qHasBlackBeads = qHasBlackBeadsAttr === true;
    const cHasBlackBeads = cHasBlackBeadsAttr === true;
    
    // Only disqualify if BOTH have explicit values (not undefined)
    if (qHasBlackBeadsAttr !== undefined && cHasBlackBeadsAttr !== undefined) {
      if (qHasBlackBeads && !cHasBlackBeads) {
        return {
          disqualify: true,
          reason: `Black beads mismatch: Query has black beads (mangalsutra) but catalog does not`
        };
      }
      
      // Reverse: catalog has black beads but query doesn't - also filter
      if (!qHasBlackBeads && cHasBlackBeads) {
        return {
          disqualify: true,
          reason: `Black beads mismatch: Catalog has black beads (mangalsutra) but query does not`
        };
      }
    }

    // NECKLACE SUB-TYPE MISMATCH
    // Mangalsutra should not match bridal-necklace and vice versa
    // Only applies when BOTH have necklaceSubType defined
    const qSubType = ((queryAttrs as any).necklaceSubType || '').toLowerCase();
    const cSubType = ((catalogAttrs as any).necklaceSubType || '').toLowerCase();
    
    // Only check if BOTH have sub-type defined (non-empty)
    if (qSubType && cSubType) {
      // Mangalsutra vs bridal-necklace is a fundamental mismatch
      const isMangalsutra = (type: string) => type === 'mangalsutra';
      const isBridal = (type: string) => type === 'bridal-necklace' || type === 'bridal';
      
      if ((isMangalsutra(qSubType) && isBridal(cSubType)) || 
          (isBridal(qSubType) && isMangalsutra(cSubType))) {
        return {
          disqualify: true,
          reason: `Necklace sub-type mismatch: ${qSubType} vs ${cSubType}`
        };
      }
      
      // Chain necklace vs elaborate bridal is also a mismatch
      const isChain = (type: string) => type === 'chain-necklace' || type === 'chain';
      if ((isChain(qSubType) && isBridal(cSubType)) || 
          (isBridal(qSubType) && isChain(cSubType))) {
        return {
          disqualify: true,
          reason: `Necklace sub-type mismatch: ${qSubType} vs ${cSubType}`
        };
      }
    }

    // PLAIN GOLD vs STONES/ENAMEL MISMATCH
    // Only check isPlainGold when the attribute is explicitly set
    const qIsPlainGoldAttr = (queryAttrs as any).isPlainGold;
    const cIsPlainGoldAttr = (catalogAttrs as any).isPlainGold;
    
    // Query is explicitly plain gold but catalog has stones - disqualify
    if (qIsPlainGoldAttr === true) {
      const catalogHasStones = catalogAttrs.hasStones === true || 
        (catalogAttrs.stoneColors && catalogAttrs.stoneColors.length > 0) ||
        (catalogAttrs.stoneTypes && catalogAttrs.stoneTypes.length > 0);
      
      if (catalogHasStones) {
        return {
          disqualify: true,
          reason: `Material mismatch: Query is plain gold but catalog has stones/embellishments`
        };
      }
    }
    
    // Catalog is explicitly plain gold but query has significant stones - disqualify
    if (cIsPlainGoldAttr === true) {
      const queryHasSignificantStones = queryAttrs.hasStones === true && 
        ((queryAttrs.stoneColors && queryAttrs.stoneColors.length > 0) ||
         (queryAttrs.stoneTypes && queryAttrs.stoneTypes.length > 0));
      
      if (queryHasSignificantStones) {
        return {
          disqualify: true,
          reason: `Material mismatch: Query has stones/embellishments but catalog is plain gold`
        };
      }
    }

    // CHAIN TYPE MISMATCH for necklaces
    // Only check when BOTH have chainType defined
    const qChainType = ((queryAttrs as any).chainType || '').toLowerCase();
    const cChainType = ((catalogAttrs as any).chainType || '').toLowerCase();
    
    // Only check if BOTH have chain type defined (non-empty)
    if (qChainType && cChainType) {
      const THIN_CHAINS = ['thin', 'delicate'];
      const HEAVY_CHAINS = ['heavy', 'elaborate-chain', 'elaborate'];
      
      const qIsThin = THIN_CHAINS.some(t => qChainType.includes(t));
      const qIsHeavy = HEAVY_CHAINS.some(t => qChainType.includes(t));
      const cIsThin = THIN_CHAINS.some(t => cChainType.includes(t));
      const cIsHeavy = HEAVY_CHAINS.some(t => cChainType.includes(t));
      
      // Thin vs heavy chain is a fundamental mismatch
      if ((qIsThin && cIsHeavy) || (qIsHeavy && cIsThin)) {
        return {
          disqualify: true,
          reason: `Chain type mismatch: ${qChainType} vs ${cChainType}`
        };
      }
    }

    // PENDANT SIZE MISMATCH
    // Only check when BOTH have pendantSize defined
    const qPendantSize = ((queryAttrs as any).pendantSize || '').toLowerCase();
    const cPendantSize = ((catalogAttrs as any).pendantSize || '').toLowerCase();
    
    // Only check if BOTH have pendant size defined (non-empty)
    if (qPendantSize && cPendantSize) {
      const NO_PENDANT = ['none', 'no'];
      const ELABORATE_PENDANT = ['elaborate', 'large'];
      
      const qHasNone = NO_PENDANT.some(p => qPendantSize.includes(p));
      const qIsElaborate = ELABORATE_PENDANT.some(p => qPendantSize.includes(p));
      const cHasNone = NO_PENDANT.some(p => cPendantSize.includes(p));
      const cIsElaborate = ELABORATE_PENDANT.some(p => cPendantSize.includes(p));
      
      // No pendant vs elaborate pendant is a fundamental mismatch
      if ((qHasNone && cIsElaborate) || (qIsElaborate && cHasNone)) {
        return {
          disqualify: true,
          reason: `Pendant size mismatch: ${qPendantSize} vs ${cPendantSize}`
        };
      }
    }

    return { disqualify: false };
  }
}

export const attributeMatchingService = new AttributeMatchingService();
