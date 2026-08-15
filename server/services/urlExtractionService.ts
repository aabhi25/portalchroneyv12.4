import { storage } from '../storage';

export interface UrlExtractionConfig {
  domain?: string | null;
  universities?: string | null;
  products?: string | null;
  fallbackUniversity?: string | null;
  fallbackProduct?: string | null;
}

export interface UrlExtractionResult {
  university: string;
  product: string;
}

const GENERIC_FALLBACK: UrlExtractionResult = {
  university: 'Any',
  product: 'All Product',
};

function buildPrompt(url: string, config: UrlExtractionConfig): string {
  const universityList = config.universities
    ? `\nValid universities (you MUST pick from this list exactly):\n${config.universities.trim()}`
    : '';

  const productList = config.products
    ? `\nValid products/courses (you MUST pick from this list exactly):\n${config.products.trim()}`
    : '';

  const fallbackUniversity = config.fallbackUniversity || 'Any';
  const fallbackProduct = config.fallbackProduct || 'All Product';

  return `Extract the university name and course/product name from this education website URL.

URL: ${url}
${universityList}
${productList}

Rules:
- Return ONLY valid JSON with two keys: "university" and "product"
- If the URL is a homepage, contact page, about page, or generic/pillar page with no specific university or product, return: {"university": "${fallbackUniversity}", "product": "${fallbackProduct}"}
- Do NOT invent values. Only use names from the valid lists above if provided.
- If you cannot determine the university, use "${fallbackUniversity}"
- If you cannot determine the product/course, use "${fallbackProduct}"

Return only JSON, no explanation:`;
}

function parseAiResponse(raw: string): { university: string; product: string } | null {
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.university === 'string' && typeof parsed.product === 'string') {
      return { university: parsed.university.trim(), product: parsed.product.trim() };
    }
    return null;
  } catch {
    const match = raw.match(/"university"\s*:\s*"([^"]+)"[\s\S]*?"product"\s*:\s*"([^"]+)"/);
    if (match) {
      return { university: match[1].trim(), product: match[2].trim() };
    }
    return null;
  }
}

function normaliseToList(extracted: string, validList: string | null | undefined, fallback: string): string {
  if (!validList || !validList.trim()) return extracted;
  const valid = validList.split('\n').map(v => v.trim()).filter(Boolean);
  const match = valid.find(v => v.toLowerCase() === extracted.toLowerCase());
  return match ?? fallback;
}

export async function extractProductFromUrl(
  url: string,
  businessAccountId: string,
  config: UrlExtractionConfig
): Promise<UrlExtractionResult> {
  const fallback: UrlExtractionResult = {
    university: config.fallbackUniversity || GENERIC_FALLBACK.university,
    product: config.fallbackProduct || GENERIC_FALLBACK.product,
  };

  if (!url) return fallback;

  try {
    const ruleMatch = await storage.getUrlRuleByUrl(url, businessAccountId);
    if (ruleMatch) {
      console.log(`[URL Extraction] URL Rule matched for: ${url} → university="${ruleMatch.university}" product="${ruleMatch.product}"`);
      return {
        university: ruleMatch.university || fallback.university,
        product: ruleMatch.product || fallback.product,
      };
    }
  } catch (err) {
    console.error('[URL Extraction] URL Rule lookup error:', err);
  }

  if (config.domain) {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes(config.domain.replace(/^https?:\/\//, '').replace(/\/$/, ''))) {
        console.log(`[URL Extraction] URL domain mismatch — skipping extraction for: ${url}`);
        return fallback;
      }
    } catch {
      console.warn(`[URL Extraction] Invalid URL, using fallback: ${url}`);
      return fallback;
    }
  }

  try {
    const cached = await storage.getUrlExtraction(url, businessAccountId);
    if (cached) {
      const rawUniversity = cached.university || fallback.university;
      const rawProduct    = cached.product   || fallback.product;
      const university = normaliseToList(rawUniversity, config.universities, fallback.university);
      const product    = normaliseToList(rawProduct,    config.products,    fallback.product);
      if (university !== rawUniversity || product !== rawProduct) {
        console.log(`[URL Extraction] Cache value normalised to list: university="${university}" product="${product}" (was: university="${rawUniversity}" product="${rawProduct}")`);
      } else {
        console.log(`[URL Extraction] Cache HIT for: ${url} → university="${university}" product="${product}"`);
      }
      return { university, product };
    }
  } catch (err) {
    console.error('[URL Extraction] Cache lookup error:', err);
  }

  console.log(`[URL Extraction] Cache MISS — calling AI for: ${url}`);

  try {
    const { llamaService } = await import('../llamaService');
    const prompt = buildPrompt(url, config);

    const master = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(master?.masterEnabled && master.primaryApiKey);
    let resolvedApiKey: string | undefined;
    if (useMaster) {
      resolvedApiKey = master!.primaryApiKey!;
    } else {
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      resolvedApiKey = businessAccount?.openaiApiKey
        || process.env.OPENAI_API_KEY
        || process.env.AI_INTEGRATIONS_OPENAI_API_KEY
        || undefined;
    }
    console.log(`[URL Extraction] Resolved API key — master=${useMaster}, hasKey=${!!resolvedApiKey}`);

    const raw = await llamaService.generateSimpleResponse(prompt, resolvedApiKey);

    if (!raw) {
      console.warn('[URL Extraction] AI returned empty response, using fallback');
      return fallback;
    }

    const parsed = parseAiResponse(raw);
    if (!parsed) {
      console.warn(`[URL Extraction] Could not parse AI response: "${raw}", using fallback`);
      return fallback;
    }

    const university = normaliseToList(parsed.university, config.universities, fallback.university);
    const product    = normaliseToList(parsed.product,    config.products,    fallback.product);
    console.log(`[URL Extraction] AI extracted (normalised): university="${university}" product="${product}"`);

    await storage.saveUrlExtraction(url, businessAccountId, university, product);

    return { university, product };
  } catch (err) {
    console.error('[URL Extraction] AI call failed:', err);
    return fallback;
  }
}
