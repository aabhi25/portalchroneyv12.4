/**
 * Design Studio (shared/designStudio.ts): shoppers design their own jewellery in the website chat.
 *
 *  - Settings: the brand's design kit, one row per account (defaults until it saves its own).
 *  - A session: one shopper designing. Drawing runs in the background and the widget polls the
 *    session, so no request waits on the image AI. A drawing left "pending" by a server restart
 *    is shown as failed after RENDER_STALE_MS.
 *  - Image AI: the account's own key (Gemini first, OpenAI as the backup, or the other way round
 *    when the brand prefers OpenAI). No platform key: the brand pays for its shoppers' designs.
 *  - Limits: images per session and per account per 24 hours, and (when the brand asks for it) the
 *    shopper's name and mobile number before any change after the first set.
 *  - "Make this for me": the session becomes a design request and its lead goes through the same
 *    lead store and CRM gate as every other website lead. Contact details stay on the lead only.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { businessAccounts, designSessions, designStudioSettings, leads, type BusinessAccount, type DesignSessionRow } from "@shared/schema";
import {
  ANGLES, DESIGNS_PER_ROUND, PIECES, RENDER_STALE_MS, REQUEST_STATUSES, availableMotifs, buildChangePrompt, buildDesignPrompt,
  cleanChoices, defaultDesignStudioSettings, describeChoices, estimatePrice, formatPriceRange, missingChoices,
  normalizeDesignStudioSettings, rankMotifs,
  type DesignChoices, type DesignImage, type DesignSessionStatus, type DesignStudioSettings, type MotifSuggestion, type PriceRange,
} from "@shared/designStudio";
import { validatePhoneNumber } from "@shared/validation/phone";
import { createOpenAI } from "../lib/openaiClient";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { createImageProvider } from "./imageGenerationProviders";
import { decrypt } from "./encryptionService";
import { openAccountGeminiKey } from "./geminiKeys";
import { r2Storage } from "./r2StorageService";
import { upsertConversationLead } from "./leadCapture/leadStore";
import { syncConversationLeadIfReady } from "./leadCapture/crmGate";
import { hybridProductSearch } from "./productHybridSearch";

const FOLDER = "design-studio";
const RENDER_TIMEOUT_MS = 150_000;

/** A problem the shopper (or the brand) can be told about in plain words. */
export class DesignStudioError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function isDesignStudioOn(businessAccountId: string): Promise<boolean> {
  const [row] = await db.select({ on: businessAccounts.designStudioEnabled }).from(businessAccounts).where(eq(businessAccounts.id, businessAccountId));
  return row?.on === "true";
}

export async function getDesignStudioSettings(businessAccountId: string): Promise<DesignStudioSettings> {
  const [row] = await db.select().from(designStudioSettings).where(eq(designStudioSettings.businessAccountId, businessAccountId));
  return row ? normalizeDesignStudioSettings(row.settings) : defaultDesignStudioSettings();
}

export async function saveDesignStudioSettings(businessAccountId: string, raw: unknown): Promise<DesignStudioSettings> {
  const settings = normalizeDesignStudioSettings(raw);
  // Photos come from our own upload only: the server fetches them to show the image AI.
  const ownPrefixes = await ownImagePrefixes();
  const isOwn = (url?: string | null) => !!url && ownPrefixes.some(p => url.startsWith(p));
  settings.stylePhotos = settings.stylePhotos.filter(isOwn);
  settings.customMotifs = settings.customMotifs.map(m => ({ ...m, imageUrl: isOwn(m.imageUrl) ? m.imageUrl : null }));
  await db.insert(designStudioSettings).values({ businessAccountId, settings })
    .onConflictDoUpdate({ target: designStudioSettings.businessAccountId, set: { settings, updatedAt: new Date() } });
  return settings;
}

// ---------------------------------------------------------------------------
// Images: where they are kept, and the AI that draws them
// ---------------------------------------------------------------------------

