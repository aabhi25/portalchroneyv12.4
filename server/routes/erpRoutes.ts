import { Router, Request, Response } from "express";
import { db } from "../db";
import { 
  erpConfigurations, 
  erpProductCache, 
  productEmbeddings, 
  erpSyncLogs,
  openAiBatchJobs,
  insertErpConfigurationSchema
} from "@shared/schema";
import { eq, and, desc, sql, or } from "drizzle-orm";
import { requireAuth, requireBusinessAccount } from "../auth";
import { ErpClient, encryptCredentials, decryptCredentials } from "../services/erpClient";
import { ErpSyncService, createErpSyncService } from "../services/erpSyncService";
import { createProductProvider } from "../services/productProvider";
import { createOpenAiBatchService } from "../services/openAiBatchService";

const router = Router();

router.get("/api/erp/config", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const [config] = await db
      .select()
      .from(erpConfigurations)
      .where(eq(erpConfigurations.businessAccountId, businessAccountId))
      .limit(1);

    if (!config) {
      return res.json({ configured: false, config: null });
    }

    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? "••••••••" : null,
      accessToken: config.accessToken ? "••••••••" : null,
      refreshToken: config.refreshToken ? "••••••••" : null,
      basicAuthPassword: config.basicAuthPassword ? "••••••••" : null,
    };

    return res.json({ configured: true, config: safeConfig });
  } catch (error: any) {
    console.error("Error fetching ERP config:", error);
    return res.status(500).json({ error: "Failed to fetch ERP configuration" });
  }
});

router.post("/api/erp/config", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const body = req.body;

    const encryptedData: any = {
      businessAccountId,
      name: body.name,
      erpType: body.erpType || "generic",
      baseUrl: body.baseUrl,
      authType: body.authType || "api_key",
      productsEndpoint: body.productsEndpoint || "/products",
      productDetailEndpoint: body.productDetailEndpoint || "/products/{id}",
      categoriesEndpoint: body.categoriesEndpoint || "/categories",
      deltaSyncEndpoint: body.deltaSyncEndpoint,
      syncEnabled: body.syncEnabled || "true",
      syncFrequencyHours: body.syncFrequencyHours || 12,
      fullSyncDayOfWeek: body.fullSyncDayOfWeek || 0,
      batchSize: body.batchSize || 500,
      fieldMapping: body.fieldMapping,
      cacheEnabled: body.cacheEnabled || "true",
      cacheTtlMinutes: body.cacheTtlMinutes || 30,
      isActive: body.isActive || "true",
    };

    if (body.apiKey && body.apiKey !== "••••••••") {
      encryptedData.apiKey = encryptCredentials(body.apiKey);
    }
    if (body.accessToken && body.accessToken !== "••••••••") {
      encryptedData.accessToken = encryptCredentials(body.accessToken);
    }
    if (body.refreshToken && body.refreshToken !== "••••••••") {
      encryptedData.refreshToken = encryptCredentials(body.refreshToken);
    }
    if (body.basicAuthUsername) {
      encryptedData.basicAuthUsername = body.basicAuthUsername;
    }
    if (body.basicAuthPassword && body.basicAuthPassword !== "••••••••") {
      encryptedData.basicAuthPassword = encryptCredentials(body.basicAuthPassword);
    }

    const [existingConfig] = await db
      .select()
      .from(erpConfigurations)
      .where(eq(erpConfigurations.businessAccountId, businessAccountId))
      .limit(1);

    let config;
    if (existingConfig) {
      [config] = await db
        .update(erpConfigurations)
        .set({
          ...encryptedData,
          updatedAt: new Date(),
        })
        .where(eq(erpConfigurations.id, existingConfig.id))
        .returning();
    } else {
      [config] = await db
        .insert(erpConfigurations)
        .values(encryptedData)
        .returning();
    }

    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? "••••••••" : null,
      accessToken: config.accessToken ? "••••••••" : null,
      refreshToken: config.refreshToken ? "••••••••" : null,
      basicAuthPassword: config.basicAuthPassword ? "••••••••" : null,
    };

    return res.json({ success: true, config: safeConfig });
  } catch (error: any) {
    console.error("Error saving ERP config:", error);
    return res.status(500).json({ error: "Failed to save ERP configuration" });
  }
});

