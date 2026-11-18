/**
 * Design Studio: shoppers design their own jewellery in the website chat.
 *
 * The shopper picks a piece, who it is for, the occasion, a motif (the AI advises), a metal, stones
 * and a size; the image AI draws design previews limited to what the brand says it can make (its
 * "design kit": pieces, motifs, metals, stones and price rules below). The shopper can change a
 * design by describing the change, then asks the brand to make it ("Make this for me"), which
 * becomes a lead with the design attached.
 *
 * Extras (each a switch in the brand's set-up): trying a design on with a selfie, a link the
 * shopper sends to family so they can vote for a design, and a "Customise this" button on product
 * cards that starts from one of the brand's own products (its photo is the first "design", and
 * every change is drawn from it).
 *
 * Everything here is plain data and arithmetic shared by the server, the portal and the widget.
 * Prices are estimates from the brand's own rules and are shown as a range, only once the brand
 * has confirmed its rates (`ratesConfirmed`).
 */

export type PieceId = "necklace" | "pendant" | "earrings" | "ring" | "bangle" | "bracelet" | "mangalsutra";
export type TierId = "delicate" | "classic" | "statement";
export type AngleId = "classic" | "modern" | "ornate";

export const PIECES: { id: PieceId; name: string; emoji: string; framing: string; needsSize?: string }[] = [
  { id: "necklace", name: "Necklace", emoji: "📿", framing: "the whole necklace laid flat in a gentle curve, clasp visible" },
  { id: "pendant", name: "Pendant", emoji: "💠", framing: "the pendant hanging on a fine matching chain, close-up, front view" },
  { id: "earrings", name: "Earrings", emoji: "✨", framing: "a matching pair of earrings side by side, front view" },
  { id: "ring", name: "Ring", emoji: "💍", framing: "a single ring standing upright, three-quarter view", needsSize: "Ring size (if you know it)" },
  { id: "bangle", name: "Bangle", emoji: "⭕", framing: "a single bangle, three-quarter view showing the outer face", needsSize: "Bangle size (if you know it)" },
  { id: "bracelet", name: "Bracelet", emoji: "🔗", framing: "the whole bracelet laid flat in a soft curve, clasp visible" },
  { id: "mangalsutra", name: "Mangalsutra", emoji: "🖤", framing: "the mangalsutra laid flat in a gentle curve: black bead chain with the pendant at the centre" },
];

export const RECIPIENTS = ["Myself", "Wife / partner", "Mother", "Sister", "Daughter", "Friend", "Him"] as const;
export const OCCASIONS = ["Wedding", "Engagement", "Anniversary", "Birthday", "Festival", "Daily wear", "Just because"] as const;

export interface Motif {
  id: string;
  name: string;
  /** Shown on the tile when there is no photo. */
  emoji?: string;
  /** One short line the shopper reads: what it stands for. */
  meaning: string;
  /** Occasions (from OCCASIONS) it suits best; empty = any. */
  occasions: string[];
  /** Photo of the motif (brand's own motifs): shown on the tile and given to the image AI. */
  imageUrl?: string | null;
  /** Extra words for the image AI. */
  promptHint?: string;
}

