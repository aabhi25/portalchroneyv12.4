import OpenAI from 'openai';
import { storage } from '../storage';
import { aiUsageLogger } from './aiUsageLogger';
import { createOpenAI, OPENAI_TIMEOUTS } from "../lib/openaiClient";

const IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export interface ImageExtractionResult {
  status: 'success' | 'failed';
  text: string;
  warning?: string;
}

/** Longest side sent to the answering model — enough for small print, far below the upload limit. */
const MODEL_IMAGE_MAX_SIDE = 1600;

export class ImageProcessingService {
  /**
   * The student's photo as a data URL the answering model can look at: turned upright (phone
   * photos carry their rotation as EXIF), scaled down and re-encoded as JPEG. null when the image
   * can't be decoded — the turn then goes ahead on the read text alone.
   */
  async imageForModel(buffer: Buffer): Promise<string | null> {
    try {
      const sharp = (await import('sharp')).default;
      const jpeg = await sharp(buffer)
        .rotate()
        .resize({ width: MODEL_IMAGE_MAX_SIDE, height: MODEL_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err: unknown) {
      console.warn('[Image Extract] Could not prepare the photo for the answering model (non-fatal):', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private async getOpenAIClient(businessAccountId: string, externalApiKey?: string): Promise<OpenAI> {
    const apiKey = externalApiKey || (await storage.getBusinessAccountOpenAIKey(businessAccountId));
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }
    // trackUsage:false — the call on this client is logged via aiUsageLogger.logDocumentAnalysisUsage
    return createOpenAI({ timeout: OPENAI_TIMEOUTS.vision, apiKey, trackUsage: false });
  }

  async extractTextFromImage(
    buffer: Buffer,
    mimeType: string,
    businessAccountId: string,
    externalApiKey?: string
  ): Promise<ImageExtractionResult> {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return { status: 'failed', text: '', warning: 'Unsupported image format. Please upload a JPEG, PNG, or WebP image.' };
    }

    if (buffer.length > IMAGE_MAX_SIZE) {
      return { status: 'failed', text: '', warning: 'Image is too large. Please upload an image smaller than 5 MB.' };
    }

    try {
      const openai = await this.getOpenAIClient(businessAccountId, externalApiKey);
      const base64Image = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'This is a student\'s question or study material. Extract all text exactly as written, preserving math symbols, equations, and formatting. If there are diagrams or figures, describe them briefly. If there is no readable text, describe the visual content in detail. Return ONLY the extracted content — no introductory phrases, no commentary.',
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0,
      });

      aiUsageLogger.logDocumentAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(
        (err: Error) => console.error('[Usage] Failed to log image extraction usage:', err)
      );

      const extractedText = completion.choices[0]?.message?.content?.trim() || '';

      if (!extractedText) {
        return { status: 'failed', text: '', warning: 'Could not extract any content from this image.' };
      }

      console.log(`[Image Extract] Extracted ${extractedText.length} chars from image via vision`);
      return { status: 'success', text: extractedText };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Image Extract] Vision extraction failed:', message);
      return { status: 'failed', text: '', warning: 'Could not read this image. Please try a clearer photo.' };
    }
  }
}

export const imageProcessingService = new ImageProcessingService();
