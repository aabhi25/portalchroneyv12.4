import { DetectedJewelry } from './jewelryDetectionService';

export interface CroppedImage {
  type: string;
  croppedDataUrl: string;
  originalBoundingBox: DetectedJewelry['boundingBox'];
  description: string;
}

const PADDING_BY_TYPE: Record<string, number> = {
  'necklace': 8,
  'earring': 12,
  'earring-pair': 12,
  'pendant': 10,
  'maang-tikka': 10,
  'nose-ring': 8,
  'chain': 6,
  'ring': 5,
  'bracelet': 6,
  'bangle': 5,
  'anklet': 8,
  'brooch': 6,
  'waist-chain': 8,
};

const BOTTOM_PADDING_OVERRIDE: Record<string, number> = {
  'necklace': 50,
};

const DEFAULT_PADDING = 8;
const MIN_CROP_SIZE = 25;

class ImageCroppingService {
  private getPaddingForType(type: string): number {
    const normalizedType = type.toLowerCase().replace(/\s+/g, '-');
    return PADDING_BY_TYPE[normalizedType] || DEFAULT_PADDING;
  }
  
  private getBottomPaddingForType(type: string): number | null {
    const normalizedType = type.toLowerCase().replace(/\s+/g, '-');
    return BOTTOM_PADDING_OVERRIDE[normalizedType] || null;
  }

  private applyPadding(
    boundingBox: { x: number; y: number; width: number; height: number; bottomAnchorY?: number },
    type: string,
    imgWidth: number,
    imgHeight: number
  ): { x: number; y: number; width: number; height: number; usedBottomAnchor: boolean } {
    const paddingPercent = this.getPaddingForType(type);
    const bottomPaddingOverride = this.getBottomPaddingForType(type);
    
    const xPadding = (boundingBox.width * paddingPercent) / 100;
    const topPadding = (boundingBox.height * paddingPercent) / 100;
    
    let bottomY: number;
    let usedBottomAnchor = false;
    
    if (boundingBox.bottomAnchorY !== undefined && type.toLowerCase().includes('necklace')) {
      const boundingBoxBottom = boundingBox.y + boundingBox.height;
      const anchorBelowBox = boundingBox.bottomAnchorY - boundingBoxBottom;
      
      if (anchorBelowBox < 5) {
        const safetyPadding = 15;
        bottomY = Math.min(100, boundingBoxBottom + safetyPadding);
        usedBottomAnchor = false;
        console.log(`[Image Cropping] AI bottomAnchorY (${boundingBox.bottomAnchorY}%) too close to box bottom (${boundingBoxBottom.toFixed(1)}%) - adding ${safetyPadding}% safety padding`);
      } else {
        const margin = (boundingBox.height * 5) / 100;
        bottomY = Math.min(100, boundingBox.bottomAnchorY + margin);
        usedBottomAnchor = true;
        console.log(`[Image Cropping] Using AI-detected bottomAnchorY: ${boundingBox.bottomAnchorY}% (with ${margin.toFixed(1)}% margin)`);
      }
    } else {
      const bottomPaddingPercent = bottomPaddingOverride !== null ? bottomPaddingOverride : paddingPercent;
      const bottomPadding = (boundingBox.height * bottomPaddingPercent) / 100;
      bottomY = boundingBox.y + boundingBox.height + bottomPadding;
    }
    
    const paddedX = Math.max(0, boundingBox.x - xPadding);
    const paddedY = Math.max(0, boundingBox.y - topPadding);
    const paddedWidth = Math.min(100 - paddedX, boundingBox.width + (2 * xPadding));
    const paddedHeight = Math.min(100 - paddedY, bottomY - paddedY);
    
    return {
      x: paddedX,
      y: paddedY,
      width: paddedWidth,
      height: paddedHeight,
      usedBottomAnchor
    };
  }

