import { backgroundRemovalService } from './backgroundRemovalService';
import { db } from '../db';
import { vistaStudioJobs, businessAccounts } from '../../shared/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { r2Storage } from './r2StorageService';
import { createImageProvider, ImageGenerationProvider } from './imageGenerationProviders';
import { decrypt } from './encryptionService';

export type CategoryType = 'necklaces' | 'rings' | 'bangles' | 'bracelets' | 'earrings';
export type StyleType = 'matte-black-mannequin' | 'ivory-mannequin' | 'charcoal-grey' | 'model-neck';
export type TemplateType = `${CategoryType}-${StyleType}`;

interface CategoryConfig {
  name: string;
  icon: string;
  description: string;
}

interface StyleConfig {
  name: string;
  description: string;
}

interface TemplatePromptConfig {
  category: CategoryType;
  style: StyleType;
  name: string;
  description: string;
  prompt: string;
}

const JEWELRY_PRESERVATION_INSTRUCTIONS = `
The jewelry design, geometry, proportions, curves, stone placement, metal color, and surface finish must remain visually identical to the original image.
Do not modify, redesign, reinterpret, enhance, or stylize the jewelry in any way.
Only adjust the background and lighting.
No additions, removals, or changes to the jewelry itself.`;

const CATEGORIES: Record<CategoryType, CategoryConfig> = {
  'necklaces': {
    name: 'Necklaces',
    icon: 'gem',
    description: 'Necklaces, chains, and pendants',
  },
  'rings': {
    name: 'Rings',
    icon: 'circle',
    description: 'Rings and bands',
  },
  'bangles': {
    name: 'Bangles',
    icon: 'circle-dot',
    description: 'Bangles and kada',
  },
  'bracelets': {
    name: 'Bracelets',
    icon: 'link',
    description: 'Chain bracelets and tennis bracelets',
  },
  'earrings': {
    name: 'Earrings',
    icon: 'sparkles',
    description: 'Earrings and ear accessories',
  },
};

const STYLES: Record<StyleType, StyleConfig> = {
  'matte-black-mannequin': {
    name: 'Matte Black Mannequin',
    description: 'Elegant dark mannequin silhouette for luxury jewelry',
  },
  'ivory-mannequin': {
    name: 'Ivory Mannequin',
    description: 'Soft cream-colored mannequin for a classic look',
  },
  'charcoal-grey': {
    name: 'Charcoal Grey',
    description: 'Modern gradient background without mannequin',
  },
  'model-neck': {
    name: 'Model Neck',
    description: 'Elegant woman\'s neck and décolletage wearing the jewelry',
  },
};