/** Ready list of motifs every brand starts with. Brands hide the ones they don't make and add their own. */
export const MOTIF_LIBRARY: Motif[] = [
  { id: "lotus", name: "Lotus", emoji: "🪷", meaning: "Purity and new beginnings", occasions: ["Wedding", "Festival", "Birthday", "Just because"], promptHint: "a lotus flower with layered petals" },
  { id: "peacock", name: "Peacock", emoji: "🦚", meaning: "Grace and beauty, a wedding classic", occasions: ["Wedding", "Engagement", "Festival"], promptHint: "a peacock with a fanned tail" },
  { id: "paisley", name: "Paisley (ambi)", emoji: "🥭", meaning: "The mango shape of prosperity and good luck", occasions: ["Wedding", "Festival"], promptHint: "a paisley (ambi, mango-shaped) motif" },
  { id: "temple", name: "Temple", emoji: "🛕", meaning: "Traditional temple work, rich and auspicious", occasions: ["Wedding", "Festival"], promptHint: "South Indian temple jewellery detailing with small domes and coin-like discs" },
  { id: "floral", name: "Flowers", emoji: "🌸", meaning: "Soft, feminine and easy to wear", occasions: ["Birthday", "Daily wear", "Anniversary", "Just because"], promptHint: "small blossoms with rounded petals" },
  { id: "leaf", name: "Leaf & vine", emoji: "🌿", meaning: "Growth and fresh starts", occasions: ["Daily wear", "Birthday", "Just because"], promptHint: "curling leaves on a fine vine" },
  { id: "heart", name: "Heart", emoji: "❤️", meaning: "Love, said simply", occasions: ["Anniversary", "Engagement", "Birthday", "Just because"], promptHint: "a clean heart shape" },
  { id: "infinity", name: "Infinity", emoji: "♾️", meaning: "Forever: a promise that doesn't end", occasions: ["Anniversary", "Engagement", "Wedding"], promptHint: "an infinity loop" },
  { id: "solitaire", name: "Solitaire", emoji: "💎", meaning: "One stone at the centre, timeless", occasions: ["Engagement", "Anniversary", "Wedding"], promptHint: "a single centre stone as the hero, in a simple setting" },
  { id: "evil-eye", name: "Evil eye", emoji: "🧿", meaning: "Protection for someone you care about", occasions: ["Daily wear", "Birthday", "Just because"], promptHint: "an evil-eye (nazar) motif" },
  { id: "moon-star", name: "Moon & stars", emoji: "🌙", meaning: "Dreams and guidance", occasions: ["Birthday", "Daily wear", "Just because"], promptHint: "a crescent moon with small stars" },
  { id: "sun", name: "Sun", emoji: "☀️", meaning: "Energy and warmth", occasions: ["Festival", "Birthday", "Daily wear"], promptHint: "a radiant sun with fine rays" },
  { id: "butterfly", name: "Butterfly", emoji: "🦋", meaning: "Change and joy", occasions: ["Birthday", "Daily wear", "Just because"], promptHint: "a butterfly with open wings" },
  { id: "elephant", name: "Elephant", emoji: "🐘", meaning: "Strength, wisdom and good fortune", occasions: ["Festival", "Wedding", "Just because"], promptHint: "a small decorated elephant" },
  { id: "om", name: "Om", emoji: "🕉️", meaning: "Peace and blessings", occasions: ["Festival", "Daily wear"], promptHint: "the Om symbol" },
  { id: "initial", name: "Initial or name", emoji: "🔤", meaning: "Their letter or name, made just for them", occasions: ["Birthday", "Anniversary", "Daily wear", "Just because"], promptHint: "a single elegant letter (use the letter or name the shopper gives; if none, a graceful monogram shape)" },
  { id: "geometric", name: "Geometric", emoji: "🔷", meaning: "Clean modern lines", occasions: ["Daily wear", "Birthday", "Just because"], promptHint: "clean geometric shapes (art-deco lines, hexagons or bars)" },
  { id: "bow", name: "Bow", emoji: "🎀", meaning: "Playful and pretty", occasions: ["Birthday", "Just because"], promptHint: "a small ribbon bow" },
];

export interface MetalOption {
  id: string;
  name: string;
  /** How the image AI should draw it. */
  look: string;
  /** Brand's price per gram, in the account's currency. */
  ratePerGram: number;
  enabled: boolean;
}

export interface StoneOption {
  id: string;
  name: string;
  look: string;
  /** Brand's typical price for one small accent stone. */
  pricePerStone: number;
  enabled: boolean;
}

export interface DesignStudioSettings {
  /** What the shopper sees on the card and the button. */
  label: string;
  tagline: string;
  /** Card on the chat's welcome menu. */
  showOnWelcome: boolean;
  pieces: PieceId[];
  hiddenMotifs: string[];
  customMotifs: Motif[];
  metals: MetalOption[];
  stones: StoneOption[];
  /** Typical weight in grams for each piece, lightest to heaviest the brand makes. */
  pieceWeights: Record<PieceId, { min: number; max: number }>;
  makingChargePercent: number;
  minOrderValue: number;
  makingDays: { min: number; max: number };
  currencySymbol: string;
  /** Prices are shown to shoppers only after the brand has checked the rates above. */
  ratesConfirmed: boolean;
  /** Up to 5 photos of the brand's own pieces: the designs follow their look. */
  stylePhotos: string[];
  /** The brand's style in a few words ("minimal, delicate, everyday wear"). */
  styleNote: string;
  /** Changes to a design need the shopper's name and mobile number first. */
  contactBeforeChanges: boolean;
  /** Most design images one shopper can make in one go. */
  maxRendersPerSession: number;
  /** Most design images the whole account makes in 24 hours (keeps the AI bill in check). */
  dailyRenderCap: number;
  imageProvider: "google" | "openai";
  /** "Try it on": the shopper sees a design on their own photo. */
  tryOn: boolean;
  /** "Share with family": a link where family and friends vote for a design. */
  familyVote: boolean;
  /** "Customise this" on product cards in the chat, for the pieces the brand makes. */
  customiseProducts: boolean;
}

export const MAX_STYLE_PHOTOS = 5;
export const MAX_CUSTOM_MOTIFS = 30;
export const DESIGNS_PER_ROUND = 3;

