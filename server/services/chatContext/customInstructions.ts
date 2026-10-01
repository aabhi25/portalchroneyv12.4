/**
 * Train Chroney custom instructions — one parser for every channel.
 *
 * Stored in widget_settings.custom_instructions as either
 *   - a JSON list: [{ id, text, type: 'always' | 'conditional' | 'fallback', keywords?: string[], channels?: string[] }]
 *   - or legacy free text.
 *
 * `channels` limits an instruction to some channels (shared/knowledgeChannels.ts); no `channels`
 * (or an empty list) means every channel, so untagged instructions behave exactly as before.
 *
 * The website chat (chatService + llamaService final override), WhatsApp and Instagram / Facebook
 * DMs all go through these helpers so an instruction means the same thing everywhere.
 */
import { appliesToChannel, sanitizeChannels, type KnowledgeChannel } from '../../../shared/knowledgeChannels';

export interface CustomInstructionItem {
  id?: string;
  text: string;
  type?: 'always' | 'conditional' | 'fallback' | string;
  keywords?: string[];
  channels?: string[] | null;
  [key: string]: unknown;
}

export interface ParsedCustomInstructions {
  /** JSON list (already filtered to the channel), or null for legacy free text / nothing. */
  items: CustomInstructionItem[] | null;
  /** Legacy free-text instructions (not JSON), unchanged. */
  legacyText: string | null;
  /** Number of JSON items before the channel filter. */
  totalItems: number;
}

/** Parse and keep only the instructions that apply on `channel` (no channel = keep all). */
export function parseCustomInstructions(raw: string | null | undefined, channel?: KnowledgeChannel | null): ParsedCustomInstructions {
  if (!raw || !raw.trim()) return { items: null, legacyText: null, totalItems: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: null, legacyText: raw, totalItems: 0 };
  }
  if (!Array.isArray(parsed)) {
    // Valid JSON but not a list (e.g. a quoted string): the website treated it as "no list".
    return { items: null, legacyText: null, totalItems: 0 };
  }
  const items = (parsed as CustomInstructionItem[]).filter(i => i && typeof i === 'object');
  return {
    items: items.filter(i => appliesToChannel(sanitizeChannels(i.channels), channel)),
    legacyText: null,
    totalItems: parsed.length,
  };
}

/** True when any stored instruction is limited to some channels. */
export function hasChannelTaggedInstructions(raw: string | null | undefined): boolean {
  const { items } = parseCustomInstructions(raw, null);
  return !!items?.some(i => sanitizeChannels(i.channels) !== null);
}

/**
 * The raw value with instructions for other channels removed. Returns the input unchanged when
 * nothing is channel-tagged (so prompts stay byte-identical for untagged accounts), and also for
 * legacy free text.
 */
export function filterCustomInstructionsForChannel(raw: string | null | undefined, channel: KnowledgeChannel): string | null | undefined {
  if (!raw || !raw.trim()) return raw;
  const { items, legacyText } = parseCustomInstructions(raw, null);
  if (legacyText !== null || !items) return raw;
  if (!items.some(i => sanitizeChannels(i.channels) !== null)) return raw;
  return JSON.stringify(items.filter(i => appliesToChannel(sanitizeChannels(i.channels), channel)));
}

export interface CustomInstructionsBlock {
  /** "CUSTOM BUSINESS INSTRUCTIONS:" + "CONDITIONAL INSTRUCTIONS" block for the system prompt ('' if none). */
  contextBlock: string;
  /** Just the instruction lines (no header), for prompts that use their own header. */
  body: string;
  alwaysCount: number;
  conditionalCount: number;
  /** Fallback instruction texts — applied only when the AI cannot answer. */
  fallback: string[];
  isLegacyText: boolean;
}

/**
 * The website chat's system-prompt block (chatService.buildEnrichedContext), now shared:
 * always-on instructions numbered, conditional ones listed with their trigger keywords,
 * fallback ones held back.
 */