const CATEGORY_STYLE_PROMPTS: Record<CategoryType, Record<StyleType, string>> = {
  'necklaces': {
    'matte-black-mannequin': 'Professional product photography of this necklace elegantly displayed on a sleek matte black mannequin bust. The mannequin has a sophisticated dark charcoal finish with subtle gradients. Luxury jewelry photography style with soft studio lighting, creating gentle highlights on the necklace. The background is a deep, rich black with a subtle gradient. High-end catalog quality, photorealistic rendering.',
    'ivory-mannequin': 'Professional product photography of this necklace displayed on an elegant ivory cream-colored mannequin bust. The mannequin has a classic, timeless appearance with soft warm tones. Luxury jewelry photography with diffused natural lighting, creating a soft and inviting atmosphere. The background is a gentle cream to light beige gradient. High-end bridal and fine jewelry catalog style, photorealistic.',
    'charcoal-grey': 'Professional product photography of this necklace floating elegantly against a modern charcoal grey gradient background. No mannequin, just the necklace beautifully lit with professional studio lighting creating soft reflections and highlights. Contemporary luxury catalog style with a sophisticated dark grey to lighter grey radial gradient. Clean, minimal, high-end product shot.',
    'model-neck': 'Professional product photography of this necklace elegantly worn on a beautiful woman\'s neck and décolletage. Close-up shot focusing on the necklace against smooth, flawless skin. The model\'s face is cropped out, showing only the graceful neck, collarbone area, and shoulders. Soft studio lighting highlights the jewelry against the warm skin tones. Luxury editorial jewelry photography style with a soft blurred neutral background. High-end fashion catalog quality, photorealistic rendering.',
  },
  'rings': {
    'matte-black-mannequin': 'Professional product photography of this ring elegantly displayed on graceful feminine fingers with manicured nails, close-up shot. The hand has a sophisticated pose against a matte black background with subtle gradients. Luxury jewelry photography style with soft studio lighting, creating gentle highlights on the ring. The background is a deep, rich black. High-end catalog quality, photorealistic rendering.',
    'ivory-mannequin': 'Professional product photography of this ring displayed on elegant feminine fingers with manicured nails, close-up shot. The hand has a graceful pose against a soft ivory cream background. Luxury jewelry photography with diffused natural lighting, creating a soft and inviting atmosphere. The background is a gentle cream to light beige gradient. High-end bridal and fine jewelry catalog style, photorealistic.',
    'charcoal-grey': 'Professional product photography of this ring floating elegantly against a modern charcoal grey gradient background. Close-up shot with the ring beautifully lit with professional studio lighting creating soft reflections and highlights on the metal and stones. Contemporary luxury catalog style with a sophisticated dark grey to lighter grey radial gradient. Clean, minimal, high-end product shot.',
    'model-neck': 'Professional product photography of this ring elegantly displayed on graceful feminine fingers with manicured nails, close-up shot. The hand is positioned near the model\'s neck and collarbone area in an elegant pose. Soft studio lighting highlights the ring against warm skin tones. Luxury editorial jewelry photography style with a soft blurred neutral background. High-end fashion catalog quality, photorealistic rendering.',
  },
  'bangles': {
    'matte-black-mannequin': 'Professional product photography of these bangles elegantly stacked on a graceful feminine wrist, close-up shot. The arm has a sophisticated pose against a matte black background with subtle gradients. Luxury jewelry photography style with soft studio lighting, creating gentle highlights on the bangles. The background is a deep, rich black. High-end catalog quality, photorealistic rendering.',
    'ivory-mannequin': 'Professional product photography of these bangles displayed stacked on an elegant feminine wrist, close-up shot. The arm has a graceful pose against a soft ivory cream background. Luxury jewelry photography with diffused natural lighting, creating a soft and inviting atmosphere. Traditional bridal style setting. The background is a gentle cream to light beige gradient. High-end fine jewelry catalog style, photorealistic.',
    'charcoal-grey': 'Professional product photography of these bangles floating elegantly against a modern charcoal grey gradient background. Close-up shot with the bangles beautifully lit with professional studio lighting creating soft reflections and highlights on the metal. Contemporary luxury catalog style with a sophisticated dark grey to lighter grey radial gradient. Clean, minimal, high-end product shot.',
    'model-neck': 'Professional product photography of these bangles elegantly stacked on a graceful feminine wrist, close-up shot. The arm is positioned near the model\'s torso in an elegant pose. Soft studio lighting highlights the bangles against warm skin tones. Luxury editorial jewelry photography style with a soft blurred neutral background. High-end fashion catalog quality, photorealistic rendering.',
  },
  'bracelets': {
    'matte-black-mannequin': 'Professional product photography of this delicate chain bracelet elegantly draped around a graceful feminine wrist, close-up shot. The arm has a sophisticated pose against a matte black background with subtle gradients. The bracelet links and chain catch the light beautifully. Luxury jewelry photography style with soft studio lighting, creating gentle highlights on the bracelet chain. The background is a deep, rich black. High-end catalog quality, photorealistic rendering.',
    'ivory-mannequin': 'Professional product photography of this delicate chain bracelet displayed draped around an elegant feminine wrist, close-up shot. The arm has a graceful pose against a soft ivory cream background. Luxury jewelry photography with diffused natural lighting, creating a soft and inviting atmosphere. The bracelet chain and links shimmer elegantly. The background is a gentle cream to light beige gradient. High-end bridal and fine jewelry catalog style, photorealistic.',
    'charcoal-grey': 'Professional product photography of this delicate chain bracelet floating elegantly against a modern charcoal grey gradient background. Close-up shot with the bracelet chain beautifully lit with professional studio lighting creating soft reflections and highlights on the links and metal. Contemporary luxury catalog style with a sophisticated dark grey to lighter grey radial gradient. Clean, minimal, high-end product shot.',
    'model-neck': 'Professional product photography of this delicate chain bracelet elegantly draped around a graceful feminine wrist, close-up shot. The arm is positioned near the model\'s body in an elegant pose. Soft studio lighting highlights the bracelet chain and links against warm skin tones. Luxury editorial jewelry photography style with a soft blurred neutral background. High-end fashion catalog quality, photorealistic rendering.',
  },
  'earrings': {
    'matte-black-mannequin': 'Professional product photography of these earrings elegantly displayed on a model ear with hair tucked back, portrait crop shot. The ear and profile are against a matte black background with subtle gradients. Luxury jewelry photography style with soft studio lighting, creating gentle highlights on the earrings. The background is a deep, rich black. High-end catalog quality, photorealistic rendering.',
    'ivory-mannequin': 'Professional product photography of these earrings displayed on a model ear with hair elegantly tucked back, portrait crop shot. The ear and profile are against a soft ivory cream background. Luxury jewelry photography with diffused natural lighting, creating a soft and inviting atmosphere. The background is a gentle cream to light beige gradient. High-end bridal and fine jewelry catalog style, photorealistic.',
    'charcoal-grey': 'Professional product photography of these earrings floating elegantly against a modern charcoal grey gradient background. Close-up shot with the earrings beautifully lit with professional studio lighting creating soft reflections and highlights. Contemporary luxury catalog style with a sophisticated dark grey to lighter grey radial gradient. Clean, minimal, high-end product shot.',
    'model-neck': 'Professional product photography of these earrings elegantly displayed on a model ear with hair swept back, portrait crop shot. The ear and graceful neck are visible with soft studio lighting. The model\'s face is cropped out, showing only the ear, jawline, and neck area. Soft blurred neutral background. Luxury editorial jewelry photography style. High-end fashion catalog quality, photorealistic rendering.',
  },
};

