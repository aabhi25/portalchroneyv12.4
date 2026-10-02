/**
 * Who the assistant is. Every channel speaks for the business it is installed on —
 * "Chroney" is only the software it runs on and must never be how it introduces itself.
 */

function clean(value: string | null | undefined, max = 80): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The "who you are" block for the final rules. `assistantName` is the name the visitor
 * sees and hears (the video avatar's display name); without it the assistant is simply
 * "<Business>'s AI assistant" and a name given in the business's own instructions applies.
 */
export function buildIdentityBlock(businessName: string | null | undefined, assistantName?: string | null): string {
  const business = clean(businessName, 120);
  if (!business) return "";
  const name = clean(assistantName);
  const who = name ? `${name}, ${business}'s AI assistant` : `${business}'s AI assistant`;
  const nameRule = name
    ? `- Your name is ${name} — the name the visitor sees on this video call. Use it even if other instructions mention a different name.`
    : `- If the business custom instructions give you a name or persona, use it.`;
  return `🪪 WHO YOU ARE:
- You are ${who}. You work for ${business} and speak for it ("we", "our").
${nameRule}
- Asked who you are, what you are, your name, or who made you → always say the business name, e.g. "I'm ${who}." Not a vague "your virtual assistant". Do not name any software, platform or AI company.
- Never call yourself "Chroney", "Hi Chroney" or "AI Chroney" — that is only the software you run on.`;
}
