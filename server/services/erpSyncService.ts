import { db } from "../db";
import {
  erpConfigurations,
  erpProductCache,
  productEmbeddings,
  erpSyncLogs,
  ErpConfiguration,
  InsertErpProductCache,
  InsertProductEmbedding,
  InsertErpSyncLog,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { ErpClient, ErpProduct, createErpClient } from "./erpClient";
import { productImageEmbeddingService } from "./productImageEmbeddingService";
import { createOpenAiBatchService, OpenAiBatchService } from "./openAiBatchService";

interface SyncProgress {
  totalProducts: number;
  processedProducts: number;
  newEmbeddings: number;
  updatedEmbeddings: number;
  failedProducts: number;
}

interface SyncResult {
  success: boolean;
  syncLogId: string;
  duration: number;
  progress: SyncProgress;
  error?: string;
  batchJobId?: string;
}

interface SyncOptions {
  useBatchApi?: boolean;
  resumeFromPage?: number;
  embeddingRateLimit?: number;
}

const BATCH_API_THRESHOLD = 500;
const DEFAULT_EMBEDDING_RATE_LIMIT = 5;

export class ErpSyncService {
  private businessAccountId: string;
  private erpConfig: ErpConfiguration | null = null;
  private erpClient: ErpClient | null = null;
  private syncLogId: string | null = null;
  private batchService: OpenAiBatchService | null = null;
  private progress: SyncProgress = {
    totalProducts: 0,
    processedProducts: 0,
    newEmbeddings: 0,
    updatedEmbeddings: 0,
    failedProducts: 0,
  };

  constructor(businessAccountId: string) {
    this.businessAccountId = businessAccountId;
    this.batchService = createOpenAiBatchService(businessAccountId);
  }

  async initialize(): Promise<boolean> {
    const [config] = await db
      .select()
      .from(erpConfigurations)
      .where(
        and(
          eq(erpConfigurations.businessAccountId, this.businessAccountId),
          eq(erpConfigurations.isActive, "true"),
          eq(erpConfigurations.syncEnabled, "true")
        )
      )
      .limit(1);

    if (!config) {
      return false;
    }

    this.erpConfig = config;
    this.erpClient = await createErpClient(config);
    return true;
  }

  private async createSyncLog(
    syncType: "full" | "delta" | "manual",
    options?: SyncOptions
  ): Promise<string> {
    const [log] = await db
      .insert(erpSyncLogs)
      .values({
        businessAccountId: this.businessAccountId,
        erpConfigurationId: this.erpConfig?.id,
        syncType,
        status: "running",
        totalProducts: 0,
        processedProducts: 0,
        newEmbeddings: 0,
        updatedEmbeddings: 0,
        deletedEmbeddings: 0,
        failedProducts: 0,
        lastProcessedPage: options?.resumeFromPage || 0,
        useBatchApi: options?.useBatchApi ? "true" : "false",
        embeddingMethod: options?.useBatchApi ? "batch" : "standard",
      })
      .returning();

    this.syncLogId = log.id;
    return log.id;
  }

  private async updateSyncLog(updates: Partial<{
    status: string;
    totalProducts: number;
    processedProducts: number;
    newEmbeddings: number;
    updatedEmbeddings: number;
    deletedEmbeddings: number;
    failedProducts: number;
    lastProcessedPage: number;
    lastProcessedProductId: string;
    completedAt: Date;
    durationSeconds: number;
    errorMessage: string;
    errorDetails: any;
  }>): Promise<void> {
    if (!this.syncLogId) return;

    await db
      .update(erpSyncLogs)
      .set(updates)
      .where(eq(erpSyncLogs.id, this.syncLogId));
  }

  private async cacheProduct(product: ErpProduct): Promise<void> {
    const cacheData: InsertErpProductCache = {
      businessAccountId: this.businessAccountId,
      erpConfigurationId: this.erpConfig?.id,
      erpProductId: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      price: product.price?.toString(),
      currency: product.currency || "INR",
      category: product.category,
      subcategory: product.subcategory,
      images: product.images,
      inStock: product.inStock ? "true" : "false",
      weight: product.weight,
      metal: product.metal,
      additionalAttributes: product.additionalAttributes,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + (this.erpConfig?.cacheTtlMinutes || 30) * 60 * 1000),
      isValid: "true",
    };

    await db
      .insert(erpProductCache)
      .values(cacheData)
      .onConflictDoUpdate({
        target: [erpProductCache.businessAccountId, erpProductCache.erpProductId],
        set: {
          name: cacheData.name,
          description: cacheData.description,
          sku: cacheData.sku,
          price: cacheData.price,
          currency: cacheData.currency,
          category: cacheData.category,
          subcategory: cacheData.subcategory,
          images: cacheData.images,
          inStock: cacheData.inStock,
          weight: cacheData.weight,
          metal: cacheData.metal,
          additionalAttributes: cacheData.additionalAttributes,
          cachedAt: cacheData.cachedAt,
          expiresAt: cacheData.expiresAt,
          isValid: "true",
          updatedAt: new Date(),
        },
      });
  }

  private async generateEmbedding(product: ErpProduct, rateLimit?: number): Promise<boolean> {
    if (!product.images || product.images.length === 0) {
      return false;
    }

    const imageUrl = product.images[0];

    try {
      if (rateLimit) {
        await this.rateLimitDelay(rateLimit);
      }

      const [existingEmbedding] = await db
        .select()
        .from(productEmbeddings)
        .where(
          and(
            eq(productEmbeddings.businessAccountId, this.businessAccountId),
            eq(productEmbeddings.erpProductId, product.id)
          )
        )
        .limit(1);

      const { embedding, visualDescription } = await productImageEmbeddingService.generateEmbeddingFromUrl(
        imageUrl,
        this.businessAccountId,
        product.name
      );

      if (!embedding) {
        return false;
      }

      if (existingEmbedding) {
        await db
          .update(productEmbeddings)
          .set({
            imageUrl,
            embedding,
            visualDescription,
            cachedName: product.name,
            cachedCategory: product.category,
            cachedPrice: product.price?.toString(),
            cachedThumbnailUrl: imageUrl,
            lastSyncedAt: new Date(),
            syncVersion: (existingEmbedding.syncVersion || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(productEmbeddings.id, existingEmbedding.id));
        
        this.progress.updatedEmbeddings++;
      } else {
        await db.insert(productEmbeddings).values({
          businessAccountId: this.businessAccountId,
          erpConfigurationId: this.erpConfig?.id,
          erpProductId: product.id,
          imageUrl,
          embedding,
          visualDescription,
          cachedName: product.name,
          cachedCategory: product.category,
          cachedPrice: product.price?.toString(),
          cachedThumbnailUrl: imageUrl,
          lastSyncedAt: new Date(),
          syncVersion: 1,
          isActive: "true",
        });
        this.progress.newEmbeddings++;
      }

      return true;
    } catch (error) {
      console.error(`Failed to generate embedding for product ${product.id}:`, error);
      return false;
    }
  }

  private async rateLimitDelay(requestsPerSecond: number): Promise<void> {
    const delayMs = Math.ceil(1000 / requestsPerSecond);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private shouldUseBatchApi(totalProducts: number, forceStandard?: boolean): boolean {
    if (forceStandard) return false;
    return totalProducts >= BATCH_API_THRESHOLD;
  }

  async runFullSync(options?: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();

    if (!await this.initialize()) {
      return {
        success: false,
        syncLogId: "",
        duration: 0,
        progress: this.progress,
        error: "ERP configuration not found or not enabled",
      };
    }

    try {
      console.log(`Starting full sync for business ${this.businessAccountId}`);

      const firstResponse = await this.erpClient!.getProducts(1, 1);
      const estimatedTotal = firstResponse.pagination.total;

      const useBatchApi = options?.useBatchApi ?? this.shouldUseBatchApi(estimatedTotal);

      await this.createSyncLog("full", {
        useBatchApi,
        resumeFromPage: options?.resumeFromPage,
      });

      console.log(`Estimated ${estimatedTotal} products. Using ${useBatchApi ? "Batch API" : "Standard API"} for embeddings`);

      const batchSize = this.erpConfig?.batchSize || 500;
      let page = options?.resumeFromPage || 1;
      let hasMore = true;
      const allProducts: ErpProduct[] = [];
      const embeddingRateLimit = options?.embeddingRateLimit || DEFAULT_EMBEDDING_RATE_LIMIT;

      while (hasMore) {
        const response = await this.erpClient!.getProducts(page, batchSize);
        
        if (page === 1 || !options?.resumeFromPage) {
          this.progress.totalProducts = response.pagination.total;
          await this.updateSyncLog({ totalProducts: this.progress.totalProducts });
        }

        for (const product of response.products) {
          try {
            await this.cacheProduct(product);
            
            if (useBatchApi) {
              if (product.images && product.images.length > 0) {
                allProducts.push(product);
              }
            } else {
              const embeddingSuccess = await this.generateEmbedding(product, embeddingRateLimit);
              if (!embeddingSuccess) {
                this.progress.failedProducts++;
              }
            }
            
            this.progress.processedProducts++;

            if (this.progress.processedProducts % 100 === 0) {
              await this.updateSyncLog({
                processedProducts: this.progress.processedProducts,
                newEmbeddings: this.progress.newEmbeddings,
                updatedEmbeddings: this.progress.updatedEmbeddings,
                failedProducts: this.progress.failedProducts,
                lastProcessedPage: page,
                lastProcessedProductId: product.id,
              });
              console.log(`Sync progress: ${this.progress.processedProducts}/${this.progress.totalProducts} (page ${page})`);
            }
          } catch (error) {
            console.error(`Failed to process product ${product.id}:`, error);
            this.progress.failedProducts++;
          }
        }

        await this.updateSyncLog({ lastProcessedPage: page });

        if (page >= response.pagination.totalPages || response.products.length === 0) {
          hasMore = false;
        } else {
          page++;
        }
      }

      let batchJobId: string | undefined;

      if (useBatchApi && allProducts.length > 0) {
        console.log(`Creating batch job for ${allProducts.length} products`);
        
        const productsForBatch = allProducts.map(p => ({
          id: p.id,
          erpProductId: p.id,
          imageUrl: p.images![0],
          name: p.name,
          category: p.category,
        }));

        const batchJob = await this.batchService!.createEmbeddingBatchJob(
          productsForBatch,
          this.syncLogId!
        );

        if (batchJob) {
          batchJobId = batchJob.id;
          console.log(`Batch job created: ${batchJob.id}, OpenAI batch: ${batchJob.openAiBatchId}`);
          
          await this.updateSyncLog({
            status: "batch_processing",
          });
        } else {
          console.warn("Failed to create batch job, embeddings will need to be generated separately");
        }
      }

      const duration = Math.floor((Date.now() - startTime) / 1000);

      const finalStatus = useBatchApi && batchJobId ? "batch_processing" : "completed";

      await this.updateSyncLog({
        status: finalStatus,
        processedProducts: this.progress.processedProducts,
        newEmbeddings: this.progress.newEmbeddings,
        updatedEmbeddings: this.progress.updatedEmbeddings,
        failedProducts: this.progress.failedProducts,
        completedAt: useBatchApi ? undefined : new Date(),
        durationSeconds: duration,
      });

      console.log(`Sync ${useBatchApi ? "phase 1" : ""} completed: ${this.progress.processedProducts} products processed in ${duration}s`);

      return {
        success: true,
        syncLogId: this.syncLogId!,
        duration,
        progress: this.progress,
        batchJobId,
      };
    } catch (error: any) {
      const duration = Math.floor((Date.now() - startTime) / 1000);

      await this.updateSyncLog({
        status: "failed",
        processedProducts: this.progress.processedProducts,
        errorMessage: error.message,
        errorDetails: { stack: error.stack },
        completedAt: new Date(),
        durationSeconds: duration,
      });

      return {
        success: false,
        syncLogId: this.syncLogId!,
        duration,
        progress: this.progress,
        error: error.message,
      };
    }
  }

  async runDeltaSync(since: Date, options?: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();

    if (!await this.initialize()) {
      return {
        success: false,
        syncLogId: "",
        duration: 0,
        progress: this.progress,
        error: "ERP configuration not found or not enabled",
      };
    }

    await this.createSyncLog("delta", options);

    try {
      console.log(`Starting delta sync for business ${this.businessAccountId} since ${since.toISOString()}`);

      const batchSize = this.erpConfig?.batchSize || 500;
      let page = 1;
      let hasMore = true;
      const embeddingRateLimit = options?.embeddingRateLimit || DEFAULT_EMBEDDING_RATE_LIMIT;

      while (hasMore) {
        const response = await this.erpClient!.getUpdatedProducts(since, page, batchSize);

        if (page === 1) {
          this.progress.totalProducts = response.pagination.total;
          await this.updateSyncLog({ totalProducts: this.progress.totalProducts });
        }

        for (const product of response.products) {
          try {
            await this.cacheProduct(product);
            await this.generateEmbedding(product, embeddingRateLimit);
            this.progress.processedProducts++;
          } catch (error) {
            console.error(`Failed to process product ${product.id}:`, error);
            this.progress.failedProducts++;
          }
        }

        if (page >= response.pagination.totalPages || response.products.length === 0) {
          hasMore = false;
        } else {
          page++;
        }
      }

      const duration = Math.floor((Date.now() - startTime) / 1000);

      await this.updateSyncLog({
        status: "completed",
        processedProducts: this.progress.processedProducts,
        newEmbeddings: this.progress.newEmbeddings,
        updatedEmbeddings: this.progress.updatedEmbeddings,
        failedProducts: this.progress.failedProducts,
        completedAt: new Date(),
        durationSeconds: duration,
      });

      console.log(`Delta sync completed: ${this.progress.processedProducts} products processed in ${duration}s`);

      return {
        success: true,
        syncLogId: this.syncLogId!,
        duration,
        progress: this.progress,
      };
    } catch (error: any) {
      const duration = Math.floor((Date.now() - startTime) / 1000);

      await this.updateSyncLog({
        status: "failed",
        errorMessage: error.message,
        completedAt: new Date(),
        durationSeconds: duration,
      });

      return {
        success: false,
        syncLogId: this.syncLogId!,
        duration,
        progress: this.progress,
        error: error.message,
      };
    }
  }

  async syncSingleProduct(erpProductId: string): Promise<boolean> {
    if (!await this.initialize()) {
      return false;
    }

    try {
      const product = await this.erpClient!.getProductById(erpProductId);
      if (!product) {
        return false;
      }

      await this.cacheProduct(product);
      await this.generateEmbedding(product);
      return true;
    } catch (error) {
      console.error(`Failed to sync product ${erpProductId}:`, error);
      return false;
    }
  }

  async resumeInterruptedSync(syncLogId: string): Promise<SyncResult | null> {
    const [log] = await db
      .select()
      .from(erpSyncLogs)
      .where(eq(erpSyncLogs.id, syncLogId))
      .limit(1);

    if (!log || log.status !== "running") {
      return null;
    }

    const resumeFromPage = (log.lastProcessedPage || 0) + 1;
    console.log(`Resuming sync ${syncLogId} from page ${resumeFromPage}`);

    this.syncLogId = log.id;
    this.progress.processedProducts = log.processedProducts || 0;
    this.progress.newEmbeddings = log.newEmbeddings || 0;
    this.progress.updatedEmbeddings = log.updatedEmbeddings || 0;
    this.progress.failedProducts = log.failedProducts || 0;

    return this.runFullSync({ resumeFromPage });
  }

  static async getLastSyncTime(businessAccountId: string): Promise<Date | null> {
    const [lastLog] = await db
      .select()
      .from(erpSyncLogs)
      .where(
        and(
          eq(erpSyncLogs.businessAccountId, businessAccountId),
          eq(erpSyncLogs.status, "completed")
        )
      )
      .orderBy(sql`${erpSyncLogs.completedAt} DESC`)
      .limit(1);

    return lastLog?.completedAt || null;
  }

  static async getSyncLogs(businessAccountId: string, limit: number = 10): Promise<any[]> {
    const logs = await db
      .select()
      .from(erpSyncLogs)
      .where(eq(erpSyncLogs.businessAccountId, businessAccountId))
      .orderBy(sql`${erpSyncLogs.startedAt} DESC`)
      .limit(limit);

    return logs;
  }

  static async getInterruptedSyncs(businessAccountId: string): Promise<any[]> {
    const logs = await db
      .select()
      .from(erpSyncLogs)
      .where(
        and(
          eq(erpSyncLogs.businessAccountId, businessAccountId),
          eq(erpSyncLogs.status, "running")
        )
      )
      .orderBy(sql`${erpSyncLogs.startedAt} DESC`);

    return logs;
  }

  static async getEmbeddingCount(businessAccountId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(productEmbeddings)
      .where(
        and(
          eq(productEmbeddings.businessAccountId, businessAccountId),
          eq(productEmbeddings.isActive, "true")
        )
      );

    return Number(result?.count || 0);
  }
}

export async function createErpSyncService(businessAccountId: string): Promise<ErpSyncService> {
  return new ErpSyncService(businessAccountId);
}
