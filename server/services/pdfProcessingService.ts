import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { storage } from '../storage';
import { aiUsageLogger } from './aiUsageLogger';
import { chunkingService } from './chunkingService';
import { embeddingService } from './embeddingService';
import { db } from '../db';
import { documentChunks, trainingDocuments } from '../../shared/schema';
import { eq } from 'drizzle-orm';

export interface ProcessedPDFResult {
  extractedText: string;
  summary: string;
  keyPoints: string[];
}

export interface ResumeExtractionResult {
  status: 'success' | 'warning' | 'failed';
  text: string;
  extractionMethod: 'pdfjs' | 'pdf-parse' | 'vision';
  pageCount: number;
  warning?: string;
}

const MIN_CHARS_THRESHOLD = 50;
const VISION_MAX_PDF_SIZE = 5 * 1024 * 1024;
const VISION_MAX_PAGES = 3;

export class PDFProcessingService {
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    if (!businessAccount?.openaiApiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }

    return new OpenAI({ apiKey: businessAccount.openaiApiKey });
  }

  private async extractWithPdfjs(uint8Array: Uint8Array): Promise<{ text: string; pageCount: number }> {
    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDocument = await pdfjsLib.getDocument({
      data: uint8Array,
      standardFontDataUrl: path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
      verbosity: 0,
    }).promise;

    let extractedText = '';
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      extractedText += pageText + '\n';
    }
    return { text: extractedText, pageCount: pdfDocument.numPages };
  }

  private async extractWithPdfParse(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = pdfParseModule.default || (pdfParseModule as any).PDFParse || pdfParseModule;
    const result = await pdfParse(buffer);
    return { text: result.text || '', pageCount: result.numpages || 0 };
  }

  private async extractWithVision(buffer: Buffer, businessAccountId: string, pageCount: number): Promise<{ text: string; truncated: boolean }> {
    if (buffer.length > VISION_MAX_PDF_SIZE) {
      throw new Error(`PDF too large for AI vision extraction (${Math.round(buffer.length / 1024 / 1024)}MB, max ${Math.round(VISION_MAX_PDF_SIZE / 1024 / 1024)}MB)`);
    }
    if (pageCount > VISION_MAX_PAGES) {
      console.log(`[PDF Vision] Page cap: processing first ${VISION_MAX_PAGES} of ${pageCount} pages`);
    }
    const pagesToProcess = Math.min(pageCount, VISION_MAX_PAGES);
    console.log(`[PDF Vision] Starting AI vision extraction for ${pagesToProcess} page(s) (${Math.round(buffer.length / 1024)}KB)`);
    const openai = await this.getOpenAIClient(businessAccountId);
    const sharp = (await import('sharp')).default;
    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const uint8Array = new Uint8Array(buffer);
    const pdfDocument = await pdfjsLib.getDocument({
      data: uint8Array,
      standardFontDataUrl: path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
      verbosity: 0,
    }).promise;

    const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });

      const { createCanvas } = await import('canvas');
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context as any, viewport }).promise;
      const pngBuffer = canvas.toBuffer('image/png');

      const compressedBuffer = await sharp(pngBuffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      imageContents.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`,
          detail: 'high',
        },
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a resume/CV text extractor. Extract ALL text content from the provided resume page image(s). Preserve the structure as much as possible (sections, bullet points, dates, contact info, skills, experience, education). Return ONLY the extracted text, no commentary or formatting markers.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Extract all text from this ${pagesToProcess}-page resume:` },
            ...imageContents,
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4000,
    });

    aiUsageLogger.logDocumentAnalysisUsage(businessAccountId, 'gpt-4o', completion).catch(err =>
      console.error('[Usage] Failed to log vision usage:', err)
    );

    const extractedText = completion.choices[0]?.message?.content || '';
    console.log(`[PDF Vision] Extracted ${extractedText.length} chars via vision`);
    return { text: extractedText, truncated: pageCount > VISION_MAX_PAGES };
  }

  private passesQualityGate(text: string, pageCount: number): boolean {
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS_THRESHOLD) return false;
    if (pageCount > 0 && trimmed.length / pageCount < 20) return false;
    return true;
  }

  async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const uint8Array = new Uint8Array(dataBuffer);
      const { text } = await this.extractWithPdfjs(uint8Array);
      return text;
    } catch (error: any) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  async extractTextFromBuffer(buffer: Buffer): Promise<string> {
    try {
      const uint8Array = new Uint8Array(buffer);
      const { text } = await this.extractWithPdfjs(uint8Array);
      return text;
    } catch (error: any) {
      console.error('Error extracting text from PDF buffer:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  async extractTextFromBufferMultiTier(buffer: Buffer, businessAccountId?: string, visionRateLimitCheck?: () => boolean): Promise<ResumeExtractionResult> {
    let pageCount = 0;

    try {
      const uint8Array = new Uint8Array(buffer);
      const pdfjsResult = await this.extractWithPdfjs(uint8Array);
      pageCount = pdfjsResult.pageCount;

      if (this.passesQualityGate(pdfjsResult.text, pdfjsResult.pageCount)) {
        console.log(`[PDF Extract] Tier 1 (pdfjs) success: ${pdfjsResult.text.trim().length} chars, ${pdfjsResult.pageCount} pages`);
        return {
          status: 'success',
          text: pdfjsResult.text.trim(),
          extractionMethod: 'pdfjs',
          pageCount: pdfjsResult.pageCount,
        };
      }
      console.log(`[PDF Extract] Tier 1 (pdfjs) insufficient: ${pdfjsResult.text.trim().length} chars`);
    } catch (err: any) {
      console.log(`[PDF Extract] Tier 1 (pdfjs) failed: ${err.message}`);
    }

    try {
      const parseResult = await this.extractWithPdfParse(buffer);
      pageCount = parseResult.pageCount || pageCount;

      if (this.passesQualityGate(parseResult.text, parseResult.pageCount)) {
        console.log(`[PDF Extract] Tier 2 (pdf-parse) success: ${parseResult.text.trim().length} chars, ${parseResult.pageCount} pages`);
        return {
          status: 'success',
          text: parseResult.text.trim(),
          extractionMethod: 'pdf-parse',
          pageCount: parseResult.pageCount,
        };
      }
      console.log(`[PDF Extract] Tier 2 (pdf-parse) insufficient: ${parseResult.text.trim().length} chars`);
    } catch (err: any) {
      console.log(`[PDF Extract] Tier 2 (pdf-parse) failed: ${err.message}`);
    }

    if (businessAccountId) {
      const visionAllowed = !visionRateLimitCheck || visionRateLimitCheck();
      if (!visionAllowed) {
        console.log(`[PDF Extract] Tier 3 (vision) skipped: vision rate limit exceeded`);
        return {
          status: 'failed',
          text: '',
          extractionMethod: 'pdfjs',
          pageCount: pageCount || 0,
          warning: 'Could not extract text from this PDF using standard methods. AI vision processing is temporarily unavailable due to rate limiting. Please try again in a minute.',
        };
      }
      try {
        const visionResult = await this.extractWithVision(buffer, businessAccountId, pageCount || 1);
        if (this.passesQualityGate(visionResult.text, pageCount || 1)) {
          console.log(`[PDF Extract] Tier 3 (vision) success: ${visionResult.text.trim().length} chars`);
          return {
            status: visionResult.truncated ? 'warning' : 'success',
            text: visionResult.text.trim(),
            extractionMethod: 'vision',
            pageCount: pageCount || 1,
            warning: visionResult.truncated
              ? `Only the first ${VISION_MAX_PAGES} of ${pageCount} pages were processed via AI vision.`
              : undefined,
          };
        }
      } catch (err: any) {
        console.error(`[PDF Extract] Tier 3 (vision) failed: ${err.message}`);
      }
    }

    return {
      status: 'failed',
      text: '',
      extractionMethod: 'pdfjs',
      pageCount: pageCount || 0,
      warning: 'Could not extract text from this PDF. The file may be corrupted or in an unsupported format.',
    };
  }

  async processWithAI(text: string, businessAccountId: string, filename: string): Promise<{ summary: string; keyPoints: string[] }> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);

      const truncatedText = text.slice(0, 12000);

      const prompt = `Analyze this document (${filename}) and provide:
1. A comprehensive summary (2-3 paragraphs)
2. Key points and important information (as a list)

Document content:
${truncatedText}

Provide a JSON response in this format:
{
  "summary": "Your summary here",
  "keyPoints": ["Point 1", "Point 2", "Point 3", ...]
}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert document analyzer. Extract key information, summaries, and important points from documents to help AI assistants provide accurate information to customers.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      // Log AI usage (fire-and-forget)
      aiUsageLogger.logDocumentAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      return {
        summary: result.summary || 'No summary generated',
        keyPoints: result.keyPoints || []
      };
    } catch (error: any) {
      console.error('Error processing PDF with AI:', error);
      throw new Error(`Failed to process PDF with AI: ${error.message}`);
    }
  }

  async processDocument(
    documentId: string,
    filePath: string,
    businessAccountId: string,
    filename: string
  ): Promise<void> {
    try {
      await storage.updateTrainingDocumentStatus(documentId, 'processing');

      const extractedText = await this.extractTextFromPDF(filePath);

      const { summary, keyPoints } = await this.processWithAI(
        extractedText,
        businessAccountId,
        filename
      );

      await storage.updateTrainingDocumentContent(
        documentId,
        extractedText,
        summary,
        JSON.stringify(keyPoints)
      );

      await storage.updateTrainingDocumentStatus(documentId, 'completed');

      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.error('Error deleting temp file:', unlinkError);
      }

      // Chunk and embed the document in the background (fire-and-forget)
      // This doesn't block the main processing flow
      this.chunkAndEmbedDocument(documentId, extractedText, businessAccountId).catch(err => {
        console.error(`[PDF] Failed to chunk/embed document ${documentId}:`, err);
      });

    } catch (error: any) {
      console.error('Error processing document:', error);
      await storage.updateTrainingDocumentStatus(
        documentId,
        'failed',
        error.message
      );

      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.error('Error deleting temp file after failure:', unlinkError);
      }

      throw error;
    }
  }

  async processDocumentFromBuffer(
    documentId: string,
    buffer: Buffer,
    businessAccountId: string,
    filename: string
  ): Promise<void> {
    try {
      await storage.updateTrainingDocumentStatus(documentId, 'processing');

      const extractedText = await this.extractTextFromBuffer(buffer);

      const { summary, keyPoints } = await this.processWithAI(
        extractedText,
        businessAccountId,
        filename
      );

      await storage.updateTrainingDocumentContent(
        documentId,
        extractedText,
        summary,
        JSON.stringify(keyPoints)
      );

      await storage.updateTrainingDocumentStatus(documentId, 'completed');

      this.chunkAndEmbedDocument(documentId, extractedText, businessAccountId).catch(err => {
        console.error(`[PDF] Failed to chunk/embed document ${documentId}:`, err);
      });

    } catch (error: any) {
      console.error('Error processing document from buffer:', error);
      await storage.updateTrainingDocumentStatus(
        documentId,
        'failed',
        error.message
      );
      throw error;
    }
  }

  /**
   * Chunk extracted text and generate embeddings for RAG
   * This runs in the background after PDF processing completes
   */
  private async chunkAndEmbedDocument(
    documentId: string,
    extractedText: string,
    businessAccountId: string
  ): Promise<void> {
    try {
      console.log(`[PDF] Starting chunking and embedding for document ${documentId}`);

      // Mark as processing
      await db.update(trainingDocuments)
        .set({ 
          embeddingStatus: 'processing',
          updatedAt: new Date()
        })
        .where(eq(trainingDocuments.id, documentId));

      // Delete any existing chunks for this document (in case of re-processing)
      await db.delete(documentChunks).where(
        eq(documentChunks.trainingDocumentId, documentId)
      );

      // Split text into chunks
      const chunks = chunkingService.chunkText(extractedText);
      
      if (chunks.length === 0) {
        console.log(`[PDF] No chunks generated for document ${documentId} (empty text)`);
        await db.update(trainingDocuments)
          .set({ 
            embeddingStatus: 'completed',
            embeddedChunkCount: '0',
            embeddedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(trainingDocuments.id, documentId));
        return;
      }

      console.log(`[PDF] Generated ${chunks.length} chunks for document ${documentId}`);

      // Generate embeddings for all chunks in batches
      const chunkTexts = chunks.map(c => c.text);
      const embeddings = await embeddingService.generateBatchEmbeddings(
        chunkTexts,
        businessAccountId,
        100 // Process 100 chunks per API call
      );

      // Save chunks with embeddings to database
      const chunkRecords = chunks.map((chunk, idx) => ({
        trainingDocumentId: documentId,
        businessAccountId,
        chunkText: chunk.text,
        chunkIndex: chunk.index,
        embedding: embeddings[idx],
      }));

      // Insert in batches to avoid query size limits
      const batchSize = 50;
      for (let i = 0; i < chunkRecords.length; i += batchSize) {
        const batch = chunkRecords.slice(i, i + batchSize);
        await db.insert(documentChunks).values(batch);
      }

      // Mark as completed with chunk count
      await db.update(trainingDocuments)
        .set({ 
          embeddingStatus: 'completed',
          embeddedChunkCount: chunks.length.toString(),
          embeddedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(trainingDocuments.id, documentId));

      console.log(`[PDF] Successfully embedded ${chunks.length} chunks for document ${documentId}`);
    } catch (error: any) {
      console.error(`[PDF] Error chunking/embedding document ${documentId}:`, error);
      
      // Mark as failed
      await db.update(trainingDocuments)
        .set({ 
          embeddingStatus: 'failed',
          errorMessage: error.message,
          updatedAt: new Date()
        })
        .where(eq(trainingDocuments.id, documentId));
    }
  }

  /**
   * Manually trigger chunking and embedding for an existing document
   * Useful for migrating old documents or re-processing
   */
  async embedExistingDocument(documentId: string, businessAccountId: string): Promise<void> {
    const document = await storage.getTrainingDocument(documentId, businessAccountId);
    
    if (!document) {
      throw new Error('Document not found');
    }

    if (document.uploadStatus !== 'completed') {
      throw new Error('Document processing not completed');
    }

    if (!document.extractedText) {
      throw new Error('No extracted text available');
    }

    await this.chunkAndEmbedDocument(documentId, document.extractedText, businessAccountId);
  }
}

export const pdfProcessingService = new PDFProcessingService();
