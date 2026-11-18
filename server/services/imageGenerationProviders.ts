import { fetchWithTimeout, LONG_FETCH_TIMEOUT_MS } from "../lib/fetchWithTimeout";
import OpenAI from 'openai';
import { toFile } from 'openai';
import { GoogleGenAI } from '@google/genai';

/**
 * The OpenAI image model for Virtual Try-On and Vista Studio. OpenAI retires these models now and
 * then (gpt-image-1 stopped on 23 Oct 2026): change it here, or set OPENAI_IMAGE_MODEL on the server.
 */
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.5-sunburst';

/** Google's image model for Vista Studio and the Design Studio (set GOOGLE_IMAGE_MODEL on the server to change it). */
export const GOOGLE_IMAGE_MODEL = process.env.GOOGLE_IMAGE_MODEL?.trim() || 'gemini-3-pro-image-preview';

export interface ImageGenerationResult {
  imageBuffer: Buffer;
  dataUrl: string;
}

export interface ImageGenerationProvider {
  name: string;
  generateImage(
    imageBuffer: Buffer,
    prompt: string,
    size?: number
  ): Promise<ImageGenerationResult>;
  /**
   * A new image from a written brief, with any number of reference images (none is fine): the
   * Design Studio's style photos and motif photo, or the design being changed. PNG buffers.
   */
  generateFromReferences(prompt: string, references: Buffer[]): Promise<ImageGenerationResult>;
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      timeout: 60000,
    });
  }

  async generateImage(
    imageBuffer: Buffer,
    prompt: string,
    size: number = 1024
  ): Promise<ImageGenerationResult> {
    console.log(`[Vista Studio] Using OpenAI ${OPENAI_IMAGE_MODEL}`);

    const imageFile = await toFile(imageBuffer, 'jewelry.png', { type: 'image/png' });

    const response = await this.client.images.edit({
      model: OPENAI_IMAGE_MODEL,
      image: imageFile,
      prompt: prompt,
      size: '1024x1024',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error(`No image returned from ${OPENAI_IMAGE_MODEL}`);
    }

    const generatedImageData = response.data[0];
    let finalBuffer: Buffer;

    if (generatedImageData.b64_json) {
      finalBuffer = Buffer.from(generatedImageData.b64_json, 'base64');
    } else if (generatedImageData.url) {
      const imageResponse = await fetchWithTimeout(generatedImageData.url, undefined, LONG_FETCH_TIMEOUT_MS);
      const arrayBuffer = await imageResponse.arrayBuffer();
      finalBuffer = Buffer.from(arrayBuffer);
    } else {
      throw new Error(`No image data in ${OPENAI_IMAGE_MODEL} response`);
    }

    const dataUrl = `data:image/png;base64,${finalBuffer.toString('base64')}`;
    return { imageBuffer: finalBuffer, dataUrl };
  }

  async generateFromReferences(prompt: string, references: Buffer[]): Promise<ImageGenerationResult> {
    const response = references.length > 0
      ? await this.client.images.edit({
          model: OPENAI_IMAGE_MODEL,
          image: await Promise.all(references.map((b, i) => toFile(b, `reference-${i + 1}.png`, { type: 'image/png' }))) as any,
          prompt,
          size: '1024x1024',
        })
      : await this.client.images.generate({ model: OPENAI_IMAGE_MODEL, prompt, size: '1024x1024' });

    const image = response.data?.[0];
    let finalBuffer: Buffer;
    if (image?.b64_json) {
      finalBuffer = Buffer.from(image.b64_json, 'base64');
    } else if (image?.url) {
      const imageResponse = await fetchWithTimeout(image.url, undefined, LONG_FETCH_TIMEOUT_MS);
      finalBuffer = Buffer.from(await imageResponse.arrayBuffer());
    } else {
      throw new Error(`No image returned from ${OPENAI_IMAGE_MODEL}`);
    }
    return { imageBuffer: finalBuffer, dataUrl: `data:image/png;base64,${finalBuffer.toString('base64')}` };
  }
}

export class GoogleNanoBananaProvider implements ImageGenerationProvider {
  name = 'google';
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateImage(
    imageBuffer: Buffer,
    prompt: string,
    size: number = 1024
  ): Promise<ImageGenerationResult> {
    console.log('[Vista Studio] Using Google Nano Banana Pro (gemini-3-pro-image-preview)');

    const base64Image = imageBuffer.toString('base64');

    const response = await this.client.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Image,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No response from Google Nano Banana Pro');
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error('No content in Google Nano Banana Pro response');
    }

    let imageData: string | undefined;
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (!imageData) {
      throw new Error('No image data in Google Nano Banana Pro response');
    }

    const finalBuffer = Buffer.from(imageData, 'base64');
    const dataUrl = `data:image/png;base64,${finalBuffer.toString('base64')}`;

    return { imageBuffer: finalBuffer, dataUrl };
  }

  async generateFromReferences(prompt: string, references: Buffer[]): Promise<ImageGenerationResult> {
    const response = await this.client.models.generateContent({
      model: GOOGLE_IMAGE_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            ...references.map(b => ({ inlineData: { mimeType: 'image/png', data: b.toString('base64') } })),
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imageData = parts.find(part => part.inlineData?.data)?.inlineData?.data;
    if (!imageData) {
      // The model answered in words only (usually a refusal): pass its reason on.
      const said = parts.map(part => part.text || '').join(' ').trim();
      throw new Error(said ? `The image AI did not draw this: ${said.slice(0, 200)}` : 'No image data in Google Nano Banana Pro response');
    }
    const finalBuffer = Buffer.from(imageData, 'base64');
    return { imageBuffer: finalBuffer, dataUrl: `data:image/png;base64,${finalBuffer.toString('base64')}` };
  }
}

export function createImageProvider(
  provider: 'openai' | 'google',
  apiKey: string
): ImageGenerationProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIImageProvider(apiKey);
    case 'google':
      return new GoogleNanoBananaProvider(apiKey);
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}