function buildTemplatePrompt(category: CategoryType, style: StyleType): string {
  const basePrompt = CATEGORY_STYLE_PROMPTS[category][style];
  return basePrompt + JEWELRY_PRESERVATION_INSTRUCTIONS;
}

function getAllTemplates(): TemplatePromptConfig[] {
  const templates: TemplatePromptConfig[] = [];
  for (const category of Object.keys(CATEGORIES) as CategoryType[]) {
    for (const style of Object.keys(STYLES) as StyleType[]) {
      templates.push({
        category,
        style,
        name: `${CATEGORIES[category].name} - ${STYLES[style].name}`,
        description: STYLES[style].description,
        prompt: buildTemplatePrompt(category, style),
      });
    }
  }
  return templates;
}

export function getTemplatePrompt(category: CategoryType, style: StyleType): string {
  return buildTemplatePrompt(category, style);
}

export function getCategories() {
  return CATEGORIES;
}

export function getStyles() {
  return STYLES;
}

export { getAllTemplates };

export class JewelryImageGeneratorService {
  private static instance: JewelryImageGeneratorService;

  static getInstance(): JewelryImageGeneratorService {
    if (!JewelryImageGeneratorService.instance) {
      JewelryImageGeneratorService.instance = new JewelryImageGeneratorService();
    }
    return JewelryImageGeneratorService.instance;
  }

