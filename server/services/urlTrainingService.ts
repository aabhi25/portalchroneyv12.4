import OpenAI from "openai";
import * as cheerio from "cheerio";
import { storage } from "../storage";
import { aiUsageLogger } from "./aiUsageLogger";
import { chunkingService } from "./chunkingService";
import { embeddingService } from "./embeddingService";
import { db } from "../db";
import { trainedUrls, urlContentChunks } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

export interface ProcessedUrlResult {
  title: string;
  extractedText: string;
  summary: string;
  keyPoints: string[];
}

export class UrlTrainingService {
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    if (!businessAccount?.openaiApiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }

    return new OpenAI({ apiKey: businessAccount.openaiApiKey });
  }

  async crawlUrl(url: string): Promise<{ title: string; content: string; metaDescription: string }> {
    try {
      console.log(`[URL Training] Crawling URL: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      $('script, style, noscript, iframe, svg, nav, footer, header, [role="navigation"], [role="banner"], .cookie-banner, .cookie-notice, #cookie-banner').remove();

      const title = $('title').first().text().trim() || 
                   $('h1').first().text().trim() || 
                   $('meta[property="og:title"]').attr('content') || 
                   'Untitled Page';

      const metaDescription = $('meta[name="description"]').attr('content') || 
                              $('meta[property="og:description"]').attr('content') || 
                              '';

      const mainContent = $('main, article, [role="main"], .content, .main-content, #content, #main').first();
      let content = '';
      
      if (mainContent.length > 0) {
        content = mainContent.text();
      } else {
        content = $('body').text();
      }

      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      console.log(`[URL Training] Extracted ${content.length} characters from ${url}`);
      
      return { title, content, metaDescription };
    } catch (error: any) {
      console.error(`[URL Training] Error crawling ${url}:`, error.message);
      throw new Error(`Failed to crawl URL: ${error.message}`);
    }
  }

  async processWithAI(text: string, url: string, businessAccountId: string): Promise<{ summary: string; keyPoints: string[] }> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);

      const truncatedText = text.slice(0, 12000);

      const prompt = `Analyze this web page content and extract key information that would be useful for a customer support AI chatbot.

URL: ${url}

Content:
${truncatedText}

Provide a JSON response with:
1. "summary": A comprehensive summary of the page content (2-3 paragraphs) focusing on information useful for customer inquiries
2. "keyPoints": An array of key facts, details, and important information from this page that customers might ask about

Format:
{
  "summary": "Your summary here",
  "keyPoints": ["Point 1", "Point 2", "Point 3", ...]
}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert content analyzer. Extract key information, facts, and details from web pages that would help an AI assistant answer customer questions accurately. Focus on practical, actionable information.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      aiUsageLogger.logDocumentAnalysisUsage(businessAccountId, 'gpt-4o-mini', completion).catch(err =>
        console.error('[URL Training] Failed to log AI usage:', err)
      );

      const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
      
      return {
        summary: result.summary || 'No summary generated',
        keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : []
      };
    } catch (error: any) {
      console.error('[URL Training] Error processing with AI:', error.message);
      throw new Error(`Failed to analyze content: ${error.message}`);
    }
  }

  async chunkAndEmbedUrl(
    trainedUrlId: string,
    extractedText: string,
    businessAccountId: string
  ): Promise<void> {
    try {
      console.log(`[URL Training] Starting chunking and embedding for URL ${trainedUrlId}`);

      await db.update(trainedUrls)
        .set({ 
          embeddingStatus: 'processing',
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));

      await db.delete(urlContentChunks).where(
        eq(urlContentChunks.trainedUrlId, trainedUrlId)
      );

      const chunks = chunkingService.chunkText(extractedText);
      
      if (chunks.length === 0) {
        console.log(`[URL Training] No chunks generated for URL ${trainedUrlId}`);
        await db.update(trainedUrls)
          .set({ 
            embeddingStatus: 'completed',
            embeddedChunkCount: '0',
            embeddedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(trainedUrls.id, trainedUrlId));
        return;
      }

      console.log(`[URL Training] Generated ${chunks.length} chunks, generating embeddings...`);

      let embeddedCount = 0;
      for (const chunk of chunks) {
        try {
          const embedding = await embeddingService.generateEmbedding(chunk.text, businessAccountId);
          
          await db.insert(urlContentChunks).values({
            trainedUrlId,
            businessAccountId,
            chunkText: chunk.text,
            chunkIndex: chunk.index,
            embedding
          });
          
          embeddedCount++;
        } catch (err: any) {
          console.error(`[URL Training] Error embedding chunk ${chunk.index}:`, err.message);
        }
      }

      await db.update(trainedUrls)
        .set({ 
          embeddingStatus: 'completed',
          embeddedChunkCount: embeddedCount.toString(),
          embeddedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));

      console.log(`[URL Training] Completed embedding ${embeddedCount}/${chunks.length} chunks for URL ${trainedUrlId}`);
    } catch (error: any) {
      console.error(`[URL Training] Error in chunkAndEmbedUrl:`, error.message);
      
      await db.update(trainedUrls)
        .set({ 
          embeddingStatus: 'failed',
          errorMessage: error.message,
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));
      
      throw error;
    }
  }

  async processUrl(
    trainedUrlId: string,
    url: string,
    businessAccountId: string
  ): Promise<void> {
    try {
      console.log(`[URL Training] Processing URL: ${url}`);

      await db.update(trainedUrls)
        .set({ 
          status: 'crawling',
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));

      const { title, content, metaDescription } = await this.crawlUrl(url);

      if (!content || content.length < 50) {
        throw new Error('Insufficient content extracted from URL');
      }

      await db.update(trainedUrls)
        .set({ 
          status: 'processing',
          title,
          description: metaDescription || undefined,
          extractedText: content,
          crawledAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));

      const { summary, keyPoints } = await this.processWithAI(content, url, businessAccountId);

      await db.update(trainedUrls)
        .set({ 
          status: 'completed',
          summary,
          keyPoints: JSON.stringify(keyPoints),
          processedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));

      this.chunkAndEmbedUrl(trainedUrlId, content, businessAccountId).catch(err => {
        console.error(`[URL Training] Background embedding failed for ${trainedUrlId}:`, err.message);
      });

      console.log(`[URL Training] Successfully processed URL: ${url}`);
    } catch (error: any) {
      console.error(`[URL Training] Failed to process URL ${url}:`, error.message);
      
      await db.update(trainedUrls)
        .set({ 
          status: 'failed',
          errorMessage: error.message,
          updatedAt: new Date()
        })
        .where(eq(trainedUrls.id, trainedUrlId));
      
      throw error;
    }
  }

  async getTrainedUrls(businessAccountId: string): Promise<any[]> {
    return await db.select()
      .from(trainedUrls)
      .where(eq(trainedUrls.businessAccountId, businessAccountId))
      .orderBy(trainedUrls.createdAt);
  }

  async getTrainedUrl(id: string, businessAccountId: string): Promise<any | null> {
    const results = await db.select()
      .from(trainedUrls)
      .where(and(
        eq(trainedUrls.id, id),
        eq(trainedUrls.businessAccountId, businessAccountId)
      ))
      .limit(1);
    
    return results[0] || null;
  }

  async deleteTrainedUrl(id: string, businessAccountId: string): Promise<boolean> {
    const result = await db.delete(trainedUrls)
      .where(and(
        eq(trainedUrls.id, id),
        eq(trainedUrls.businessAccountId, businessAccountId)
      ));
    
    return true;
  }

  async reprocessUrl(id: string, businessAccountId: string): Promise<void> {
    const trainedUrl = await this.getTrainedUrl(id, businessAccountId);
    if (!trainedUrl) {
      throw new Error('Trained URL not found');
    }
    
    await this.processUrl(id, trainedUrl.url, businessAccountId);
  }
}

export const urlTrainingService = new UrlTrainingService();