router.post("/api/erp/test-connection", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const [config] = await db
      .select()
      .from(erpConfigurations)
      .where(eq(erpConfigurations.businessAccountId, businessAccountId))
      .limit(1);

    if (!config) {
      return res.status(400).json({ error: "ERP configuration not found" });
    }

    const client = new ErpClient(config);
    const result = await client.testConnection();

    await db
      .update(erpConfigurations)
      .set({
        lastTestedAt: new Date(),
        lastTestStatus: result.success ? "success" : "failed",
        lastTestError: result.success ? null : result.message,
      })
      .where(eq(erpConfigurations.id, config.id));

    return res.json(result);
  } catch (error: any) {
    console.error("Error testing ERP connection:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/api/erp/sync/full", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const syncService = await createErpSyncService(businessAccountId);
    
    res.json({ message: "Full sync started", status: "running" });

    syncService.runFullSync().then(result => {
      console.log("Full sync completed:", result);
    }).catch(error => {
      console.error("Full sync failed:", error);
    });
  } catch (error: any) {
    console.error("Error starting full sync:", error);
    return res.status(500).json({ error: "Failed to start sync" });
  }
});

router.post("/api/erp/sync/delta", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { since } = req.body;

    const sinceDate = since ? new Date(since) : await ErpSyncService.getLastSyncTime(businessAccountId);
    
    if (!sinceDate) {
      return res.status(400).json({ error: "No previous sync found. Run a full sync first." });
    }

    const syncService = await createErpSyncService(businessAccountId);
    
    res.json({ message: "Delta sync started", since: sinceDate.toISOString(), status: "running" });

    syncService.runDeltaSync(sinceDate).then(result => {
      console.log("Delta sync completed:", result);
    }).catch(error => {
      console.error("Delta sync failed:", error);
    });
  } catch (error: any) {
    console.error("Error starting delta sync:", error);
    return res.status(500).json({ error: "Failed to start sync" });
  }
});

router.get("/api/erp/sync/logs", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const limit = parseInt(req.query.limit as string) || 20;

    const logs = await ErpSyncService.getSyncLogs(businessAccountId, limit);
    return res.json({ logs });
  } catch (error: any) {
    console.error("Error fetching sync logs:", error);
    return res.status(500).json({ error: "Failed to fetch sync logs" });
  }
});

router.get("/api/erp/products", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { query, categoryId, minPrice, maxPrice, page = "1", perPage = "20" } = req.query;

    const provider = await createProductProvider(businessAccountId);
    
    const result = await provider.searchProducts({
      query: query as string,
      categoryId: categoryId as string,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      page: parseInt(page as string),
      perPage: parseInt(perPage as string),
    });

    return res.json(result);
  } catch (error: any) {
    console.error("Error fetching ERP products:", error);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/api/erp/products/:productId", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { productId } = req.params;

    const provider = await createProductProvider(businessAccountId);
    const product = await provider.getProductById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json({ product });
  } catch (error: any) {
    console.error("Error fetching product:", error);
    return res.status(500).json({ error: "Failed to fetch product" });
  }
});

router.get("/api/erp/categories", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const provider = await createProductProvider(businessAccountId);
    const categories = await provider.getCategories();

    return res.json({ categories });
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.get("/api/erp/price-range", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const provider = await createProductProvider(businessAccountId);
    const priceRange = await provider.getPriceRange();

    return res.json(priceRange);
  } catch (error: any) {
    console.error("Error fetching price range:", error);
    return res.status(500).json({ error: "Failed to fetch price range" });
  }
});

router.delete("/api/erp/config", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    await db
      .delete(erpConfigurations)
      .where(eq(erpConfigurations.businessAccountId, businessAccountId));

    await db
      .delete(erpProductCache)
      .where(eq(erpProductCache.businessAccountId, businessAccountId));

    await db
      .delete(productEmbeddings)
      .where(eq(productEmbeddings.businessAccountId, businessAccountId));

    return res.json({ success: true, message: "ERP configuration and related data deleted" });
  } catch (error: any) {
    console.error("Error deleting ERP config:", error);
    return res.status(500).json({ error: "Failed to delete ERP configuration" });
  }
});

router.get("/api/erp/batch-jobs", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const limit = parseInt(req.query.limit as string) || 10;

    const jobs = await db
      .select()
      .from(openAiBatchJobs)
      .where(eq(openAiBatchJobs.businessAccountId, businessAccountId))
      .orderBy(desc(openAiBatchJobs.createdAt))
      .limit(limit);

    return res.json({ jobs });
  } catch (error: any) {
    console.error("Error fetching batch jobs:", error);
    return res.status(500).json({ error: "Failed to fetch batch jobs" });
  }
});