async function ownImagePrefixes(): Promise<string[]> {
  const prefixes = [`/uploads/${FOLDER}/`];
  if (await r2Storage.ensureInitialized()) {
    const r2 = r2Storage.getPublicUrl(`${FOLDER}/`);
    if (/^https?:\/\//.test(r2)) prefixes.push(r2);
  }
  return prefixes;
}

/** Saves an image (a design, a style photo, a motif photo) and returns its address. */
export async function storeStudioImage(businessAccountId: string, buffer: Buffer, ext: "jpg" | "png" = "jpg"): Promise<string> {
  const contentType = ext === "png" ? "image/png" : "image/jpeg";
  if (await r2Storage.ensureInitialized()) {
    const up = await r2Storage.uploadFile(buffer, `design.${ext}`, FOLDER, contentType, businessAccountId);
    if (up.success && up.url) return up.url;
    console.error("[Design Studio] R2 upload failed, keeping the image on this server:", up.error);
  }
  const dir = path.join(process.cwd(), "uploads", FOLDER, businessAccountId);
  await fs.mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer);
  return `/uploads/${FOLDER}/${businessAccountId}/${name}`;
}

/** An uploaded photo made ready to keep: turned upright, at most 1280px, JPEG. */
export async function prepareUploadedPhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
}

/** One of our own images as a PNG the image AI can read. Null when it can't be loaded. */
async function loadReference(url: string): Promise<Buffer | null> {
  try {
    let raw: Buffer;
    if (url.startsWith(`/uploads/${FOLDER}/`)) {
      const file = path.normalize(path.join(process.cwd(), url));
      if (!file.startsWith(path.join(process.cwd(), "uploads", FOLDER))) return null;
      raw = await fs.readFile(file);
    } else {
      if (!(await ownImagePrefixes()).some(p => url.startsWith(p))) return null;
      const res = await fetchWithTimeout(url, undefined, 20_000);
      if (!res.ok) return null;
      raw = Buffer.from(await res.arrayBuffer());
    }
    return await sharp(raw).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch (e: any) {
    console.warn("[Design Studio] Could not load a reference image:", e?.message);
    return null;
  }
}

type ImageAi = { provider: "google" | "openai"; apiKey: string };

function imageAisFor(account: BusinessAccount, preferred: "google" | "openai"): ImageAi[] {
  const out: ImageAi[] = [];
  let google: string | null = null;
  if (account.googleNanoBananaApiKey) {
    try { google = decrypt(account.googleNanoBananaApiKey); } catch { google = null; }
  }
  google = google || openAccountGeminiKey(account);
  if (google) out.push({ provider: "google", apiKey: google });
  if (account.openaiApiKey) out.push({ provider: "openai", apiKey: account.openaiApiKey });
  return out.sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
}

const fakeRenders = () => process.env.DESIGN_STUDIO_FAKE_RENDER === "1" && process.env.NODE_ENV !== "production";

/** Whether this account can draw designs, for the portal's set-up line. */
export async function imageAiStatus(businessAccountId: string): Promise<{ ready: boolean; provider: "google" | "openai" | null }> {
  if (fakeRenders()) return { ready: true, provider: "google" };
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) return { ready: false, provider: null };
  const settings = await getDesignStudioSettings(businessAccountId);
  const ais = imageAisFor(account, settings.imageProvider);
  return { ready: ais.length > 0, provider: ais[0]?.provider ?? null };
}

