/**
 * Helpers for the widget's page-visit / chat-opened counters (visitor_daily_stats → Visitor Insights).
 *
 * - Crawlers (Googlebot renders pages with the widget and reports itself as an Android phone) are
 *   not visitors: their page loads and chat opens are not counted.
 * - Countries were stored as full names ("India", from ip-api) until July 2026 and as two-letter
 *   codes ("IN", from Cloudflare) since; both are shown as the code so a date range spanning the
 *   switch doesn't list a country twice.
 * - A few cities come in two spellings ("New Delhi" / "Delhi"); they are counted as one.
 */

const CRAWLER_TOKENS = /googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|apis-google|feedfetcher|google-read-aloud|storebot-google|bingbot|bingpreview|adidxbot|slurp|duckduckbot|baiduspider|yandex(bot|images|metrika)?|sogou|exabot|petalbot|bytespider|applebot|amazonbot|facebookexternalhit|facebookcatalog|meta-externalagent|twitterbot|linkedinbot|pinterestbot|slackbot|discordbot|telegrambot|whatsapp\/|skypeuripreview|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexitybot|ccbot|ahrefsbot|semrushbot|mj12bot|dotbot|dataforseobot|seznambot|blexbot|rogerbot|screaming frog|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|chrome-lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|python-requests|python-urllib|aiohttp|scrapy|curl\/|wget\/|go-http-client|okhttp|axios\/|node-fetch|undici|java\/|libwww-perl|httpclient/i;

/** True for search-engine crawlers, link previewers, monitoring and scripted clients. */
export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').trim();
  if (!ua) return true; // every real browser sends one
  if (CRAWLER_TOKENS.test(ua)) return true;
  // Generic "...bot/1.0", "crawler", "spider" — but not phone brands like "Cubot".
  return /\b[\w-]*(bot|crawler|spider)\b/i.test(ua) && !/cubot/i.test(ua);
}

// Names ip-api / older data used that the region list spells differently.
const COUNTRY_ALIASES: Record<string, string> = {
  'congo (drc)': 'CD', 'dr congo': 'CD', 'democratic republic of the congo': 'CD',
  'congo republic': 'CG', 'republic of the congo': 'CG',
  'ivory coast': 'CI', "cote d'ivoire": 'CI',
  'curacao': 'CW', 'reunion': 'RE',
  'palestine': 'PS', 'palestinian territory': 'PS',
  'timor leste': 'TL', 'timor-leste': 'TL', 'east timor': 'TL',
  'turkey': 'TR', 'türkiye': 'TR', 'turkiye': 'TR',
  'the netherlands': 'NL', 'netherlands': 'NL',
  'hong kong': 'HK', 'macao': 'MO', 'macau': 'MO',
  'micronesia': 'FM', 'kosovo': 'XK', 'myanmar': 'MM', 'burma': 'MM',
  'u.s. virgin islands': 'VI', 'british virgin islands': 'VG',
  'cabo verde': 'CV', 'cape verde': 'CV', 'eswatini': 'SZ', 'swaziland': 'SZ', 'czechia': 'CZ', 'czech republic': 'CZ',
  'united states': 'US', 'usa': 'US', 'united kingdom': 'GB', 'uk': 'GB',
  'south korea': 'KR', 'north korea': 'KP', 'russia': 'RU', 'vietnam': 'VN', 'laos': 'LA', 'syria': 'SY', 'iran': 'IR',
  'saint vincent and the grenadines': 'VC', 'brunei': 'BN', 'bolivia': 'BO', 'venezuela': 'VE', 'tanzania': 'TZ', 'moldova': 'MD', 'taiwan': 'TW',
};

const countryKey = (name: string) => name.toLowerCase()
  .replace(/&/g, 'and')
  .replace(/\bst\.?\s/g, 'saint ')
  .replace(/[’']/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

let countryCodes: Map<string, string> | null = null;
function countryCodeMap(): Map<string, string> {
  if (countryCodes) return countryCodes;
  const map = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        const name = names.of(code);
        if (name && name !== code) {
          map.set(countryKey(name), code);
          // "Myanmar (Burma)", "Hong Kong SAR China" → also without the extra part.
          map.set(countryKey(name.replace(/\s*\(.*\)$/, '').replace(/\s+SAR China$/, '')), code);
        }
      }
    }
  } catch { /* no ICU data: aliases only */ }
  for (const [name, code] of Object.entries(COUNTRY_ALIASES)) map.set(countryKey(name), code);
  countryCodes = map;
  return map;
}

/** "India" → "IN"; codes stay as they are; unknown names are returned unchanged. */
export function normalizeCountry(country: string | null | undefined): string {
  const c = (country || '').trim();
  if (!c) return '';
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return countryCodeMap().get(countryKey(c)) || c;
}

const CITY_ALIASES: Record<string, string> = {
  'new delhi': 'Delhi',
  'bangalore': 'Bengaluru',
  'gurgaon': 'Gurugram',
  'bombay': 'Mumbai',
  'calcutta': 'Kolkata',
  'madras': 'Chennai',
};

/** One spelling per city ("New Delhi" → "Delhi"). */
export function normalizeCity(city: string | null | undefined): string {
  const c = (city || '').trim();
  if (!c) return '';
  return CITY_ALIASES[c.toLowerCase()] || c;
}