router.get("/api/erp/batch-jobs/:jobId", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { jobId } = req.params;

    const batchService = createOpenAiBatchService(businessAccountId);
    const job = await batchService.checkBatchStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: "Batch job not found" });
    }

    return res.json({ job });
  } catch (error: any) {
    console.error("Error fetching batch job:", error);
    return res.status(500).json({ error: "Failed to fetch batch job" });
  }
});

router.post("/api/erp/batch-jobs/:jobId/process", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { jobId } = req.params;

    const batchService = createOpenAiBatchService(businessAccountId);
    
    const job = await batchService.checkBatchStatus(jobId);
    if (!job) {
      return res.status(404).json({ error: "Batch job not found" });
    }

    if (job.status !== "completed") {
      return res.status(400).json({ 
        error: "Batch job not ready for processing", 
        status: job.status 
      });
    }

    const result = await batchService.processBatchResults(jobId);

    if (job.erpSyncLogId) {
      await db
        .update(erpSyncLogs)
        .set({
          status: "completed",
          newEmbeddings: result.processed,
          failedProducts: result.failed,
          completedAt: new Date(),
        })
        .where(eq(erpSyncLogs.id, job.erpSyncLogId));
    }

    return res.json({ 
      success: true, 
      processed: result.processed, 
      failed: result.failed 
    });
  } catch (error: any) {
    console.error("Error processing batch job:", error);
    return res.status(500).json({ error: "Failed to process batch job" });
  }
});

router.post("/api/erp/batch-jobs/:jobId/cancel", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { jobId } = req.params;

    const batchService = createOpenAiBatchService(businessAccountId);
    const success = await batchService.cancelBatchJob(jobId);

    if (!success) {
      return res.status(400).json({ error: "Failed to cancel batch job" });
    }

    return res.json({ success: true, message: "Batch job cancelled" });
  } catch (error: any) {
    console.error("Error cancelling batch job:", error);
    return res.status(500).json({ error: "Failed to cancel batch job" });
  }
});

router.get("/api/erp/sync/status", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;

    const lastSyncTime = await ErpSyncService.getLastSyncTime(businessAccountId);
    const embeddingCount = await ErpSyncService.getEmbeddingCount(businessAccountId);
    const recentLogs = await ErpSyncService.getSyncLogs(businessAccountId, 5);
    const interruptedSyncs = await ErpSyncService.getInterruptedSyncs(businessAccountId);

    const [runningSync] = await db
      .select()
      .from(erpSyncLogs)
      .where(
        and(
          eq(erpSyncLogs.businessAccountId, businessAccountId),
          or(
            eq(erpSyncLogs.status, "running"),
            eq(erpSyncLogs.status, "batch_processing")
          )
        )
      )
      .orderBy(desc(erpSyncLogs.startedAt))
      .limit(1);

    const pendingBatchJobs = await db
      .select()
      .from(openAiBatchJobs)
      .where(
        and(
          eq(openAiBatchJobs.businessAccountId, businessAccountId),
          or(
            eq(openAiBatchJobs.status, "submitted"),
            eq(openAiBatchJobs.status, "in_progress")
          )
        )
      )
      .orderBy(desc(openAiBatchJobs.createdAt));

    const [cacheCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(erpProductCache)
      .where(
        and(
          eq(erpProductCache.businessAccountId, businessAccountId),
          eq(erpProductCache.isValid, "true")
        )
      );

    return res.json({
      lastSyncTime,
      embeddingCount,
      cachedProductCount: Number(cacheCount?.count || 0),
      isRunning: !!runningSync,
      currentSync: runningSync,
      recentLogs,
      interruptedSyncs,
      pendingBatchJobs,
    });
  } catch (error: any) {
    console.error("Error fetching sync status:", error);
    return res.status(500).json({ error: "Failed to fetch sync status" });
  }
});

router.post("/api/erp/sync/resume/:syncLogId", requireAuth, requireBusinessAccount, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId;
    const { syncLogId } = req.params;

    const syncService = await createErpSyncService(businessAccountId);
    
    res.json({ message: "Resuming sync", syncLogId, status: "running" });

    syncService.resumeInterruptedSync(syncLogId).then(result => {
      if (result) {
        console.log("Resumed sync completed:", result);
      } else {
        console.log("Could not resume sync:", syncLogId);
      }
    }).catch(error => {
      console.error("Resumed sync failed:", error);
    });
  } catch (error: any) {
    console.error("Error resuming sync:", error);
    return res.status(500).json({ error: "Failed to resume sync" });
  }
});

export default router;