  async generateProductImage(
    imageBuffer: Buffer,
    template: TemplateType,
    cropBox?: { x: number; y: number; width: number; height: number },
    apiKey?: string,
    customPrompt?: string,
    provider: 'openai' | 'google' = 'openai'
  ): Promise<{ imageBuffer: Buffer; dataUrl: string }> {
    const startTime = Date.now();
    console.log(`[Vista Studio] Starting image generation with provider: ${provider}, template: ${template}`);

    if (!apiKey) {
      throw new Error(`API key is required for ${provider === 'google' ? 'Google Nano Banana Pro' : 'OpenAI DALL-E'} image generation`);
    }

    try {
      let processedBuffer = imageBuffer;
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(imageBuffer).metadata();
      const imgWidth = metadata.width || 0;
      const imgHeight = metadata.height || 0;

      if (cropBox) {
        const pixelX = Math.round((cropBox.x / 100) * imgWidth);
        const pixelY = Math.round((cropBox.y / 100) * imgHeight);
        const pixelWidth = Math.round((cropBox.width / 100) * imgWidth);
        const pixelHeight = Math.round((cropBox.height / 100) * imgHeight);

        const clampedX = Math.max(0, Math.min(pixelX, imgWidth - 1));
        const clampedY = Math.max(0, Math.min(pixelY, imgHeight - 1));
        const clampedWidth = Math.max(1, Math.min(pixelWidth, imgWidth - clampedX));
        const clampedHeight = Math.max(1, Math.min(pixelHeight, imgHeight - clampedY));

        console.log(`[Vista Studio] Cropping: ${clampedX},${clampedY} ${clampedWidth}x${clampedHeight}`);

        processedBuffer = await sharp(imageBuffer)
          .extract({ left: clampedX, top: clampedY, width: clampedWidth, height: clampedHeight })
          .toBuffer();
      }

      console.log('[Vista Studio] Removing background...');
      const bgRemovedBuffer = await backgroundRemovalService.removeBackground(processedBuffer);
      console.log('[Vista Studio] Background removed');

      const squareBuffer = await this.makeSquareImage(bgRemovedBuffer, 1024);
      console.log('[Vista Studio] Image prepared (1024x1024)');

      const [category, ...styleParts] = template.split('-') as [CategoryType, ...string[]];
      const style = styleParts.join('-') as StyleType;
      const defaultPrompt = getTemplatePrompt(category, style);
      
      const finalPrompt = customPrompt && customPrompt.trim().length > 0
        ? this.sanitizePrompt(customPrompt)
        : defaultPrompt;
      
      console.log(`[Vista Studio] Using prompt (${customPrompt ? 'custom' : 'template'}): ${finalPrompt.substring(0, 100)}...`);

      const imageProvider = createImageProvider(provider, apiKey);
      const result = await imageProvider.generateImage(squareBuffer, finalPrompt, 1024);

      const finalBuffer = await sharp(result.imageBuffer)
        .png({ quality: 95 })
        .toBuffer();

      const dataUrl = `data:image/png;base64,${finalBuffer.toString('base64')}`;

      const elapsed = Date.now() - startTime;
      console.log(`[Vista Studio] ${provider} generation completed in ${elapsed}ms`);

      return { imageBuffer: finalBuffer, dataUrl };
    } catch (error: any) {
      console.error('[Vista Studio] Error:', error);
      
      const errorMessage = this.sanitizeError(error, provider);
      throw new Error(errorMessage);
    }
  }

  private sanitizePrompt(prompt: string): string {
    // Limit length to 1000 characters
    let sanitized = prompt.slice(0, 1000);
    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    // Trim whitespace
    sanitized = sanitized.trim();
    return sanitized;
  }