const DEFAULT_WEIGHTS: Record<PieceId, { min: number; max: number }> = {
  necklace: { min: 8, max: 40 },
  pendant: { min: 1.5, max: 8 },
  earrings: { min: 2, max: 12 },
  ring: { min: 2, max: 9 },
  bangle: { min: 8, max: 30 },
  bracelet: { min: 4, max: 18 },
  mangalsutra: { min: 5, max: 25 },
};

/** Starting values. The rates are placeholders: shoppers see no prices until the brand confirms its own. */
export function defaultDesignStudioSettings(): DesignStudioSettings {
  return {
    label: "Design your own jewellery",
    tagline: "Tell us what you have in mind and see it come to life",
    showOnWelcome: true,
    pieces: ["necklace", "pendant", "earrings", "ring", "bangle", "bracelet"],
    hiddenMotifs: [],
    customMotifs: [],
    metals: [
      { id: "gold-18k-yellow", name: "18K yellow gold", look: "18 karat yellow gold, polished", ratePerGram: 0, enabled: true },
      { id: "gold-18k-rose", name: "18K rose gold", look: "18 karat rose gold, polished", ratePerGram: 0, enabled: true },
      { id: "gold-18k-white", name: "18K white gold", look: "18 karat white gold, rhodium polished", ratePerGram: 0, enabled: true },
      { id: "gold-14k-yellow", name: "14K yellow gold", look: "14 karat yellow gold, polished", ratePerGram: 0, enabled: true },
      { id: "gold-22k-yellow", name: "22K yellow gold", look: "22 karat rich yellow gold with a warm traditional finish", ratePerGram: 0, enabled: false },
      { id: "silver-925", name: "925 silver", look: "925 sterling silver, bright polished", ratePerGram: 0, enabled: true },
    ],
    stones: [
      { id: "lab-diamond", name: "Lab-grown diamonds", look: "small brilliant-cut colourless diamonds", pricePerStone: 0, enabled: true },
      { id: "diamond", name: "Natural diamonds", look: "small brilliant-cut colourless diamonds", pricePerStone: 0, enabled: false },
      { id: "ruby", name: "Ruby", look: "deep red rubies", pricePerStone: 0, enabled: true },
      { id: "emerald", name: "Emerald", look: "rich green emeralds", pricePerStone: 0, enabled: true },
      { id: "sapphire", name: "Blue sapphire", look: "royal blue sapphires", pricePerStone: 0, enabled: true },
      { id: "pearl", name: "Pearl", look: "small round white pearls", pricePerStone: 0, enabled: true },
      { id: "zircon", name: "Zircon", look: "small clear cubic zirconia stones", pricePerStone: 0, enabled: false },
    ],
    pieceWeights: DEFAULT_WEIGHTS,
    makingChargePercent: 15,
    minOrderValue: 0,
    makingDays: { min: 14, max: 28 },
    currencySymbol: "₹",
    ratesConfirmed: false,
    stylePhotos: [],
    styleNote: "",
    contactBeforeChanges: true,
    maxRendersPerSession: 12,
    dailyRenderCap: 150,
    imageProvider: "google",
    tryOn: true,
    familyVote: true,
    customiseProducts: false,
  };
}

const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : fallback);
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const isHttpUrl = (v: unknown): v is string => typeof v === "string" && /^(https?:\/\/|\/uploads\/)/i.test(v.trim()) && v.length < 1000;

