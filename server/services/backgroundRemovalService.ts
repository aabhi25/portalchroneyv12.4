export class BackgroundRemovalService {
  private static instance: BackgroundRemovalService;

  static getInstance(): BackgroundRemovalService {
    if (!BackgroundRemovalService.instance) {
      BackgroundRemovalService.instance = new BackgroundRemovalService();
    }
    return BackgroundRemovalService.instance;
  }

  async removeBackground(imageInput: Buffer, mimeType: string = 'image/jpeg'): Promise<Buffer> {
    try {
      console.log('[Background Removal] Processing image...');
      const startTime = Date.now();

      const { removeBackground } = await import("@imgly/background-removal-node");
      const blob = new Blob([imageInput], { type: mimeType });

      const result = await removeBackground(blob, {
        model: 'small',
        output: {
          format: 'image/png',
          quality: 0.9,
        },
      });

      const arrayBuffer = await result.arrayBuffer();
      const resultBuffer = Buffer.from(arrayBuffer);

      const elapsed = Date.now() - startTime;
      console.log(`[Background Removal] Completed in ${elapsed}ms, output size: ${resultBuffer.length} bytes`);

      return resultBuffer;
    } catch (error) {
      console.error('[Background Removal] Error:', error);
      throw error;
    }
  }

  async removeBackgroundFromDataUrl(dataUrl: string): Promise<string> {
    try {
      const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const inputBuffer = Buffer.from(base64Data, 'base64');

      const resultBuffer = await this.removeBackground(inputBuffer, mimeType);

      const resultBase64 = resultBuffer.toString('base64');
      return `data:image/png;base64,${resultBase64}`;
    } catch (error) {
      console.error('[Background Removal] Error processing data URL:', error);
      throw error;
    }
  }
}

export const backgroundRemovalService = BackgroundRemovalService.getInstance();
