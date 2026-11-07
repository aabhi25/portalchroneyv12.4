import { fetchWithTimeout, LONG_FETCH_TIMEOUT_MS } from "../lib/fetchWithTimeout";
import OpenAI from 'openai';
import { toFile } from 'openai';
import { GoogleGenAI } from '@google/genai';

/**
 * The OpenAI image model for Virtual Try-On and Vista Studio. OpenAI retires these models now and
 * then (gpt-image-1 stopped on 23 Oct 2026): change it here, or set OPENAI_IMAGE_MODEL on the server.
 */
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.5-sunburst';

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
