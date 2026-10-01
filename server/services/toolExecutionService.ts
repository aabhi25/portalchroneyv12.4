import { storage } from '../storage';
import { db } from '../db';
import { k12Topics, k12Questions } from '@shared/schema';
import { ilike, or, eq, and, sql } from 'drizzle-orm';
import { getK12ContentResolver } from './k12ContentResolver';
import { addDays, startOfDay, endOfDay, format, parseISO, isAfter, isBefore } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { updateLeadWithTopics } from './topicExtractionService';
import { extractUtmCampaign, extractUtmSource, extractUtmMedium } from './leadsquaredService';
import { productTextEmbeddingService } from './productTextEmbeddingService';
import { productQueryParserService } from './productQueryParserService';
import { describePhoneRule, validatePhoneNumber } from '../../shared/validation/phone';
import {
  applyWhatsappCapture, getConversationLead, isValidEmail, isValidLeadName, phoneModeFor, planForConversation,
  syncConversationLeadIfReady, updateLeadCaptureState, upsertConversationLead, type LeadPlan,
} from './leadCapture';
import { createOpenAI } from "../lib/openaiClient";

const IST_TIMEZONE = 'Asia/Kolkata';

// Auto-sync lead to LeadSquared CRM (async, non-blocking)
// changedFields: optional array of database field names that changed (for updates)
export async function syncLeadToLeadSquared(
  lead: { id: string; name?: string | null; email?: string | null; phone?: string | null; leadsquaredLeadId?: string | null; sourceUrl?: string | null; whatsapp?: string | null },
  businessAccountId: string,
  isUpdate: boolean = false,
  changedFields?: string[]
): Promise<void> {
  try {
    const settings = await storage.getWidgetSettings(businessAccountId);
    if (!settings?.leadsquaredEnabled || settings.leadsquaredEnabled !== 'true') {
      return;
    }
    
    const { hasLeadSquaredCredentials, createLeadSquaredServiceFromSettings, buildJourneyCrmContext, buildConversationCrmContext } = await import('./leadsquaredService');
    if (!hasLeadSquaredCredentials(settings, { requireRegion: true })) {
      console.log('[LeadSquared-Tool] Auto-sync enabled but credentials not configured');
      return;
    }

    let leadsquaredService;
    try {
      leadsquaredService = await createLeadSquaredServiceFromSettings(settings);
    } catch (decryptError) {
      console.error('[LeadSquared-Tool] Failed to decrypt stored credentials:', decryptError);
      return;
    }
    if (!leadsquaredService) return;
    
    // Get business account info for additional fields
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    // Get full lead record to access all fields (city, createdAt, whatsapp, etc.)
    const fullLead = await storage.getLead(lead.id, businessAccountId);

    // CAPTCHA status lives on the conversation, not the lead. Resolve it so it
    // can be mapped to a CRM field (lead.captchaStatus). Best-effort: never
    // block a sync because the conversation lookup failed.
    let captchaStatus: string | null = null;
    try {
      const convId = (fullLead as any)?.conversationId;
      if (convId) {
        const conv = await storage.getConversation(convId, businessAccountId);
        captchaStatus = (conv as any)?.captchaStatus ?? null;
      }
    } catch (convErr) {
      console.error('[LeadSquared-Tool] captchaStatus lookup failed (continuing):', convErr);
    }
    
    // Get field mappings from database (dynamic, configurable)
    const fieldMappings = await storage.getLeadsquaredFieldMappings(businessAccountId);
    
    // Build context for dynamic field mapping (with full lead data for consistency)
    const sourceUrl = fullLead?.sourceUrl || lead.sourceUrl || null;

    // AI URL extraction — only runs when a mapping uses urlLookup.*
    let urlExtraction: { university?: string; product?: string } = {};
    const needsUrlExtraction = fieldMappings.some(
      m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('urlLookup.')
    );
    if (needsUrlExtraction && sourceUrl) {
      try {
        const { extractProductFromUrl } = await import('./urlExtractionService');
        const extractionConfig = {
          domain: settings.lsqExtractionDomain || undefined,
          universities: settings.lsqExtractionUniversities || undefined,
          products: settings.lsqExtractionProducts || undefined,
          fallbackUniversity: settings.lsqExtractionFallbackUniversity || 'Any',
          fallbackProduct: settings.lsqExtractionFallbackProduct || 'All Product',
        };
        urlExtraction = await extractProductFromUrl(sourceUrl, businessAccountId, extractionConfig);
        console.log('[LeadSquared-Tool] URL extraction result:', urlExtraction);
      } catch (err) {
        console.error('[LeadSquared-Tool] URL extraction failed, continuing without it:', err);
      }
    }

    // Journey answers (journey.* mappings) — only queried when a mapping needs them.
    let journeyContext: Record<string, string> = {};
    const needsJourney = fieldMappings.some(
      m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('journey.')
    );
    if (needsJourney) {
      const convId = (fullLead as any)?.conversationId;
      journeyContext = await buildJourneyCrmContext(convId);
    }

    // Conversation summary/topics (conversation.* mappings) — only queried when needed.
    let conversationContext: { summary?: string | null; topics?: string | null } = {};
    const needsConversation = fieldMappings.some(
      m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('conversation.')
    );
    if (needsConversation) {
      const convId = (fullLead as any)?.conversationId;
      conversationContext = await buildConversationCrmContext(convId);
    }

    const leadContext = {
      lead: {
        name: fullLead?.name || lead.name || null,
        email: fullLead?.email || lead.email || null,
        phone: fullLead?.phone || lead.phone || null,
        // leads has no whatsapp column: website chat passes it from the conversation's lead state.
        whatsapp: (fullLead as any)?.whatsapp || lead.whatsapp || null,
        createdAt: fullLead?.createdAt || null,
        sourceUrl: sourceUrl,
        captchaStatus,
      },
      session: {
        city: fullLead?.city || null,
        utmCampaign: extractUtmCampaign(sourceUrl) || null,
        utmSource: extractUtmSource(sourceUrl) || null,
        utmMedium: extractUtmMedium(sourceUrl) || null,
        pageUrl: sourceUrl,
      },
      business: {
        name: businessAccount?.name || null,
        website: businessAccount?.website || null,
      },
      urlExtraction: urlExtraction,
      ...(Object.keys(journeyContext).length ? { journey: journeyContext } : {}),
      ...(conversationContext.summary || conversationContext.topics ? { conversation: conversationContext } : {}),
    };
    
    console.log('[LeadSquared-Tool] Auto-sync using dynamic field mappings, count:', fieldMappings.length);
    
    await (await import('./leadsquaredRetryWorker')).markLeadsquaredSyncPending(lead.id, businessAccountId);
    if (isUpdate && lead.leadsquaredLeadId) {
      console.log('[LeadSquared-Tool] Auto-syncing lead update:', lead.id, '→', lead.leadsquaredLeadId);
      const result = await leadsquaredService.updateLeadWithMappings(lead.leadsquaredLeadId, fieldMappings, leadContext, changedFields);
      
      if (result.success) {
        await storage.updateLead(lead.id, businessAccountId, {
          leadsquaredSyncStatus: 'synced',
          leadsquaredSyncedAt: new Date(),
          leadsquaredSyncPayload: result.syncPayload || null
        });
        console.log('[LeadSquared-Tool] Lead update synced successfully:', lead.id);
      } else {
        console.error('[LeadSquared-Tool] Lead update sync failed:', lead.id, result.message);
        await storage.updateLead(lead.id, businessAccountId, {
          leadsquaredSyncStatus: 'failed',
          leadsquaredSyncError: result.message
        });
      }
    } else {
      const action = isUpdate ? 'syncing existing unsynced lead' : 'syncing new lead';
      console.log(`[LeadSquared-Tool] Auto-${action}:`, lead.id);
      const result = await leadsquaredService.createLeadWithMappings(fieldMappings, leadContext);
      
      if (result.success) {
        await storage.updateLead(lead.id, businessAccountId, {
          // Only overwrite the stored ID when we actually got one (duplicates have none).
          ...(result.leadId ? { leadsquaredLeadId: result.leadId } : {}),
          leadsquaredSyncStatus: 'synced',
          leadsquaredSyncedAt: new Date(),
          leadsquaredSyncError: null,
          leadsquaredSyncPayload: result.syncPayload || null
        });
        console.log('[LeadSquared-Tool] Lead synced successfully:', lead.id, '→', result.leadId || (result.alreadyExists ? 'already exists' : 'no id'));
      } else {
        console.error('[LeadSquared-Tool] Lead sync failed:', lead.id, result.message);
        await storage.updateLead(lead.id, businessAccountId, {
          leadsquaredSyncStatus: 'failed',
          leadsquaredSyncError: result.message
        });
      }
    }
  } catch (error: any) {
    console.error('[LeadSquared-Tool] Auto-sync error:', error);
  }
}

interface ToolExecutionContext {
  businessAccountId: string;
  userId: string;
  conversationId?: string;
  visitorCity?: string;
  userMessage?: string; // For detecting language and translating product fields
  selectedLanguage?: string; // Explicitly selected language from picker (overrides auto-detection)
  channel?: 'widget' | 'whatsapp' | 'instagram' | 'facebook' | 'other'; // Source channel — OTP gating only runs on 'widget' in v1
  skipLeadTraining?: boolean; // Signed student/guidance surfaces must not create sales leads
  cpId?: string | null; // TopScholar: content-package id bound to this conversation; scopes curriculum retrieval
  cpIds?: string[] | null; // TopScholar grade-scoped widget: cp_id set resolved from student board/medium/grade (empty array = refuse, null = whole-account)
  chapter?: string | null; // TopScholar: optional chapter narrowing on top of cpIds; blank/undefined = whole-subject
}

interface ToolResponse {
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
  [key: string]: any; // Allow additional properties like pagination
}

export class ToolExecutionService {
  static async executeTool(
    toolName: string,
    parameters: any,
    context: ToolExecutionContext,
    userMessage?: string,
    appointmentsEnabled: boolean = true
  ): Promise<ToolResponse> {
    try {
      switch (toolName) {
        case 'get_products':
          return await this.handleGetProducts(parameters, context);
        
        case 'get_faqs':
          return await this.handleGetFaqs(parameters, context);
        
        case 'capture_lead':
          if (context.skipLeadTraining) {
            console.warn('[ToolExecution] Blocked capture_lead on a lead-free tutoring/guidance surface');
            return {
              success: false,
              message: 'Contact capture is unavailable in this tutoring conversation.',
            };
          }
          return await this.handleCaptureLead(parameters, context, userMessage, appointmentsEnabled);

        case 'verify_phone_otp':
          return await this.handleVerifyPhoneOtp(parameters, context);

        case 'resend_phone_otp':
          return await this.handleResendPhoneOtp(parameters, context);
        
        case 'list_available_slots':
          if (context.skipLeadTraining) {
            console.warn('[ToolExecution] Blocked generic appointment flow on a lead-free tutoring/guidance surface');
            return {
              success: false,
              message: 'Appointment booking is unavailable in this tutoring conversation.',
            };
          }
          return await this.handleListAvailableSlots(parameters, context);
        
        case 'book_appointment':
          if (context.skipLeadTraining) {
            console.warn('[ToolExecution] Blocked generic appointment flow on a lead-free tutoring/guidance surface');
            return {
              success: false,
              message: 'Appointment booking is unavailable in this tutoring conversation.',
            };
          }
          return await this.handleBookAppointment(parameters, context);
        
        case 'get_journey_progress':
          return await this.handleGetJourneyProgress(context);
        
        case 'record_current_journey_answer':
          return await this.handleRecordCurrentJourneyAnswer(parameters, context);
        
        case 'skip_current_journey_step':
          return await this.handleSkipCurrentJourneyStep(parameters, context);
        
        case 'complete_journey':
          return await this.handleCompleteJourney(parameters, context);
        
        case 'fetch_k12_topic':
          return await this.handleFetchK12Topic(parameters, context);
        
        case 'fetch_k12_questions':
          return await this.handleFetchK12Questions(parameters, context);

        case 'search_jobs':
          return await this.handleSearchJobs(parameters, context);

        case 'parse_resume_and_match':
          return await this.handleParseResumeAndMatch(parameters, context);

        case 'apply_to_job':
          return await this.handleApplyToJob(parameters, context);

        case 'show_order_lookup_options':
          return await this.handleShowOrderLookupOptions(context);

        case 'track_order':
          return await this.handleTrackOrder(parameters, context);

        case 'initiate_return':
          return await this.handleInitiateReturn(parameters, context);
        
        default:
          return {
            success: false,
            error: `Unknown tool: ${toolName}`
          };
      }
    } catch (error: any) {
      return this.createErrorResponse(error.message || 'Tool execution failed');
    }
  }