export function buildCustomInstructionsBlock(raw: string | null | undefined, channel?: KnowledgeChannel | null): CustomInstructionsBlock {
  const empty: CustomInstructionsBlock = { contextBlock: '', body: '', alwaysCount: 0, conditionalCount: 0, fallback: [], isLegacyText: false };
  const parsed = parseCustomInstructions(raw, channel);
  if (parsed.legacyText !== null) {
    return {
      contextBlock: `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${parsed.legacyText}\n\n`,
      body: parsed.legacyText,
      alwaysCount: 0,
      conditionalCount: 0,
      fallback: [],
      isLegacyText: true,
    };
  }
  const instructions = parsed.items;
  if (!instructions || instructions.length === 0) return empty;

  const alwaysActive = instructions.filter(i => i.type === 'always' || !i.type);
  const conditional = instructions.filter(i => i.type === 'conditional');
  const fallback = instructions.filter(i => i.type === 'fallback').map(i => i.text);

  let contextBlock = '';
  const bodyParts: string[] = [];
  if (alwaysActive.length > 0) {
    const formatted = alwaysActive.map((instr, index) => `${index + 1}. ${instr.text}`).join('\n');
    contextBlock = `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${formatted}\n\n`;
    bodyParts.push(formatted);
  }
  if (conditional.length > 0) {
    const formatted = conditional
      .map(instr => `- When user mentions [${instr.keywords?.join(', ') || ''}]: ${instr.text}`)
      .join('\n');
    contextBlock += `CONDITIONAL INSTRUCTIONS (apply when keywords are mentioned):\n${formatted}\n\n`;
    bodyParts.push(`CONDITIONAL INSTRUCTIONS (apply when keywords are mentioned):\n${formatted}`);
  }
  return {
    contextBlock,
    body: bodyParts.join('\n\n'),
    alwaysCount: alwaysActive.length,
    conditionalCount: conditional.length,
    fallback,
    isLegacyText: false,
  };
}

/**
 * The website chat's per-message selection (llamaService final override): "always" instructions
 * plus the "conditional" ones whose keywords appear in this message, numbered by their original
 * position. Returns '' when nothing applies; legacy free text is returned whole.
 */
export function selectInstructionsForMessage(
  raw: string | null | undefined,
  userMessage: string,
  channel?: KnowledgeChannel | null,
): { text: string; applied: number; total: number; matchedConditional: CustomInstructionItem[] } {
  const parsed = parseCustomInstructions(raw, channel);
  if (parsed.legacyText !== null) {
    return { text: `Follow these instructions:\n${parsed.legacyText}`, applied: 1, total: 1, matchedConditional: [] };
  }
  const instructions = parsed.items;
  if (!instructions || instructions.length === 0) return { text: '', applied: 0, total: 0, matchedConditional: [] };
  const userMessageLower = (userMessage || '').toLowerCase();
  const matchedConditional: CustomInstructionItem[] = [];
  const indexed = instructions.map((instr, originalIndex) => ({ instr, originalIndex: originalIndex + 1 }));
  const applicable = indexed.filter(({ instr }) => {
    const instrType = instr.type || 'always';
    if (instrType === 'fallback') return false;
    if (instrType === 'always') return true;
    if (instrType === 'conditional' && instr.keywords && Array.isArray(instr.keywords)) {
      const keywordMatch = instr.keywords.some((keyword: string) => userMessageLower.includes(String(keyword).toLowerCase()));
      if (keywordMatch) matchedConditional.push(instr);
      return keywordMatch;
    }
    return true;
  });
  if (applicable.length === 0) return { text: '', applied: 0, total: instructions.length, matchedConditional };
  const formatted = applicable.map(({ instr, originalIndex }) => `${originalIndex}. ${instr.text}`).join('\n');
  return { text: `Follow these instructions:\n${formatted}`, applied: applicable.length, total: instructions.length, matchedConditional };
}

/**
 * Clean `channels` on each stored instruction before saving (unknown values dropped, "all" stored
 * as no tag). Returns the input unchanged when it is not a JSON list or nothing needed cleaning.
 */
export function sanitizeCustomInstructionsChannels<T>(raw: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return raw;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (!Array.isArray(parsed)) return raw;
  let changed = false;
  const out = parsed.map((item: any) => {
    if (!item || typeof item !== 'object' || !('channels' in item)) return item;
    const clean = sanitizeChannels(item.channels);
    const { channels: _drop, ...rest } = item;
    changed = true;
    return clean ? { ...rest, channels: clean } : rest;
  });
  return changed ? (JSON.stringify(out) as unknown as T) : raw;
}