  private bufferToDataUrl(buffer: Buffer, mimeType: string = 'image/jpeg'): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  async cropJewelryFromUrl(
    imageUrl: string,
    detectedItems: DetectedJewelry[]
  ): Promise<CroppedImage[]> {
    if (detectedItems.length === 0) {
      return [];
    }

    try {
      let finalImageUrl = imageUrl;
      if (process.env.NODE_ENV === 'development' && imageUrl.startsWith('/')) {
        const domain = process.env.APP_DOMAIN || process.env.REPLIT_DEV_DOMAIN || 'localhost:5000';
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        finalImageUrl = `${protocol}://${domain}${imageUrl}`;
        console.log('[Image Cropping] Mapping relative URL to absolute for fetch:', finalImageUrl);
      }

      const imageResponse = await fetch(finalImageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const inputBuffer = Buffer.from(imageBuffer);
      
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(inputBuffer).metadata();
      const imgWidth = metadata.width || 0;
      const imgHeight = metadata.height || 0;

      if (imgWidth === 0 || imgHeight === 0) {
        throw new Error('Could not determine image dimensions');
      }

      const croppedImages: CroppedImage[] = [];

      for (const item of detectedItems) {
        const { boundingBox, type, description } = item;
        
        const paddedBox = this.applyPadding(boundingBox, type, imgWidth, imgHeight);
        const paddingUsed = this.getPaddingForType(type);
        const bottomPaddingUsed = this.getBottomPaddingForType(type);
        
        const x = Math.round((paddedBox.x / 100) * imgWidth);
        const y = Math.round((paddedBox.y / 100) * imgHeight);
        const width = Math.round((paddedBox.width / 100) * imgWidth);
        const height = Math.round((paddedBox.height / 100) * imgHeight);

        const safeX = Math.max(0, x);
        const safeY = Math.max(0, y);
        const safeWidth = Math.min(width, imgWidth - safeX);
        const safeHeight = Math.min(height, imgHeight - safeY);

        if (safeWidth < MIN_CROP_SIZE || safeHeight < MIN_CROP_SIZE) {
          console.log(`[Image Cropping] Skipping small crop for ${type}: ${safeWidth}x${safeHeight}px (min: ${MIN_CROP_SIZE}px)`);
          continue;
        }

        const croppedBuffer = await sharp(inputBuffer)
          .extract({ left: safeX, top: safeY, width: safeWidth, height: safeHeight })
          .jpeg({ quality: 90 })
          .toBuffer();

        const croppedDataUrl = this.bufferToDataUrl(croppedBuffer);

        croppedImages.push({
          type,
          croppedDataUrl,
          originalBoundingBox: boundingBox,
          description
        });

        let paddingInfo: string;
        if (paddedBox.usedBottomAnchor) {
          paddingInfo = `AI-detected bottom anchor (bottomAnchorY: ${boundingBox.bottomAnchorY}%)`;
        } else if (bottomPaddingUsed !== null) {
          paddingInfo = `fallback padding: ${paddingUsed}% top/sides, ${bottomPaddingUsed}% bottom`;
        } else {
          paddingInfo = `padding: ${paddingUsed}%`;
        }
        console.log(`[Image Cropping] Cropped ${type}: ${safeWidth}x${safeHeight}px (${paddingInfo})`);
      }

      return croppedImages;
    } catch (error: any) {
      console.error('[Image Cropping] Error:', error);
      throw error;
    }
  }

  async cropSingleRegion(
    imageUrl: string,
    boundingBox: { x: number; y: number; width: number; height: number }
  ): Promise<string> {
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const inputBuffer = Buffer.from(imageBuffer);
      
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(inputBuffer).metadata();
      const imgWidth = metadata.width || 0;
      const imgHeight = metadata.height || 0;

      if (imgWidth === 0 || imgHeight === 0) {
        throw new Error('Could not determine image dimensions');
      }

      const x = Math.round((boundingBox.x / 100) * imgWidth);
      const y = Math.round((boundingBox.y / 100) * imgHeight);
      const width = Math.round((boundingBox.width / 100) * imgWidth);
      const height = Math.round((boundingBox.height / 100) * imgHeight);

      const safeX = Math.max(0, x);
      const safeY = Math.max(0, y);
      const safeWidth = Math.min(width, imgWidth - safeX);
      const safeHeight = Math.min(height, imgHeight - safeY);

      const croppedBuffer = await sharp(inputBuffer)
        .extract({ left: safeX, top: safeY, width: safeWidth, height: safeHeight })
        .jpeg({ quality: 90 })
        .toBuffer();

      return this.bufferToDataUrl(croppedBuffer);
    } catch (error: any) {
      console.error('[Image Cropping] Error in single region crop:', error);
      throw error;
    }
  }
}

export const imageCroppingService = new ImageCroppingService();