  private static createErrorResponse(error: string): ToolResponse {
    return {
      success: false,
      error
    };
  }

  private static createSuccessResponse(message?: string, data?: any): ToolResponse {
    return {
      success: true,
      ...(message && { message }),
      ...(data && { data })
    };
  }

  private static async runVectorSearch(
    query: string, 
    businessAccountId: string, 
    startTime: number
  ): Promise<{ products: any[], threshold: number }> {
    const thresholds = [0.6, 0.5, 0.4];
    
    for (const threshold of thresholds) {
      try {
        const vectorResults = await productTextEmbeddingService.searchProducts(
          query,
          businessAccountId,
          20,
          threshold
        );
        
        if (vectorResults.length > 0) {
          console.log(`[Product Search] Vector: "${query}" → ${vectorResults.length} matches (threshold: ${threshold}, ${Date.now() - startTime}ms)`);
          
          const products = await Promise.all(
            vectorResults.map(async (vr) => {
              const [categories, tags] = await Promise.all([
                storage.getProductCategories(vr.id),
                storage.getProductTags(vr.id)
              ]);
              
              return {
                id: vr.id,
                name: vr.name,
                description: vr.description,
                price: vr.price,
                imageUrl: vr.imageUrl,
                categories: categories.map(c => ({ id: c.id, name: c.name })),
                tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color }))
              };
            })
          );
          
          return { products, threshold };
        }
      } catch (error: any) {
        console.log(`[Product Search] Vector search failed at threshold ${threshold}: ${error.message}`);
      }
    }
    
    return { products: [], threshold: 0 };
  }

  private static async findProductsByCategoryTag(
    productType: string, 
    businessAccountId: string
  ): Promise<any[]> {
    try {
      const typeLower = productType.toLowerCase();
      const allProducts = await storage.getAllProducts(businessAccountId);
      
      // Fetch categories/tags for ALL products in PARALLEL
      const productsWithMeta = await Promise.all(
        allProducts.map(async (p) => {
          const [categories, tags] = await Promise.all([
            storage.getProductCategories(p.id),
            storage.getProductTags(p.id)
          ]);
          return { product: p, categories, tags };
        })
      );
      
      // Helper function to check if search term matches target using word boundaries
      // Uses regex \b to prevent "ring" matching inside "earring"
      // Supports singular/plural matching (ring/rings)
      const wordsMatch = (searchTerm: string, targetName: string): boolean => {
        const searchLower = searchTerm.toLowerCase().trim();
        const targetLower = targetName.toLowerCase().trim();
        
        // Escape regex special characters in search term
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Build pattern that matches the search term as a whole word (with optional trailing 's')
        // \b = word boundary - prevents "ring" matching inside "earring"
        const searchBase = searchLower.endsWith('s') ? searchLower.slice(0, -1) : searchLower;
        const pattern = new RegExp(`\\b${escapeRegex(searchBase)}s?\\b`, 'i');
        
        return pattern.test(targetLower);
      };
      
      // Filter in memory for category/tag matches using word boundary matching
      const matchingProducts = productsWithMeta
        .filter(({ categories, tags }) => {
          const categoryMatch = categories.some(c => wordsMatch(typeLower, c.name));
          const tagMatch = tags.some(t => wordsMatch(typeLower, t.name));
          return categoryMatch || tagMatch;
        })
        .map(({ product: p, categories, tags }) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          imageUrl: p.imageUrl,
          categories: categories.map(c => ({ id: c.id, name: c.name })),
          tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color }))
        }));
      
      console.log(`[Product Search] Category/Tag match for "${productType}" → ${matchingProducts.length} products`);
      return matchingProducts;
    } catch (error: any) {
      console.log(`[Product Search] Category/tag search failed: ${error.message}`);
      return [];
    }
  }

  private static async handleGetProducts(params: any, context: ToolExecutionContext): Promise<ToolResponse> {
    const startTime = Date.now();
    
    // BROWSE INTENT DETECTION: Check if query is generic browsing request
    const browseIntentPatterns = [
      /^products?$/i,
      /^items?$/i,
      /^catalog(ue)?$/i,
      /^show\s*(me\s*)?(your\s*)?(all\s*)?(the\s*)?products?$/i,
      /^show\s*(me\s*)?(your\s*)?(all\s*)?(the\s*)?items?$/i,
      /^what\s*(do\s*)?you\s*have$/i,
      /^what('s|s)?\s*(in\s*)?(your\s*)?stock$/i,
      /^browse$/i,
      /^see\s*(all\s*)?products?$/i,
      /^view\s*(all\s*)?products?$/i,
      /^list\s*(all\s*)?products?$/i,
      /^all\s*products?$/i,
    ];
    
    const isBrowseIntent = params.search && browseIntentPatterns.some(pattern => pattern.test(params.search.trim()));
    
    if (isBrowseIntent) {
      console.log(`[Product Search] Browse intent detected for: "${params.search}" - returning random products`);
      
      // Get all products and return random selection
      const allProducts = await storage.getAllProducts(context.businessAccountId);
      
      if (allProducts.length > 0) {
        // Shuffle products for random selection
        const shuffled = [...allProducts].sort(() => Math.random() - 0.5);
        
        // Apply pagination - max 5 products per request
        const limit = 5;
        const offset = params.offset || 0;
        const totalCount = shuffled.length;
        const paginatedProducts = shuffled.slice(offset, offset + limit);
        const hasMore = (offset + limit) < totalCount;
        const nextOffset = hasMore ? offset + limit : null;
        
        // Fetch categories and tags for the paginated products
        let productsWithMeta = await Promise.all(
          paginatedProducts.map(async (p) => {
            const [categories, tags] = await Promise.all([
              storage.getProductCategories(p.id),
              storage.getProductTags(p.id)
            ]);
            return {
              id: p.id,
              name: p.name,
              description: p.description,
              price: p.price,
              imageUrl: p.imageUrl,
              categories: categories.map(c => ({ id: c.id, name: c.name })),
              tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color }))
            };
          })
        );
        
        // Translate product fields if user message is in non-English language
        if (context.userMessage && productsWithMeta.length > 0) {
          productsWithMeta = await this.translateProductFieldsIfNeeded(productsWithMeta, context.userMessage, context.businessAccountId, context.selectedLanguage);
        }
        
        console.log(`[Product Search] Browse intent: returned ${productsWithMeta.length} of ${totalCount} random products (${Date.now() - startTime}ms)`);
        
        return {
          success: true,
          data: productsWithMeta,
          pagination: {
            total: totalCount,
            offset: offset,
            limit: limit,
            hasMore: hasMore,
            nextOffset: nextOffset,
            showing: productsWithMeta.length,
            filters: {
              search: params.search || null,
              minPrice: params.min_price !== undefined ? params.min_price : null,
              maxPrice: params.max_price !== undefined ? params.max_price : null,
            }
          },
          message: `Showing ${productsWithMeta.length} of ${totalCount} product(s)`
        };
      }
    }
    
    // ENTERPRISE: Parse query to extract structured attributes (color, type, price, etc.)
    let parsedQuery = null;
    if (params.search) {
      parsedQuery = await productQueryParserService.parseQuery(params.search, context.businessAccountId);
    }
    
    // Try vector search first if search query provided
    let filteredProducts: any[] = [];
    let usedVectorSearch = false;
    
    if (params.search) {
      // Run vector search AND category/tag match in PARALLEL
      const vectorSearchPromise = this.runVectorSearch(params.search, context.businessAccountId, startTime);
      const categoryTagSearchTerm = parsedQuery?.productType || params.search;
      const categoryTagPromise = categoryTagSearchTerm
        ? this.findProductsByCategoryTag(categoryTagSearchTerm, context.businessAccountId)
        : Promise.resolve([]);
      
      const [vectorResults, categoryTagResults] = await Promise.all([vectorSearchPromise, categoryTagPromise]);
      
      if (vectorResults.products.length > 0 || categoryTagResults.length > 0) {
        usedVectorSearch = true;
        
        // Merge and deduplicate results (vector results first, then category/tag matches)
        const seenIds = new Set<string>();
        const mergedProducts: any[] = [];
        
        // Add vector results first (higher priority)
        for (const p of vectorResults.products) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            mergedProducts.push(p);
          }
        }
        
        // Add category/tag matches (if not already included)
        for (const p of categoryTagResults) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            mergedProducts.push(p);
          }
        }
        
        console.log(`[Product Search] Query: "${params.search}" → vector: ${vectorResults.products.length}, category/tag: ${categoryTagResults.length}, merged: ${mergedProducts.length} (${Date.now() - startTime}ms)`);
        
        filteredProducts = mergedProducts;
        
        // ENTERPRISE: Apply structured filters based on parsed query
        if (parsedQuery) {
          const beforeFilter = filteredProducts.length;
          filteredProducts = productQueryParserService.filterProductsByParsedQuery(filteredProducts, parsedQuery);
          console.log(`[Product Search] Structured filter: ${beforeFilter} → ${filteredProducts.length} products`);
        }
      }
    }
    
    // Fall back to AI-based semantic search if vector search didn't work or no search query
    if (!usedVectorSearch) {
      // Get products filtered by business account at database level
      const businessProducts = await storage.getAllProducts(context.businessAccountId);

      // Fetch categories and tags for ALL products first (needed for search)
      const productsWithMeta = await Promise.all(
        businessProducts.map(async (p) => {
          const [categories, tags] = await Promise.all([
            storage.getProductCategories(p.id),
            storage.getProductTags(p.id)
          ]);

          return {
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            imageUrl: p.imageUrl,
            categories: categories.map(c => ({ id: c.id, name: c.name })),
            tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color }))
          };
        })
      );

      // Apply search if provided - use AI-based semantic matching
      filteredProducts = productsWithMeta;
      if (params.search) {
        try {
          // Use AI to find semantically matching products
          const productList = productsWithMeta.map((p, index) => 
            `${index + 1}. "${p.name}" - ${p.categories.map(c => c.name).join(', ') || 'No category'}`
          ).join('\n');
          
          // Get OpenAI API key for this business
          let apiKey = await storage.getBusinessAccountOpenAIKey(context.businessAccountId);
          
          // Decrypt API key if encrypted
          if (apiKey && apiKey.startsWith('enc:')) {
            try {
              const { decrypt } = await import('./encryptionService');
              apiKey = decrypt(apiKey);
            } catch (e) {
              console.log('[Product Search] Failed to decrypt API key, using global');
              apiKey = process.env.OPENAI_API_KEY || null;
            }
          }
          
          if (!apiKey) {
            apiKey = process.env.OPENAI_API_KEY || null;
          }
          
          if (apiKey && productsWithMeta.length > 0) {
            const openai = createOpenAI({ businessAccountId: context.businessAccountId, apiKey });
            
            const response = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `You are a product search assistant. Given a search query and a list of products, return ONLY the numbers of products that match the search query semantically.

Consider:
- Synonyms (tshirt = t-shirt = tee = t shirt)
- Common variations (polo shirt includes polo t-shirt)
- Category matches (asking for "shirts" should include all shirt types)
- Partial matches are OK if semantically related

Return ONLY a JSON array of matching product numbers, like: [1, 3, 5]
If no products match, return: []`
                },
                {
                  role: 'user',
                  content: `Search query: "${params.search}"

Products:
${productList}`
                }
              ],
              temperature: 0,
              max_tokens: 200,
            });
            
            const content = response.choices[0]?.message?.content || '[]';
            // Extract JSON array from response
            const match = content.match(/\[[\d,\s]*\]/);
            if (match) {
              const matchingIndices: number[] = JSON.parse(match[0]);
              filteredProducts = matchingIndices
                .filter(i => i >= 1 && i <= productsWithMeta.length)
                .map(i => productsWithMeta[i - 1]);
              
              console.log(`[Product Search] Query: "${params.search}" → ${filteredProducts.length} matches (AI semantic matching, ${Date.now() - startTime}ms)`);
            } else {
              filteredProducts = [];
              console.log(`[Product Search] Query: "${params.search}" → 0 matches (AI returned no valid indices, ${Date.now() - startTime}ms)`);
            }
          } else {
            // No API key available, fall back to simple text matching
            const searchLower = params.search.toLowerCase().replace(/[-\s]/g, '');
            filteredProducts = productsWithMeta.filter(p => {
              const nameLower = (p.name || '').toLowerCase().replace(/[-\s]/g, '');
              const descLower = (p.description || '').toLowerCase().replace(/[-\s]/g, '');
              const categoryText = p.categories.map(c => c.name).join(' ').toLowerCase().replace(/[-\s]/g, '');
              return nameLower.includes(searchLower) || descLower.includes(searchLower) || categoryText.includes(searchLower);
            });
            console.log(`[Product Search] Query: "${params.search}" → ${filteredProducts.length} matches (simple text match - no API key, ${Date.now() - startTime}ms)`);
          }
        } catch (aiError: any) {
          console.log(`[Product Search] AI matching failed: ${aiError.message}, falling back to simple text match`);
          // Fall back to simple text matching that handles hyphen variations
          const searchLower = params.search.toLowerCase().replace(/[-\s]/g, '');
          filteredProducts = productsWithMeta.filter(p => {
            const nameLower = (p.name || '').toLowerCase().replace(/[-\s]/g, '');
            const descLower = (p.description || '').toLowerCase().replace(/[-\s]/g, '');
            const categoryText = p.categories.map(c => c.name).join(' ').toLowerCase().replace(/[-\s]/g, '');
            return nameLower.includes(searchLower) || descLower.includes(searchLower) || categoryText.includes(searchLower);
          });
          console.log(`[Product Search] Query: "${params.search}" → ${filteredProducts.length} matches (simple text fallback, ${Date.now() - startTime}ms)`);
        }
        
        // ENTERPRISE: Apply structured filters to AI fallback results
        if (parsedQuery && filteredProducts.length > 0) {
          const beforeFilter = filteredProducts.length;
          filteredProducts = productQueryParserService.filterProductsByParsedQuery(filteredProducts, parsedQuery);
          console.log(`[Product Search] Structured filter on fallback: ${beforeFilter} → ${filteredProducts.length} products`);
        }
      }
      
      // Trigger background embedding generation if products are missing embeddings
      if (businessProducts.length > 0) {
        const hasEmbeddings = businessProducts.some((p: any) => p.textEmbedding);
        if (!hasEmbeddings) {
          console.log(`[Product Search] No embeddings found - triggering background generation for ${context.businessAccountId}`);
          // Fire and forget - don't block the response
          import('./productTextEmbeddingService').then(({ productTextEmbeddingService }) => {
            productTextEmbeddingService.backfillEmbeddingsForBusiness(context.businessAccountId).catch(e => 
              console.log(`[Product Search] Background embedding generation failed: ${e.message}`)
            );
          });
        }
      }
    }

    // Apply price filters if provided
    if (params.min_price !== undefined || params.max_price !== undefined) {
      filteredProducts = filteredProducts.filter(p => {
        // Skip products without prices when filtering by price
        if (p.price === null || p.price === undefined) {
          return false;
        }
        
        const price = parseFloat(p.price.toString());
        
        // Check minimum price
        if (params.min_price !== undefined && price < params.min_price) {
          return false;
        }
        
        // Check maximum price
        if (params.max_price !== undefined && price > params.max_price) {
          return false;
        }
        
        return true;
      });
    }

    // Apply pagination - max 5 products per request
    const limit = 5;
    const offset = params.offset || 0;
    const totalCount = filteredProducts.length;
    let paginatedProducts = filteredProducts.slice(offset, offset + limit);
    const hasMore = (offset + limit) < totalCount;
    const nextOffset = hasMore ? offset + limit : null;

    // Translate product fields if user message is in non-English language
    if (context.userMessage && paginatedProducts.length > 0) {
      paginatedProducts = await this.translateProductFieldsIfNeeded(paginatedProducts, context.userMessage, context.businessAccountId, context.selectedLanguage);
    }

    return {
      success: true,
      data: paginatedProducts,
      pagination: {
        total: totalCount,
        offset: offset,
        limit: limit,
        hasMore: hasMore,
        nextOffset: nextOffset,
        showing: paginatedProducts.length,
        // Include original filters so "Show More" can maintain them
        filters: {
          search: params.search || null,
          minPrice: params.min_price !== undefined ? params.min_price : null,
          maxPrice: params.max_price !== undefined ? params.max_price : null,
        }
      },
      message: paginatedProducts.length > 0 
        ? `Showing ${paginatedProducts.length} of ${totalCount} product(s)` 
        : 'No products found'
    };
  }

  // Translate product names and descriptions to match user's language (if non-English)
  private static async translateProductFieldsIfNeeded(
    products: any[],
    userMessage: string,
    businessAccountId: string,
    selectedLanguage?: string
  ): Promise<any[]> {
    try {
      // Get OpenAI API key for this business
      let apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
      
      if (apiKey && apiKey.startsWith('enc:')) {
        try {
          const { decrypt } = await import('./encryptionService');
          apiKey = decrypt(apiKey);
        } catch (e) {
          apiKey = process.env.OPENAI_API_KEY || null;
        }
      }
      
      if (!apiKey) {
        apiKey = process.env.OPENAI_API_KEY || null;
      }
      
      if (!apiKey) {
        console.log('[Product Translation] No API key available, skipping translation');
        return products;
      }

      const openai = createOpenAI({ businessAccountId, apiKey });

      // Build product list for translation - names only (descriptions translated on-demand in frontend)
      const productsToTranslate = products.map((p, i) => ({
        index: i,
        name: p.name || ''
      }));

      const LANG_NAMES: Record<string, string> = {
        'hi': 'Hindi', 'hinglish': 'Hinglish', 'ta': 'Tamil', 'te': 'Telugu',
        'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali', 'gu': 'Gujarati',
        'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'as': 'Assamese',
        'ur': 'Urdu', 'ne': 'Nepali', 'es': 'Spanish', 'fr': 'French',
        'de': 'German', 'pt': 'Portuguese', 'it': 'Italian', 'ja': 'Japanese',
        'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'ru': 'Russian'
      };

      const explicitLang = selectedLanguage && selectedLanguage !== 'auto' && selectedLanguage !== 'en'
        ? LANG_NAMES[selectedLanguage] || null
        : null;

      let systemPrompt: string;
      let userContent: string;

      if (explicitLang) {
        // Explicit language selected — skip detection, translate directly
        systemPrompt = `Translate all product names to ${explicitLang}.
Return JSON: {"translations": [{"index": 0, "name": "translated name"}, ...]}`;
        userContent = `Product names to translate:\n${JSON.stringify(productsToTranslate)}`;
      } else {
        // Auto-detect from user message
        systemPrompt = `You analyze the user's message language and translate product names to match.

RULES:
1. If user message is in English → return {"skip": true}
2. If user message is in Hindi/Hinglish (romanized Hindi in Latin script) → translate to Hinglish (Latin script, NOT Devanagari)
3. If user message is in Hindi (Devanagari script) → translate to Hindi (Devanagari)
4. For any other language → translate to that language

Return JSON:
- If English: {"skip": true}
- If translation needed: {"translations": [{"index": 0, "name": "translated name"}, ...]}`;
        userContent = `User message: "${userMessage}"\n\nProduct names to translate:\n${JSON.stringify(productsToTranslate)}`;
      }

      // Translate names in one call
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      // If GPT says skip (English), return original products
      if (parsed.skip === true) {
        console.log('[Product Translation] User message is English, skipping translation');
        return products;
      }

      const translations = parsed.translations;

      if (Array.isArray(translations)) {
        console.log(`[Product Translation] Translated ${translations.length} product names to match user language`);
        // Apply name translations only (descriptions are translated on-demand in the frontend)
        return products.map((product, i) => {
          const translation = translations.find((t: any) => t.index === i);
          if (translation) {
            return {
              ...product,
              name: translation.name || product.name
            };
          }
          return product;
        });
      }

      console.log('[Product Translation] Unexpected response format, returning original products');
      return products;
    } catch (error: any) {
      console.log(`[Product Translation] Failed: ${error.message}, returning original products`);
      return products;
    }
  }

  private static async handleGetFaqs(params: any, context: ToolExecutionContext) {
    // Get FAQs filtered by business account at database level
    const businessFaqs = await storage.getAllFaqs(context.businessAccountId);

    // Apply search if provided - use keyword-based matching with relevance scoring
    let filteredFaqs = businessFaqs;
    if (params.search) {
      const searchLower = params.search.toLowerCase();
      
      // Extract keywords from search (remove common words and punctuation)
      const stopWords = ['is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'about', 'tell', 'me'];
      const searchKeywords = searchLower
        .split(/\s+/)
        .map((word: string) => word.replace(/[^\w]/g, '')) // Strip punctuation: "fees?" → "fees"
        .filter((word: string) => word.length > 2 && !stopWords.includes(word));
      
      // Define high-priority keywords that indicate specific intent
      const highPriorityKeywords = {
        price: ['fees', 'fee', 'cost', 'costs', 'price', 'pricing', 'much', 'pay', 'payment', 'expensive'],
        duration: ['duration', 'long', 'time', 'years', 'months', 'period'],
        eligibility: ['eligible', 'eligibility', 'qualify', 'requirements', 'criteria'],
        emi: ['emi', 'emis', 'installment', 'installments', 'finance', 'financing']
      };
      
      // Calculate relevance score for each FAQ
      const faqsWithScores = businessFaqs.map(f => {
        const questionLower = f.question.toLowerCase();
        const answerLower = f.answer.toLowerCase();
        let score = 0;
        
        // HIGHEST PRIORITY: Exact phrase match in question (score: 100)
        if (questionLower.includes(searchLower)) {
          score += 100;
        }
        
        // HIGH PRIORITY: High-priority keyword matches in question (score: 10 per match)
        for (const [category, keywords] of Object.entries(highPriorityKeywords)) {
          const searchHasCategory = searchKeywords.some((sk: string) => keywords.includes(sk));
          const questionHasCategory = keywords.some((hpk: string) => questionLower.includes(hpk));
          
          if (searchHasCategory && questionHasCategory) {
            score += 10;
          }
        }
        
        // MEDIUM PRIORITY: Regular keyword matches in question (score: 3 per match)
        const questionKeywordMatches = searchKeywords.filter((keyword: string) => 
          questionLower.includes(keyword)
        ).length;
        score += questionKeywordMatches * 3;
        
        // LOW PRIORITY: Keyword matches in answer (score: 1 per match)
        const answerKeywordMatches = searchKeywords.filter((keyword: string) => 
          answerLower.includes(keyword)
        ).length;
        score += answerKeywordMatches * 1;
        
        // PENALTY: Long answers get lower priority (avoid verbose FAQs)
        if (f.answer.length > 500) {
          score -= 2;
        }
        
        return { faq: f, score };
      });
      
      // Filter FAQs with score > 0 and sort by relevance score (highest first)
      filteredFaqs = faqsWithScores
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.faq);
      
      // FALLBACK: If no FAQs scored > 0, try simple keyword matching (prevents empty results)
      if (filteredFaqs.length === 0 && searchKeywords.length > 0) {
        console.log('[FAQ Search] No scored matches found, using fallback keyword matching');
        filteredFaqs = businessFaqs.filter(f => {
          const questionLower = f.question.toLowerCase();
          const answerLower = f.answer.toLowerCase();
          
          // Match at least one keyword
          return searchKeywords.some((keyword: string) => 
            questionLower.includes(keyword) || answerLower.includes(keyword)
          );
        });
      }
    }

    // Apply category filter if provided
    if (params.category) {
      filteredFaqs = filteredFaqs.filter(f => 
        f.category?.toLowerCase() === params.category.toLowerCase()
      );
    }

    console.log('[FAQ Search] Query:', params.search);
    console.log('[FAQ Search] Total business FAQs:', businessFaqs.length);
    console.log('[FAQ Search] Filtered results:', filteredFaqs.length);
    if (filteredFaqs.length > 0) {
      console.log('[FAQ Search] Matched questions:', filteredFaqs.map(f => f.question));
    }

    return {
      success: true,
      data: filteredFaqs.map(f => ({
        question: f.question,
        answer: f.answer,
        category: f.category
      })),
      message: filteredFaqs.length > 0 
        ? `Found ${filteredFaqs.length} relevant answers` 
        : 'No relevant information found'
    };
  }

  private static async handleCaptureLead(params: any, context: ToolExecutionContext, userMessage?: string, _appointmentsEnabled: boolean = true) {
    const str = (v: any) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
    const rawName = str(params?.name);
    const rawEmail = str(params?.email);
    const rawPhone = str(params?.phone);
    const rawWhatsapp = str(params?.whatsapp);
    const waSame: boolean | undefined = typeof params?.whatsapp_same_as_phone === 'boolean' ? params.whatsapp_same_as_phone : undefined;
    const message: string | undefined = str(params?.message) || undefined;

    const widgetSettings = await storage.getWidgetSettings(context.businessAccountId).catch(() => undefined);
    const leadConfig = (widgetSettings?.leadTrainingConfig as any) || null;
    const phoneMode = phoneModeFor(leadConfig);
    const mobileFieldCfg = Array.isArray(leadConfig?.fields) ? leadConfig.fields.find((f: any) => f?.id === 'mobile' && f.enabled) : null;
    const otpEnabledForPhone = !!(mobileFieldCfg && mobileFieldCfg.otpEnabled === true);

    // ── Validate every detail on its own: valid ones are saved, invalid ones are reported. ──
    const values: { name?: string; email?: string; phone?: string } = {};
    const rejected: Array<{ field: 'name' | 'email' | 'phone' | 'whatsapp'; reason: string }> = [];
    let phoneRejectionReason: string | undefined;
    if (rawName) {
      if (isValidLeadName(rawName)) values.name = rawName;
      else rejected.push({ field: 'name', reason: 'that does not look like a person\'s name' });
    }
    if (rawEmail) {
      if (isValidEmail(rawEmail)) values.email = rawEmail;
      else rejected.push({ field: 'email', reason: 'that is not a valid email address' });
    }
    if (rawPhone) {
      const r = validatePhoneNumber(rawPhone, phoneMode);
      if (r.isValid) values.phone = r.normalized;
      else {
        rejected.push({ field: 'phone', reason: `${r.reasonMessage} — a valid number is ${describePhoneRule(phoneMode)}` });
        phoneRejectionReason = r.reasonCode;
      }
    }
    let waNumber: string | null = null;
    if (rawWhatsapp) {
      const r = validatePhoneNumber(rawWhatsapp, phoneMode);
      if (r.isValid) waNumber = r.normalized;
      else rejected.push({ field: 'whatsapp', reason: `${r.reasonMessage} — a valid number is ${describePhoneRule(phoneMode)}` });
    }
    if (rejected.length) console.log(`[Lead Validation] capture_lead rejected: ${rejected.map(r => `${r.field} (${r.reason})`).join('; ')}`);

    const labelOf = (f: string) => f === 'phone' ? 'mobile number' : f === 'whatsapp' ? 'WhatsApp number' : f === 'email' ? 'email address' : 'name';
    const rejectedText = rejected.map(r => `${labelOf(r.field)} (${r.reason})`).join('; ');
    const nothingToSave = !values.name && !values.email && !values.phone && !waNumber && waSame === undefined;
    if (nothingToSave) {
      if (rejected.length) {
        return {
          success: false,
          error: 'invalid_contact_details',
          validationError: true,
          ...(phoneRejectionReason ? { phoneRejectionReason } : {}),
          data: { saved: [], rejected, nextField: null },
          message: `Not saved: ${rejectedText}. Tell the visitor briefly and ask them to re-enter only their ${labelOf(rejected[0].field)}.`,
        };
      }
      return {
        success: false,
        error: 'No contact information provided',
        data: { saved: [], rejected: [], nextField: null },
        message: 'No contact details were given, so nothing was saved.',
      };
    }

    // ── No conversation (legacy callers): plain create, gated CRM sync. ──
    if (!context.conversationId) {
      const lead = await storage.createLead({
        businessAccountId: context.businessAccountId,
        name: values.name || null,
        email: values.email || null,
        phone: values.phone || waNumber || null,
        message: message || 'Via Chat',
        city: context.visitorCity || null,
        conversationId: null,
      });
      syncConversationLeadIfReady({ leadId: lead.id, businessAccountId: context.businessAccountId, conversationId: null, channel: context.channel, source: 'capture_lead' }).catch(() => undefined);
      return {
        success: true,
        data: { leadId: lead.id, saved: Object.keys(values), rejected, nextField: null },
        message: `Saved: ${Object.keys(values).map(labelOf).join(', ')}.${rejected.length ? ` Not saved: ${rejectedText}.` : ''}`,
      };
    }
    const conversationId = context.conversationId;

    // ── WhatsApp details live in the conversation's lead state (leads has no whatsapp column). ──
    const existingBefore = await getConversationLead(conversationId, context.businessAccountId);
    const phoneOnLead = values.phone || existingBefore?.phone || null;
    if (waNumber && !phoneOnLead) values.phone = waNumber; // their WhatsApp number is also a mobile number
    if (waNumber || waSame !== undefined) {
      const sameAsMobile = waNumber
        ? (phoneOnLead ? waNumber.replace(/\D/g, '').slice(-10) === String(phoneOnLead).replace(/\D/g, '').slice(-10) : true)
        : waSame;
      await updateLeadCaptureState(conversationId, s => applyWhatsappCapture(s, { number: waNumber && sameAsMobile === false ? waNumber : null, sameAsMobile }));
    }

    // ── OTP gating (widget only): an unverified phone is saved, a code is sent, CRM waits. ──
    if (otpEnabledForPhone && context.channel && context.channel !== 'widget' && values.phone) {
      console.log(`[OTP] Skipped: channel not widget (channel=${context.channel}, business=${context.businessAccountId}, source=capture_lead)`);
    }
    if (otpEnabledForPhone && context.channel === 'widget' && values.phone) {
      const { OtpService, normalizePhone } = await import('./otp');
      const normalized = normalizePhone(values.phone);
      const alreadyVerified = normalized
        ? await storage.hasVerifiedOtpForConversationPhone(context.businessAccountId, conversationId, normalized)
        : false;
      if (!alreadyVerified) {
        const issue = await OtpService.issueChallenge(context.businessAccountId, conversationId, values.phone);
        try {
          const up = await upsertConversationLead({
            businessAccountId: context.businessAccountId,
            conversationId,
            values: { ...values, message, city: context.visitorCity || null },
            createMessage: 'Via Chat (pending OTP)',
          });
          console.log(`[OTP] Partial lead ${up.lead.id} ${up.created ? 'created' : 'updated'} (no CRM sync until verified)`);
        } catch (err) {
          console.error('[OTP] Failed to save partial lead while gating:', err);
        }
        if (!issue.ok) {
          if (issue.reason === 'locked') {
            return { success: false, error: 'otp_locked', otp_state: issue.snapshot, message: `Verification is temporarily locked for this conversation. Please try again later.` };
          }
          if (issue.reason === 'send_failed') {
            return { success: false, error: 'otp_send_failed', otp_state: issue.snapshot, message: `I couldn't send the verification code right now. Please try again in a moment.` };
          }
          return { success: false, error: 'invalid_phone', message: 'The mobile number looks invalid. Please share a valid mobile number.' };
        }
        return {
          success: true,
          data: { otp_required: true, saved: true, partialLead: true, rejected },
          otp_state: issue.snapshot,
          message: `I've sent a 6-digit verification code to ${issue.snapshot.phone_masked || 'your mobile'}. Please enter it to verify your number — the code expires in 5 minutes.`,
        };
      }
    }

    // ── Save (one row per conversation; serialized with auto-capture). ──
    const up = await upsertConversationLead({
      businessAccountId: context.businessAccountId,
      conversationId,
      values: { ...values, message, city: context.visitorCity || null },
    });
    const lead = up.lead;
    console.log(`[Lead ${up.created ? 'Create' : 'Update'}] lead ${lead.id} conversation ${conversationId}: ${up.changed.join(', ') || 'no changes'}${up.reusedFromConversationId ? ` (returning visitor, lead moved from ${up.reusedFromConversationId})` : ''}`);

    let newTitle = '';
    if (lead.name && lead.name.trim()) newTitle = lead.name.trim();
    else if (lead.phone && lead.phone.trim()) newTitle = lead.phone.trim();
    else if (lead.email && lead.email.trim()) newTitle = lead.email.trim();
    if (newTitle) {
      try { await storage.updateConversationTitle(conversationId, context.businessAccountId, newTitle); }
      catch (error) { console.error('[Lead Capture] Error updating conversation title:', error); }
    }

    // CRM: only once every mandatory field is in (and verification passed); later changes update.
    if (up.created || up.changed.length > 0 || up.reusedFromConversationId || waNumber || waSame !== undefined) {
      syncConversationLeadIfReady({
        leadId: lead.id, businessAccountId: context.businessAccountId, conversationId,
        changedFields: up.changed, channel: context.channel, source: 'capture_lead',
      }).catch(() => undefined);
    }

    // What may be asked next (at most ONE field, per timing/priority/refusals).
    let plan: LeadPlan | null = null;
    try {
      plan = await planForConversation({
        conversationId,
        config: leadConfig,
        known: { name: lead.name, email: lead.email, phone: lead.phone },
        userMessage: userMessage || context.userMessage || '',
      });
    } catch (err) {
      console.error('[Lead Capture] next-field planning failed (non-fatal):', err);
    }
    const allRequiredFieldsCollected = !!plan?.allMandatoryCollected && rejected.length === 0;
    if (allRequiredFieldsCollected) {
      updateLeadWithTopics(lead.id, context.businessAccountId, conversationId)
        .catch(err => console.error('[Lead Capture] Topic extraction failed:', err));
    }
    const nextField = plan?.next ? { field: plan.next.id, label: plan.next.label, mode: plan.next.mode } : null;
    const savedFields = Object.keys(values);
    const parts: string[] = [];
    if (savedFields.length) parts.push(`Saved: ${savedFields.map(labelOf).join(', ')}.`);
    if (waNumber || waSame !== undefined) parts.push('WhatsApp details noted.');
    if (rejected.length) parts.push(`Not saved: ${rejectedText}. Ask the visitor to re-enter only their ${labelOf(rejected[0].field)}.`);
    else if (nextField) parts.push(`Next detail allowed now: ${nextField.label} (${nextField.mode === 'block' ? 'ask before answering' : 'optional — only after answering'}). Ask for nothing else.`);
    else parts.push('No other contact detail is due now — do not ask for more.');

    return {
      success: true,
      data: {
        leadId: lead.id,
        saved: savedFields,
        rejected,
        nextField,
        partialLead: !plan?.allMandatoryCollected,
        ...(allRequiredFieldsCollected ? { allRequiredFieldsCollected: true } : {}),
      },
      ...(phoneRejectionReason ? { phoneRejectionReason } : {}),
      message: parts.join(' '),
    };
  }

  private static async handleVerifyPhoneOtp(params: any, context: ToolExecutionContext) {
    const code = (params?.code || params?.otp || '').toString();
    if (!context.conversationId) {
      return { success: false, error: 'no_conversation', message: 'Verification is unavailable right now.' };
    }
    const { OtpService } = await import('./otp');
    const result = await OtpService.verify(context.businessAccountId, context.conversationId, code);

    if (result.verified) {
      // Promote the partial lead — CRM sync now that the number is verified (still waits for
      // any other mandatory lead-training field).
      try {
        const lead = await getConversationLead(context.conversationId, context.businessAccountId);
        if (lead && (lead.phone || lead.email)) {
          syncConversationLeadIfReady({
            leadId: lead.id, businessAccountId: context.businessAccountId, conversationId: context.conversationId,
            channel: context.channel || 'widget', source: 'otp_verified',
          }).catch(err => console.error('[OTP→CRM] Post-verify sync error:', err));
        }
      } catch (err) {
        console.error('[OTP→CRM] Failed to resolve partial lead:', err);
      }

      return {
        success: true,
        data: { verified: true, otp_required: false },
        otp_state: result.snapshot,
        message: `Great — your mobile number has been verified! How can I help you next?`,
      };
    }

    const snapshot = result.snapshot;
    if (result.reason === 'wrong_code') {
      const remaining = snapshot.attempts_remaining ?? 0;
      return {
        success: false,
        error: 'wrong_code',
        otp_state: snapshot,
        message: `That code doesn't match. ${remaining} attempt${remaining === 1 ? '' : 's'} left. Please try again.`,
      };
    }
    if (result.reason === 'expired') {
      return {
        success: false,
        error: 'expired',
        otp_state: snapshot,
        message: `That code has expired. Reply "resend" if you'd like a new one.`,
      };
    }
    if (result.reason === 'locked') {
      return {
        success: false,
        error: 'locked',
        otp_state: snapshot,
        message: `Too many wrong attempts. Verification is locked for 15 minutes.`,
      };
    }
    if (result.reason === 'invalid_format') {
      return {
        success: false,
        error: 'invalid_format',
        otp_state: snapshot,
        message: `Please enter the 6-digit code that was sent to your mobile.`,
      };
    }
    return {
      success: false,
      error: 'no_active_challenge',
      otp_state: snapshot,
      message: `There is no active verification code. Please share your mobile number again to get a new code.`,
    };
  }

  private static async handleResendPhoneOtp(_params: any, context: ToolExecutionContext) {
    if (!context.conversationId) {
      return { success: false, error: 'no_conversation', message: 'Verification is unavailable right now.' };
    }
    const { OtpService } = await import('./otp');
    const result = await OtpService.resend(context.businessAccountId, context.conversationId);
    if (result.ok) {
      return {
        success: true,
        data: { resent: true },
        otp_state: result.snapshot,
        message: `A new 6-digit code has been sent to ${result.snapshot.phone_masked || 'your mobile'}.`,
      };
    }
    if (result.reason === 'cooldown') {
      const sec = result.retry_after_seconds ?? 60;
      return {
        success: false,
        error: 'cooldown',
        otp_state: result.snapshot,
        message: `Please wait ${sec} more second${sec === 1 ? '' : 's'} before requesting another code.`,
      };
    }
    if (result.reason === 'max_resends') {
      return {
        success: false,
        error: 'max_resends',
        otp_state: result.snapshot,
        message: `You've reached the maximum number of resends. Please try again later.`,
      };
    }
    if (result.reason === 'locked') {
      return { success: false, error: 'locked', otp_state: result.snapshot, message: `Verification is temporarily locked.` };
    }
    if (result.reason === 'send_failed') {
      return { success: false, error: 'send_failed', otp_state: result.snapshot, message: `I couldn't send the code right now. Please try again.` };
    }
    return { success: false, error: 'no_active_challenge', message: `There is no active verification. Please share your mobile number again.` };
  }

  private static async handleListAvailableSlots(params: any, context: ToolExecutionContext) {
    console.log('[Appointments] list_available_slots called with params:', JSON.stringify(params));
    
    // Check if appointment booking is enabled
    const widgetSettings = await storage.getWidgetSettings(context.businessAccountId);
    console.log('[Appointments] Booking enabled:', widgetSettings?.appointmentBookingEnabled);
    
    if (widgetSettings && widgetSettings.appointmentBookingEnabled === 'false') {
      return {
        success: true,
        data: { slots: {}, total: 0 },
        message: 'We are not currently accepting appointments. Please contact us directly for assistance.'
      };
    }

    const durationMinutes = params.duration_minutes || 30;
    
    const nowIST = toZonedTime(new Date(), IST_TIMEZONE);
    const today = startOfDay(nowIST);
    const startDate = params.start_date ? startOfDay(toZonedTime(parseISO(params.start_date), IST_TIMEZONE)) : today;
    const endDate = params.end_date ? endOfDay(toZonedTime(parseISO(params.end_date), IST_TIMEZONE)) : endOfDay(addDays(startDate, 6));
    
    console.log('[Appointments] Date range:', { 
      startDate: format(startDate, 'yyyy-MM-dd'), 
      endDate: format(endDate, 'yyyy-MM-dd') 
    });
    
    const [scheduleTemplates, overrides, existingAppointments] = await Promise.all([
      storage.getScheduleTemplates(context.businessAccountId),
      storage.getSlotOverridesForRange(context.businessAccountId, startDate, endDate),
      storage.getAppointmentsForRange(context.businessAccountId, startDate, endDate),
    ]);

    console.log('[Appointments] Found:', {
      scheduleTemplates: scheduleTemplates.length,
      overrides: overrides.length,
      appointments: existingAppointments.length
    });

    if (scheduleTemplates.length > 0) {
      console.log('[Appointments] Schedule templates:', scheduleTemplates.map(t => ({
        day: t.dayOfWeek,
        time: `${t.startTime}-${t.endTime}`,
        duration: t.slotDurationMinutes,
        active: t.isActive
      })));
    }

    if (scheduleTemplates.length === 0 && overrides.length === 0) {
      return {
        success: true,
        data: { slots: {}, total: 0 },
        message: 'No availability schedule has been configured yet. Please contact us directly to schedule an appointment.'
      };
    }

    const templatesByDay = new Map<number, typeof scheduleTemplates>();
    let activeCount = 0;
    scheduleTemplates.forEach(template => {
      const day = parseInt(template.dayOfWeek.toString());
      if (!templatesByDay.has(day)) {
        templatesByDay.set(day, []);
      }
      if (template.isActive === 'true') {
        templatesByDay.get(day)!.push(template);
        activeCount++;
      }
    });
    
    console.log('[Appointments] Active templates:', activeCount, 'Days with schedules:', Array.from(templatesByDay.keys()));

    const overridesMap = new Map<string, typeof overrides>();
    overrides.forEach(override => {
      const key = `${format(new Date(override.slotDate), 'yyyy-MM-dd')}_${override.slotTime}`;
      if (!overridesMap.has(key)) {
        overridesMap.set(key, []);
      }
      overridesMap.get(key)!.push(override);
    });

    const appointmentsMap = new Map<string, typeof existingAppointments>();
    existingAppointments.forEach(appt => {
      if (appt.status !== 'cancelled') {
        const key = `${format(new Date(appt.appointmentDate), 'yyyy-MM-dd')}_${appt.appointmentTime}`;
        if (!appointmentsMap.has(key)) {
          appointmentsMap.set(key, []);
        }
        appointmentsMap.get(key)!.push(appt);
      }
    });

    const availableSlots: Record<string, string[]> = {};
    let currentDate = new Date(startDate);
    let totalSlots = 0;

    while (isBefore(currentDate, endDate) || currentDate.getTime() === endDate.getTime()) {
      const dayOfWeek = currentDate.getDay();
      const dateKey = format(currentDate, 'yyyy-MM-dd');
      const daySlots: string[] = [];

      // Check if entire day is blocked via all-day override
      const allDayBlocks = overrides.filter(o => 
        format(new Date(o.slotDate), 'yyyy-MM-dd') === dateKey && 
        o.isAllDay === 'true' && 
        o.isAvailable === 'false'
      );
      
      // Skip this entire day if it has an all-day block
      if (allDayBlocks.length > 0) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      const templates = templatesByDay.get(dayOfWeek) || [];
      for (const template of templates) {
        const slotDuration = parseInt(template.slotDurationMinutes.toString());
        const [startHour, startMin] = template.startTime.split(':').map(Number);
        const [endHour, endMin] = template.endTime.split(':').map(Number);
        
        let slotTime = startHour * 60 + startMin;
        const endTime = endHour * 60 + endMin;

        while (slotTime + slotDuration <= endTime) {
          const hour = Math.floor(slotTime / 60);
          const min = slotTime % 60;
          const timeStr = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
          const slotKey = `${dateKey}_${timeStr}`;
          
          const overridesForSlot = overridesMap.get(slotKey) || [];
          const isBlocked = overridesForSlot.some(o => o.isAvailable === 'false');
          const appointmentsForSlot = appointmentsMap.get(slotKey) || [];
          const isBooked = appointmentsForSlot.length > 0;

          if (!isBlocked && !isBooked && !daySlots.includes(timeStr)) {
            daySlots.push(timeStr);
          }

          slotTime += slotDuration;
        }
      }

      overridesMap.forEach((overrideList, key) => {
        if (key.startsWith(dateKey)) {
          overrideList.forEach(override => {
            if (override.isAvailable === 'true') {
              const slotKey = `${dateKey}_${override.slotTime}`;
              const appointmentsForSlot = appointmentsMap.get(slotKey) || [];
              const isBooked = appointmentsForSlot.length > 0;
              
              if (!isBooked && !daySlots.includes(override.slotTime)) {
                daySlots.push(override.slotTime);
              }
            }
          });
        }
      });

      if (daySlots.length > 0) {
        daySlots.sort();
        
        // Filter out past slots if the date is today
        const isToday = format(currentDate, 'yyyy-MM-dd') === format(nowIST, 'yyyy-MM-dd');
        let filteredSlots = daySlots;
        
        if (isToday) {
          const currentTimeMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
          filteredSlots = daySlots.filter(slot => {
            const [hour, min] = slot.split(':').map(Number);
            const slotMinutes = hour * 60 + min;
            return slotMinutes > currentTimeMinutes;
          });
        }
        
        if (filteredSlots.length > 0) {
          availableSlots[dateKey] = filteredSlots;
          totalSlots += filteredSlots.length;
        }
      }

      currentDate = addDays(currentDate, 1);
    }

    const nextAvailableDate = Object.keys(availableSlots).sort()[0];

    return {
      success: true,
      data: {
        slots: availableSlots,
        total: totalSlots,
        next_available_date: nextAvailableDate || null,
        duration_minutes: durationMinutes
      },
      message: totalSlots > 0 
        ? `Found ${totalSlots} available time slot(s) across ${Object.keys(availableSlots).length} day(s)` 
        : 'No available slots found in the requested date range. Please try different dates or contact us directly.'
    };
  }

  private static async handleBookAppointment(params: any, context: ToolExecutionContext) {
    // Check if appointment booking is enabled
    const widgetSettings = await storage.getWidgetSettings(context.businessAccountId);
    if (widgetSettings && widgetSettings.appointmentBookingEnabled === 'false') {
      return {
        success: false,
        error: 'Appointments are disabled',
        message: 'We are not currently accepting appointments. Please contact us directly for assistance.'
      };
    }

    const { patient_name, patient_phone, patient_email, appointment_date, appointment_time, duration_minutes, notes } = params;

    // Basic validation - ensure name and phone are provided
    if (!patient_name || patient_name.trim().length < 2) {
      return {
        success: false,
        error: 'Your Name is required',
        message: 'I need your name to complete the booking. May I have your name please?'
      };
    }

    if (!patient_phone || patient_phone.replace(/\D/g, '').length < 10) {
      return {
        success: false,
        error: 'Your Mobile Number is required',
        message: 'I need your phone number to complete the booking. What\'s the best number to reach you?'
      };
    }

    const phoneCheck = validatePhoneNumber(patient_phone, '10');
    if (!phoneCheck.isValid) {
      return {
        success: false,
        error: `Invalid phone number: ${phoneCheck.reasonMessage}`,
        message: `The phone number you provided is not valid. ${phoneCheck.reasonMessage}. Could you please provide your correct mobile number?`
      };
    }

    const appointmentDateTime = toZonedTime(parseISO(appointment_date), IST_TIMEZONE);
    const nowIST = toZonedTime(new Date(), IST_TIMEZONE);
    const todayIST = startOfDay(nowIST);
    
    if (isBefore(appointmentDateTime, todayIST)) {
      return {
        success: false,
        error: 'Cannot book appointments in the past',
        message: 'I cannot book appointments for past dates. Please choose a future date.'
      };
    }

    const [scheduleTemplates, overrides, existingAppointments] = await Promise.all([
      storage.getScheduleTemplates(context.businessAccountId),
      storage.getSlotOverridesForRange(context.businessAccountId, appointmentDateTime, appointmentDateTime),
      storage.getAppointmentsForRange(context.businessAccountId, appointmentDateTime, appointmentDateTime),
    ]);

    const slotKey = `${format(appointmentDateTime, 'yyyy-MM-dd')}_${appointment_time}`;
    const conflictingAppointments = existingAppointments.filter(
      appt => appt.status !== 'cancelled' && appt.appointmentTime === appointment_time
    );

    if (conflictingAppointments.length > 0) {
      return {
        success: false,
        error: 'Time slot already booked',
        message: 'I\'m sorry, but this time slot has just been booked. Let me show you other available times.'
      };
    }

    const dayOfWeek = appointmentDateTime.getDay();
    const dateKey = format(appointmentDateTime, 'yyyy-MM-dd');
    
    const relevantOverrides = overrides.filter(o => {
      const overrideDateKey = format(new Date(o.slotDate), 'yyyy-MM-dd');
      return overrideDateKey === dateKey && o.slotTime === appointment_time;
    });

    const isBlockedByOverride = relevantOverrides.some(o => o.isAvailable === 'false');
    if (isBlockedByOverride) {
      return {
        success: false,
        error: 'Time slot not available',
        message: 'I\'m sorry, but this time slot is not available. Please choose another time.'
      };
    }

    const isAddedByOverride = relevantOverrides.some(o => o.isAvailable === 'true');
    
    if (!isAddedByOverride) {
      const dayTemplates = scheduleTemplates.filter(
        t => parseInt(t.dayOfWeek.toString()) === dayOfWeek && t.isActive === 'true'
      );

      let isWithinSchedule = false;
      for (const template of dayTemplates) {
        const [startHour, startMin] = template.startTime.split(':').map(Number);
        const [endHour, endMin] = template.endTime.split(':').map(Number);
        const [apptHour, apptMin] = appointment_time.split(':').map(Number);
        
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const apptMinutes = apptHour * 60 + apptMin;

        if (apptMinutes >= startMinutes && apptMinutes < endMinutes) {
          isWithinSchedule = true;
          break;
        }
      }

      if (!isWithinSchedule) {
        return {
          success: false,
          error: 'Time slot outside business hours',
          message: 'I\'m sorry, but this time is outside our regular hours. Please check available slots.'
        };
      }
    }

    const appointmentMessage = notes || `Booked appointment for ${format(appointmentDateTime, 'MMMM d, yyyy')} at ${appointment_time}`;

    // One lead per conversation: update the conversation's lead (serialized with auto-capture /
    // capture_lead so a booking never creates a second row).
    let lead: any;
    if (context.conversationId) {
      const up = await upsertConversationLead({
        businessAccountId: context.businessAccountId,
        conversationId: context.conversationId,
        values: { name: patient_name, phone: patient_phone, email: patient_email || null, message: appointmentMessage, city: context.visitorCity || null },
        policy: { email: 'fill' },
      });
      lead = up.lead;
    } else {
      // Create new lead if none exists
      lead = await storage.createLead({
        businessAccountId: context.businessAccountId,
        conversationId: context.conversationId || null,
        name: patient_name,
        email: patient_email || null,
        phone: patient_phone,
        city: context.visitorCity || null,
        message: appointmentMessage,
      });
    }
    
    // Auto-sync to LeadSquared (async, non-blocking). A booking always goes to the CRM; an
    // already-synced lead is updated instead of creating a second CRM lead.
    syncLeadToLeadSquared({
      id: lead.id,
      name: patient_name,
      email: lead.email || patient_email || null,
      phone: patient_phone,
      leadsquaredLeadId: lead.leadsquaredLeadId || null,
    }, context.businessAccountId, !!lead.leadsquaredLeadId).catch(err => console.error('[LeadSquared-Tool] Background sync error:', err));

    // Then create the appointment linked to the lead
    const appointment = await storage.createAppointment({
      businessAccountId: context.businessAccountId,
      conversationId: context.conversationId || null,
      leadId: lead.id,
      patientName: patient_name,
      patientPhone: patient_phone,
      patientEmail: patient_email || null,
      appointmentDate: appointmentDateTime,
      appointmentTime: appointment_time,
      durationMinutes: duration_minutes ? duration_minutes.toString() : '30',
      status: 'confirmed',
      notes: notes || null,
      cancellationReason: null,
    });

    const formattedDate = format(appointmentDateTime, 'EEEE, MMMM d, yyyy');
    const [hour, min] = appointment_time.split(':').map(Number);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    const formattedTime = `${displayHour}:${min.toString().padStart(2, '0')} ${ampm}`;

    return {
      success: true,
      data: { appointmentId: appointment.id },
      message: `Perfect! I've booked your appointment for ${formattedDate} at ${formattedTime}. You'll receive a confirmation shortly. See you then, ${patient_name}!`
    };
  }

  private static async handleGetJourneyProgress(context: ToolExecutionContext) {
    if (!context.conversationId) {
      return {
        success: false,
        error: 'No conversation ID provided'
      };
    }

    // Import journey service
    const { journeyService } = await import('./journeyService');
    
    // Get current journey state
    const journeyState = await journeyService.getJourneyState(context.conversationId);
    
    if (!journeyState || journeyState.completed) {
      return {
        success: true,
        data: {
          active: false,
          message: 'No active journey'
        }
      };
    }

    // Get journey details
    const journey = await storage.getJourney(journeyState.journeyId, context.businessAccountId);
    const allSteps = await storage.getJourneySteps(journeyState.journeyId);
    const sortedSteps = allSteps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    
    // Get current step
    const currentStep = sortedSteps[journeyState.currentStepIndex];
    
    // Build collected answers map
    const collectedAnswers: any = {};
    for (const [stepId, answer] of Array.from(journeyState.responses.entries())) {
      const step = sortedSteps.find(s => s.id === stepId);
      if (step) {
        collectedAnswers[step.questionText || 'Unknown'] = answer;
      }
    }
    
    // Get remaining required steps
    const remainingSteps = sortedSteps.slice(journeyState.currentStepIndex);
    const requiredRemaining = remainingSteps.filter(s => s.isRequired === 'true').map(s => ({
      id: s.id,
      question: s.questionText,
      order: s.stepOrder
    }));

    return {
      success: true,
      data: {
        active: true,
        journeyName: journey?.name || 'Unknown Journey',
        currentStep: currentStep ? {
          id: currentStep.id,
          question: currentStep.questionText,
          required: currentStep.isRequired === 'true',
          alreadyAsked: journeyState.firstQuestionShownAsGreeting && journeyState.currentStepIndex === 0
        } : null,
        collectedAnswers,
        requiredStepsRemaining: requiredRemaining,
        totalSteps: sortedSteps.length,
        completedSteps: journeyState.currentStepIndex,
        progress: `${journeyState.currentStepIndex}/${sortedSteps.length}`
      }
    };
  }

  private static async handleCompleteJourney(params: any, context: ToolExecutionContext) {
    const { summary } = params;

    if (!context.conversationId) {
      return {
        success: false,
        error: 'No conversation ID provided'
      };
    }

    // Import journey service
    const { journeyService } = await import('./journeyService');

    // Get current journey state
    const journeyState = await journeyService.getJourneyState(context.conversationId);
    
    if (!journeyState || journeyState.completed) {
      return {
        success: false,
        error: 'No active journey to complete'
      };
    }

    // Validate that all required fields are collected
    const allSteps = await storage.getJourneySteps(journeyState.journeyId);
    const requiredSteps = allSteps.filter(s => s.isRequired === 'true');
    const missingRequired = requiredSteps.filter(s => !journeyState.responses.has(s.id));

    if (missingRequired.length > 0) {
      const missingQuestions = missingRequired.map(s => s.questionText).join(', ');
      return {
        success: false,
        error: `Cannot complete journey: Missing required fields: ${missingQuestions}`
      };
    }

    // Mark journey as completed
    await journeyService.completeJourney(context.conversationId);

    console.log(`[Journey] Completed: ${summary}`);

    return {
      success: true,
      message: `Journey completed successfully! ${summary}`
    };
  }

  private static async handleRecordCurrentJourneyAnswer(params: any, context: ToolExecutionContext) {
    const { answer } = params;

    if (!context.conversationId) {
      return {
        success: false,
        error: 'No conversation ID provided'
      };
    }

    if (!answer) {
      return {
        success: false,
        error: 'Missing required parameter: answer'
      };
    }

    // Import journey service and database
    const { journeyService } = await import('./journeyService');
    const { db } = await import('../db');
    const { journeyResponses } = await import('../../shared/schema');

    // Get current journey state
    const journeyState = await journeyService.getJourneyState(context.conversationId);
    
    if (!journeyState || journeyState.completed) {
      return {
        success: false,
        error: 'No active journey to record answer for'
      };
    }

    // Get all steps to find current step
    const allSteps = await storage.getJourneySteps(journeyState.journeyId);
    const sortedSteps = allSteps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    const currentStep = sortedSteps[journeyState.currentStepIndex];

    if (!currentStep) {
      return {
        success: false,
        error: 'No current step found'
      };
    }

    const step_id = currentStep.id;

    console.log(`[Journey] Recording answer for current step: ${step_id} (${currentStep.questionText})`);

    // Store answer in memory
    journeyState.responses.set(step_id, answer);

    // Store answer in database
    try {
      await db.insert(journeyResponses).values({
        sessionId: journeyState.sessionId,
        journeyId: journeyState.journeyId,
        conversationId: context.conversationId,
        stepId: step_id,
        response: answer,
      });
    } catch (error: any) {
      // Ignore duplicate key errors - question already answered
      if (!error.message?.includes('duplicate')) {
        throw error;
      }
    }

    // Advance to next step for form journeys and include next step data
    if (journeyState.journeyType === 'form') {
      journeyState.currentStepIndex++;
      
      // Check if journey is complete
      if (journeyState.currentStepIndex >= sortedSteps.length) {
        journeyState.completed = true;
        return {
          success: true,
          message: `Recorded answer: "${answer}"`,
          journeyCompleted: true
        };
      }
      
      // Get next form step data
      const nextStep = sortedSteps[journeyState.currentStepIndex];
      let options: string[] | undefined;
      if ((nextStep.questionType === 'radio' || nextStep.questionType === 'dropdown') && nextStep.multipleChoiceOptions) {
        try {
          options = JSON.parse(nextStep.multipleChoiceOptions);
        } catch (e) {
          console.error('[Journey] Failed to parse choice options:', e);
        }
      }
      
      return {
        success: true,
        message: `Recorded answer: "${answer}"`,
        nextFormStep: {
          stepId: nextStep.id,
          questionText: nextStep.questionText,
          questionType: nextStep.questionType || 'text',
          isRequired: nextStep.isRequired === 'true',
          options,
          placeholder: nextStep.placeholderText || undefined,
          stepType: nextStep.toolTrigger || undefined,
        }
      };
    }

    return {
      success: true,
      message: `Recorded answer: "${answer}"`
    };
  }

  private static async handleSkipCurrentJourneyStep(params: any, context: ToolExecutionContext) {
    const { reason } = params;

    if (!context.conversationId) {
      return {
        success: false,
        error: 'No conversation ID provided'
      };
    }

    if (!reason) {
      return {
        success: false,
        error: 'Missing required parameter: reason'
      };
    }

    // Import journey service
    const { journeyService } = await import('./journeyService');

    // Get current journey state
    const journeyState = await journeyService.getJourneyState(context.conversationId);
    
    if (!journeyState || journeyState.completed) {
      return {
        success: false,
        error: 'No active journey'
      };
    }

    // Get all steps to find current step
    const allSteps = await storage.getJourneySteps(journeyState.journeyId);
    const sortedSteps = allSteps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    const currentStep = sortedSteps[journeyState.currentStepIndex];

    if (!currentStep) {
      return {
        success: false,
        error: 'No current step found'
      };
    }

    const step_id = currentStep.id;

    console.log(`[Journey] Skipping current step: ${step_id} (${currentStep.questionText}) - Reason: ${reason}`);

    // Mark as skipped in memory
    journeyState.responses.set(step_id, `[SKIPPED: ${reason}]`);

    return {
      success: true,
      message: `Skipped step: ${reason}`
    };
  }

  private static async handleFetchK12Topic(
    parameters: { query: string },
    context: ToolExecutionContext
  ): Promise<ToolResponse> {
    const { query } = parameters;
    const resolver = await getK12ContentResolver(context.businessAccountId);
    const result = await resolver.searchTopics(query, context.businessAccountId, { cpId: context.cpId, cpIds: context.cpIds, chapter: context.chapter });
    return this.createSuccessResponse(result.message, result.results);
  }

  private static async handleFetchK12Questions(
    parameters: { query: string; difficulty?: number },
    context: ToolExecutionContext
  ): Promise<ToolResponse> {
    const { query, difficulty } = parameters;
    const resolver = await getK12ContentResolver(context.businessAccountId);
    const result = await resolver.searchQuestions(query, context.businessAccountId, difficulty, { cpId: context.cpId, cpIds: context.cpIds, chapter: context.chapter });
    return this.createSuccessResponse(result.message, result.results);
  }

  private static async requireJobPortalEnabled(businessAccountId: string): Promise<boolean> {
    const account = await storage.getBusinessAccount(businessAccountId);
    return account?.jobPortalEnabled === 'true';
  }

  private static async handleSearchJobs(
    parameters: { query: string },
    context: ToolExecutionContext
  ): Promise<ToolResponse> {
    const { query } = parameters;
    const businessAccountId = context.businessAccountId;
    console.log(`[JobPortal Tool] search_jobs query="${query}" business=${businessAccountId}`);

    if (!await this.requireJobPortalEnabled(businessAccountId)) {
      return this.createErrorResponse('Job portal is not enabled for this account.');
    }

    try {
      const { embeddingService } = await import('./embeddingService');
      const { jobs: jobsTable } = await import('../../shared/schema');
      const { cosineDistance, desc, eq, and, sql: sqlFn } = await import('drizzle-orm');

      const queryEmbedding = await embeddingService.generateEmbedding(query, businessAccountId);

      const similarity = sqlFn<number>`1 - (${cosineDistance(jobsTable.textEmbedding, queryEmbedding)})`;
      const results = await db.select({
        id: jobsTable.id,
        title: jobsTable.title,
        description: jobsTable.description,
        location: jobsTable.location,
        salaryMin: jobsTable.salaryMin,
        salaryMax: jobsTable.salaryMax,
        currency: jobsTable.currency,
        jobType: jobsTable.jobType,
        experienceLevel: jobsTable.experienceLevel,
        department: jobsTable.department,
        skills: jobsTable.skills,
        similarity,
      })
        .from(jobsTable)
        .where(and(
          eq(jobsTable.businessAccountId, businessAccountId),
          eq(jobsTable.status, 'active')
        ))
        .orderBy(desc(similarity))
        .limit(10);

      const filteredResults = results.filter((r: any) => r.similarity > 0.3);

      if (filteredResults.length === 0) {
        const allActiveJobs = await storage.getJobs(businessAccountId, { status: 'active' });
        if (allActiveJobs.length === 0) {
          return this.createSuccessResponse('No job openings are currently available.', []);
        }
        const fallbackJobs = allActiveJobs.slice(0, 5).map(j => ({
          id: j.id,
          title: j.title,
          description: j.description,
          location: j.location,
          salaryMin: j.salaryMin,
          salaryMax: j.salaryMax,
          currency: j.currency,
          jobType: j.jobType,
          experienceLevel: j.experienceLevel,
          department: j.department,
          skills: j.skills,
        }));
        return {
          success: true,
          message: `No exact matches for "${query}", but here are some current openings:`,
          data: fallbackJobs,
          _type: 'jobs'
        };
      }

      const jobData = filteredResults.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        location: r.location,
        salaryMin: r.salaryMin,
        salaryMax: r.salaryMax,
        currency: r.currency,
        jobType: r.jobType,
        experienceLevel: r.experienceLevel,
        department: r.department,
        skills: r.skills,
        matchScore: Math.round((r.similarity as number) * 100),
      }));

      return {
        success: true,
        message: `Found ${jobData.length} matching job(s) for "${query}".`,
        data: jobData,
        _type: 'jobs'
      };
    } catch (err: any) {
      console.error('[JobPortal Tool] search_jobs error:', err.message);
      const allJobs = await storage.getJobs(businessAccountId, { status: 'active' });
      if (allJobs.length === 0) {
        return this.createSuccessResponse('No job openings are currently available.', []);
      }
      const textQuery = query.toLowerCase();
      const matched = allJobs.filter(j =>
        j.title.toLowerCase().includes(textQuery) ||
        (j.description && j.description.toLowerCase().includes(textQuery)) ||
        (j.department && j.department.toLowerCase().includes(textQuery)) ||
        (j.skills && (j.skills as string[]).some(s => s.toLowerCase().includes(textQuery)))
      );
      const results = (matched.length > 0 ? matched : allJobs).slice(0, 5).map(j => ({
        id: j.id,
        title: j.title,
        description: j.description,
        location: j.location,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        currency: j.currency,
        jobType: j.jobType,
        experienceLevel: j.experienceLevel,
        department: j.department,
        skills: j.skills,
      }));
      return {
        success: true,
        message: matched.length > 0 ? `Found ${results.length} job(s) matching "${query}".` : `Here are some current openings:`,
        data: results,
        _type: 'jobs'
      };
    }
  }

  private static async handleParseResumeAndMatch(
    parameters: { resumeText: string; conversationId?: string; resumeUrl?: string },
    context: ToolExecutionContext
  ): Promise<ToolResponse> {
    let { resumeText, conversationId, resumeUrl } = parameters;
    const businessAccountId = context.businessAccountId;

    if (!resumeText || resumeText.length < 50 || resumeText.includes('[EXTRACTED RESUME TEXT]') || resumeText === 'use_context') {
      console.warn(`[JobPortal Tool] parse_resume_and_match received placeholder/short resumeText (${resumeText?.length || 0} chars): "${resumeText?.substring(0, 60)}"`);
      return this.createErrorResponse('Resume text was not properly provided. Please try uploading the resume again.');
    }

    console.log(`[JobPortal Tool] parse_resume_and_match business=${businessAccountId} resumeLength=${resumeText.length}`);

    if (!await this.requireJobPortalEnabled(businessAccountId)) {
      return this.createErrorResponse('Job portal is not enabled for this account.');
    }

    try {
      const apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
      if (!apiKey) {
        return this.createErrorResponse('OpenAI API key not configured for this account.');
      }
      const openai = createOpenAI({ businessAccountId, apiKey });

      const extractionResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract candidate information from the following resume text. Return a JSON object with these fields:
- name: string (candidate full name)
- email: string | null
- phone: string | null
- skills: string[] (list of key skills)
- experienceSummary: string (1-2 sentence summary of experience)
Return ONLY valid JSON, no markdown or explanation.`
          },
          { role: 'user', content: resumeText.substring(0, 8000) }
        ],
        temperature: 0,
        max_tokens: 500
      });

      let parsed: { name: string; email?: string | null; phone?: string | null; skills?: string[]; experienceSummary?: string };
      try {
        const raw = extractionResponse.choices[0]?.message?.content || '{}';
        parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim());
      } catch {
        parsed = { name: 'Unknown Candidate', skills: [], experienceSummary: '' };
      }

      const applicant = await storage.createApplicant({
        businessAccountId,
        name: parsed.name || 'Unknown Candidate',
        email: parsed.email || null,
        phone: parsed.phone || null,
        resumeText: resumeText.substring(0, 50000),
        resumeUrl: resumeUrl || null,
        skills: parsed.skills || [],
        experienceSummary: parsed.experienceSummary || null,
        source: 'chatbot',
        conversationId: conversationId || context.conversationId || null,
      });

      console.log(`[JobPortal Tool] Created applicant: ${applicant.id} name="${applicant.name}"`);

      const { embeddingService } = await import('./embeddingService');
      const { jobs: jobsTable } = await import('../../shared/schema');
      const { cosineDistance, desc, eq, and, sql: sqlFn } = await import('drizzle-orm');

      const skillsText = [parsed.experienceSummary, ...(parsed.skills || [])].filter(Boolean).join(' ');
      const resumeEmbedding = await embeddingService.generateEmbedding(skillsText || resumeText.substring(0, 2000), businessAccountId);

      const similarity = sqlFn<number>`1 - (${cosineDistance(jobsTable.textEmbedding, resumeEmbedding)})`;
      const matchedJobs = await db.select({
        id: jobsTable.id,
        title: jobsTable.title,
        description: jobsTable.description,
        location: jobsTable.location,
        salaryMin: jobsTable.salaryMin,
        salaryMax: jobsTable.salaryMax,
        currency: jobsTable.currency,
        jobType: jobsTable.jobType,
        experienceLevel: jobsTable.experienceLevel,
        department: jobsTable.department,
        skills: jobsTable.skills,
        similarity,
      })
        .from(jobsTable)
        .where(and(
          eq(jobsTable.businessAccountId, businessAccountId),
          eq(jobsTable.status, 'active')
        ))
        .orderBy(desc(similarity))
        .limit(5);

      const jobResults = matchedJobs.map((j: any) => ({
        id: j.id,
        title: j.title,
        description: j.description,
        location: j.location,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        currency: j.currency,
        jobType: j.jobType,
        experienceLevel: j.experienceLevel,
        department: j.department,
        skills: j.skills,
        matchScore: Math.round((j.similarity as number) * 100),
      }));

      return {
        success: true,
        message: `Resume parsed for ${parsed.name}. Found ${jobResults.length} matching job(s).`,
        data: jobResults,
        _type: 'jobs',
        applicant: {
          id: applicant.id,
          name: applicant.name,
          email: applicant.email,
          skills: applicant.skills,
          experienceSummary: applicant.experienceSummary,
        }
      };
    } catch (err: any) {
      console.error('[JobPortal Tool] parse_resume_and_match error:', err.message);
      return this.createErrorResponse('Failed to parse resume: ' + err.message);
    }
  }

  private static async handleApplyToJob(
    parameters: { jobId: string; applicantId: string },
    context: ToolExecutionContext
  ): Promise<ToolResponse> {
    const { jobId, applicantId } = parameters;
    const businessAccountId = context.businessAccountId;
    console.log(`[JobPortal Tool] apply_to_job job=${jobId} applicant=${applicantId} business=${businessAccountId}`);

    if (!await this.requireJobPortalEnabled(businessAccountId)) {
      return this.createErrorResponse('Job portal is not enabled for this account.');
    }

    try {
      const job = await storage.getJob(jobId, businessAccountId);
      if (!job) {
        return this.createErrorResponse('Job not found or no longer available.');
      }

      const applicant = await storage.getApplicant(applicantId, businessAccountId);
      if (!applicant) {
        return this.createErrorResponse('Applicant record not found. Please upload your resume first.');
      }

      const existingApplications = await storage.getApplications(businessAccountId, { jobId, applicantId });
      if (existingApplications.length > 0) {
        return this.createSuccessResponse(`You have already applied to "${job.title}". Your application is being reviewed.`);
      }

      const application = await storage.createApplication({
        jobId,
        applicantId,
        businessAccountId,
        status: 'new',
      });

      return this.createSuccessResponse(
        `Application submitted successfully for "${job.title}"! The hiring team will review your profile and get back to you.`,
        { applicationId: application.id, jobTitle: job.title }
      );
    } catch (err: any) {
      console.error('[JobPortal Tool] apply_to_job error:', err.message);
      return this.createErrorResponse('Failed to submit application: ' + err.message);
    }
  }

  private static async handleShowOrderLookupOptions(context: ToolExecutionContext): Promise<ToolResponse> {
    const { businessAccountId } = context;
    console.log(`[DemoOrders Tool] show_order_lookup_options business=${businessAccountId}`);
    return this.createSuccessResponse(
      'Showing order lookup options to customer.',
      { show_lookup_options: true }
    );
  }

  private static async handleTrackOrder(parameters: any, context: ToolExecutionContext): Promise<ToolResponse> {
    const { order_id, phone, email } = parameters;
    const { businessAccountId } = context;
    console.log(`[DemoOrders Tool] track_order orderId="${order_id}" phone="${phone}" email="${email}" business=${businessAccountId}`);
    try {
      const account = await storage.getBusinessAccount(businessAccountId);
      if (!account || account.demoOrdersEnabled !== 'true') {
        return this.createErrorResponse('Order tracking is not available for this account.');
      }
      if (!order_id && !phone && !email) {
        return this.createSuccessResponse(
          'Please provide your order ID, phone number, or email to look up your order.',
          { requires_input: true }
        );
      }

      const { demoOrders } = await import('../../shared/schema');
      const { db } = await import('../db');
      const { eq, and } = await import('drizzle-orm');

      let orders: any[] = [];
      if (order_id) {
        const normalizedId = '#' + order_id.replace(/^#/, '').toUpperCase();
        const exact = await db.select().from(demoOrders)
          .where(and(eq(demoOrders.businessAccountId, businessAccountId), eq(demoOrders.orderId, normalizedId)));
        if (exact.length === 0) {
          const altId = order_id.replace(/^#/, '').toUpperCase();
          const altExact = await db.select().from(demoOrders)
            .where(and(eq(demoOrders.businessAccountId, businessAccountId), eq(demoOrders.orderId, altId)));
          orders = altExact;
        } else {
          orders = exact;
        }
        if (orders.length === 0) {
          const all = await db.select().from(demoOrders).where(eq(demoOrders.businessAccountId, businessAccountId));
          const needle = order_id.replace(/^#/, '').toUpperCase();
          orders = all.filter((o: any) => (o.orderId || '').replace(/^#/, '').toUpperCase() === needle);
        }
      } else if (phone) {
        const { desc } = await import('drizzle-orm');
        const all = await db.select().from(demoOrders)
          .where(eq(demoOrders.businessAccountId, businessAccountId))
          .orderBy(desc(demoOrders.orderDate), desc(demoOrders.createdAt));
        orders = all.filter((o: any) => (o.customerPhone || '').replace(/\D/g, '') === phone.replace(/\D/g, '')).slice(0, 3);
      } else if (email) {
        const { desc } = await import('drizzle-orm');
        const all = await db.select().from(demoOrders)
          .where(eq(demoOrders.businessAccountId, businessAccountId))
          .orderBy(desc(demoOrders.orderDate), desc(demoOrders.createdAt));
        orders = all.filter((o: any) => (o.customerEmail || '').toLowerCase() === email.toLowerCase()).slice(0, 3);
      }

      if (orders.length === 0) {
        return this.createSuccessResponse(
          `No order found for ${order_id ? `order ID ${order_id}` : phone ? `phone ${phone}` : `email ${email}`}. Please double-check the details or contact support.`,
          { found: false }
        );
      }

      const STATUS_LABELS: Record<string, string> = {
        confirmed: 'Order Confirmed',
        processing: 'Processing',
        shipped: 'Shipped',
        out_for_delivery: 'Out for Delivery',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
        return_requested: 'Return Requested',
      };

      const formattedOrders = orders.map((o: any) => ({
        orderId: o.orderId,
        product: o.productName,
        productImageUrl: o.productImageUrl || null,
        status: o.status,
        statusLabel: STATUS_LABELS[o.status] || o.status,
        courier: o.courier || null,
        trackingNumber: o.trackingNumber || null,
        estimatedDelivery: o.estimatedDelivery || null,
        orderDate: o.orderDate || null,
        amount: o.amount ? `₹${Number(o.amount).toLocaleString('en-IN')}` : null,
      }));

      return this.createSuccessResponse(
        orders.length === 1
          ? `Found your order. Here are the details.`
          : `Found ${orders.length} recent orders for you.`,
        { found: true, orders: formattedOrders }
      );
    } catch (err: any) {
      console.error('[DemoOrders Tool] track_order error:', err.message);
      return this.createErrorResponse('Failed to look up order: ' + err.message);
    }
  }

  private static async handleInitiateReturn(parameters: any, context: ToolExecutionContext): Promise<ToolResponse> {
    const { order_id, reason, resolution } = parameters;
    const { businessAccountId } = context;
    console.log(`[DemoOrders Tool] initiate_return orderId="${order_id}" reason="${reason}" resolution="${resolution}" business=${businessAccountId}`);
    try {
      const account = await storage.getBusinessAccount(businessAccountId);
      if (!account || account.demoOrdersEnabled !== 'true') {
        return this.createErrorResponse('Return requests are not available for this account.');
      }
      if (!order_id || !reason || !resolution) {
        return this.createSuccessResponse('Please provide the order ID, reason for return, and whether you prefer a refund or exchange.', { requires_input: true });
      }

      const { demoOrders } = await import('../../shared/schema');
      const { db } = await import('../db');
      const { eq } = await import('drizzle-orm');

      const all = await db.select().from(demoOrders).where(eq(demoOrders.businessAccountId, businessAccountId));
      const normalizedId = (order_id || '').replace(/^#/, '').toUpperCase();
      const order = all.find((o: any) => (o.orderId || '').replace(/^#/, '').toUpperCase() === normalizedId);

      if (!order) {
        return this.createSuccessResponse(
          `Order ${order_id} not found. Please double-check the order ID.`,
          { found: false }
        );
      }

      if (order.status === 'cancelled') {
        return this.createSuccessResponse(
          `Order ${order_id} is already cancelled and cannot be returned.`,
          { eligible: false }
        );
      }

      if (order.status === 'return_requested') {
        return this.createSuccessResponse(
          `A return request is already in progress for order ${order_id}. Our team will contact you within 24-48 hours.`,
          { eligible: false, alreadyRequested: true }
        );
      }

      if (order.status !== 'delivered') {
        const STATUS_LABELS: Record<string, string> = {
          confirmed: 'Order Confirmed',
          processing: 'Processing',
          shipped: 'Shipped',
          out_for_delivery: 'Out for Delivery',
        };
        const statusLabel = STATUS_LABELS[order.status] || order.status;
        return this.createSuccessResponse(
          `Returns can only be requested for delivered orders. Your order ${order_id} is currently "${statusLabel}" and cannot be returned yet. Please reach out once your order has been delivered.`,
          { eligible: false, currentStatus: order.status }
        );
      }

      const ticketNumber = `RT${Date.now().toString().slice(-6)}`;
      const returnNote = `Return requested. Ticket: #${ticketNumber}. Reason: ${reason}. Resolution: ${resolution === 'refund' ? 'Refund' : 'Exchange'}.`;

      await db.update(demoOrders)
        .set({
          status: 'return_requested',
          notes: order.notes ? `${order.notes} | ${returnNote}` : returnNote,
          updatedAt: new Date(),
        })
        .where(eq(demoOrders.id, order.id));

      console.log(`[DemoOrders Tool] Order ${order.orderId} status updated to return_requested, ticket ${ticketNumber}`);

      return this.createSuccessResponse(
        `Your return request for order ${order_id} has been registered! Ticket: #${ticketNumber}. Reason: ${reason}. Resolution: ${resolution === 'refund' ? 'Refund' : 'Exchange'}. Our team will contact you within 24-48 hours.`,
        {
          success: true,
          ticketNumber,
          orderId: order_id,
          product: order.productName,
          reason,
          resolution,
        }
      );
    } catch (err: any) {
      console.error('[DemoOrders Tool] initiate_return error:', err.message);
      return this.createErrorResponse('Failed to initiate return: ' + err.message);
    }
  }
}
