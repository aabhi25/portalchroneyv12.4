import imghash from 'imghash';

class ImageHashService {
  /**
   * Generate a perceptual hash (pHash) for an image
   * pHash captures the visual "fingerprint" of an image based on its structure
   * Same/similar images produce similar hashes, different images produce different hashes
   * 
   * @param imageInput - URL or base64 data URL of the image
   * @returns 16-character hexadecimal hash string
   */
  async generateHash(imageInput: string): Promise<string> {
    try {
      let imageBuffer: Buffer;

      if (imageInput.startsWith('data:')) {
        const base64Data = imageInput.split(',')[1];
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        const response = await fetch(imageInput);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      // Resize and convert to PNG format (imghash needs image with proper headers)
      const sharp = (await import('sharp')).default;
      const processedBuffer = await sharp(imageBuffer)
        .resize(64, 64, { fit: 'fill' })
        .grayscale()
        .png()
        .toBuffer();

      // Generate 64-bit perceptual hash (default returns 16-char hex string)
      const hexHash = await imghash.hash(processedBuffer);
      
      console.log(`[pHash] Generated hash: ${hexHash.substring(0, 8)}... (${hexHash.length} chars)`);
      return hexHash;
    } catch (error) {
      console.error('[pHash] Error generating hash:', error);
      throw error;
    }
  }

  /**
   * Calculate Hamming distance between two hashes
   * Lower distance = more similar images
   * 0-10: Very likely same image
   * 11-20: Possibly same image with modifications
   * 20+: Different images
   */
  calculateHammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      throw new Error('Hashes must be the same length');
    }

    let distance = 0;
    
    for (let i = 0; i < hash1.length; i++) {
      const byte1 = parseInt(hash1[i], 16);
      const byte2 = parseInt(hash2[i], 16);
      let xor = byte1 ^ byte2;
      while (xor > 0) {
        distance += xor & 1;
        xor >>= 1;
      }
    }

    return distance;
  }

  /**
   * Check if two images are perceptually identical
   * Uses Hamming distance with a threshold
   */
  areImagesSimilar(hash1: string, hash2: string, threshold: number = 10): boolean {
    const distance = this.calculateHammingDistance(hash1, hash2);
    return distance <= threshold;
  }

  /**
   * Get similarity percentage between two hashes
   * 100% = identical, 0% = completely different
   */
  getSimilarityPercentage(hash1: string, hash2: string): number {
    const distance = this.calculateHammingDistance(hash1, hash2);
    const maxDistance = hash1.length * 4;
    return Math.max(0, Math.round((1 - distance / maxDistance) * 100));
  }
}

export const imageHashService = new ImageHashService();
