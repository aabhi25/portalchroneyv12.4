import { storage } from '../storage';
import type { ProductImportJob } from '@shared/schema';

interface ParsedProductRow {
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
  categories: string[];
  tags: string[];
}

interface ImportJobData {
  jobId: string;
  businessAccountId: string;
  rows: ParsedProductRow[];
  fileName?: string;
  fileSize?: number;
}

class BulkImportService {
  private processingJobs: Set<string> = new Set();
  private embeddingQueue: Array<{ productId: string; imageUrl: string; name: string; businessAccountId: string; jobId: string }> = [];
  private embeddingQueueIndex: number = 0;
  private isProcessingEmbeddings: boolean = false;
  private readonly BATCH_SIZE = 500;
  private readonly EMBEDDINGS_PER_BATCH = 2;
  private readonly DELAY_BETWEEN_BATCHES_MS = 2000;
  private readonly PRODUCTS_PER_TICK = 50;

  async parseExcelData(buffer: Buffer): Promise<ParsedProductRow[]> {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];

    return data.map((row: any) => {
      const rowData: any = {};
      for (const key in row) {
        rowData[key.toLowerCase().trim()] = row[key];
      }

      const name = rowData['name'] || rowData['product name'] || rowData['title'] || '';
      const description = rowData['description'] || rowData['desc'] || '';
      const price = rowData['price'] || rowData['cost'] || null;
      const imageUrl = rowData['image'] || rowData['image url'] || rowData['imageurl'] || null;
      const categoriesStr = rowData['categories'] || rowData['category'] || '';
      const tagsStr = rowData['tags'] || rowData['tag'] || '';

      return {
        name: String(name).trim(),
        description: String(description).trim(),
        price: price ? String(price) : null,
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
        categories: categoriesStr 
          ? String(categoriesStr).split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0)
          : [],
        tags: tagsStr
          ? String(tagsStr).split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0)
          : [],
      };
    }).filter(row => row.name.length > 0);
  }

  async createImportJob(businessAccountId: string, buffer: Buffer, fileName?: string): Promise<ProductImportJob> {
    const rows = await this.parseExcelData(buffer);
    
    const job = await storage.createProductImportJob({
      businessAccountId,
      status: 'pending',
      totalRows: rows.length,
      processedRows: 0,
      successCount: 0,
      errorCount: 0,
      totalEmbeddings: 0,
      processedEmbeddings: 0,
      fileName: fileName || 'import.xlsx',
      fileSize: buffer.length,
      errors: [],
    });

    setImmediate(() => {
      this.startBackgroundProcessing({
        jobId: job.id,
        businessAccountId,
        rows,
        fileName,
        fileSize: buffer.length,
      });
    });

    return job;
  }

  private async startBackgroundProcessing(data: ImportJobData): Promise<void> {
    const { jobId, businessAccountId, rows } = data;

    if (this.processingJobs.has(jobId)) {
      console.log(`[BulkImport] Job ${jobId} already processing`);
      return;
    }

    this.processingJobs.add(jobId);

    try {
      await storage.updateProductImportJob(jobId, {
        status: 'processing',
        startedAt: new Date(),
      });

      console.log(`[BulkImport] Starting job ${jobId} with ${rows.length} rows`);

      // Check if AI product processing is enabled for this business account
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      const aiProcessingEnabled = businessAccount?.aiProductProcessingEnabled === "true";
      
      if (!aiProcessingEnabled) {
        console.log(`[BulkImport] AI product processing is disabled for business ${businessAccountId}, skipping embeddings`);
      }

      const allCategories = await storage.getAllCategories(businessAccountId);
      const allTags = await storage.getAllTags(businessAccountId);
      
      const categoryCache = new Map<string, string>();
      const tagCache = new Map<string, string>();
      
      allCategories.forEach(c => categoryCache.set(c.name.toLowerCase(), c.id));
      allTags.forEach(t => tagCache.set(t.name.toLowerCase(), t.id));

      let successCount = 0;
      let errorCount = 0;
      const errors: Array<{ row: number; error: string }> = [];
      let productsWithImages = 0;
      let processedRows = 0;

      for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
        const currentJob = await storage.getProductImportJob(jobId, businessAccountId);
        if (currentJob?.status === 'cancelled') {
          console.log(`[BulkImport] Job ${jobId} was cancelled`);
          break;
        }

        const batch = rows.slice(i, i + this.BATCH_SIZE);
        const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(rows.length / this.BATCH_SIZE);
        
        console.log(`[BulkImport] Processing batch ${batchNumber}/${totalBatches} (${batch.length} products)`);

        for (let j = 0; j < batch.length; j += this.PRODUCTS_PER_TICK) {
          const tickBatch = batch.slice(j, j + this.PRODUCTS_PER_TICK);
          
          await new Promise<void>(resolve => setImmediate(resolve));
          
          await Promise.all(tickBatch.map(async (row, idx) => {
            const rowIndex = i + j + idx + 1;
            
            try {
              const product = await storage.createProduct({
                businessAccountId,
                name: row.name,
                description: row.description,
                price: row.price || undefined,
                imageUrl: row.imageUrl || undefined,
                source: 'manual',
                isEditable: 'true',
              });

              for (const categoryName of row.categories) {
                try {
                  const catKey = categoryName.toLowerCase();
                  let categoryId = categoryCache.get(catKey);
                  
                  if (!categoryId) {
                    const category = await storage.createCategory({
                      businessAccountId,
                      name: categoryName,
                    });
                    categoryId = category.id;
                    categoryCache.set(catKey, categoryId);
                  }

                  await storage.assignProductToCategory(product.id, categoryId);
                } catch (catError: any) {
                  console.error(`[BulkImport] Category error row ${rowIndex}:`, catError.message);
                }
              }

              for (const tagName of row.tags) {
                try {
                  const tagKey = tagName.toLowerCase();
                  let tagId = tagCache.get(tagKey);
                  
                  if (!tagId) {
                    const tag = await storage.createTag({
                      businessAccountId,
                      name: tagName,
                    });
                    tagId = tag.id;
                    tagCache.set(tagKey, tagId);
                  }

                  await storage.assignProductToTag(product.id, tagId);
                } catch (tagError: any) {
                  console.error(`[BulkImport] Tag error row ${rowIndex}:`, tagError.message);
                }
              }

              if (product.imageUrl && aiProcessingEnabled) {
                // Only queue embeddings if AI processing is enabled
                this.queueEmbedding(product.id, product.imageUrl, product.name, businessAccountId, jobId);
                productsWithImages++;
              }

              successCount++;
            } catch (error: any) {
              errorCount++;
              if (errors.length < 100) {
                errors.push({ row: rowIndex, error: error.message });
              }
              console.error(`[BulkImport] Failed row ${rowIndex}:`, error.message);
            }
            
            processedRows++;
          }));
        }

        await storage.updateProductImportJob(jobId, {
          processedRows,
          successCount,
          errorCount,
          totalEmbeddings: productsWithImages,
          errors: errors.slice(0, 100),
        });
      }

      const finalJob = await storage.getProductImportJob(jobId, businessAccountId);
      if (finalJob?.status !== 'cancelled') {
        await storage.updateProductImportJob(jobId, {
          status: 'completed',
          completedAt: new Date(),
          processedRows: rows.length,
          successCount,
          errorCount,
          totalEmbeddings: productsWithImages,
          errors: errors.slice(0, 100),
        });
      }

      console.log(`[BulkImport] Job ${jobId} completed: ${successCount} success, ${errorCount} errors`);

    } catch (error: any) {
      console.error(`[BulkImport] Job ${jobId} failed:`, error);
      await storage.updateProductImportJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
        errors: [{ row: 0, error: error.message }],
      });
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  private queueEmbedding(productId: string, imageUrl: string, name: string, businessAccountId: string, jobId: string): void {
    this.embeddingQueue.push({ productId, imageUrl, name, businessAccountId, jobId });
    
    if (!this.isProcessingEmbeddings) {
      this.processEmbeddingQueue();
    }
  }

  private async embedWithRetry(
    productImageEmbeddingService: any,
    item: { productId: string; imageUrl: string; name: string; businessAccountId: string; jobId: string },
    useJewelryDetection: boolean = false,
    maxRetries: number = 5
  ): Promise<{ success: boolean; jobId: string; businessAccountId: string }> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (useJewelryDetection) {
          await productImageEmbeddingService.detectAndEmbedProduct(
            item.productId,
            item.imageUrl,
            item.name,
            item.businessAccountId
          );
        } else {
          await productImageEmbeddingService.embedProduct(
            item.productId,
            item.imageUrl,
            item.name,
            item.businessAccountId
          );
        }
        return { success: true, jobId: item.jobId, businessAccountId: item.businessAccountId };
      } catch (error: any) {
        lastError = error;
        const isRateLimit = error.message?.includes('Rate limit') || 
                           error.message?.includes('429') || 
                           error.code === 'rate_limit_exceeded';
        
        if (isRateLimit && attempt < maxRetries - 1) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 30000);
          console.log(`[BulkImport] Rate limit hit for product ${item.productId}, waiting ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (!isRateLimit) {
          console.error(`[BulkImport] Embedding failed for product ${item.productId}:`, error.message);
          break;
        }
      }
    }
    
    console.error(`[BulkImport] Embedding failed after ${maxRetries} attempts for product ${item.productId}:`, lastError?.message);
    return { success: false, jobId: item.jobId, businessAccountId: item.businessAccountId };
  }

  private async processEmbeddingQueue(): Promise<void> {
    if (this.isProcessingEmbeddings || this.embeddingQueueIndex >= this.embeddingQueue.length) {
      return;
    }

    this.isProcessingEmbeddings = true;
    const totalItems = this.embeddingQueue.length - this.embeddingQueueIndex;
    console.log(`[BulkImport] Starting embedding queue processing (${totalItems} items)`);

    try {
      const { productImageEmbeddingService } = await import('./productImageEmbeddingService');
      
      // Cache jewelry detection settings per business account to avoid repeated DB calls
      // Jewelry detection is enabled when OpenAI key is present
      const jewelryDetectionCache = new Map<string, boolean>();
      
      const getJewelryDetectionEnabled = async (businessAccountId: string): Promise<boolean> => {
        if (jewelryDetectionCache.has(businessAccountId)) {
          return jewelryDetectionCache.get(businessAccountId)!;
        }
        const openaiApiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
        const enabled = !!openaiApiKey;
        jewelryDetectionCache.set(businessAccountId, enabled);
        return enabled;
      };

      while (this.embeddingQueueIndex < this.embeddingQueue.length) {
        const startIdx = this.embeddingQueueIndex;
        const endIdx = Math.min(startIdx + this.EMBEDDINGS_PER_BATCH, this.embeddingQueue.length);
        const batch = this.embeddingQueue.slice(startIdx, endIdx);
        this.embeddingQueueIndex = endIdx;
        
        const results = await Promise.allSettled(
          batch.map(async item => {
            const useJewelryDetection = await getJewelryDetectionEnabled(item.businessAccountId);
            return this.embedWithRetry(productImageEmbeddingService, item, useJewelryDetection);
          })
        );

        const successfulByJob = new Map<string, { count: number; businessAccountId: string }>();
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.success) {
            const key = result.value.jobId;
            const current = successfulByJob.get(key) || { count: 0, businessAccountId: result.value.businessAccountId };
            current.count++;
            successfulByJob.set(key, current);
          }
        }

        const entries = Array.from(successfulByJob.entries());
        for (let i = 0; i < entries.length; i++) {
          const [jobId, { count, businessAccountId }] = entries[i];
          try {
            const job = await storage.getProductImportJob(jobId, businessAccountId);
            if (job) {
              await storage.updateProductImportJob(jobId, {
                processedEmbeddings: (job.processedEmbeddings || 0) + count,
              });
            }
          } catch (e) {
          }
        }

        if (this.embeddingQueueIndex < this.embeddingQueue.length) {
          await new Promise(resolve => setTimeout(resolve, this.DELAY_BETWEEN_BATCHES_MS));
        }
      }

      this.embeddingQueue = [];
      this.embeddingQueueIndex = 0;

      console.log(`[BulkImport] Embedding queue processing completed`);
    } catch (error) {
      console.error(`[BulkImport] Embedding queue error:`, error);
    } finally {
      this.isProcessingEmbeddings = false;
    }
  }

  async getJobStatus(jobId: string, businessAccountId: string): Promise<ProductImportJob | undefined> {
    return await storage.getProductImportJob(jobId, businessAccountId);
  }

  async getRecentJobs(businessAccountId: string): Promise<ProductImportJob[]> {
    return await storage.getProductImportJobs(businessAccountId);
  }

  async cancelJob(jobId: string, businessAccountId: string): Promise<boolean> {
    const job = await storage.getProductImportJob(jobId, businessAccountId);
    if (!job) return false;

    if (job.status === 'pending' || job.status === 'processing') {
      await storage.updateProductImportJob(jobId, {
        status: 'cancelled',
        completedAt: new Date(),
      });
      return true;
    }

    return false;
  }
}

export const bulkImportService = new BulkImportService();
