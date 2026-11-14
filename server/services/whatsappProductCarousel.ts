/**
 * WhatsApp product replies: one swipeable carousel message (Meta's interactive media carousel, a normal
 * session message — no template, no catalog) instead of separate photo messages, which WhatsApp can
 * deliver out of order. Each card: photo, name / price / one short line, and two quick replies,
 * "Know more (N)" (the same as replying with the product's number) and "Book consultation".
 *
 * WHATSAPP_PRODUCT_CAROUSEL=0 switches carousels off (the separate photo cards are sent instead).
 */

export const CAROUSEL_MIN_CARDS = 2;
export const CAROUSEL_MAX_CARDS = 10;
const CARD_BODY_MAX = 160; // WhatsApp's limit, up to 2 line breaks
const BUTTON_TITLE_MAX = 20;

export function carouselEnabled(): boolean {
  return process.env.WHATSAPP_PRODUCT_CAROUSEL !== "0";
}

/**
 * A short, readable product text: a leading heading line ("Overview") dropped, lines joined into
 * sentences, cut at the end of a sentence when possible, otherwise at a whole word with "…".
 */
export function captionExcerpt(text: string | null | undefined, max: number): string {
  if (!text) return "";
  let lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const first = lines[0] || "";
  // A heading: short, no closing punctuation, and the next line starts a new sentence (capital, digit or bullet).
  const looksLikeHeading = lines.length > 1 && first.length <= 30 && !/[.!?:,]$/.test(first)
    && first.split(/\s+/).length <= 3 && /^[A-Z0-9•*"“]/.test(lines[1]);
  if (looksLikeHeading) lines = lines.slice(1);
  const flat = lines.join(" ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentenceEnd >= max * 0.5) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(" ", max - 1);
  return `${(space > max * 0.5 ? head.slice(0, space) : head.slice(0, max - 1)).replace(/[,;:\-–—\s]+$/, "")}…`;
}

export interface CarouselCard {
  /** The product's number in the reply (what "Know more (N)" selects); defaults to its place in the carousel. */
  number?: number;
  name: string;
  price?: number;
  description?: string;
  imageUrl: string;
  outOfStock?: boolean;
}

const fit = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Card text within WhatsApp's 160 characters: *name*, price (and stock), one short line. */
export function cardBody(card: CarouselCard, formatPrice: (n: number) => string): string {
  const name = `*${fit(card.name, 70)}*`;
  const priceLine = [card.price && card.price > 0 ? formatPrice(card.price) : "", card.outOfStock ? "Out of stock" : ""].filter(Boolean).join(" · ");
  const head = priceLine ? `${name}\n${priceLine}` : name;
  const room = CARD_BODY_MAX - head.length - 1;
  const line = room > 20 ? captionExcerpt(card.description, room) : "";
  return line ? `${head}\n${line}` : head;
}

/** Text of the "Know more" button of card N (1-based), within WhatsApp's 20 characters. */
export function knowMoreTitle(n: number, label = "Know more"): string {
  const suffix = ` (${n})`;
  return `${label.slice(0, BUTTON_TITLE_MAX - suffix.length).trimEnd()}${suffix}`;
}

/**
 * A tap on "Know more (N)" arrives as that text; it means the same as replying "N" (the product's
 * number), which the product-pick flow already understands. Other messages come back unchanged.
 */
export function carouselTapToNumber(message: string): string {
  const m = /^(.{1,16})\((\d{1,2})\)$/.exec(message.trim());
  return m && message.trim().length <= BUTTON_TITLE_MAX ? m[2] : message;
}

/** The `interactive` object for MSG91's outbound API (Meta's interactive carousel format). */
export function carouselInteractive(
  bodyText: string,
  cards: CarouselCard[],
  formatPrice: (n: number) => string,
  labels: { knowMore?: string; book?: string } = {},
) {
  const book = (labels.book || "Book consultation").slice(0, BUTTON_TITLE_MAX);
  return {
    type: "carousel",
    body: { text: fit(bodyText, 1024) },
    action: {
      cards: cards.slice(0, CAROUSEL_MAX_CARDS).map((card, i) => ({
        card_index: i,
        type: "cta_url",
        header: { type: "image", image: { link: card.imageUrl } },
        body: { text: cardBody(card, formatPrice) },
        action: {
          buttons: [
            { type: "quick_reply", quick_reply: { id: `product_more_${card.number ?? i + 1}`, title: knowMoreTitle(card.number ?? i + 1, labels.knowMore) } },
            { type: "quick_reply", quick_reply: { id: "book_consultation", title: book } },
          ],
        },
      })),
    },
  };
}
