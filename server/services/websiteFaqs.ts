import { createOpenAI, OPENAI_TIMEOUTS } from "../lib/openaiClient";
import { aiUsageLogger } from "./aiUsageLogger";
import { extractSiteFacts, fetchScanHtml, kindOfPage, mainPageText, pageKey, type FoundPage, type PageDiscovery, type PageKind } from "./websitePages";

/**
 * Training › FAQs › "Add from website": FAQ suggestions read from the business's own website pages.
 *
 *  - exact: questions the page already lists (published FAQ data, open/close question blocks), word for word;
 *  - ai: for pages without a question list (a returns or shipping policy…), short questions and answers the
 *    AI writes from that page's text only, each marked with its page.
 *
 * Nothing is saved here: the FAQs page shows the suggestions for review and saves the ticked ones.
 * Suggestions that repeat an existing FAQ (or each other) are marked so they start unticked.
 */

export interface FaqSuggestion {
  question: string;
  answer: string;
  category: string;
  source: "exact" | "ai";
  pageUrl: string;
  /** The existing FAQ (or earlier suggestion) this one repeats. */
  duplicateOf?: string;
}

export interface FaqSuggestions {
  suggestions: FaqSuggestion[];
  pagesRead: number;
  pagesFailed: { url: string; reason: string }[];
  /** No AI key on the account: only the website's own question lists were read. */
  aiUnavailable?: boolean;
}

export const FAQ_DEFAULT_PICK = 10;
export const FAQ_MAX_PAGES = 15;
const MAX_SUGGESTIONS = 120;
const PAGE_TEXT_CHARS = 12_000;
const CONCURRENCY = 4;
/** A page that already lists this many questions doesn't need AI-written ones too. */
const EXACT_ENOUGH = 3;

const CATEGORY_OF_KIND: Partial<Record<PageKind, string>> = {
  shipping: "Shipping & delivery",
  returns: "Returns & exchanges",
  warranty: "Warranty & care",
  contact: "Contact",
  stores: "Stores",
  pricing: "Pricing",
  services: "Services",
  policy: "Policies",
  about: "About us",
};
const CATEGORIES = ["Shipping & delivery", "Returns & exchanges", "Payments", "Orders", "Warranty & care", "Products",
  "Stores", "Contact", "Pricing", "Services", "Policies", "About us", "General"];

/** Which pages to read for FAQs: question pages and the policies customers ask about, ticked first. */
export function pickFaqPages(found: PageDiscovery): FoundPage[] {
  const wanted: PageKind[] = ["faq", "returns", "shipping", "warranty", "contact", "pricing", "stores", "services", "policy", "about"];
  const rank = (k: PageKind) => { const i = wanted.indexOf(k); return i === -1 ? 99 : i; };
  const perKind = new Map<PageKind, number>();
  const cap: Partial<Record<PageKind, number>> = { faq: 4, returns: 2, shipping: 2, warranty: 2, contact: 1, pricing: 1, stores: 1, services: 1, policy: 1, about: 1 };
  const list = found.pages
    .filter(p => p.kind !== "home" && p.kind !== "careers")
    .map(p => ({ ...p, picked: false, alreadyRead: undefined }))
    .sort((a, b) => rank(a.kind) - rank(b.kind));
  let picked = 0;
  for (const p of list) {
    if (picked >= FAQ_DEFAULT_PICK) break;
    const n = perKind.get(p.kind) ?? 0;
    if (n < (cap[p.kind] ?? 0)) { p.picked = true; picked++; perKind.set(p.kind, n + 1); }
  }
  return list;
}