/** Saved settings (or anything a browser sent) made safe: unknown keys dropped, numbers clamped, defaults filled. */
export function normalizeDesignStudioSettings(raw: unknown): DesignStudioSettings {
  const d = defaultDesignStudioSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const pieceIds = new Set(PIECES.map(p => p.id));
  const pieces = Array.isArray(r.pieces) ? (r.pieces.filter((p: any) => pieceIds.has(p)) as PieceId[]) : d.pieces;

  const options = <T extends MetalOption | StoneOption>(list: unknown, defaults: T[], priceKey: "ratePerGram" | "pricePerStone"): T[] => {
    if (!Array.isArray(list)) return defaults;
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of list.slice(0, 20)) {
      const name = text(item?.name, 60);
      const id = text(item?.id, 40) || slug(name);
      if (!name || !id || seen.has(id)) continue;
      seen.add(id);
      const known = defaults.find(x => x.id === id);
      out.push({
        id, name,
        look: text(item?.look, 160) || known?.look || name,
        [priceKey]: num(item?.[priceKey], 0, 0, 10_000_000),
        enabled: item?.enabled !== false,
      } as unknown as T);
    }
    return out.length ? out : defaults;
  };

  const customMotifs: Motif[] = [];
  if (Array.isArray(r.customMotifs)) {
    const libraryIds = new Set(MOTIF_LIBRARY.map(m => m.id));
    for (const m of r.customMotifs.slice(0, MAX_CUSTOM_MOTIFS)) {
      const name = text(m?.name, 40);
      if (!name) continue;
      let id = text(m?.id, 48) || `own-${slug(name)}`;
      if (libraryIds.has(id) || customMotifs.some(x => x.id === id)) id = `own-${slug(name)}-${customMotifs.length + 1}`;
      customMotifs.push({
        id, name,
        meaning: text(m?.meaning, 120),
        occasions: Array.isArray(m?.occasions) ? m.occasions.filter((o: any) => (OCCASIONS as readonly string[]).includes(o)) : [],
        imageUrl: isHttpUrl(m?.imageUrl) ? m.imageUrl.trim() : null,
        promptHint: text(m?.promptHint, 200),
      });
    }
  }

  const pieceWeights = { ...d.pieceWeights };
  for (const p of PIECES) {
    const w = r.pieceWeights?.[p.id];
    if (!w) continue;
    const min = num(w.min, d.pieceWeights[p.id].min, 0.1, 1000);
    const max = num(w.max, d.pieceWeights[p.id].max, 0.1, 1000);
    pieceWeights[p.id] = { min: Math.min(min, max), max: Math.max(min, max) };
  }

  const daysMin = num(r.makingDays?.min, d.makingDays.min, 1, 365);
  const daysMax = num(r.makingDays?.max, d.makingDays.max, 1, 365);

  return {
    label: text(r.label, 40) || d.label,
    tagline: text(r.tagline, 90) || d.tagline,
    showOnWelcome: r.showOnWelcome !== false,
    pieces: pieces.length ? pieces : d.pieces,
    hiddenMotifs: Array.isArray(r.hiddenMotifs) ? r.hiddenMotifs.filter((x: any) => typeof x === "string").slice(0, 100) : [],
    customMotifs,
    metals: options<MetalOption>(r.metals, d.metals, "ratePerGram"),
    stones: options<StoneOption>(r.stones, d.stones, "pricePerStone"),
    pieceWeights,
    makingChargePercent: num(r.makingChargePercent, d.makingChargePercent, 0, 100),
    minOrderValue: num(r.minOrderValue, d.minOrderValue, 0, 100_000_000),
    makingDays: { min: Math.min(daysMin, daysMax), max: Math.max(daysMin, daysMax) },
    currencySymbol: text(r.currencySymbol, 4) || d.currencySymbol,
    ratesConfirmed: r.ratesConfirmed === true,
    stylePhotos: Array.isArray(r.stylePhotos) ? r.stylePhotos.filter(isHttpUrl).map((u: string) => u.trim()).slice(0, MAX_STYLE_PHOTOS) : [],
    styleNote: text(r.styleNote, 200),
    contactBeforeChanges: r.contactBeforeChanges !== false,
    maxRendersPerSession: Math.round(num(r.maxRendersPerSession, d.maxRendersPerSession, DESIGNS_PER_ROUND, 40)),
    dailyRenderCap: Math.round(num(r.dailyRenderCap, d.dailyRenderCap, DESIGNS_PER_ROUND, 5000)),
    imageProvider: r.imageProvider === "openai" ? "openai" : "google",
    tryOn: r.tryOn !== false,
    familyVote: r.familyVote !== false,
    customiseProducts: r.customiseProducts === true,
  };
}

/** Motifs the shopper can pick: the brand's own first, then the library ones it kept. */
export function availableMotifs(settings: DesignStudioSettings): Motif[] {
  const hidden = new Set(settings.hiddenMotifs);
  return [...settings.customMotifs, ...MOTIF_LIBRARY.filter(m => !hidden.has(m.id))];
}

/** What the shopper chose. Free text is the shopper's own words, kept short. */
export interface DesignChoices {
  piece?: PieceId;
  recipient?: string;
  occasion?: string;
  motifId?: string;
  /** The shopper's own idea, in place of or on top of a motif ("my daughter's initial A with a small star"). */
  idea?: string;
  metalId?: string;
  /** A stone id, or "none". */
  stoneId?: string;
  tier?: TierId;
  /** "Customise this": the product the shopper started from. Set by the server only. */
  base?: BaseProduct;
}

export interface BaseProduct {
  productId: string;
  name: string;
  imageUrl: string;
  price?: string | null;
  productUrl?: string | null;
}

