/** Small keyword-matching toolkit used for hybrid scoring and de-duplication. */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with',
  'about', 'as', 'into', 'over', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'have',
  'has', 'had', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'i', 'me', 'my', 'we', 'us',
  'our', 'you', 'your', 'he', 'she', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'what',
  'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'there', 'here', 'please', 'tell', 'know', 'want',
  'need', 'like', 'any', 'some', 'all', 'more', 'most', 'much', 'many', 'also', 'just', 'get', 'got', 'give', 'show',
  'let', 'not', 'no', 'yes', 'ok', 'okay', 'hi', 'hello', 'hey', 'thanks', 'thank', 'than', 'too', 'very', 'up', 'out',
  'same', 'other', 'else', 'one', 'ones', 'else', 'does', 'doing', 'able', 'via', 'per',
]);

// Letters/digits of Latin, Greek, Cyrillic, Hebrew, Arabic, Indic, Thai, CJK and Hangul scripts.
const NON_WORD = /[^a-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/;

/** Lower-case word tokens, stopwords removed, light plural stemming. */
export function tokenize(text: string): string[] {
  const words = (text || '').toLowerCase().normalize('NFKC').split(NON_WORD).filter(Boolean);
  const out: string[] = [];
  for (let w of words) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.length > 4 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    // parking → park, booking → book, opening → open (keeps "ring", "king", "sing")
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    out.push(w);
  }
  return out;
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  small.forEach(t => { if (large.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

export interface WeightedTerm { term: string; weight: number }

/** Query terms: the current message counts fully, folded-in earlier turns count less. */
export function queryTerms(primary: string, context = '', contextWeight = 0.4): WeightedTerm[] {
  const map = new Map<string, number>();
  for (const t of tokenize(primary)) map.set(t, 1);
  for (const t of tokenize(context)) if (!map.has(t)) map.set(t, contextWeight);
  return Array.from(map, ([term, weight]) => ({ term, weight }));
}

/**
 * Weighted, IDF-adjusted coverage of the query terms by a document, in [0, 1].
 * `docFreq` / `docCount` come from the candidate pool so rare terms matter more.
 */
export function lexicalScore(
  terms: WeightedTerm[],
  docTokens: Set<string>,
  docFreq: Map<string, number>,
  docCount: number,
  titleTokens?: Set<string>,
): number {
  if (!terms.length) return 0;
  let total = 0;
  let hit = 0;
  for (const { term, weight } of terms) {
    const df = docFreq.get(term) || 0;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    const w = weight * Math.max(idf, 0.2);
    total += w;
    if (docTokens.has(term)) hit += w;
    else if (titleTokens?.has(term)) hit += w * 0.8;
  }
  return total > 0 ? hit / total : 0;
}

/** Distinctive query words for ILIKE candidate lookup (escaped for LIKE). */
export function keywordPatterns(terms: WeightedTerm[], max = 6): string[] {
  const strong = terms.filter(t => t.weight >= 1 && t.term.length >= 3);
  return (strong.length ? strong : terms.filter(t => t.term.length >= 3))
    .sort((a, b) => b.term.length - a.term.length)
    .slice(0, max)
    .map(t => `%${t.term.replace(/[\\%_]/g, m => `\\${m}`)}%`);
}