const STOP = new Set("a an the is are do does did can could will would should i you we our your my me to of in on for and or with at by from it this that be have has how what when where which who why if any there their them".split(" "));
function words(q: string): Set<string> {
  return new Set(q.toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").split(/\s+/).filter(w => w && !STOP.has(w)));
}
/** Two questions ask the same thing (most of their meaningful words are shared). Exported for tests. */
export function sameQuestion(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  x.forEach(w => { if (y.has(w)) both++; });
  return both / (x.size + y.size - both) >= 0.6 || both / Math.min(x.size, y.size) >= 0.85;
}

async function aiFaqs(text: string, pageUrl: string, kind: PageKind, apiKey: string, businessAccountId: string): Promise<{ question: string; answer: string; category: string }[]> {
  const openai = createOpenAI({ timeout: OPENAI_TIMEOUTS.default, apiKey, trackUsage: false }); // usage logged below
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You write FAQ entries for a business's customer chat, using ONLY the web page text given.
Rules:
- Write the questions real customers would ask that this page answers (up to 8). Skip legal boilerplate, cookie text and menus.
- Each answer: 1-3 short sentences (max 60 words), complete on its own, in plain language.
- Keep every number, time, amount, condition and name exactly as the page says. Never add facts that aren't on the page.
- If the page doesn't answer customer questions, return no entries.
- category: one of ${CATEGORIES.join(", ")}.
Return JSON: {"faqs":[{"question":"...","answer":"...","category":"..."}]}`,
      },
      { role: "user", content: `Page: ${pageUrl} (looks like: ${kind})\n\nPage text:\n${text.slice(0, PAGE_TEXT_CHARS)}` },
    ],
  });
  aiUsageLogger.logWebsiteAnalysisUsage(businessAccountId, "gpt-4o-mini", completion, { feature: "faqs_from_website" }).catch(() => {});
  let parsed: any;
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.faqs) ? parsed.faqs : [];
  return list
    .map((f: any) => ({
      question: String(f?.question ?? "").trim(),
      answer: String(f?.answer ?? "").trim(),
      category: CATEGORIES.includes(f?.category) ? f.category : (CATEGORY_OF_KIND[kind] ?? "General"),
    }))
    .filter((f: { question: string; answer: string }) => f.question.length > 5 && f.answer.length > 5)
    .slice(0, 8);
}

/** FAQ suggestions from the chosen pages, duplicates of existing FAQs (and of each other) marked. */
export async function suggestFaqsFromPages(
  pageUrls: string[],
  opts: { businessAccountId: string; openaiApiKey?: string | null; existingQuestions: string[] },
): Promise<FaqSuggestions> {
  const pages = Array.from(new Map(pageUrls.map(u => [pageKey(u), u])).values()).slice(0, FAQ_MAX_PAGES);
  const perPage = new Map<string, FaqSuggestion[]>();
  const failed: { url: string; reason: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const url = pages[next++];
      const kind = kindOfPage(url);
      const category = CATEGORY_OF_KIND[kind] ?? "General";
      try {
        const html = await fetchScanHtml(url);
        const exact: FaqSuggestion[] = extractSiteFacts(html).faqs.map(f => ({ question: f.q, answer: f.a, category, source: "exact", pageUrl: url }));
        let written: FaqSuggestion[] = [];
        if (exact.length < EXACT_ENOUGH && opts.openaiApiKey) {
          const text = mainPageText(html);
          if (text.replace(/[•|\s]/g, "").length >= 200) {
            written = (await aiFaqs(text, url, kind, opts.openaiApiKey, opts.businessAccountId)).map(f => ({ ...f, source: "ai" as const, pageUrl: url }));
          }
        }
        if (!exact.length && !written.length) failed.push({ url, reason: "No questions found on this page (it may be built by JavaScript)." });
        perPage.set(url, [...exact, ...written]);
      } catch (e: any) {
        failed.push({ url, reason: e?.message || "The page could not be read." });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));

  // In page order; exact questions before AI-written ones, so a repeat keeps the website's own wording.
  const all = pages.flatMap(u => perPage.get(u) ?? []).sort((a, b) => Number(a.source === "ai") - Number(b.source === "ai"));
  const kept: FaqSuggestion[] = [];
  for (const s of all) {
    const existing = opts.existingQuestions.find(q => sameQuestion(q, s.question));
    const earlier = kept.find(k => !k.duplicateOf && sameQuestion(k.question, s.question));
    if (earlier && !existing) continue; // the same suggestion twice: shown once
    kept.push(existing ? { ...s, duplicateOf: existing } : s);
    if (kept.length >= MAX_SUGGESTIONS) break;
  }
  return {
    suggestions: kept,
    pagesRead: pages.length - failed.filter(f => !perPage.has(f.url)).length,
    pagesFailed: failed,
    ...(opts.openaiApiKey ? {} : { aiUnavailable: true }),
  };
}