  private sanitizeError(error: any, provider: 'openai' | 'google' = 'openai'): string {
    const message = error?.message || 'Unknown error';
    const providerName = provider === 'google' ? 'Google Nano Banana Pro' : 'OpenAI DALL-E';
    
    if (message.includes('rate_limit') || message.includes('Rate limit') || message.includes('RESOURCE_EXHAUSTED')) {
      return 'AI service is busy. Please try again in a few moments.';
    }
    if (message.includes('invalid_api_key') || message.includes('API key') || message.includes('INVALID_ARGUMENT')) {
      return `${providerName} API key is invalid or expired. Please check your settings.`;
    }
    if (message.includes('content_policy') || message.includes('safety') || message.includes('SAFETY')) {
      return 'The image could not be processed due to content policy. Please try a different image.';
    }
    if (message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('DEADLINE_EXCEEDED')) {
      return 'AI service timed out. Please try again.';
    }
    if (message.includes('billing') || message.includes('quota') || message.includes('PERMISSION_DENIED')) {
      return `${providerName} account has insufficient credits or permissions. Please check your billing settings.`;
    }
    
    if (message.includes('background')) {
      return 'Failed to process image background. Please try a different image.';
    }
    
    return 'Failed to generate image. Please try again or contact support.';
  }

  private async makeSquareImage(buffer: Buffer, size: number): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || size;
    const height = metadata.height || size;

    const scale = Math.min((size * 0.7) / width, (size * 0.7) / height);
    const scaledWidth = Math.round(width * scale);
    const scaledHeight = Math.round(height * scale);

    const resized = await sharp(buffer)
      .resize(scaledWidth, scaledHeight, { fit: 'inside' })
      .png()
      .toBuffer();