/** Local testing only (DESIGN_STUDIO_FAKE_RENDER=1): a placeholder picture, so the flow runs without an AI key. */
async function fakeImage(prompt: string): Promise<Buffer> {
  const hue = Array.from(prompt).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const label = prompt.split("\n")[0].replace(/[<>&"]/g, "").slice(0, 46);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="hsl(${hue},35%,93%)"/>
    <circle cx="512" cy="470" r="230" fill="none" stroke="hsl(${hue},55%,45%)" stroke-width="26"/>
    <circle cx="512" cy="240" r="46" fill="hsl(${(hue + 40) % 360},70%,60%)"/>
    <text x="512" y="820" font-family="Helvetica, Arial" font-size="30" text-anchor="middle" fill="#444">TEST PICTURE (no image AI)</text>
    <text x="512" y="870" font-family="Helvetica, Arial" font-size="24" text-anchor="middle" fill="#666">${label}</text>
  </svg>`;
  await new Promise(r => setTimeout(r, 1500));
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms).unref?.())]);

/** Draws one image and returns it as a JPEG. Tries the brand's preferred image AI, then its other one. */
async function draw(account: BusinessAccount, settings: DesignStudioSettings, prompt: string, references: Buffer[]): Promise<Buffer> {
  if (fakeRenders()) return fakeImage(prompt);
  const ais = imageAisFor(account, settings.imageProvider);
  if (ais.length === 0) throw new DesignStudioError("no_image_ai", "Designing isn't available right now.", 503);
  let lastError: unknown;
  for (const ai of ais) {
    try {
      const started = Date.now();
      const result = await withTimeout(createImageProvider(ai.provider, ai.apiKey).generateFromReferences(prompt, references), RENDER_TIMEOUT_MS, "The image AI");
      console.log(`[Design Studio] ${ai.provider} drew a design for ${account.id} in ${Date.now() - started}ms (${references.length} reference image(s))`);
      return await sharp(result.imageBuffer).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    } catch (e: any) {
      lastError = e;
      console.error(`[Design Studio] ${ai.provider} could not draw a design for ${account.id}:`, e?.message);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The design could not be drawn");
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface PublicSession {
  id: string;
  choices: DesignChoices;
  designs: DesignImage[];
  price: PriceRange | null;
  priceText: string | null;
  hasContact: boolean;
  requested: boolean;
  chosenDesignId: string | null;
  rendersLeft: number;
}

/** What the widget sees of a session. */
export function toPublicSession(row: DesignSessionRow, settings: DesignStudioSettings): PublicSession {
  const now = Date.now();
  const designs = (row.designs || []).map(d =>
    d.status === "pending" && now - new Date(d.createdAt).getTime() > RENDER_STALE_MS ? { ...d, status: "failed" as const } : d);
  const price = settings.ratesConfirmed && row.priceLow != null && row.priceHigh != null ? { low: row.priceLow, high: row.priceHigh } : null;
  return {
    id: row.id,
    choices: row.choices || {},
    designs,
    price,
    priceText: price ? formatPriceRange(settings.currencySymbol, price) : null,
    hasContact: !!row.leadId,
    requested: !!row.requestedAt,
    chosenDesignId: row.chosenDesignId,
    rendersLeft: Math.max(0, settings.maxRendersPerSession - row.renderCount),
  };
}

export async function startSession(input: { businessAccountId: string; conversationId?: string | null; visitorToken?: string | null; pageUrl?: string | null }): Promise<DesignSessionRow> {
  let conversationId: string | null = null;
  if (input.conversationId && !input.conversationId.startsWith("temp_")) {
    const conv = await storage.getConversation(input.conversationId, input.businessAccountId).catch(() => undefined);
    // Only the visitor's own chat: a lead made here is attached to it.
    if (conv && (!conv.visitorToken || conv.visitorToken === input.visitorToken)) conversationId = conv.id;
  }
  // Times come from this server's clock throughout (requested_at and updated_at are set here too),
  // so date filters compare like with like whatever the database's own time zone is.
  const now = new Date();
  const [row] = await db.insert(designSessions).values({
    businessAccountId: input.businessAccountId,
    conversationId,
    visitorToken: input.visitorToken?.trim().slice(0, 200) || null,
    pageUrl: input.pageUrl?.trim().slice(0, 1000) || null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return row;
}

/** The session, when it belongs to this account and this visitor. */
export async function getSession(id: string, businessAccountId: string, visitorToken?: string | null): Promise<DesignSessionRow> {
  const [row] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db.select().from(designSessions).where(and(eq(designSessions.id, id), eq(designSessions.businessAccountId, businessAccountId)))
    : [];
  if (!row || (row.visitorToken && row.visitorToken !== (visitorToken || "").trim())) {
    throw new DesignStudioError("not_found", "This design session wasn't found. Please start again.", 404);
  }
  return row;
}

async function updateSession(id: string, change: (row: DesignSessionRow) => Partial<DesignSessionRow> | null): Promise<DesignSessionRow> {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(designSessions).where(eq(designSessions.id, id)).for("update");
    if (!row) throw new DesignStudioError("not_found", "This design session wasn't found. Please start again.", 404);
    const patch = change(row);
    if (!patch) return row;
    const [updated] = await tx.update(designSessions).set({ ...patch, updatedAt: new Date() }).where(eq(designSessions.id, id)).returning();
    return updated;
  });
}

async function checkLimits(row: DesignSessionRow, settings: DesignStudioSettings, images: number) {
  if (row.renderCount + images > settings.maxRendersPerSession) {
    throw new DesignStudioError("session_limit", "You've reached the number of designs for one session. Pick your favourite and we'll take it from here.", 429);
  }
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${designSessions.renderCount}), 0)::int` }).from(designSessions)
    .where(and(eq(designSessions.businessAccountId, row.businessAccountId), gte(designSessions.updatedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
  if (used + images > settings.dailyRenderCap) {
    console.warn(`[Design Studio] Daily design limit reached for ${row.businessAccountId} (${used}/${settings.dailyRenderCap})`);
    throw new DesignStudioError("daily_limit", "Our designers are very busy today. Please try again tomorrow, or leave your number and we'll call you.", 429);
  }
}

function needsContact(row: DesignSessionRow, settings: DesignStudioSettings): boolean {
  return settings.contactBeforeChanges && !row.leadId && (row.designs || []).length > 0;
}

const CONTACT_FIRST = new DesignStudioError("contact_required", "Please share your name and mobile number to keep designing.", 403);

async function finishDesign(sessionId: string, designId: string, patch: Partial<DesignImage>) {
  await updateSession(sessionId, row => ({
    designs: (row.designs || []).map(d => (d.id === designId ? { ...d, ...patch } : d)),
    ...(patch.status === "ready" && row.status === "started" ? { status: "designed" } : {}),
  })).catch(e => console.error("[Design Studio] Could not save a finished design:", e?.message));
}

/** The first three designs (or three more, from new choices). Returns at once; drawing carries on in the background. */
export async function startDesigns(row: DesignSessionRow, rawChoices: unknown): Promise<DesignSessionRow> {
  const settings = await getDesignStudioSettings(row.businessAccountId);
  const choices = cleanChoices(rawChoices, settings);
  const missing = missingChoices(choices);
  if (missing.length) throw new DesignStudioError("incomplete", `Please choose: ${missing.join(", ")}.`);
  if (needsContact(row, settings)) throw CONTACT_FIRST;
  await checkLimits(row, settings, DESIGNS_PER_ROUND);
  const account = await storage.getBusinessAccount(row.businessAccountId);
  if (!account) throw new DesignStudioError("not_found", "Account not found.", 404);
  if (!fakeRenders() && imageAisFor(account, settings.imageProvider).length === 0) {
    throw new DesignStudioError("no_image_ai", "Designing isn't available right now. Please leave your number and we'll call you.", 503);
  }

  const price = estimatePrice(settings, choices);
  const now = new Date().toISOString();
  const pending: DesignImage[] = ANGLES.slice(0, DESIGNS_PER_ROUND).map(a => ({
    id: randomUUID(), status: "pending", note: a.note, angle: a.id, round: 0, createdAt: now,
  }));
  const updated = await updateSession(row.id, current => {
    const round = Math.max(0, ...(current.designs || []).map(d => d.round)) + 1;
    pending.forEach(p => { p.round = round; });
    return {
      choices,
      designs: [...(current.designs || []), ...pending],
      renderCount: current.renderCount + pending.length,
      priceLow: price?.low ?? null,
      priceHigh: price?.high ?? null,
    };
  });

  void (async () => {
    const motif = availableMotifs(settings).find(m => m.id === choices.motifId);
    const [styleRefs, motifRef] = await Promise.all([
      Promise.all(settings.stylePhotos.slice(0, 3).map(loadReference)).then(list => list.filter((b): b is Buffer => !!b)),
      motif?.imageUrl ? loadReference(motif.imageUrl) : Promise.resolve(null),
    ]);
    const references = motifRef ? [...styleRefs, motifRef] : styleRefs;
    await Promise.all(pending.map(async p => {
      try {
        const prompt = buildDesignPrompt({ choices, settings, angle: p.angle!, styleRefs: styleRefs.length, motifRef: !!motifRef });
        const image = await draw(account, settings, prompt, references);
        await finishDesign(row.id, p.id, { status: "ready", url: await storeStudioImage(row.businessAccountId, image) });
      } catch {
        await finishDesign(row.id, p.id, { status: "failed" });
      }
    }));
  })();

  return updated;
}

/** One changed copy of a design ("make the motif smaller"). Returns at once; drawing carries on in the background. */
export async function startChange(row: DesignSessionRow, designId: string, rawChange: unknown): Promise<DesignSessionRow> {
  const settings = await getDesignStudioSettings(row.businessAccountId);
  const change = typeof rawChange === "string" ? rawChange.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (change.length < 3) throw new DesignStudioError("no_change", "Tell us what to change, in a few words.");
  const parent = (row.designs || []).find(d => d.id === designId && d.status === "ready" && d.url);
  if (!parent) throw new DesignStudioError("not_found", "That design wasn't found.", 404);
  if (needsContact(row, settings)) throw CONTACT_FIRST;
  await checkLimits(row, settings, 1);
  const account = await storage.getBusinessAccount(row.businessAccountId);
  if (!account) throw new DesignStudioError("not_found", "Account not found.", 404);

  const design: DesignImage = {
    id: randomUUID(), status: "pending", note: `Changed: ${change}`, round: 0, parentId: parent.id, change, createdAt: new Date().toISOString(),
  };
  const updated = await updateSession(row.id, current => {
    design.round = Math.max(0, ...(current.designs || []).map(d => d.round)) + 1;
    return { designs: [...(current.designs || []), design], renderCount: current.renderCount + 1 };
  });

  void (async () => {
    try {
      const reference = await loadReference(parent.url!);
      if (!reference) throw new Error("The design to change could not be loaded");
      const image = await draw(account, settings, buildChangePrompt(change), [reference]);
      await finishDesign(row.id, design.id, { status: "ready", url: await storeStudioImage(row.businessAccountId, image) });
    } catch {
      await finishDesign(row.id, design.id, { status: "failed" });
    }
  })();

  return updated;
}

// ---------------------------------------------------------------------------
// The AI's motif advice
// ---------------------------------------------------------------------------

export interface MotifAdvice { intro: string; suggestions: MotifSuggestion[] }

function adviceIntro(c: DesignChoices): string {
  const piece = PIECES.find(p => p.id === c.piece)?.name.toLowerCase() || "piece";
  const who = c.recipient && c.recipient !== "Myself" ? ` for your ${c.recipient.toLowerCase().replace(" / ", " or ").replace("him", "husband or partner")}` : "";
  const when = c.occasion ? (c.occasion === "Daily wear" ? " for daily wear" : c.occasion === "Just because" ? "" : ` for the ${c.occasion.toLowerCase()}`) : "";
  return `For a ${piece}${who}${when}, these would look lovely:`;
}

/** Four motifs that suit this shopper, each with a reason. The AI chooses and explains; a plain ranking stands in when it can't. */
export async function suggestMotifs(businessAccountId: string, rawChoices: unknown): Promise<MotifAdvice> {
  const settings = await getDesignStudioSettings(businessAccountId);
  const choices = cleanChoices(rawChoices, settings);
  const shortlist = rankMotifs(settings, choices, 9);
  const fallback: MotifAdvice = { intro: adviceIntro(choices), suggestions: shortlist.slice(0, 4) };
  const motifs = availableMotifs(settings);
  try {
    const apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
    if (!apiKey || shortlist.length <= 1) return fallback;
    const client = createOpenAI({ apiKey, timeout: 12_000, maxRetries: 0, businessAccountId, feature: "design_studio" });
    const piece = PIECES.find(p => p.id === choices.piece)?.name || "jewellery";
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a warm, experienced Indian jewellery designer helping a shopper design a custom piece.",
            "From the motif list, choose the 4 that suit this shopper best and say why each suits THEM: the person it is for, the occasion and the piece.",
            'Reply as JSON: {"intro": string, "picks": [{"id": string, "why": string}]}.',
            "intro: one friendly sentence of at most 20 words that leads into the suggestions. why: one sentence of at most 18 words, plain everyday English, no hype.",
            "Use only ids from the list, each once. Never mention prices.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            piece,
            for: choices.recipient || "not said",
            occasion: choices.occasion || "not said",
            houseStyle: settings.styleNote || undefined,
            motifs: shortlist.map(s => {
              const m = motifs.find(x => x.id === s.motifId)!;
              return { id: m.id, name: m.name, meaning: m.meaning };
            }),
          }),
        },
      ],
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    const allowed = new Set(shortlist.map(s => s.motifId));
    const seen = new Set<string>();
    const picks: MotifSuggestion[] = [];
    for (const p of Array.isArray(parsed.picks) ? parsed.picks : []) {
      if (typeof p?.id !== "string" || !allowed.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      const why = typeof p.why === "string" ? p.why.trim().slice(0, 160) : "";
      picks.push({ motifId: p.id, why: why || shortlist.find(s => s.motifId === p.id)!.why });
    }
    if (picks.length < 2) return fallback;
    for (const s of shortlist) {
      if (picks.length >= 4) break;
      if (!seen.has(s.motifId)) picks.push(s);
    }
    const intro = typeof parsed.intro === "string" && parsed.intro.trim() ? parsed.intro.trim().slice(0, 180) : fallback.intro;
    return { intro, suggestions: picks.slice(0, 4) };
  } catch (e: any) {
    console.warn("[Design Studio] Motif advice fell back to the plain ranking:", e?.message);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Contact details and the request
// ---------------------------------------------------------------------------

export interface ContactInput { name?: unknown; phone?: unknown; email?: unknown }

function cleanContact(input: ContactInput): { name: string; phone: string; email: string | null } {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
  const name = str(input.name, 80);
  const phone = str(input.phone, 20);
  const email = str(input.email, 120);
  if (name.length < 2) throw new DesignStudioError("bad_contact", "Please enter your name.");
  const check = validatePhoneNumber(phone, "10");
  if (!check.isValid) throw new DesignStudioError("bad_contact", check.reasonMessage || "Please enter a valid mobile number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new DesignStudioError("bad_contact", "That email doesn't look right.");
  return { name, phone, email: email || null };
}

function requestSummary(row: DesignSessionRow, settings: DesignStudioSettings, designUrl?: string | null, note?: string | null): string {
  const price = settings.ratesConfirmed && row.priceLow != null && row.priceHigh != null
    ? ` · estimate ${formatPriceRange(settings.currencySymbol, { low: row.priceLow, high: row.priceHigh })}` : "";
  return `Design Studio: ${describeChoices(settings, row.choices || {}) || "custom design"}${price}`
    + (note ? ` · note: ${note}` : "")
    + (designUrl ? ` · design: ${designUrl}` : "");
}

/** Saves the shopper's name and number as a lead on their chat (made if they haven't chatted yet). */
export async function saveContact(row: DesignSessionRow, input: ContactInput, message?: string): Promise<DesignSessionRow> {
  const contact = cleanContact(input);
  const settings = await getDesignStudioSettings(row.businessAccountId);

  let conversationId = row.conversationId;
  if (!conversationId && row.visitorToken) {
    conversationId = (await storage.findReusableConversation(row.businessAccountId, row.visitorToken).catch(() => undefined))?.id ?? null;
  }
  if (!conversationId) {
    const conversation = await storage.createConversation({
      businessAccountId: row.businessAccountId,
      title: `${contact.name} — ${settings.label}`,
      visitorToken: row.visitorToken || null,
    } as any);
    conversationId = conversation.id;
  }

  const up = await upsertConversationLead({
    businessAccountId: row.businessAccountId,
    conversationId,
    values: { ...contact, message: message || requestSummary(row, settings), sourceUrl: row.pageUrl },
    policy: { message: "replace" },
    createMessage: message || requestSummary(row, settings),
  });
  const lead = up.lead;
  if (!lead) throw new DesignStudioError("bad_contact", "Please enter a valid mobile number.");
  const topics = Array.from(new Set([...(lead.topicsOfInterest || []), "Design Studio"]));
  if (topics.length !== (lead.topicsOfInterest || []).length) {
    await storage.updateLead(lead.id, row.businessAccountId, { topicsOfInterest: topics }).catch(() => undefined);
  }
  syncConversationLeadIfReady({
    leadId: lead.id, businessAccountId: row.businessAccountId, conversationId, changedFields: up.changed, channel: "widget", source: "design_studio",
  }).catch(err => console.error("[Design Studio] CRM sync failed:", err?.message));

  return updateSession(row.id, () => ({ leadId: lead.id, conversationId }));
}

/** "Make this for me": the chosen design goes to the brand as a request, on the shopper's lead and chat. */
export async function requestDesign(row: DesignSessionRow, input: ContactInput & { designId?: unknown; note?: unknown }): Promise<DesignSessionRow> {
  const settings = await getDesignStudioSettings(row.businessAccountId);
  const design = (row.designs || []).find(d => d.id === input.designId && d.status === "ready" && d.url);
  if (!design) throw new DesignStudioError("not_found", "Please pick a design first.", 404);
  const note = typeof input.note === "string" ? input.note.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  const summary = requestSummary(row, settings, design.url, note);

  // A shopper who already gave their details needn't type them again.
  let current = row;
  if (!row.leadId || input.phone) current = await saveContact(row, input, summary);
  else if (row.leadId) {
    await storage.updateLead(row.leadId, row.businessAccountId, { message: summary }).catch(() => undefined);
    syncConversationLeadIfReady({
      leadId: row.leadId, businessAccountId: row.businessAccountId, conversationId: row.conversationId, changedFields: ["message"], channel: "widget", source: "design_studio",
    }).catch(err => console.error("[Design Studio] CRM sync failed:", err?.message));
  }

  if (current.conversationId) {
    try {
      await storage.createMessage({ conversationId: current.conversationId, role: "user", content: `Please make this design for me.${note ? ` ${note}` : ""}`, interactionSource: "form" } as any);
      await storage.createMessage({
        conversationId: current.conversationId, role: "assistant", imageUrl: design.url,
        content: `Design request received: ${describeChoices(settings, current.choices || {})}. Our designer will call you with the final design and price.`,
        interactionSource: "form",
      } as any);
      await storage.updateConversationTimestamp(current.conversationId);
    } catch (e: any) {
      console.warn("[Design Studio] Could not add the request to the chat:", e?.message);
    }
  }

  return updateSession(row.id, r => ({
    chosenDesignId: design.id,
    requestNote: note || null,
    requestedAt: r.requestedAt ?? new Date(),
    status: r.requestedAt ? r.status : "requested",
  }));
}

// ---------------------------------------------------------------------------
// Ready pieces like this
// ---------------------------------------------------------------------------

export interface SimilarProduct { id: string; name: string; price: string | null; imageUrl: string | null; productUrl: string | null }

/** Products the brand already sells that are close to what the shopper designed. */
export async function similarProducts(row: DesignSessionRow): Promise<SimilarProduct[]> {
  const settings = await getDesignStudioSettings(row.businessAccountId);
  const c = row.choices || {};
  const piece = PIECES.find(p => p.id === c.piece)?.name;
  const motif = availableMotifs(settings).find(m => m.id === c.motifId)?.name.replace(/\s*\(.*\)/, "");
  const metal = settings.metals.find(m => m.id === c.metalId)?.name.replace(/\b\d+k\b|\b925\b/gi, "").trim();
  const query = [motif, metal, piece].filter(Boolean).join(" ") || c.idea || "";
  if (!query) return [];
  try {
    let hits = await hybridProductSearch(row.businessAccountId, { query, productType: piece, limit: 12 });
    if (hits.length === 0 && piece) hits = await hybridProductSearch(row.businessAccountId, { query: piece, limit: 12 });
    return hits
      .filter(h => h.imageUrl && h.stockStatus !== "out_of_stock" && h.stockStatus !== "outofstock")
      .slice(0, 6)
      .map(h => ({ id: h.id, name: h.name, price: h.price, imageUrl: h.imageUrl, productUrl: h.productUrl }));
  } catch (e: any) {
    console.warn("[Design Studio] Ready pieces search failed:", e?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// The brand's side: requests and numbers
// ---------------------------------------------------------------------------

export interface DesignRequestRow {
  id: string;
  status: DesignSessionStatus;
  requestedAt: Date | null;
  summary: string;
  designUrl: string | null;
  designs: { id: string; url: string; note: string }[];
  priceText: string | null;
  requestNote: string | null;
  staffNotes: string | null;
  leadId: string | null;
  conversationId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export async function listRequests(businessAccountId: string, from: Date, to: Date): Promise<DesignRequestRow[]> {
  const settings = await getDesignStudioSettings(businessAccountId);
  const rows = await db.select({ session: designSessions, name: leads.name, phone: leads.phone, email: leads.email })
    .from(designSessions)
    .leftJoin(leads, and(eq(leads.id, designSessions.leadId), eq(leads.businessAccountId, businessAccountId)))
    .where(and(
      eq(designSessions.businessAccountId, businessAccountId),
      isNotNull(designSessions.requestedAt),
      gte(designSessions.requestedAt, from),
      lte(designSessions.requestedAt, to),
    ))
    .orderBy(desc(designSessions.requestedAt))
    .limit(500);
  return rows.map(({ session: s, name, phone, email }) => {
    const ready = (s.designs || []).filter(d => d.status === "ready" && d.url);
    const chosen = ready.find(d => d.id === s.chosenDesignId);
    return {
      id: s.id,
      status: s.status as DesignSessionStatus,
      requestedAt: s.requestedAt,
      summary: describeChoices(settings, s.choices || {}),
      designUrl: chosen?.url ?? null,
      designs: ready.map(d => ({ id: d.id, url: d.url!, note: d.note })),
      priceText: s.priceLow != null && s.priceHigh != null ? formatPriceRange(settings.currencySymbol, { low: s.priceLow, high: s.priceHigh }) : null,
      requestNote: s.requestNote,
      staffNotes: s.staffNotes,
      leadId: s.leadId,
      conversationId: s.conversationId,
      name, phone, email,
    };
  });
}

export async function updateRequest(businessAccountId: string, id: string, patch: { status?: unknown; staffNotes?: unknown }): Promise<void> {
  const set: Partial<DesignSessionRow> = {};
  if (patch.status !== undefined) {
    if (!REQUEST_STATUSES.some(s => s.id === patch.status)) throw new DesignStudioError("bad_status", "Unknown status.");
    set.status = patch.status as string;
  }
  if (patch.staffNotes !== undefined) set.staffNotes = typeof patch.staffNotes === "string" ? patch.staffNotes.trim().slice(0, 2000) || null : null;
  if (Object.keys(set).length === 0) return;
  const updated = await db.update(designSessions).set({ ...set, updatedAt: new Date() })
    .where(and(eq(designSessions.id, id), eq(designSessions.businessAccountId, businessAccountId), isNotNull(designSessions.requestedAt)))
    .returning({ id: designSessions.id });
  if (updated.length === 0) throw new DesignStudioError("not_found", "That request wasn't found.", 404);
}

export interface DesignFunnel { started: number; designed: number; requested: number; quoted: number; ordered: number; images: number }

/** Sessions started in the dates, and how far they got. */
export async function designFunnel(businessAccountId: string, from: Date, to: Date): Promise<DesignFunnel> {
  const [row] = await db.select({
    started: sql<number>`count(*)::int`,
    designed: sql<number>`count(*) filter (where ${designSessions.status} <> 'started')::int`,
    requested: sql<number>`count(*) filter (where ${designSessions.requestedAt} is not null)::int`,
    quoted: sql<number>`count(*) filter (where ${designSessions.status} in ('quoted', 'ordered'))::int`,
    ordered: sql<number>`count(*) filter (where ${designSessions.status} = 'ordered')::int`,
    images: sql<number>`coalesce(sum(${designSessions.renderCount}), 0)::int`,
  }).from(designSessions).where(and(
    eq(designSessions.businessAccountId, businessAccountId),
    gte(designSessions.createdAt, from),
    lte(designSessions.createdAt, to),
  ));
  return row;
}