/** Which piece a product is, read from its name ("Silver Heart Pendant" → pendant). Null when it isn't clear. */
export function pieceForProduct(name: string | null | undefined): PieceId | null {
  const n = (name || "").toLowerCase();
  // Things sold alongside jewellery that aren't jewellery.
  if (/\b(box|case|pouch|cleaner|cloth|polish|stand|organi[sz]er|voucher|gift\s?card)\b/.test(n)) return null;
  // The more specific words first: "earring" before "ring", "mangalsutra" before "pendant" and "chain".
  if (/\bmangal\s?sutra/.test(n)) return "mangalsutra";
  if (/\bear\s?-?rings?\b|\bjhumk[ai]s?\b|\bstuds?\b|\bhoops?\b|\bdanglers?\b|\btops\b|\bbalis?\b/.test(n)) return "earrings";
  if (/\bpendants?\b|\blockets?\b/.test(n)) return "pendant";
  if (/\bnecklaces?\b|\bchokers?\b|\bhaar\b|\bchains?\b/.test(n)) return "necklace";
  if (/\bbangles?\b|\bkadas?\b|\bkangans?\b/.test(n)) return "bangle";
  if (/\bbracelets?\b/.test(n)) return "bracelet";
  if (/\brings?\b|\bbands?\b/.test(n)) return "ring";
  return null;
}

/** "Customise this" is offered on a product when the brand has it on and makes that kind of piece. */
export function canCustomiseProduct(product: { name?: string | null; imageUrl?: string | null }, studio: { customise?: boolean; pieces?: string[] } | null | undefined): boolean {
  if (!studio?.customise || !product.imageUrl) return false;
  const piece = pieceForProduct(product.name);
  return !!piece && (studio.pieces || []).includes(piece);
}

export function cleanChoices(raw: unknown, settings: DesignStudioSettings): DesignChoices {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out: DesignChoices = {};
  if (settings.pieces.includes(r.piece)) out.piece = r.piece;
  if (typeof r.recipient === "string" && (RECIPIENTS as readonly string[]).includes(r.recipient)) out.recipient = r.recipient;
  if (typeof r.occasion === "string" && (OCCASIONS as readonly string[]).includes(r.occasion)) out.occasion = r.occasion;
  if (typeof r.motifId === "string" && availableMotifs(settings).some(m => m.id === r.motifId)) out.motifId = r.motifId;
  const idea = text(r.idea, 200);
  if (idea) out.idea = idea;
  if (typeof r.metalId === "string" && settings.metals.some(m => m.enabled && m.id === r.metalId)) out.metalId = r.metalId;
  if (r.stoneId === "none" || (typeof r.stoneId === "string" && settings.stones.some(s => s.enabled && s.id === r.stoneId))) out.stoneId = r.stoneId;
  if (r.tier === "delicate" || r.tier === "classic" || r.tier === "statement") out.tier = r.tier;
  return out;
}

/** Everything a design needs before the AI can draw it. */
export function missingChoices(c: DesignChoices): string[] {
  const missing: string[] = [];
  if (!c.piece) missing.push("piece");
  if (!c.motifId && !c.idea) missing.push("motif");
  if (!c.metalId) missing.push("metal");
  if (!c.tier) missing.push("tier");
  return missing;
}

export const TIERS: { id: TierId; name: string; line: string; build: string; stones: [number, number] }[] = [
  { id: "delicate", name: "Delicate", line: "Light and fine, for everyday", build: "delicate and lightweight, with fine slim metalwork", stones: [3, 6] },
  { id: "classic", name: "Classic", line: "Balanced, for special days", build: "medium weight with balanced proportions", stones: [6, 14] },
  { id: "statement", name: "Statement", line: "Bold and rich, made to be noticed", build: "bold and substantial, a statement piece with generous detailing", stones: [14, 30] },
];

export interface PriceRange { low: number; high: number }

/** To a tidy step: 8,340 → 8,300; 45,740 → 45,500; 2,31,400 → 2,31,000. */
export function roundPrice(n: number): number {
  const step = n < 10_000 ? 100 : n < 100_000 ? 500 : 1000;
  return Math.round(n / step) * step;
}

/**
 * Estimated price range of one size of one piece, from the brand's rules:
 * weight × metal rate, plus making charge, plus accent stones. Null when it can't be worked out
 * (no rate set for that metal, or the brand hasn't confirmed its rates).
 */
export function estimatePrice(settings: DesignStudioSettings, c: Pick<DesignChoices, "piece" | "metalId" | "stoneId" | "tier">): PriceRange | null {
  if (!settings.ratesConfirmed || !c.piece || !c.metalId || !c.tier) return null;
  const metal = settings.metals.find(m => m.id === c.metalId && m.enabled);
  const weights = settings.pieceWeights[c.piece];
  if (!metal || !weights || !(metal.ratePerGram > 0)) return null;
  const index = TIERS.findIndex(t => t.id === c.tier);
  if (index < 0) return null;
  const span = (weights.max - weights.min) / TIERS.length;
  const gramsLow = weights.min + span * index;
  const gramsHigh = gramsLow + span;
  const stone = c.stoneId && c.stoneId !== "none" ? settings.stones.find(s => s.id === c.stoneId && s.enabled) : undefined;
  const [stonesLow, stonesHigh] = TIERS[index].stones;
  const making = 1 + settings.makingChargePercent / 100;
  const low = gramsLow * metal.ratePerGram * making + (stone ? stonesLow * stone.pricePerStone : 0);
  const high = gramsHigh * metal.ratePerGram * making + (stone ? stonesHigh * stone.pricePerStone : 0);
  const floor = settings.minOrderValue || 0;
  const roundedLow = Math.max(roundPrice(low), floor);
  return { low: roundedLow, high: Math.max(roundPrice(high), roundedLow) };
}

