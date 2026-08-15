import OpenAI from "openai";
import * as cheerio from "cheerio";
import { storage } from "./storage";
import { promises as dns } from "dns";
import { aiUsageLogger } from "./services/aiUsageLogger";

interface AnalyzedWebsiteContent {
  businessName: string;
  businessDescription: string;
  mainProducts: string[];
  mainServices: string[];
  keyFeatures: string[];
  targetAudience: string;
  uniqueSellingPoints: string[];
  contactInfo: {
    email?: string;
    phone?: string;
    address?: string;
  };
  businessHours?: string;
  pricingInfo?: string;
  additionalInfo: string;
}

interface EvidenceBackedField<T> {
  value: T;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ExtractedDataWithEvidence {
  businessName: EvidenceBackedField<string>;
  businessDescription: EvidenceBackedField<string>;
  mainProducts: EvidenceBackedField<string>[];
  mainServices: EvidenceBackedField<string>[];
  keyFeatures: EvidenceBackedField<string>[];
  targetAudience: EvidenceBackedField<string>;
  uniqueSellingPoints: EvidenceBackedField<string>[];
  contactInfo: {
    email?: EvidenceBackedField<string>;
    phone?: EvidenceBackedField<string>;
    address?: EvidenceBackedField<string>;
  };
  businessHours?: EvidenceBackedField<string>;
  pricingInfo?: EvidenceBackedField<string>;
  additionalInfo: EvidenceBackedField<string>;
}

export class WebsiteAnalysisService {
  /**
   * Detect obviously fake or placeholder patterns in data
   */
  private isSuspiciousData(value: string, fieldType: 'email' | 'phone' | 'address' | 'other'): boolean {
    if (!value || value.trim() === '') return true;
    
    const lowerValue = value.toLowerCase();
    const trimmedValue = value.trim();
    
    // Common placeholder patterns
    const placeholderPatterns = [
      /example\.com/i,
      /\btest\b/i,
      /\bdemo\b/i,
      /\bplaceholder\b/i,
      /\bsample\b/i,
      /xxx[-\s]?xxx/i,
      /\bN\/A\b/i,
      /\bnone\b/i,
      /\bunknown\b/i,
    ];
    
    if (placeholderPatterns.some(pattern => pattern.test(value))) {
      return true;
    }
    
    // Field-specific suspicious patterns
    if (fieldType === 'phone') {
      const digitsOnly = value.replace(/\D/g, '');
      
      // Too short or too long
      if (digitsOnly.length < 7 || digitsOnly.length > 15) return true;
      
      // Sequential ascending numbers (123456, 234567, 345678, etc.)
      if (/(?:0123|1234|2345|3456|4567|5678|6789|7890|012345|123456|234567|345678|456789|567890)/.test(digitsOnly)) return true;
      
      // Sequential descending (987654, 876543, etc.)
      if (/(?:9876|8765|7654|6543|5432|4321|3210|987654|876543|765432|654321)/.test(digitsOnly)) return true;
      
      // Repeated digits (111, 2222, 33333, etc.)
      if (/(\d)\1{2,}/.test(digitsOnly)) return true;
      
      // All zeros
      if (/^0+$/.test(digitsOnly)) return true;
      
      // Patterns like xxx-xxx-xxxx with placeholder x
      if (/x{3,}/i.test(value)) return true;
      
      // Common fake patterns
      if (/555[-\s]?0100|800[-\s]?000[-\s]?0000/.test(value)) return true;
    }
    
    if (fieldType === 'email') {
      // Generic placeholder emails
      if (/^(info|contact|hello|support|admin|sales|mail|email|test|demo|placeholder|sample)@/i.test(trimmedValue)) {
        // Only if combined with suspicious domain
        if (/example|test|demo|placeholder|sample|yourdomain|yourcompany|company|business|website/i.test(trimmedValue)) {
          return true;
        }
      }
      
      // Obviously fake patterns
      if (/@(example|test|demo|placeholder|sample|yourdomain|yourcompany)\.com$/i.test(trimmedValue)) return true;
      
      // Missing @ or domain
      if (!trimmedValue.includes('@') || !trimmedValue.includes('.')) return true;
    }
    
    if (fieldType === 'address') {
      // Suspicious street numbers (123, 456, 789, 1, 100, 1000, etc.)
      if (/^(1|10|100|1000|123|234|345|456|567|678|789)\s/i.test(trimmedValue)) return true;
      
      // Generic street names
      if (/\b(main|first|second|third|maple|oak|street|avenue|road|lane|drive|way|boulevard)\b/i.test(lowerValue)) {
        // Check if it's ONLY generic (e.g., "123 Main Street, City, State")
        const genericCount = (lowerValue.match(/\b(main|first|second|third|maple|oak|street|avenue|road|lane|drive|way|city|state|country|zip|zipcode)\b/gi) || []).length;
        if (genericCount >= 3) return true;
      }
      
      // Placeholder patterns
      if (/\b(city|state|country|zip|zipcode|postal)\b/i.test(lowerValue) && 
          !/\b\d{5}\b/.test(trimmedValue)) { // Unless it has a real zip code
        return true;
      }
      
      // Too short to be real address
      if (trimmedValue.length < 10) return true;
      
      // Pattern like "Street, City, State" without specifics
      const parts = trimmedValue.split(',').map(p => p.trim());
      if (parts.length >= 2 && parts.every(p => p.split(' ').length <= 3)) {
        // Very short parts suggest placeholder
        if (parts.every(p => p.length < 15)) return true;
      }
    }
    
    return false;
  }
  
