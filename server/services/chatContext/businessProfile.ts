/**
 * Compact, always-on business profile for the website chat prompt, plus the
 * retrievable passages (website pages, training-document summaries) that used to be
 * dumped into every prompt in full.
 *
 * Pure functions — no DB or network — so they are easy to test and benchmark.
 */
import { estimateTokens, truncateToTokens } from './tokens';

export interface WebsiteFacts {
  businessName?: string;
  businessDescription?: string;
  mainProducts?: string[];
  mainServices?: string[];
  keyFeatures?: string[];
  targetAudience?: string;
  uniqueSellingPoints?: string[];
  contactInfo?: { email?: string; phone?: string; address?: string };
  businessHours?: string;
  pricingInfo?: string;
  additionalInfo?: string;
}

export interface ProfilePage { pageUrl: string; extractedContent: string | null }
export interface ProfileDoc {
  id?: string;
  originalFilename: string;
  summary: string | null;
  keyPoints: string | null;
  uploadStatus: string;
}

export interface ProfileSource {
  companyDescription?: string | null;
  website?: WebsiteFacts | null;
  pages: ProfilePage[];
  docs: ProfileDoc[];
}

export interface KnowledgePassage {
  id: string;
  source: 'page' | 'doc_summary';
  title: string;
  text: string;
}

export interface BusinessProfile {
  /** The block that goes into the stable part of the prompt. */
  text: string;
  tokens: number;
  /** True when the whole (small) page/doc corpus fitted and was inlined verbatim. */
  inlinedAllContent: boolean;
  /** Retrievable passages (empty when inlined). */
  passages: KnowledgePassage[];
  /** Total tokens of page + doc summary content (what legacy put in every prompt). */
  corpusTokens: number;
}

export const PROFILE_BUDGET_TOKENS = 1500;
/** Sites whose entire page + document-summary content is this small are inlined in full. */
export const INLINE_CORPUS_TOKENS = 2500;
const PASSAGE_TARGET_CHARS = 900;

const NO_INFO = 'No relevant business information found on this page.';
const RETRIEVAL_NOTE = `Detailed website page and document content is looked up for each question; the relevant excerpts appear under "CRITICAL DOCUMENT KNOWLEDGE" when they exist.\n\n`;
const USAGE_NOTE = `IMPORTANT: Use this business knowledge to give accurate, context-aware answers. Answer naturally without mentioning that you analyzed their website or documents.\n\n`;

export function usablePages(pages: ProfilePage[]): ProfilePage[] {
  return pages.filter(p => p.extractedContent && p.extractedContent.trim() !== '' && p.extractedContent !== NO_INFO);
}

export function completedDocs(docs: ProfileDoc[]): ProfileDoc[] {
  return docs.filter(d => d.uploadStatus === 'completed' && (d.summary || d.keyPoints));
}

/** Same page naming as the legacy builder (last path segment, or Homepage). */
export function pageNameFromUrl(pageUrl: string): string {
  let parts: string[];
  try { parts = new URL(pageUrl).pathname.split('/').filter(Boolean); } catch { parts = pageUrl.split('/').filter(Boolean); }
  return parts[parts.length - 1] || 'Homepage';
}

/** Human title for a page: "pricing-plans.html" → "Pricing Plans". */
export function pageTitleFromUrl(pageUrl: string): string {
  const raw = decodeURIComponent(pageNameFromUrl(pageUrl)).replace(/\.(html?|php|aspx?)$/i, '');
  if (raw === 'Homepage') return raw;
  return raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()) || 'Homepage';
}

function parseKeyPoints(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : [];
  } catch { return []; }
}

/** The legacy rendering of one page / one doc, used when the corpus is small enough to inline. */
function legacyPageBlock(p: ProfilePage): string {
  return `--- ${pageNameFromUrl(p.pageUrl).toUpperCase()} PAGE ---\n${p.extractedContent}\n\n`;
}
function legacyDocBlock(d: ProfileDoc): string {
  let s = `--- ${d.originalFilename} ---\n`;
  if (d.summary) s += `Summary: ${d.summary}\n\n`;
  const kp = parseKeyPoints(d.keyPoints);
  if (kp.length) s += `Key Points:\n${kp.map((k, i) => `${i + 1}. ${k}`).join('\n')}\n\n`;
  return s;
}