    const finalBuffer = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: resized,
          left: Math.round((size - scaledWidth) / 2),
          top: Math.round((size - scaledHeight) / 2),
        },
      ])
      .png()
      .toBuffer();

    return finalBuffer;
  }

  getAvailableTemplates() {
    return {
      categories: Object.entries(CATEGORIES).map(([id, config]) => ({
        id: id as CategoryType,
        name: config.name,
        icon: config.icon,
        description: config.description,
      })),
      styles: Object.entries(STYLES).map(([id, config]) => ({
        id: id as StyleType,
        name: config.name,
        description: config.description,
      })),
      getPrompt: (category: CategoryType, style: StyleType) => buildTemplatePrompt(category, style),
    };
  }
  
  getTemplatePrompt(category: CategoryType, style: StyleType): string {
    return buildTemplatePrompt(category, style);
  }

  async createJob(
    businessAccountId: string,
    templateId: TemplateType,
    prompt: string,
    originalImageBuffer: Buffer,
    provider: 'openai' | 'google' = 'openai'
  ): Promise<string> {
    const filename = `original-${Date.now()}.png`;
    const uploadResult = await r2Storage.uploadFile(
      originalImageBuffer,
      filename,
      'vista-studio/originals',
      'image/png',
      businessAccountId
    );

    if (!uploadResult.success || !uploadResult.url) {
      throw new Error('Failed to upload original image');
    }

    const [job] = await db.insert(vistaStudioJobs).values({
      businessAccountId,
      templateId,
      prompt,
      originalImageUrl: uploadResult.url,
      status: 'pending',
      provider,
    }).returning();

    return job.id;
  }

  async createJobFromUrl(
    businessAccountId: string,
    templateId: string,
    prompt: string,
    originalImageUrl: string,
    provider: 'openai' | 'google' = 'openai'
  ): Promise<{ id: string }> {
    const [job] = await db.insert(vistaStudioJobs).values({
      businessAccountId,
      templateId,
      prompt,
      originalImageUrl,
      status: 'pending',
      provider,
    }).returning();

    return job;
  }

  async getJob(jobId: string, businessAccountId: string) {
    const [job] = await db.select()
      .from(vistaStudioJobs)
      .where(and(
        eq(vistaStudioJobs.id, jobId),
        eq(vistaStudioJobs.businessAccountId, businessAccountId)
      ));
    return job || null;
  }

  async getJobs(businessAccountId: string, limit: number = 20) {
    const jobs = await db.select()
      .from(vistaStudioJobs)
      .where(eq(vistaStudioJobs.businessAccountId, businessAccountId))
      .orderBy(desc(vistaStudioJobs.createdAt))
      .limit(limit);
    return jobs;
  }

  async processJob(jobId: string): Promise<void> {
    console.log(`[Vista Studio] Starting background job processing: ${jobId}`);
    
    let provider: 'openai' | 'google' = 'openai';
    
    try {
      await db.update(vistaStudioJobs)
        .set({ status: 'processing' })
        .where(eq(vistaStudioJobs.id, jobId));

      const [job] = await db.select()
        .from(vistaStudioJobs)
        .where(eq(vistaStudioJobs.id, jobId));

      if (!job) {
        console.error(`[Vista Studio] Job not found: ${jobId}`);
        return;
      }

      provider = (job.provider as 'openai' | 'google') || 'openai';

      const [account] = await db.select()
        .from(businessAccounts)
        .where(eq(businessAccounts.id, job.businessAccountId));

      let apiKey: string | undefined;

      if (provider === 'google') {
        if (!account?.googleNanoBananaApiKey) {
          throw new Error('Google Nano Banana Pro API key not configured. Please add your API key in Settings.');
        }
        try {
          apiKey = decrypt(account.googleNanoBananaApiKey);
        } catch (e) {
          throw new Error('Failed to decrypt Google API key. Please re-enter your API key in Settings.');
        }
      } else {
        if (!account?.openaiApiKey) {
          throw new Error('OpenAI API key not configured');
        }
        apiKey = account.openaiApiKey;
      }

      const originalImageResponse = await fetch(job.originalImageUrl);
      const originalImageBuffer = Buffer.from(await originalImageResponse.arrayBuffer());

      const result = await this.generateProductImage(
        originalImageBuffer,
        job.templateId as TemplateType,
        undefined,
        apiKey,
        job.prompt,
        provider
      );

      const generatedFilename = `generated-${Date.now()}.png`;
      const generatedUploadResult = await r2Storage.uploadFile(
        result.imageBuffer,
        generatedFilename,
        'vista-studio/generated',
        'image/png',
        job.businessAccountId
      );

      if (!generatedUploadResult.success || !generatedUploadResult.url) {
        throw new Error('Failed to upload generated image');
      }

      await db.update(vistaStudioJobs)
        .set({
          status: 'completed',
          generatedImageUrl: generatedUploadResult.url,
          completedAt: new Date(),
        })
        .where(eq(vistaStudioJobs.id, jobId));

      console.log(`[Vista Studio] Job completed: ${jobId}`);
    } catch (error: any) {
      console.error(`[Vista Studio] Job failed: ${jobId}`, error);
      
      const errorMessage = this.sanitizeError(error, provider);
      
      await db.update(vistaStudioJobs)
        .set({
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(vistaStudioJobs.id, jobId));
    }
  }

  async deleteJob(jobId: string, businessAccountId: string): Promise<boolean> {
    const result = await db.delete(vistaStudioJobs)
      .where(and(
        eq(vistaStudioJobs.id, jobId),
        eq(vistaStudioJobs.businessAccountId, businessAccountId)
      ));
    return true;
  }

  async recoverStuckJobs(): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const stuckJobs = await db.select()
      .from(vistaStudioJobs)
      .where(and(
        eq(vistaStudioJobs.status, 'processing'),
        sql`${vistaStudioJobs.createdAt} < ${fiveMinutesAgo}`
      ));

    if (stuckJobs.length === 0) {
      return 0;
    }

    console.log(`[Vista Studio] Found ${stuckJobs.length} stuck job(s) in 'processing' state. Marking as failed for retry.`);

    for (const job of stuckJobs) {
      await db.update(vistaStudioJobs)
        .set({
          status: 'failed',
          errorMessage: 'Job was interrupted due to server restart. Please retry.',
          completedAt: new Date(),
        })
        .where(eq(vistaStudioJobs.id, job.id));
      
      console.log(`[Vista Studio] Recovered stuck job: ${job.id}`);
    }

    return stuckJobs.length;
  }
}

export const jewelryImageGeneratorService = JewelryImageGeneratorService.getInstance();