  /**
   * Verify that evidence snippet actually exists in source content
   * Balanced approach: strict enough to catch hallucinations, flexible enough for real data
   */
  private verifyEvidence(evidence: string, sourceContent: string): boolean {
    if (!evidence || !sourceContent) {
      return false;
    }
    
    const trimmedEvidence = evidence.trim();
    
    // Very short evidence is acceptable if it's just a name/value
    if (trimmedEvidence.length < 2) {
      return false;
    }
    
    // Try exact match first (case-insensitive)
    const lowerEvidence = trimmedEvidence.toLowerCase();
    const lowerSource = sourceContent.toLowerCase();
    
    if (lowerSource.includes(lowerEvidence)) {
      return true;
    }
    
    // Try with normalized whitespace (single spaces only)
    const normalizedEvidence = trimmedEvidence.replace(/\s+/g, ' ').toLowerCase();
    const normalizedSource = sourceContent.replace(/\s+/g, ' ').toLowerCase();
    
    if (normalizedSource.includes(normalizedEvidence)) {
      return true;
    }
    
    // For longer evidence, check if key words exist (at least 50% match for 3+ words)
    const evidenceWords = normalizedEvidence.split(' ').filter(w => w.length > 2);
    if (evidenceWords.length >= 2) {
      const matchCount = evidenceWords.filter(word => normalizedSource.includes(word)).length;
      const matchRate = matchCount / evidenceWords.length;
      
      // Accept if at least 50% of meaningful words match
      if (matchRate >= 0.5) {
        return true;
      }
    }
    
    // For single-word evidence, be more lenient
    if (evidenceWords.length === 1 && evidenceWords[0].length >= 3) {
      return normalizedSource.includes(evidenceWords[0]);
    }
    
    return false;
  }
  
  /**
   * Process raw extracted content into structured bullet points using AI
   * Extracts only business-relevant information in a readable format
   */
  private async processContentToBulletPoints(
    rawContent: string,
    pageUrl: string,
    apiKey: string,
    businessAccountId: string
  ): Promise<string> {
    try {
      const openai = new OpenAI({ apiKey });
      
      const systemPrompt = `You are a business analyst extracting key information from website content.
Your task is to analyze the provided content and extract ONLY the most important business-relevant information.

Format your response as clean, organized bullet points. Group related information under clear headings.

ALWAYS extract these if present (even from legal/terms/privacy pages):
- Company name, legal entity name, registration numbers
- Founders, founding year, company history
- Leadership team members and key personnel
- Business address, headquarters location
- Contact information (email, phone)
- Key products or services offered
- Important features or benefits
- Business hours or operational details
- Pricing information
- Certifications, licenses, compliance standards
- Unique policies that differentiate the business
- Data handling practices customers should know about
- Refund, warranty, or guarantee policies

IGNORE these (do not extract):
- Generic warranty disclaimers ("provided as-is", "without warranty")
- Liability limitation clauses
- Legal jargon about jurisdiction or arbitration
- Cookie consent boilerplate
- Standard indemnification clauses
- Navigation menus and headers/footers
- "Last updated" timestamps (unless part of a version or history note)

Extraction rules:
- Maximum 1-2 sentences per bullet point
- If a Terms page says "Founded by John Smith in 2020" → EXTRACT IT
- If a Privacy Policy lists company address → EXTRACT IT
- If legal text is pure disclaimers with no business facts → return "No relevant business information found on this page."
- Summarize long policy explanations into concise bullets
- Only include information explicitly stated in the content`;

      const userPrompt = `Page URL: ${pageUrl}

Raw Content:
${rawContent.substring(0, 15000)} ${rawContent.length > 15000 ? '(content truncated)' : ''}

Extract and organize the key business information as bullet points.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      // Log AI usage (fire-and-forget)
      aiUsageLogger.logWebsiteAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );

      const processedContent = completion.choices[0]?.message?.content?.trim();
      
      if (!processedContent || processedContent === "") {
        return "No relevant business information found on this page.";
      }
      
      return processedContent;
    } catch (error) {
      console.error('[Website Analysis] Error processing content to bullet points:', error);
      // Fallback: return first 500 chars of raw content
      return `Content preview:\n${rawContent.substring(0, 500)}...`;
    }
  }

  /**
   * Create a cancellable timeout promise
   */
  private createCancellableTimeout(ms: number, message: string): { promise: Promise<never>; cancel: () => void } {
    let timeoutId: NodeJS.Timeout;
    const promise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });
    const cancel = () => clearTimeout(timeoutId);
    return { promise, cancel };
  }

  /**
   * Find all internal pages to crawl (analyzes ALL same-domain links)
   * Returns unique internal pages with configurable limit
   */
  /**
   * Smart URL normalization - canonical form for true deduplication
   * - Lowercases hostname (LiquiBonds.in → liquibonds.in)
   * - Removes tracking params (utm_, fbclid, etc.)
   * - Sorts query parameters (?b=2&a=1 → ?a=1&b=2)
   * - Drops fragments (#section)
   * - Removes trailing slashes
   */
  private normalizeUrl(url: URL): string {
    // Tracking/marketing params to strip (common noise)
    const trackingParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      'ref', 'source', 'campaign', '_ga', '_gl', 'si'
    ]);
    
    // Lowercase hostname for case-insensitive matching
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol;
    
    // Remove tracking params and sort remaining params for consistent order
    const sortedParams = new URLSearchParams();
    const paramEntries = Array.from(url.searchParams.entries())
      .filter(([key]) => !trackingParams.has(key))
      .sort((a, b) => a[0].localeCompare(b[0])); // Sort by key
    
    paramEntries.forEach(([key, value]) => sortedParams.append(key, value));
    
    // Build canonical URL: protocol + lowercase host + pathname (no trailing slash) + sorted params (no fragment)
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const queryString = sortedParams.toString();
    const normalized = `${protocol}//${hostname}${pathname}${queryString ? '?' + queryString : ''}`;
    
    return normalized;
  }

  /**
   * Calculate priority score for a URL based on business importance
   * Higher score = more important = analyzed first
   * 
   * Only matches first-level path segments (depth = 1) for high priority
   * to avoid false positives like /blog/services-update or /products/category/item
   */
  private calculatePagePriority(url: string): number {
    try {
      const urlObj = new URL(url);
      const pathLower = urlObj.pathname.toLowerCase();
      
      // Parse path segments (ignore empty segments from leading/trailing slashes)
      const segments = pathLower.split('/').filter(s => s.length > 0);
      
      // Extract first segment for pattern matching
      const firstSegment = segments[0] || '';
      const pathDepth = segments.length;
      
      // CRITICAL: Check depth FIRST to avoid misclassifying nested pages
      // Only top-level pages (/about, /contact, /services) get high priority
      if (pathDepth === 1) {
        // High Priority (100-200): Critical business information pages
        if (/^(about|about-us|who-we-are|our-story|company|team)$/.test(firstSegment)) return 200;
        if (/^(contact|contact-us|get-in-touch|reach-us)$/.test(firstSegment)) return 190;
        if (/^(services|our-services|what-we-do|solutions)$/.test(firstSegment)) return 180;
        if (/^(products|our-products|shop|store)$/.test(firstSegment)) return 170;
        if (/^(pricing|plans|packages)$/.test(firstSegment)) return 160;
        if (/^(faq|faqs|help|support|questions)$/.test(firstSegment)) return 150;
        if (/^(features|capabilities|benefits)$/.test(firstSegment)) return 140;
        if (/^(testimonials|reviews|case-studies|success-stories)$/.test(firstSegment)) return 130;
        if (/^(careers|jobs|work-with-us|join-us)$/.test(firstSegment)) return 120;
        if (/^(locations|offices|branches|find-us)$/.test(firstSegment)) return 110;
        
        // Medium Priority (50-99): Useful but less critical top-level pages
        if (/^(blog|news|articles|insights)$/.test(firstSegment)) return 90;
        if (/^(portfolio|work|projects|gallery)$/.test(firstSegment)) return 80;
        if (/^(technology|tech|process|how-it-works)$/.test(firstSegment)) return 70;
        if (/^(partners|clients|affiliates)$/.test(firstSegment)) return 60;
        
        // Low Priority (1-49): Legal and policy pages (depth 1)
        if (/^(privacy|privacy-policy|data-protection)$/.test(firstSegment)) return 40;
        if (/^(terms|tos|terms-of-service|terms-and-conditions|tnc)$/.test(firstSegment)) return 35;
        if (/^(cookies|cookie-policy)$/.test(firstSegment)) return 30;
        if (/^(legal|disclaimer|compliance)$/.test(firstSegment)) return 25;
        if (/^(sitemap|accessibility)$/.test(firstSegment)) return 20;
        
        // Unknown top-level pages get default medium priority
        return 50;
      }
      
      // Nested pages (pathDepth > 1) - always get lower priority
      // Individual blog posts/articles
      if (/^(blog|news|articles|insights|press)$/.test(firstSegment)) return 15;
      
      // Individual product/catalog pages
      if (/^(products|shop|store|catalog)$/.test(firstSegment)) return 45;
      
      // Service detail pages
      if (/^(services|solutions)$/.test(firstSegment)) return 42;
      
      // Other nested pages get low priority (depth 2+ under any section)
      return 35;
    } catch (error) {
      // Invalid URL, give lowest priority
      return 10;
    }
  }

  private async findInternalPages(baseUrl: string, homepageHtml: string, maxPages: number = 10): Promise<string[]> {
    const $ = cheerio.load(homepageHtml);
    const parsedBase = new URL(baseUrl);
    const baseOrigin = parsedBase.origin;
    const basePath = parsedBase.pathname.replace(/\/$/, '');
    
    // Map: normalized URL → { url, priority }
    const pageMap: Map<string, { url: string; priority: number }> = new Map();
    let duplicatesSkipped = 0;

    console.log(`[Page Discovery] Searching for internal pages in ${baseUrl}`);
    console.log(`[Page Discovery] HTML length: ${homepageHtml.length} characters`);
    
    // Find all links on the page
    const allLinks: string[] = [];
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      allLinks.push(href);

      try {
        // Resolve relative URLs
        const absoluteUrl = new URL(href, baseUrl);
        
        // Only consider links from the same domain
        if (absoluteUrl.origin !== baseOrigin) {
          return;
        }

        // Smart normalization: remove tracking params but keep content params (id, page, category, etc.)
        const normalizedUrl = this.normalizeUrl(absoluteUrl);
        
        // Skip if it's the same as homepage
        const homeNormalized = this.normalizeUrl(parsedBase);
        if (normalizedUrl === homeNormalized || normalizedUrl === `${baseOrigin}/`) {
          return;
        }

        // Skip common non-content pages
        const path = absoluteUrl.pathname.toLowerCase();
        const skipPatterns = [
          '/login', '/signup', '/register', '/cart', '/checkout',
          '/admin', '/dashboard', '/account', '/profile',
          '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.zip', '.doc', '.docx'
        ];
        
        if (skipPatterns.some(pattern => path.includes(pattern))) {
          return;
        }

        // Check for true duplicates (normalized URL already exists)
        if (pageMap.has(normalizedUrl)) {
          duplicatesSkipped++;
          return;
        }

        // Calculate priority for this page
        const priority = this.calculatePagePriority(normalizedUrl);

        // Add to map (we'll sort later and take top N)
        pageMap.set(normalizedUrl, { url: normalizedUrl, priority });
      } catch (error) {
        // Skip invalid URLs
      }
    });