/** Split text into ~PASSAGE_TARGET_CHARS passages on paragraph / sentence boundaries. */
export function splitIntoPassages(text: string, targetChars = PASSAGE_TARGET_CHARS): string[] {
  const paragraphs = text.split(/\n\s*\n|\n(?=[-•*]\s)|\n(?=#+\s)/).map(p => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= targetChars * 1.3) { pieces.push(p); continue; }
    // Long paragraph: split on sentences.
    const sentences = p.match(/[^.!?\n]+[.!?]*\s*/g) || [p];
    let cur = '';
    for (const s of sentences) {
      if (cur && (cur.length + s.length) > targetChars) { pieces.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  // Merge small neighbours so passages carry enough context.
  const out: string[] = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && buf.length + piece.length + 1 > targetChars) { out.push(buf); buf = ''; }
    buf = buf ? `${buf}\n${piece}` : piece;
  }
  if (buf) out.push(buf);
  return out;
}

export function buildKnowledgePassages(src: ProfileSource): KnowledgePassage[] {
  const passages: KnowledgePassage[] = [];
  for (const page of usablePages(src.pages)) {
    const title = pageTitleFromUrl(page.pageUrl);
    splitIntoPassages(page.extractedContent || '').forEach((text, i) => {
      passages.push({ id: `page:${page.pageUrl}#${i}`, source: 'page', title, text });
    });
  }
  for (const doc of completedDocs(src.docs)) {
    const kp = parseKeyPoints(doc.keyPoints);
    const body = [doc.summary ? `Summary: ${doc.summary}` : '', kp.length ? `Key points:\n${kp.map(k => `- ${k}`).join('\n')}` : '']
      .filter(Boolean).join('\n');
    splitIntoPassages(body).forEach((text, i) => {
      passages.push({ id: `doc:${doc.id || doc.originalFilename}#${i}`, source: 'doc_summary', title: doc.originalFilename, text });
    });
  }
  return passages;
}

/**
 * Build the compact profile. Sections are added in priority order; each is trimmed so
 * the whole block stays within `budgetTokens`.
 */
export function buildBusinessProfile(
  src: ProfileSource,
  opts: { budgetTokens?: number; inlineCorpusTokens?: number } = {},
): BusinessProfile {
  const budget = opts.budgetTokens ?? PROFILE_BUDGET_TOKENS;
  const inlineLimit = opts.inlineCorpusTokens ?? INLINE_CORPUS_TOKENS;
  const w = src.website || null;
  const pages = usablePages(src.pages);
  const docs = completedDocs(src.docs);

  // Inline the whole corpus when it is small: nothing to gain from retrieval, and
  // the model then sees exactly what the legacy builder showed it.
  const corpusText = pages.map(legacyPageBlock).join('') + docs.map(legacyDocBlock).join('');
  const corpusTokens = estimateTokens(corpusText);
  const inlinedAllContent = corpusTokens > 0 && corpusTokens <= inlineLimit;

  const sections: string[] = [];
  // Header + the two trailing notes added below are part of the budget.
  let used = estimateTokens('BUSINESS PROFILE:\n') + estimateTokens(RETRIEVAL_NOTE) + estimateTokens(USAGE_NOTE) + 4;
  const add = (text: string, maxTokens?: number): boolean => {
    if (!text.trim()) return true;
    const remaining = budget - used;
    if (remaining < 20) return false;
    const cap = Math.min(remaining, maxTokens ?? remaining);
    const t = estimateTokens(text) > cap ? truncateToTokens(text, cap) : text;
    sections.push(t);
    used += estimateTokens(t) + 1;
    return true;
  };
  const list = (label: string, items: string[] | undefined, maxItems: number, itemTokens: number, sectionTokens: number) => {
    const clean = (items || []).map(s => String(s).trim()).filter(Boolean);
    if (!clean.length) return;
    const shown = clean.slice(0, maxItems).map(i => `- ${truncateToTokens(i, itemTokens)}`);
    const more = clean.length > maxItems ? `\n- (+${clean.length - maxItems} more)` : '';
    add(`${label}:\n${shown.join('\n')}${more}`, sectionTokens);
  };

  // P1 — identity
  if (w?.businessName) add(`Business Name: ${w.businessName}`, 40);
  if (src.companyDescription) add(`Company Information: ${src.companyDescription}`, 250);
  if (w?.businessDescription) add(`About: ${w.businessDescription}`, 200);
  if (w?.targetAudience) add(`Target Audience: ${w.targetAudience}`, 60);
  // P2 — practical facts
  const c = w?.contactInfo;
  if (c && (c.email || c.phone || c.address)) {
    add(['Contact Information:', c.email ? `- Email: ${c.email}` : '', c.phone ? `- Phone: ${c.phone}` : '', c.address ? `- Address: ${c.address}` : '']
      .filter(Boolean).join('\n'), 120);
  }
  if (w?.businessHours) add(`Business Hours: ${w.businessHours}`, 80);
  if (w?.pricingInfo) add(`Pricing: ${w.pricingInfo}`, 150);
  // P3 — what exists (titles only; content comes via retrieval)
  if (!inlinedAllContent) {
    if (pages.length) {
      const titles = Array.from(new Set(pages.map(p => pageTitleFromUrl(p.pageUrl))));
      add(`Website pages (${pages.length}): ${titles.join(', ')}`, 150);
    }
    if (docs.length) {
      const lines = docs.map(d => {
        const first = (d.summary || '').split(/[.!?](\s|$)/)[0] || '';
        return `- ${d.originalFilename}${first ? `: ${truncateToTokens(first, 25)}` : ''}`;
      });
      add(`Reference documents (${docs.length}):\n${lines.join('\n')}`, 180);
    }
  }
  // P4 — offering
  list('Main Products', w?.mainProducts, 12, 25, 180);
  list('Main Services', w?.mainServices, 12, 25, 180);
  list('Key Features', w?.keyFeatures, 8, 25, 120);
  list('Unique Selling Points', w?.uniqueSellingPoints, 6, 25, 100);
  if (w?.additionalInfo) add(`Additional Information: ${w.additionalInfo}`, 120);

  let text = '';
  if (sections.length) {
    text += `BUSINESS PROFILE:\n${sections.join('\n')}\n\n`;
  }
  if (inlinedAllContent) {
    if (pages.length) text += `DETAILED WEBSITE CONTENT:\n${pages.map(legacyPageBlock).join('')}`;
    if (docs.length) text += `TRAINING DOCUMENTS KNOWLEDGE:\n${docs.map(legacyDocBlock).join('')}`;
  } else if (pages.length || docs.length) {
    text += RETRIEVAL_NOTE;
  }
  if (text) {
    text += USAGE_NOTE;
  }

  return {
    text,
    tokens: estimateTokens(text),
    inlinedAllContent,
    passages: inlinedAllContent ? [] : buildKnowledgePassages(src),
    corpusTokens,
  };
}
