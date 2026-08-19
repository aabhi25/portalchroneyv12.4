/**
 * Helpers to turn TopScholar's rich revision-note HTML (which embeds MathML and
 * <img> tags) into (a) plain text suitable for embedding + LLM context, and
 * (b) chunked passages. The original HTML is preserved separately for rich
 * widget rendering with a MathML-capable engine.
 */

const MATHML_TAGS = ['math', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mfenced', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd'];

/**
 * Best-effort linearization of MathML into readable text (e.g. "x ^ 2 + 1").
 * Not a full converter — enough to make math searchable and legible in context.
 */
function linearizeMathml(html: string): string {
  let out = html;
  // fractions: <mfrac><a/><b/></mfrac> -> "(a)/(b)" is hard without a parser;
  // we instead annotate operators/structure with spacing so symbols survive.
  out = out.replace(/<msup[^>]*>/gi, ' ').replace(/<\/msup>/gi, ' ');
  out = out.replace(/<msub[^>]*>/gi, ' ').replace(/<\/msub>/gi, ' ');
  out = out.replace(/<mfrac[^>]*>/gi, ' ').replace(/<\/mfrac>/gi, ' ');
  out = out.replace(/<msqrt[^>]*>/gi, ' sqrt(').replace(/<\/msqrt>/gi, ') ');
  // Strip remaining MathML wrapper tags but keep their text content
  for (const tag of MATHML_TAGS) {
    out = out.replace(new RegExp(`</?${tag}(\\s[^>]*)?>`, 'gi'), ' ');
  }
  return out;
}

export interface ExtractedHtml {
  text: string;
  images: string[];
  imageDetails: Array<{ url: string; alt: string | null }>;
}

export function htmlToText(html: string | null | undefined): ExtractedHtml {
  if (!html) return { text: '', images: [], imageDetails: [] };

  const images: string[] = [];
  const imageDetails: Array<{ url: string; alt: string | null }> = [];
  const imgRe = /<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    if (!m[1]) continue;
    const altMatch = /\balt=["']([^"']*)["']/i.exec(m[0]);
    images.push(m[1]);
    imageDetails.push({ url: m[1], alt: altMatch?.[1]?.trim() || null });
  }

  let text = linearizeMathml(html);
  // line breaks for block elements
  text = text.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n');
  // strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // decode a few common entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { text, images, imageDetails };
}

/**
 * Split long text into overlapping chunks on sentence/paragraph boundaries.
 */
export function chunkText(text: string, maxLen = 1400, overlap = 150): string[] {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];

  const chunks: string[] = [];
  // Prefer to break on paragraph, then sentence boundaries.
  const paragraphs = clean.split(/\n{2,}/);
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };

  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).length <= maxLen) {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
      continue;
    }
    if (buffer) flush();
    if (para.length <= maxLen) {
      buffer = para;
      continue;
    }
    // paragraph itself too long: hard-window it
    let i = 0;
    while (i < para.length) {
      const slice = para.slice(i, i + maxLen);
      chunks.push(slice.trim());
      i += maxLen - overlap;
    }
  }
  flush();
  return chunks.filter(Boolean);
}