    console.log(`[Page Discovery] Total links found: ${allLinks.length}`);
    console.log(`[Page Discovery] Unique internal pages found: ${pageMap.size}`);
    console.log(`[Page Discovery] Duplicates skipped (tracking param variants): ${duplicatesSkipped}`);

    // Sort by priority (highest first) and take top N pages
    const sortedPages = Array.from(pageMap.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxPages);

    // Log the prioritized selection
    console.log(`[Page Discovery] Selected ${sortedPages.length} pages by priority (max: ${maxPages}):`);
    sortedPages.forEach((page, index) => {
      const pageName = new URL(page.url).pathname.split('/').filter(p => p).pop() || 'root';
      console.log(`[Page Discovery]   ${index + 1}. [Priority ${page.priority}] ${page.url} (${pageName})`);
    });

    // Return the sorted URLs (which preserve content query params)
    return sortedPages.map(p => p.url);
  }

  /**
   * Scrape and analyze a website to extract business information
   * Now includes multi-page crawling for comprehensive analysis
   */
  async analyzeWebsite(websiteUrl: string, businessAccountId: string, openaiApiKey: string): Promise<void> {
    try {
      // Update status to analyzing
      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'analyzing');

      // Step 1: Scrape homepage (get both content and HTML for link discovery)
      console.log('[Website Analysis] Scraping homepage:', websiteUrl);
      const { content: homepageContent, html: homepageHtml } = await this.scrapeWebsiteWithHtml(websiteUrl);

      // Step 2: Find and scrape ALL internal pages (comprehensive analysis)
      // Use the rendered HTML for link discovery (works for both static and JavaScript sites)
      console.log('[Website Analysis] Finding internal pages...');
      const additionalPages = await this.findInternalPages(websiteUrl, homepageHtml, 10);
      
      console.log('[Website Analysis] Found pages to analyze:', additionalPages.length);
      
      // Track per-page content for storage (Map: URL → content)
      const pageContentMap = new Map<string, string>();
      pageContentMap.set(websiteUrl, homepageContent);
      
      let combinedContent = `HOMEPAGE CONTENT:\n${homepageContent}\n\n`;

      // Scrape each additional page and store content
      for (const pageUrl of additionalPages) {
        try {
          console.log('[Website Analysis] Scraping:', pageUrl);
          const pageContent = await this.scrapeWebsite(pageUrl);
          const pageName = new URL(pageUrl).pathname.split('/').filter(p => p).pop() || 'page';
          combinedContent += `\n\n${pageName.toUpperCase()} PAGE CONTENT:\n${pageContent}\n`;
          
          // Store per-page content for database
          pageContentMap.set(pageUrl, pageContent);
        } catch (error) {
          console.error('[Website Analysis] Error scraping page:', pageUrl, error);
          // Continue with other pages even if one fails
        }
      }

      console.log('[Website Analysis] Total content length:', combinedContent.length);

      // Step 3: Analyze with OpenAI (combined content for comprehensive business info)
      const analyzedContent = await this.analyzeWithOpenAI(combinedContent, openaiApiKey, businessAccountId);

      // Step 4: Save combined analysis to database
      await storage.upsertWebsiteAnalysis(businessAccountId, {
        websiteUrl,
        status: 'completed',
        analyzedContent: JSON.stringify(analyzedContent),
      });

      // Step 5: Process and save analyzed pages with AI-extracted bullet points
      const allAnalyzedPages = Array.from(pageContentMap.keys());
      
      for (const pageUrl of allAnalyzedPages) {
        try {
          const rawContent = pageContentMap.get(pageUrl);
          if (!rawContent) {
            continue;
          }
          
          // Process raw content into structured bullet points using AI
          console.log('[Website Analysis] Processing content for:', pageUrl);
          const processedContent = await this.processContentToBulletPoints(
            rawContent,
            pageUrl,
            openaiApiKey,
            businessAccountId
          );
          
          await storage.createAnalyzedPage({
            businessAccountId,
            pageUrl,
            extractedContent: processedContent,
          });
          console.log('[Website Analysis] Saved analyzed page with processed content:', pageUrl);
        } catch (error) {
          console.error('[Website Analysis] Error saving analyzed page:', pageUrl, error);
          // Continue even if saving one page fails
        }
      }
      console.log(`[Website Analysis] Saved ${allAnalyzedPages.length} pages with processed content`);

      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'completed');
      console.log('[Website Analysis] Analysis completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[Website Analysis] Error:', errorMessage);
      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'failed', errorMessage);
      throw error;
    }
  }

  /**
   * Analyze multiple specific pages and optionally merge with existing data
   * @param pageUrls - Array of URLs to analyze
   * @param businessAccountId - Business account ID
   * @param openaiApiKey - OpenAI API key
   * @param appendMode - If true, merge with existing data; if false, replace
   */
  async analyzeWebsitePages(pageUrls: string[], businessAccountId: string, openaiApiKey: string, appendMode: boolean = false): Promise<void> {
    console.log('[Website Analysis] Starting analysis for', pageUrls.length, 'pages');
    
    // Create cancellable timeout (5 minutes max)
    const timeout = this.createCancellableTimeout(
      300000, 
      'Website analysis timed out after 5 minutes. The website may be too slow or unresponsive.'
    );
    
    try {
      // Race the analysis against the timeout
      await Promise.race([
        this.performAnalysis(pageUrls, businessAccountId, openaiApiKey, appendMode),
        timeout.promise
      ]);
      
      // Analysis completed successfully - cancel the timeout
      timeout.cancel();
    } catch (error) {
      // Make sure timeout is cancelled
      timeout.cancel();
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[Website Analysis] Error:', errorMessage);
      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'failed', errorMessage);
      throw error;
    }
  }

  private async performAnalysis(pageUrls: string[], businessAccountId: string, openaiApiKey: string, appendMode: boolean): Promise<void> {
    try {
      // Update status to analyzing
      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'analyzing');

      // Step 1: Scrape all provided pages
      console.log('[Website Analysis] Analyzing', pageUrls.length, 'pages in', appendMode ? 'append' : 'replace', 'mode');
      let combinedContent = '';
      const pageContentMap = new Map<string, string>();

      for (const pageUrl of pageUrls) {
        try {
          console.log('[Website Analysis] Scraping:', pageUrl);
          const pageContent = await this.scrapeWebsite(pageUrl);
          const pageName = new URL(pageUrl).pathname.split('/').filter(p => p).pop() || 'page';
          combinedContent += `${pageName.toUpperCase()} PAGE (${pageUrl}):\n${pageContent}\n\n`;
          pageContentMap.set(pageUrl, pageContent);
        } catch (error) {
          console.error('[Website Analysis] Error scraping page:', pageUrl, error);
          // Continue with other pages even if one fails
        }
      }

      if (!combinedContent.trim()) {
        throw new Error('Failed to scrape any pages');
      }

      console.log('[Website Analysis] Total content length:', combinedContent.length);

      // Step 2: Get existing analysis if in append mode
      let existingData: AnalyzedWebsiteContent | null = null;
      if (appendMode) {
        const analysis = await storage.getWebsiteAnalysis(businessAccountId);
        if (analysis && analysis.analyzedContent) {
          try {
            existingData = JSON.parse(analysis.analyzedContent) as AnalyzedWebsiteContent;
            console.log('[Website Analysis] Found existing data to merge with');
          } catch (error) {
            console.error('[Website Analysis] Error parsing existing data:', error);
          }
        }
      }

      // Step 3: Analyze with OpenAI
      let analyzedContent: AnalyzedWebsiteContent;
      if (existingData && appendMode) {
        // Merge mode: use OpenAI to intelligently combine old and new data
        analyzedContent = await this.mergeAnalysisData(existingData, combinedContent, openaiApiKey, businessAccountId);
      } else {
        // Replace mode: just analyze the new content
        analyzedContent = await this.analyzeWithOpenAI(combinedContent, openaiApiKey, businessAccountId);
      }

      // Step 4: Save to database
      await storage.upsertWebsiteAnalysis(businessAccountId, {
        websiteUrl: pageUrls[0], // Use the first URL as the main website URL
        status: 'completed',
        analyzedContent: JSON.stringify(analyzedContent),
      });

      // Step 5: Process and save analyzed pages with AI-extracted bullet points
      const uniquePages = Array.from(new Set(pageUrls.map(url => url.toLowerCase().replace(/\/$/, ''))));
      
      for (const pageUrl of uniquePages) {
        try {
          const rawContent = pageContentMap.get(pageUrl);
          if (rawContent) {
            // Process raw content into structured bullet points using AI
            console.log('[Website Analysis] Processing content for:', pageUrl);
            const processedContent = await this.processContentToBulletPoints(
              rawContent,
              pageUrl,
              openaiApiKey,
              businessAccountId
            );
            
            await storage.createAnalyzedPage({
              businessAccountId,
              pageUrl,
              extractedContent: processedContent,
            });
            console.log('[Website Analysis] Saved analyzed page with processed content:', pageUrl);
          } else {
            // No content available for this page (scraping failed)
            await storage.createAnalyzedPage({
              businessAccountId,
              pageUrl,
              extractedContent: null,
            });
            console.log('[Website Analysis] Saved analyzed page without content:', pageUrl);
          }
        } catch (error) {
          console.error('[Website Analysis] Error saving analyzed page:', pageUrl, error);
          // Continue even if saving one page fails
        }
      }
      console.log(`[Website Analysis] Saved ${uniquePages.length} unique pages with processed content`);

      await storage.updateWebsiteAnalysisStatus(businessAccountId, 'completed');
      console.log('[Website Analysis] Analysis completed successfully');
    } catch (error) {
      console.error('[Website Analysis] Error in performAnalysis:', error);
      throw error; // Re-throw to be handled by parent function
    }
  }

  /**
   * Merge existing analysis data with new website content using AI
   */
  private async mergeAnalysisData(existingData: AnalyzedWebsiteContent, newContent: string, apiKey: string, businessAccountId: string): Promise<AnalyzedWebsiteContent> {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are an expert business analyst specializing in merging and updating business information. Your goal is to combine existing business data with new website content, ensuring no information is lost and new details are added.`;

    const userPrompt = `I have existing business information and new website content. Please merge them intelligently:

EXISTING BUSINESS DATA:
${JSON.stringify(existingData, null, 2)}

NEW WEBSITE CONTENT:
${newContent}

Your task:
1. Keep ALL existing information that is still valid
2. Add ANY new information from the new content
3. Update any information that appears to have changed
4. For arrays (products, services, features, etc.), COMBINE both old and new items, removing duplicates
5. For contact info, keep existing values but add new ones if found
6. For descriptions, expand them with new details if available

Return ONLY valid JSON with this exact structure:

{
  "businessName": "business name (use existing unless clearly different)",
  "businessDescription": "comprehensive description merging both sources",
  "mainProducts": ["ALL products from both old and new data - no duplicates"],
  "mainServices": ["ALL services from both old and new data - no duplicates"],
  "keyFeatures": ["ALL features from both old and new data - no duplicates"],
  "targetAudience": "merged and expanded target audience description",
  "uniqueSellingPoints": ["ALL USPs from both old and new data - no duplicates"],
  "contactInfo": {
    "email": "email (prefer existing, add new if found)",
    "phone": "phone (prefer existing, add new if found)",
    "address": "address (prefer existing, add new if found)"
  },
  "businessHours": "operating hours (prefer new if different, keep existing otherwise)",
  "pricingInfo": "merged pricing information from both sources",
  "additionalInfo": "ALL additional information from both sources combined"
}

CRITICAL: Do NOT remove any existing data. Only add to it and update when necessary.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    // Log AI usage (fire-and-forget)
    aiUsageLogger.logWebsiteAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(err =>
      console.error('[Usage] Failed to log:', err)
    );

    const result = completion.choices[0].message.content;
    if (!result) {
      throw new Error('OpenAI returned empty response');
    }

    const parsedResult = JSON.parse(result) as AnalyzedWebsiteContent;
    return parsedResult;
  }

  /**
   * Fetch raw HTML for a page (used for link extraction)
   */
  private async fetchPageHtml(url: string): Promise<string> {
    const validatedUrl = await this.validateUrl(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(validatedUrl.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChroneyBot/1.0; +https://portal.aichroney.com)',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      if (response.status >= 300 && response.status < 400) {
        throw new Error('Redirects not supported');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Quick size check
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        throw new Error('Content too large');
      }

      const html = await response.text();
      return html.substring(0, 500000); // 500KB limit for HTML
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Check if an IP address is private/internal
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = ip.match(ipv4Pattern);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      
      // Validate octets are in range 0-255
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return true; // Invalid IP, treat as private
      }
      
      // Check private ranges
      if (
        a === 0 || // 0.0.0.0/8 (current network)
        a === 10 || // 10.0.0.0/8 (private)
        a === 127 || // 127.0.0.0/8 (loopback)
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (private)
        (a === 192 && b === 168) || // 192.168.0.0/16 (private)
        (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
        (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 (documentation)
        (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 (documentation)
        (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 (documentation)
        a >= 224 // 224.0.0.0/4 (multicast) and above
      ) {
        return true;
      }
    }

    // IPv6 private/special ranges
    const ipLower = ip.toLowerCase();
    if (
      ipLower === '::1' || // loopback
      ipLower.startsWith('::ffff:') || // IPv4-mapped
      ipLower.startsWith('fe80:') || // link-local
      ipLower.startsWith('fc') || // unique local fc00::/7
      ipLower.startsWith('fd') || // unique local fd00::/8
      ipLower.startsWith('ff') || // multicast
      ipLower === '::' // unspecified
    ) {
      return true;
    }

    return false;
  }

  /**
   * Validate URL and resolve DNS to prevent SSRF attacks
   */
  private async validateUrl(url: string): Promise<URL> {
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }

    // Only allow http and https protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS protocols are allowed');
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // Block obvious localhost strings
    if (hostname === 'localhost') {
      throw new Error('Access to localhost is not allowed');
    }

    // Block metadata endpoints
    if (hostname.includes('metadata')) {
      throw new Error('Access to metadata endpoints is not allowed');
    }

    // Check if hostname is already an IP address (IPv4 or IPv6)
    if (this.isPrivateIP(hostname) || hostname.includes(':')) {
      // For IPv6 literals, strip brackets
      const cleanHost = hostname.replace(/^\[|\]$/g, '');
      if (this.isPrivateIP(cleanHost)) {
        throw new Error('Access to private IP addresses is not allowed');
      }
    }

    // Resolve DNS to check if domain points to private IP
    try {
      const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
      const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
      
      const allAddresses = [...addresses, ...addresses6];
      
      if (allAddresses.length === 0) {
        throw new Error('Unable to resolve hostname');
      }

      // Check if any resolved IP is private
      for (const addr of allAddresses) {
        if (this.isPrivateIP(addr)) {
          throw new Error('Domain resolves to a private IP address');
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw our validation errors
        if (error.message.includes('not allowed') || error.message.includes('private IP') || error.message.includes('Unable to resolve')) {
          throw error;
        }
      }
      // DNS resolution failed for other reasons
      throw new Error('Unable to resolve hostname. Please check the URL.');
    }

    return parsedUrl;
  }


  /**
   * Scrape website and return both content and HTML (for link discovery)
   * Only used for homepage to enable multi-page crawling
   */
  private async scrapeWebsiteWithHtml(url: string): Promise<{ content: string; html: string }> {
    // Validate URL and resolve DNS to prevent SSRF
    const validatedUrl = await this.validateUrl(url);

    // Fetch the website with security controls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(validatedUrl.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChroneyBot/1.0; +https://portal.aichroney.com)',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      if (response.status >= 300 && response.status < 400) {
        throw new Error('Website redirects are not supported. Please provide the final URL.');
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch website: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/html')) {
        throw new Error('Website did not return HTML content');
      }

      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_SIZE) {
        throw new Error('Website content is too large');
      }

      if (!response.body) {
        throw new Error('Response body is not available');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > MAX_SIZE) {
            throw new Error('Website content exceeded size limit during download');
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const allChunks = new Uint8Array(totalSize);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }

      const html = new TextDecoder('utf-8').decode(allChunks);
      const $ = cheerio.load(html);

      // Extract content (same as scrapeWebsite)
      $('script, style, iframe, noscript').remove();
      const title = $('title').text() || '';
      const metaDescription = $('meta[name="description"]').attr('content') || '';
      const ogDescription = $('meta[property="og:description"]').attr('content') || '';
      
      // Extract content from multiple sources for comprehensive analysis
      let mainContent = '';
      const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.main', '#main'];
      for (const selector of mainSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          mainContent = element.text();
          break;
        }
      }

      // If no main content found, extract from sections and divs
      if (!mainContent || mainContent.length < 200) {
        const sections = $('section, [class*="section"], [class*="content"], [id*="content"]')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(text => text.length > 50)
          .join(' ');
        if (sections) mainContent = sections;
      }

      // Fallback to body if still no content
      if (!mainContent || mainContent.length < 200) {
        mainContent = $('body').text();
      }

      const headerContent = $('header, .header, nav, .nav, [role="banner"], [role="navigation"]').text() || '';
      const footerContent = $('footer, .footer, [role="contentinfo"]').text() || '';
      const headings = $('h1, h2, h3, h4').map((_, el) => $(el).text().trim()).get().filter(h => h.length > 0).join(' | ');
      
      // Extract all paragraphs for additional context
      const paragraphs = $('p').map((_, el) => $(el).text().trim()).get().filter(p => p.length > 20).join(' ');

      // Extract contact information specifically
      const telLinks = $('a[href^="tel:"]').map((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        return `Phone: ${href.replace('tel:', '')} (${text})`;
      }).get().join(', ');
      
      const mailtoLinks = $('a[href^="mailto:"]').map((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        return `Email: ${href.replace('mailto:', '')} (${text})`;
      }).get().join(', ');
      
      // Extract contact sections
      const contactContent = $('[class*="contact"], [id*="contact"], .address, .phone, .email, [class*="phone"], [class*="email"]')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 0 && text.length < 500)
        .join(' ');

      const fullContent = `
        Title: ${title}
        Meta Description: ${metaDescription}
        OG Description: ${ogDescription}
        
        Headings: ${headings}
        
        Contact Links: ${telLinks || mailtoLinks ? `${telLinks} ${mailtoLinks}`.trim() : 'None found'}
        
        Contact Sections: ${contactContent || 'None found'}
        
        Header & Navigation:
        ${headerContent}
        
        Main Content:
        ${mainContent}
        
        Paragraphs:
        ${paragraphs}
        
        Footer:
        ${footerContent}
      `;

      const cleanedContent = fullContent
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 50000);

      console.log('[Cheerio] Extracted content length:', cleanedContent.length);

      // If content is too short, the site is likely JavaScript-heavy
      if (cleanedContent.length < 300) {
        throw new Error('This website appears to be JavaScript-heavy and cannot be analyzed. Website analysis works best with standard HTML sites. Please ensure your key business information is available in regular HTML pages.');
      }

      // Return Cheerio content and HTML
      return { content: cleanedContent, html: html.substring(0, 500000) };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Website request timed out');
        }
        if (error.message.includes('not allowed') || 
            error.message.includes('Invalid URL') ||
            error.message.includes('JavaScript-heavy')) {
          throw error;
        }
      }
      throw new Error('Unable to access the website. Please check the URL and try again.');
    }
  }

  /**
   * Scrape website content using fetch and cheerio
   * Works with standard HTML websites
   */
  private async scrapeWebsite(url: string): Promise<string> {
    // Validate URL and resolve DNS to prevent SSRF
    const validatedUrl = await this.validateUrl(url);

    // Fetch the website with security controls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(validatedUrl.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChroneyBot/1.0; +https://portal.aichroney.com)',
        },
        signal: controller.signal,
        redirect: 'manual', // Disable automatic redirects to prevent redirect-based SSRF bypass
      });

      clearTimeout(timeoutId);

      // Handle redirects manually (don't follow them for security)
      if (response.status >= 300 && response.status < 400) {
        throw new Error('Website redirects are not supported. Please provide the final URL.');
      }

      if (!response.ok) {
        // Sanitize error message to avoid leaking internal details
        throw new Error(`Failed to fetch website: HTTP ${response.status}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/html')) {
        throw new Error('Website did not return HTML content');
      }

      // Enforce streaming size limit (5MB) regardless of Content-Length header
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_SIZE) {
        throw new Error('Website content is too large');
      }

      // Read response with streaming size enforcement
      if (!response.body) {
        throw new Error('Response body is not available');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > MAX_SIZE) {
            throw new Error('Website content exceeded size limit during download');
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine chunks and decode
      const allChunks = new Uint8Array(totalSize);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }

      const html = new TextDecoder('utf-8').decode(allChunks);
    const $ = cheerio.load(html);

    // Remove script, style, and other non-content elements
    $('script, style, iframe, noscript').remove();

    // Extract different content sections
    const title = $('title').text() || '';
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';
    
    // Extract main content - try multiple selectors
    let mainContent = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.main', '#main', 'body'];
    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        mainContent = element.text();
        break;
      }
    }

    // Extract header content (often has business info)
    const headerContent = $('header, .header, [role="banner"]').text() || '';

    // Extract footer content (often has contact info, hours)
    const footerContent = $('footer, .footer, [role="contentinfo"]').text() || '';

    // Look for specific business information patterns
    const contactPatterns = $('[class*="contact"], [id*="contact"], [class*="phone"], [class*="email"], [class*="address"]').text() || '';
    const aboutPatterns = $('[class*="about"], [id*="about"], [class*="mission"], [class*="story"]').text() || '';
    const productsPatterns = $('[class*="product"], [id*="product"], [class*="service"], [id*="service"]').text() || '';
    
    // Extract all headings for structure
    const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().join(' | ');

    // Combine all content with clear sections
    const fullContent = `
      Title: ${title}
      Meta Description: ${metaDescription}
      OG Description: ${ogDescription}
      
      Headings: ${headings}
      
      Header Section:
      ${headerContent}
      
      Main Content:
      ${mainContent}
      
      About/Mission Info:
      ${aboutPatterns}
      
      Products/Services Info:
      ${productsPatterns}
      
      Contact Information:
      ${contactPatterns}
      
      Footer Section:
      ${footerContent}
    `;

      // Clean up whitespace and limit size
      const cleanedContent = fullContent
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 25000); // Increased to 25k chars for more comprehensive extraction

      console.log('[Cheerio] Extracted content length:', cleanedContent.length);

      // If content is too short, the site is likely JavaScript-heavy
      if (cleanedContent.length < 300) {
        throw new Error('This website appears to be JavaScript-heavy and cannot be analyzed. Website analysis works best with standard HTML sites. Please ensure your key business information is available in regular HTML pages.');
      }

      return cleanedContent;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Sanitize error messages to prevent information disclosure
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Website request timed out');
        }
        // Re-throw our own validation errors
        if (error.message.includes('not allowed') || error.message.includes('Invalid URL')) {
          throw error;
        }
      }
      // Generic error for network/fetch issues
      throw new Error('Unable to access the website. Please check the URL and try again.');
    }
  }

  /**
   * Extract data with evidence using strict anti-hallucination prompts
   */
  private async extractWithEvidence(content: string, apiKey: string, businessAccountId: string): Promise<ExtractedDataWithEvidence> {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are a precise data extractor. Extract business information that is clearly stated in the provided content.

CORE RULES:
1. Extract information that is stated or clearly evident in the content
2. NEVER invent data - if you don't see it, omit the field
3. For each extracted value, provide a supporting quote from the content as evidence
4. NEVER use fake placeholder data (avoid "123-456-7890", "info@example.com", "123 Main Street", etc.)
5. When in doubt, omit the field rather than guessing

EVIDENCE GUIDELINES:
- Provide the relevant text snippet that supports each extraction
- Evidence should be recognizable quotes from the source
- Short evidence is fine if it clearly supports the value

CONFIDENCE LEVELS:
- high: Data is explicitly stated with clear evidence
- medium: Data is reasonably clear from the content
- If you're uncertain or evidence is weak, omit the field`;

    const userPrompt = `Extract business information from the content below. Extract data that is clearly present in the content, and provide supporting evidence.

CONTENT TO ANALYZE:
${content}

RETURN JSON WITH THIS STRUCTURE:
{
  "businessName": { "value": "company name", "evidence": "supporting quote", "confidence": "high" },
  "businessDescription": { "value": "what they do", "evidence": "relevant text", "confidence": "high/medium" },
  "mainProducts": [
    { "value": "Product Name", "evidence": "text mentioning it", "confidence": "high" }
  ],
  "mainServices": [
    { "value": "Service Name", "evidence": "supporting text", "confidence": "high" }
  ],
  "keyFeatures": [
    { "value": "Feature/Benefit/Award", "evidence": "supporting text", "confidence": "high" }
  ],
  "targetAudience": { "value": "who they serve", "evidence": "relevant text", "confidence": "high/medium" },
  "uniqueSellingPoints": [
    { "value": "What makes them unique", "evidence": "supporting text", "confidence": "high" }
  ],
  "contactInfo": {
    "email": { "value": "email if found", "evidence": "text showing it", "confidence": "high" },
    "phone": { "value": "phone if found", "evidence": "text showing it", "confidence": "high" },
    "address": { "value": "address if found", "evidence": "text showing it", "confidence": "high" }
  },
  "businessHours": { "value": "hours if stated", "evidence": "supporting text", "confidence": "high" },
  "pricingInfo": { "value": "pricing if stated", "evidence": "supporting text", "confidence": "high" },
  "additionalInfo": { "value": "other relevant info", "evidence": "supporting text", "confidence": "medium" }
}

IMPORTANT RULES:
1. OMIT fields entirely if data is not found in the content
2. Extract all products, services, and features you find - be thorough
3. For contact info: extract real emails/phones/addresses you see - NEVER make them up
4. Provide evidence snippets from the content for each field
5. Use confidence "high" when certain, "medium" when reasonably sure
6. DO NOT invent placeholder data like "123-456-7890" or "info@example.com"`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      top_p: 0.1,
      response_format: { type: "json_object" }
    });

    // Log AI usage (fire-and-forget)
    aiUsageLogger.logWebsiteAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(err =>
      console.error('[Usage] Failed to log:', err)
    );

    const result = completion.choices[0].message.content;
    if (!result) {
      throw new Error('OpenAI returned empty response');
    }

    console.log('[Website Analysis] Raw extraction result preview:', result.substring(0, 500));
    const parsedResult = JSON.parse(result) as ExtractedDataWithEvidence;
    return parsedResult;
  }

  /**
   * Convert evidence-backed extraction to final format with validation
   */
  private convertAndValidate(extracted: ExtractedDataWithEvidence, sourceContent: string): AnalyzedWebsiteContent {
    const result: AnalyzedWebsiteContent = {
      businessName: "unknown",
      businessDescription: "unknown",
      mainProducts: [],
      mainServices: [],
      keyFeatures: [],
      targetAudience: "unknown",
      uniqueSellingPoints: [],
      contactInfo: {},
      additionalInfo: "unknown"
    };

    // Validate and convert businessName
    if (extracted.businessName && extracted.businessName.confidence !== 'low') {
      if (this.verifyEvidence(extracted.businessName.evidence, sourceContent)) {
        result.businessName = extracted.businessName.value;
      } else {
        console.warn('[Validation] Business name evidence not found in source');
      }
    }

    // Validate and convert businessDescription
    if (extracted.businessDescription && extracted.businessDescription.confidence !== 'low') {
      if (this.verifyEvidence(extracted.businessDescription.evidence, sourceContent)) {
        result.businessDescription = extracted.businessDescription.value;
      }
    }

    // Validate and convert mainProducts
    if (extracted.mainProducts && Array.isArray(extracted.mainProducts)) {
      result.mainProducts = extracted.mainProducts
        .filter(item => item.confidence !== 'low' && this.verifyEvidence(item.evidence, sourceContent))
        .map(item => item.value);
    }

    // Validate and convert mainServices
    if (extracted.mainServices && Array.isArray(extracted.mainServices)) {
      result.mainServices = extracted.mainServices
        .filter(item => item.confidence !== 'low' && this.verifyEvidence(item.evidence, sourceContent))
        .map(item => item.value);
    }

    // Validate and convert keyFeatures
    if (extracted.keyFeatures && Array.isArray(extracted.keyFeatures)) {
      result.keyFeatures = extracted.keyFeatures
        .filter(item => item.confidence !== 'low' && this.verifyEvidence(item.evidence, sourceContent))
        .map(item => item.value);
    }

    // Validate and convert targetAudience
    if (extracted.targetAudience && extracted.targetAudience.confidence !== 'low') {
      if (this.verifyEvidence(extracted.targetAudience.evidence, sourceContent)) {
        result.targetAudience = extracted.targetAudience.value;
      }
    }

    // Validate and convert uniqueSellingPoints
    if (extracted.uniqueSellingPoints && Array.isArray(extracted.uniqueSellingPoints)) {
      result.uniqueSellingPoints = extracted.uniqueSellingPoints
        .filter(item => item.confidence !== 'low' && this.verifyEvidence(item.evidence, sourceContent))
        .map(item => item.value);
    }

    // Validate and convert contactInfo with suspicion checks
    if (extracted.contactInfo?.email && extracted.contactInfo.email.confidence !== 'low') {
      const email = extracted.contactInfo.email.value;
      if (this.verifyEvidence(extracted.contactInfo.email.evidence, sourceContent) &&
          !this.isSuspiciousData(email, 'email')) {
        result.contactInfo.email = email;
      } else {
        console.warn('[Validation] Email failed validation:', email);
      }
    }

    if (extracted.contactInfo?.phone && extracted.contactInfo.phone.confidence !== 'low') {
      const phone = extracted.contactInfo.phone.value;
      if (this.verifyEvidence(extracted.contactInfo.phone.evidence, sourceContent) &&
          !this.isSuspiciousData(phone, 'phone')) {
        result.contactInfo.phone = phone;
      } else {
        console.warn('[Validation] Phone failed validation:', phone);
      }
    }

    if (extracted.contactInfo?.address && extracted.contactInfo.address.confidence !== 'low') {
      const address = extracted.contactInfo.address.value;
      if (this.verifyEvidence(extracted.contactInfo.address.evidence, sourceContent) &&
          !this.isSuspiciousData(address, 'address')) {
        result.contactInfo.address = address;
      } else {
        console.warn('[Validation] Address failed validation:', address);
      }
    }

    // Validate and convert businessHours
    if (extracted.businessHours && extracted.businessHours.confidence !== 'low') {
      if (this.verifyEvidence(extracted.businessHours.evidence, sourceContent)) {
        result.businessHours = extracted.businessHours.value;
      }
    }

    // Validate and convert pricingInfo
    if (extracted.pricingInfo && extracted.pricingInfo.confidence !== 'low') {
      if (this.verifyEvidence(extracted.pricingInfo.evidence, sourceContent)) {
        result.pricingInfo = extracted.pricingInfo.value;
      }
    }

    // Validate and convert additionalInfo
    if (extracted.additionalInfo && extracted.additionalInfo.confidence !== 'low') {
      if (this.verifyEvidence(extracted.additionalInfo.evidence, sourceContent)) {
        result.additionalInfo = extracted.additionalInfo.value;
      }
    }

    console.log('[Validation] Conversion complete. Products:', result.mainProducts.length, 'Services:', result.mainServices.length);
    return result;
  }

  /**
   * Main analysis method with evidence-backed extraction and validation
   */
  private async analyzeWithOpenAI(content: string, apiKey: string, businessAccountId: string): Promise<AnalyzedWebsiteContent> {
    // Step 1: Extract with evidence
    const extracted = await this.extractWithEvidence(content, apiKey, businessAccountId);
    
    // Step 2: Validate and convert
    const validated = this.convertAndValidate(extracted, content);
    
    return validated;
  }

  /**
   * Get the analyzed content for a business account
   */
  async getAnalyzedContent(businessAccountId: string): Promise<AnalyzedWebsiteContent | null> {
    const analysis = await storage.getWebsiteAnalysis(businessAccountId);
    if (!analysis || !analysis.analyzedContent) {
      return null;
    }
    return JSON.parse(analysis.analyzedContent) as AnalyzedWebsiteContent;
  }
}

export const websiteAnalysisService = new WebsiteAnalysisService();
