import fs from "fs";
import path from "path";
import type { GoogleGenAI } from "@google/genai";
import { fetchWithTimeout, LONG_FETCH_TIMEOUT_MS } from "../lib/fetchWithTimeout";

/**
 * Gemini Embedding 2 for photo search: turns product photos and customer photos into
 * 768-number fingerprints that the built-in matcher compares in Postgres (pgvector).
 *
 * The key comes from geminiKeys.resolveGeminiKey (the account's own key, else the platform key).
 * 768 dimensions match the existing vector(768) columns. Gemini Embedding 2 normalises
 * truncated vectors itself; we normalise again so cosine distance is always comparable.
 */
export const GEMINI_IMAGE_MODEL = "gemini-embedding-2";
export const GEMINI_IMAGE_DIMENSIONS = 768;
/** Prefix written to products.visualDescription so Gemini fingerprints are never mixed with older engines'. */
export const GEMINI_EMBEDDING_MARKER = "Gemini Embedding 2";

const MAX_IMAGES_PER_REQUEST = 6; // API limit for gemini-embedding-2
const MAX_EDGE_PX = 768;

const clients = new Map<string, GoogleGenAI>();

async function getClient(apiKey: string): Promise<GoogleGenAI> {
  if (!apiKey) throw new Error("No Gemini API key for photo search");
  let client = clients.get(apiKey);
  if (!client) {
    const { GoogleGenAI } = await import("@google/genai");
    client = new GoogleGenAI({ apiKey });
    if (clients.size > 50) clients.clear();
    clients.set(apiKey, client);
  }
  return client;
}

/** A data URL, an http(s) URL, a local /uploads/ path, or raw bytes. */
export async function loadImageBuffer(input: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma < 0) throw new Error("Malformed data URL");
    return Buffer.from(input.slice(comma + 1), "base64");
  }
  if (input.startsWith("/uploads/")) {
    const uploadsDir = path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsDir, input.replace(/^\/uploads\//, ""));
    if (!filePath.startsWith(uploadsDir)) throw new Error("Invalid image path");
    return fs.promises.readFile(filePath);
  }
  if (/^https?:\/\//i.test(input)) {
    const response = await fetchWithTimeout(input, undefined, LONG_FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("Unsupported image source");
}

/** Same framing for catalog and customer photos: upright, white behind transparency, at most 768 px, JPEG. */
async function prepareImage(input: string | Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const buffer = await loadImageBuffer(input);
  const jpeg = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return jpeg.toString("base64");
}

function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? values : values.map(v => v / norm);
}

function isRetryable(error: any): boolean {
  const status = error?.status ?? error?.code;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return /429|rate|quota exceeded|unavailable|deadline|timeout|ECONNRESET|fetch failed/i.test(String(error?.message || ""));
}

async function embedChunk(base64Images: string[], apiKey: string): Promise<number[][]> {
  const client = await getClient(apiKey);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.models.embedContent({
        model: GEMINI_IMAGE_MODEL,
        // One Content per photo: Gemini returns a separate fingerprint for each.
        contents: base64Images.map(data => ({ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data } }] })),
        config: { outputDimensionality: GEMINI_IMAGE_DIMENSIONS },
      });
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== base64Images.length) {
        throw new Error(`Gemini returned ${embeddings.length} embeddings for ${base64Images.length} images`);
      }
      return embeddings.map(e => {
        const values = e.values;
        if (!values || values.length !== GEMINI_IMAGE_DIMENSIONS) {
          throw new Error(`Gemini returned an embedding of ${values?.length ?? 0} dimensions`);
        }
        return normalize(values);
      });
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isRetryable(error)) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Fingerprints for several photos, in the same order. */
export async function embedImages(inputs: Array<string | Buffer>, apiKey: string): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const prepared = await Promise.all(inputs.map(prepareImage));
  const results: number[][] = [];
  for (let i = 0; i < prepared.length; i += MAX_IMAGES_PER_REQUEST) {
    results.push(...(await embedChunk(prepared.slice(i, i + MAX_IMAGES_PER_REQUEST), apiKey)));
  }
  return results;
}

export async function embedImage(input: string | Buffer, apiKey: string): Promise<number[]> {
  const [embedding] = await embedImages([input], apiKey);
  return embedding;
}

/** Checks a key by fingerprinting a tiny generated picture. Never throws. */
export async function testGeminiKey(apiKey: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const sharp = (await import("sharp")).default;
    const sample = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 212, g: 175, b: 55 } } }).png().toBuffer();
    await embedImage(sample, apiKey);
    return { success: true, message: "Key works with Gemini Embedding 2", latencyMs: Date.now() - start };
  } catch (error: any) {
    const raw = String(error?.message || error);
    const message = /API key not valid|API_KEY_INVALID|permission|401|403/i.test(raw)
      ? "Google rejected this key"
      : /429|quota|rate/i.test(raw)
        ? "Quota exceeded or rate limited — check billing on the Google project"
        : raw.slice(0, 160);
    return { success: false, message, latencyMs: Date.now() - start };
  }
}