export function formatPrice(symbol: string, n: number): string {
  return `${symbol}${Math.round(n).toLocaleString("en-IN")}`;
}

export function formatPriceRange(symbol: string, range: PriceRange): string {
  return range.low === range.high ? `about ${formatPrice(symbol, range.low)}` : `${formatPrice(symbol, range.low)} – ${formatPrice(symbol, range.high)}`;
}

export interface MotifSuggestion { motifId: string; why: string }

/**
 * Motifs that suit the occasion, best first, each with a reason: what the AI's advice falls back
 * to when the AI can't be asked, and the shortlist it chooses from when it can.
 */
export function rankMotifs(settings: DesignStudioSettings, c: Pick<DesignChoices, "occasion" | "recipient" | "piece">, count = 4): MotifSuggestion[] {
  const motifs = availableMotifs(settings);
  const own = new Set(settings.customMotifs.map(m => m.id));
  const scored = motifs.map((m, i) => {
    let score = 0;
    if (c.occasion && m.occasions.includes(c.occasion)) score += 3;
    if (m.occasions.length === 0) score += 1;
    if (own.has(m.id)) score += 1.5; // the brand's own motifs are what it makes best
    if (c.recipient === "Him" && ["floral", "bow", "butterfly", "heart"].includes(m.id)) score -= 3;
    if (c.piece === "mangalsutra" && ["solitaire", "floral", "heart", "infinity", "geometric"].includes(m.id)) score += 1;
    return { m, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, count).map(({ m }) => ({
    motifId: m.id,
    why: c.occasion && m.occasions.includes(c.occasion)
      ? `${m.meaning || m.name}. A lovely fit for ${c.occasion === "Daily wear" ? "daily wear" : `a ${c.occasion.toLowerCase()}`}.`
      : m.meaning || `One of our signature motifs.`,
  }));
}

export const ANGLES: { id: AngleId; name: string; brief: string; note: string }[] = [
  { id: "classic", name: "Timeless", brief: "a timeless, balanced design with the motif as the clear centre", note: "A timeless take, with the motif at the centre." },
  { id: "modern", name: "Modern", brief: "a modern, minimal design with clean lines and the motif simplified into an elegant outline", note: "A modern, minimal take with clean lines." },
  { id: "ornate", name: "Rich detail", brief: "a richly detailed design with fine traditional craftsmanship (filigree or granulation) around the motif", note: "A richer take, with fine detailing around the motif." },
];

/** Quick changes offered under a design. */
export const QUICK_CHANGES = ["Make it more delicate", "Make the motif bigger", "Add more stones", "Fewer stones", "More traditional", "More modern"];
/** Quick changes offered on one of the brand's own products ("Customise this"). */
export const CUSTOMISE_CHANGES = ["Make it in rose gold", "Make it in yellow gold", "Add my initial", "Add more stones", "Make it more delicate", "Make it bolder"];

export interface DesignPromptInput {
  choices: DesignChoices;
  settings: DesignStudioSettings;
  angle: AngleId;
  /** How many of the brand's style photos are attached. */
  styleRefs: number;
  /** A photo of the motif is attached (after the style photos). */
  motifRef: boolean;
}

const MAKEABLE = [
  "It must be a real piece a jeweller can make by hand or by casting: realistic proportions and thickness, every stone held in a normal setting (prong, bezel or pavé), solid joints, a working clasp or hook where one is needed, nothing floating and nothing impossibly thin.",
  "Do not copy any brand's signature design, logo or trademark.",
  "One piece only (a pair for earrings). No model, no hands, no props, no packaging.",
  "No text, letters, numbers, labels or watermark in the image unless the design itself is a letter or name.",
].join(" ");

const PHOTO = "Photorealistic studio product photograph, soft even lighting, plain warm ivory background with a soft shadow, the piece centred and fully in frame, sharp focus on the metalwork.";

/** The instruction the image AI gets for one design. */
export function buildDesignPrompt({ choices, settings, angle, styleRefs, motifRef }: DesignPromptInput): string {
  const piece = PIECES.find(p => p.id === choices.piece)!;
  const metal = settings.metals.find(m => m.id === choices.metalId);
  const stone = choices.stoneId && choices.stoneId !== "none" ? settings.stones.find(s => s.id === choices.stoneId) : undefined;
  const tier = TIERS.find(t => t.id === choices.tier) ?? TIERS[1];
  const motif = availableMotifs(settings).find(m => m.id === choices.motifId);
  const look = ANGLES.find(a => a.id === angle) ?? ANGLES[0];

  const lines: string[] = [];
  lines.push(`Design a new ${piece.name.toLowerCase()} and show it as a product photograph: ${piece.framing}.`);
  if (motif) lines.push(`Motif: ${motif.promptHint || motif.name}${motifRef ? " (the last attached image shows this motif: follow its shape)" : ""}.`);
  if (choices.idea) lines.push(`The customer's own idea, in their words: "${choices.idea}". Follow it as far as it can be made in jewellery.`);
  lines.push(`Metal: ${metal?.look || "yellow gold"}.`);
  lines.push(stone
    ? `Stones: ${stone.look}, used as accents (about ${tier.stones[0]}–${tier.stones[1]} small stones). No other gemstones.`
    : "No gemstones: metal only.");
  lines.push(`Size and weight: ${tier.build}.`);
  lines.push(`Style: ${look.brief}.`);
  if (choices.occasion || choices.recipient) {
    lines.push(`It is ${choices.recipient && choices.recipient !== "Myself" ? `a gift for the customer's ${choices.recipient.toLowerCase().replace("him", "husband or partner").replace(" / ", " or ")}` : "for the customer"}${choices.occasion ? `, for ${choices.occasion === "Daily wear" ? "daily wear" : `a ${choices.occasion.toLowerCase()}`}` : ""}.`);
  }
  if (settings.styleNote) lines.push(`The jeweller's house style: ${settings.styleNote}.`);
  if (styleRefs > 0) {
    lines.push(`The ${styleRefs === 1 ? "first attached image shows a piece" : `first ${styleRefs} attached images show pieces`} this jeweller already makes. Match their finish, level of detail and overall taste, but create a new design: do not copy them.`);
  }
  lines.push(MAKEABLE);
  lines.push(PHOTO);
  return lines.join("\n");
}

/** The instruction for changing an existing design (the design's image is attached). */
export function buildChangePrompt(change: string): string {
  return [
    "The attached image is a jewellery design preview.",
    `Change only this: "${change}".`,
    "Keep the same piece, metal, motif, camera angle, lighting and background unless the change asks otherwise.",
    MAKEABLE,
  ].join("\n");
}

/** The instruction for the first change to one of the brand's own products (the product's photo is attached). */
export function buildCustomisePrompt(productName: string, change: string): string {
  return [
    `The attached image shows a piece of jewellery this jeweller sells ("${productName}"). It may be shown on a model or a stand: look only at the jewellery.`,
    "Draw a customised version of this same piece as a product photograph.",
    `Change only this: "${change}".`,
    "Keep everything else about the design the same: its shape, proportions, motif, stone layout and finish, so it is clearly the same piece with that one change.",
    MAKEABLE,
    PHOTO,
  ].join("\n");
}

/** What was asked for on the way to a design, oldest first ("add my initial" → "make it rose gold"). */
export function changeTrail(designs: DesignImage[], designId: string | null | undefined): string[] {
  const trail: string[] = [];
  let current = designs.find(d => d.id === designId);
  for (let i = 0; current && i < 50; i++) {
    if (current.change) trail.unshift(current.change);
    const parentId: string | undefined = current.parentId;
    current = parentId ? designs.find(d => d.id === parentId) : undefined;
  }
  return trail;
}

/** One line describing the choices, for the lead, the chat and the request list. */
export function describeChoices(settings: DesignStudioSettings, c: DesignChoices): string {
  if (c.base) return `Customised "${c.base.name}"`;
  const piece = PIECES.find(p => p.id === c.piece)?.name;
  const motif = availableMotifs(settings).find(m => m.id === c.motifId)?.name;
  const metal = settings.metals.find(m => m.id === c.metalId)?.name;
  const stone = c.stoneId && c.stoneId !== "none" ? settings.stones.find(s => s.id === c.stoneId)?.name : c.stoneId === "none" ? "no stones" : undefined;
  const tier = TIERS.find(t => t.id === c.tier)?.name;
  const parts = [
    [tier, piece].filter(Boolean).join(" ").trim() || undefined,
    motif ? `${motif} motif` : undefined,
    metal,
    stone,
    c.recipient && c.recipient !== "Myself" ? `for ${c.recipient.toLowerCase()}` : undefined,
    c.occasion,
  ].filter(Boolean);
  return parts.join(" · ") + (c.idea ? ` · idea: "${c.idea}"` : "");
}

export type DesignStatus = "pending" | "ready" | "failed";

export interface DesignImage {
  id: string;
  status: DesignStatus;
  url?: string;
  /** One line the shopper reads under the picture. */
  note: string;
  angle?: AngleId;
  /** Which round of drawing it came from (1 = the first three). */
  round: number;
  /** Set on a changed design: the design it was changed from, and what was asked. */
  parentId?: string;
  change?: string;
  /** "Customise this": the brand's own product photo, where the changes start from. Not a drawing. */
  original?: boolean;
  createdAt: string;
}

/** One family member's vote on a shared session. One per voter; voting again moves it. */
export interface DesignVote {
  designId: string;
  voterId: string;
  name?: string;
  at: string;
}

export const MAX_VOTES = 60;

export interface VoteTally { count: number; names: string[] }

/** Votes per design, with the names of those who gave one. */
export function tallyVotes(votes: DesignVote[] | null | undefined): Record<string, VoteTally> {
  const out: Record<string, VoteTally> = {};
  for (const v of votes || []) {
    const t = (out[v.designId] ||= { count: 0, names: [] });
    t.count++;
    if (v.name) t.names.push(v.name);
  }
  return out;
}

/** The word the try-on instructions know each piece by. */
export function tryOnTypeFor(piece: PieceId | null | undefined): string {
  return piece === "mangalsutra" ? "necklace" : piece === "earrings" ? "earrings" : piece || "jewellery";
}

/** A drawing that has been "pending" this long is treated as failed (the server restarted mid-way). */
export const RENDER_STALE_MS = 4 * 60 * 1000;

export type DesignSessionStatus = "started" | "designed" | "requested" | "contacted" | "quoted" | "ordered" | "closed";

/** Request statuses the brand moves a request through, in order. */
export const REQUEST_STATUSES: { id: DesignSessionStatus; label: string }[] = [
  { id: "requested", label: "New" },
  { id: "contacted", label: "Called" },
  { id: "quoted", label: "Quoted" },
  { id: "ordered", label: "Ordered" },
  { id: "closed", label: "Closed" },
];

/** What the widget needs to run the studio (no prices per gram or other brand-only numbers). */
export interface DesignStudioPublicConfig {
  enabled: boolean;
  label: string;
  tagline: string;
  showOnWelcome: boolean;
  pieces: { id: PieceId; name: string; emoji: string; needsSize?: string }[];
  recipients: string[];
  occasions: string[];
  motifs: { id: string; name: string; emoji?: string; meaning: string; imageUrl?: string | null }[];
  metals: { id: string; name: string }[];
  stones: { id: string; name: string }[];
  tiers: { id: TierId; name: string; line: string }[];
  quickChanges: string[];
  showPrices: boolean;
  currencySymbol: string;
  makingDays: { min: number; max: number };
  contactBeforeChanges: boolean;
  customiseChanges: string[];
  tryOn: boolean;
  familyVote: boolean;
}

export function toPublicConfig(settings: DesignStudioSettings, enabled: boolean): DesignStudioPublicConfig {
  return {
    enabled,
    label: settings.label,
    tagline: settings.tagline,
    showOnWelcome: settings.showOnWelcome,
    pieces: PIECES.filter(p => settings.pieces.includes(p.id)).map(({ id, name, emoji, needsSize }) => ({ id, name, emoji, needsSize })),
    recipients: [...RECIPIENTS],
    occasions: [...OCCASIONS],
    motifs: availableMotifs(settings).map(({ id, name, emoji, meaning, imageUrl }) => ({ id, name, emoji, meaning, imageUrl })),
    metals: settings.metals.filter(m => m.enabled).map(({ id, name }) => ({ id, name })),
    stones: settings.stones.filter(s => s.enabled).map(({ id, name }) => ({ id, name })),
    tiers: TIERS.map(({ id, name, line }) => ({ id, name, line })),
    quickChanges: QUICK_CHANGES,
    showPrices: settings.ratesConfirmed,
    currencySymbol: settings.currencySymbol,
    makingDays: settings.makingDays,
    contactBeforeChanges: settings.contactBeforeChanges,
    customiseChanges: CUSTOMISE_CHANGES,
    tryOn: settings.tryOn,
    familyVote: settings.familyVote,
  };
}

/** Words in a chat message that mean "I want something made for me". */
const CUSTOM_INTENT = /\b(custom[\s-]?(made|design|jewell?ery|order|piece|ring|necklace|pendant|earrings?|bangle|bracelet)?|customi[sz]e[ds]?|customi[sz]ation|bespoke|made[\s-]to[\s-]order|personali[sz]ed?|design (my|our|your) own|design (a|an|my) [a-z ]{0,20}(ring|necklace|pendant|earrings?|bangle|bracelet|mangalsutra|jewell?ery)|own design|get (it|one|this|something) made|make (it|one|this|something) for me)\b/i;

export function wantsCustomDesign(message: string): boolean {
  return CUSTOM_INTENT.test(message || "");
}
