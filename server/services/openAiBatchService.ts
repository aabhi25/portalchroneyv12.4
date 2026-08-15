import OpenAI from "openai";
import { db } from "../db";
import {
  openAiBatchJobs,
  productEmbeddings,
  erpSyncLogs,
  InsertOpenAiBatchJob,
  OpenAiBatchJob,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface BatchEmbeddingRequest {
  custom_id: string;
  method: "POST";
  url: "/v1/embeddings";
  body: {
    model: string;
    input: string;
    dimensions?: number;
  };
}

interface BatchVisualRequest {
  custom_id: string;
  method: "POST";
  url: "/v1/chat/completions";
  body: {
    model: string;
    messages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>;
    max_tokens: number;
  };
}

interface ProductForBatch {
  id: string;
  erpProductId?: string;
  imageUrl: string;
  name: string;
  category?: string;
  price?: string;
}

export class OpenAiBatchService {
  private openai: OpenAI | null = null;
  private businessAccountId: string;
  private readonly BATCH_SIZE = 50000;
  private readonly EMBEDDING_MODEL = "text-embedding-3-small";
  private readonly VISION_MODEL = "gpt-4o-mini";

  constructor(businessAccountId: string) {
    this.businessAccountId = businessAccountId;
  }

  async initialize(): Promise<boolean> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[OpenAI Batch] No API key available");
      return false;
    }

    this.openai = new OpenAI({ apiKey });
    return true;
  }

  async createEmbeddingBatchJob(
    products: ProductForBatch[],
    syncLogId?: string
  ): Promise<OpenAiBatchJob | null> {
    if (!await this.initialize()) {
      return null;
    }

    try {
      const batchRequests: BatchEmbeddingRequest[] = products.map((product, index) => ({
        custom_id: `embed_${product.id}_${index}`,
        method: "POST" as const,
        url: "/v1/embeddings" as const,
        body: {
          model: this.EMBEDDING_MODEL,
          input: `${product.name}. ${product.category || ""}. Product for visual similarity search.`,
          dimensions: 1536,
        },
      }));

      const jsonlContent = batchRequests.map(req => JSON.stringify(req)).join("\n");
      const blob = new Blob([jsonlContent], { type: "application/jsonl" });
      const file = new File([blob], "batch_embeddings.jsonl", { type: "application/jsonl" });

      console.log(`[OpenAI Batch] Uploading batch file with ${products.length} embedding requests`);

      const uploadedFile = await this.openai!.files.create({
        file,
        purpose: "batch",
      });

      console.log(`[OpenAI Batch] File uploaded: ${uploadedFile.id}`);

      const batch = await this.openai!.batches.create({
        input_file_id: uploadedFile.id,
        endpoint: "/v1/embeddings",
        completion_window: "24h",
      });

      console.log(`[OpenAI Batch] Batch created: ${batch.id}`);

      const batchInputData = products.map(p => ({
        productId: p.id,
        erpProductId: p.erpProductId,
        imageUrl: p.imageUrl,
        name: p.name,
      }));

      const [batchJob] = await db
        .insert(openAiBatchJobs)
        .values({
          businessAccountId: this.businessAccountId,
          erpSyncLogId: syncLogId,
          openAiBatchId: batch.id,
          openAiInputFileId: uploadedFile.id,
          jobType: "embedding",
          status: "submitted",
          totalRequests: products.length,
          batchInputData,
          submittedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      return batchJob;
    } catch (error: any) {
      console.error("[OpenAI Batch] Failed to create batch job:", error.message);
      return null;
    }
  }

  async createVisualDescriptionBatchJob(
    products: ProductForBatch[],
    syncLogId?: string
  ): Promise<OpenAiBatchJob | null> {
    if (!await this.initialize()) {
      return null;
    }

    try {
      const batchRequests: BatchVisualRequest[] = products.map((product, index) => ({
        custom_id: `visual_${product.id}_${index}`,
        method: "POST" as const,
        url: "/v1/chat/completions" as const,
        body: {
          model: this.VISION_MODEL,
          messages: [
            {
              role: "system",
              content: "You are a product description assistant. Describe the visual appearance of products for search purposes. Be concise but descriptive, focusing on colors, shapes, materials, and distinctive features. Output only the description, no preamble.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Describe this product image for "${product.name}" in 2-3 sentences for visual search purposes:`,
                },
                {
                  type: "image_url",
                  image_url: { url: product.imageUrl },
                },
              ],
            },
          ],
          max_tokens: 150,
        },
      }));

      const jsonlContent = batchRequests.map(req => JSON.stringify(req)).join("\n");
      const blob = new Blob([jsonlContent], { type: "application/jsonl" });
      const file = new File([blob], "batch_visual.jsonl", { type: "application/jsonl" });

      console.log(`[OpenAI Batch] Uploading visual description batch with ${products.length} requests`);

      const uploadedFile = await this.openai!.files.create({
        file,
        purpose: "batch",
      });

      const batch = await this.openai!.batches.create({
        input_file_id: uploadedFile.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      });

      console.log(`[OpenAI Batch] Visual batch created: ${batch.id}`);

      const batchInputData = products.map(p => ({
        productId: p.id,
        erpProductId: p.erpProductId,
        imageUrl: p.imageUrl,
        name: p.name,
      }));

      const [batchJob] = await db
        .insert(openAiBatchJobs)
        .values({
          businessAccountId: this.businessAccountId,
          erpSyncLogId: syncLogId,
          openAiBatchId: batch.id,
          openAiInputFileId: uploadedFile.id,
          jobType: "visual_description",
          status: "submitted",
          totalRequests: products.length,
          batchInputData,
          submittedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      return batchJob;
    } catch (error: any) {
      console.error("[OpenAI Batch] Failed to create visual batch job:", error.message);
      return null;
    }
  }

  async checkBatchStatus(batchJobId: string): Promise<OpenAiBatchJob | null> {
    const [batchJob] = await db
      .select()
      .from(openAiBatchJobs)
      .where(
        and(
          eq(openAiBatchJobs.id, batchJobId),
          eq(openAiBatchJobs.businessAccountId, this.businessAccountId)
        )
      )
      .limit(1);

    if (!batchJob || !batchJob.openAiBatchId) {
      return null;
    }

    if (!await this.initialize()) {
      return batchJob;
    }

    try {
      const batch = await this.openai!.batches.retrieve(batchJob.openAiBatchId);

      let status = batchJob.status;
      switch (batch.status) {
        case "validating":
        case "in_progress":
          status = "in_progress";
          break;
        case "completed":
          status = "completed";
          break;
        case "failed":
          status = "failed";
          break;
        case "expired":
          status = "expired";
          break;
        case "cancelled":
        case "cancelling":
          status = "cancelled";
          break;
      }

      const updates: Partial<InsertOpenAiBatchJob> = {
        status,
        completedRequests: batch.request_counts?.completed || 0,
        failedRequests: batch.request_counts?.failed || 0,
        updatedAt: new Date(),
      };

      if (batch.output_file_id) {
        updates.openAiOutputFileId = batch.output_file_id;
      }

      if (batch.status === "completed") {
        updates.completedAt = new Date();
      }

      if (batch.errors?.data && batch.errors.data.length > 0) {
        updates.errorDetails = batch.errors.data;
      }

      await db
        .update(openAiBatchJobs)
        .set(updates)
        .where(eq(openAiBatchJobs.id, batchJobId));

      return { ...batchJob, ...updates } as OpenAiBatchJob;
    } catch (error: any) {
      console.error("[OpenAI Batch] Failed to check batch status:", error.message);
      return batchJob;
    }
  }

  async processBatchResults(batchJobId: string): Promise<{ processed: number; failed: number }> {
    const [batchJob] = await db
      .select()
      .from(openAiBatchJobs)
      .where(
        and(
          eq(openAiBatchJobs.id, batchJobId),
          eq(openAiBatchJobs.businessAccountId, this.businessAccountId)
        )
      )
      .limit(1);

    if (!batchJob || !batchJob.openAiOutputFileId) {
      return { processed: 0, failed: 0 };
    }

    if (!await this.initialize()) {
      return { processed: 0, failed: 0 };
    }

    try {
      console.log(`[OpenAI Batch] Downloading results for batch ${batchJob.openAiBatchId}`);

      const fileResponse = await this.openai!.files.content(batchJob.openAiOutputFileId);
      const content = await fileResponse.text();
      const lines = content.trim().split("\n");

      const inputData = batchJob.batchInputData as Array<{
        productId: string;
        erpProductId?: string;
        imageUrl: string;
        name: string;
      }>;

      const productMap = new Map(inputData.map((p, idx) => [`${batchJob.jobType === "embedding" ? "embed" : "visual"}_${p.productId}_${idx}`, p]));

      let processed = 0;
      let failed = 0;

      for (const line of lines) {
        try {
          const result = JSON.parse(line);
          const customId = result.custom_id;
          const product = productMap.get(customId);

          if (!product) {
            console.warn(`[OpenAI Batch] Unknown custom_id: ${customId}`);
            continue;
          }

          if (result.error) {
            console.error(`[OpenAI Batch] Error for ${customId}:`, result.error);
            failed++;
            continue;
          }

          if (batchJob.jobType === "embedding") {
            const embedding = result.response?.body?.data?.[0]?.embedding;
            if (embedding) {
              await this.saveEmbedding(product, embedding, null);
              processed++;
            } else {
              failed++;
            }
          } else {
            const description = result.response?.body?.choices?.[0]?.message?.content;
            if (description) {
              await this.saveVisualDescription(product, description);
              processed++;
            } else {
              failed++;
            }
          }
        } catch (parseError) {
          console.error("[OpenAI Batch] Failed to parse result line:", parseError);
          failed++;
        }
      }

      await db
        .update(openAiBatchJobs)
        .set({
          completedRequests: processed,
          failedRequests: failed,
          status: "completed",
          results: { processed, failed },
          updatedAt: new Date(),
        })
        .where(eq(openAiBatchJobs.id, batchJobId));

      console.log(`[OpenAI Batch] Processed ${processed} results, ${failed} failed`);

      return { processed, failed };
    } catch (error: any) {
      console.error("[OpenAI Batch] Failed to process batch results:", error.message);

      await db
        .update(openAiBatchJobs)
        .set({
          status: "failed",
          errorMessage: error.message,
          updatedAt: new Date(),
        })
        .where(eq(openAiBatchJobs.id, batchJobId));

      return { processed: 0, failed: 0 };
    }
  }

  private async saveEmbedding(
    product: { productId: string; erpProductId?: string; imageUrl: string; name: string },
    embedding: number[],
    visualDescription: string | null
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(productEmbeddings)
      .where(
        and(
          eq(productEmbeddings.businessAccountId, this.businessAccountId),
          product.erpProductId
            ? eq(productEmbeddings.erpProductId, product.erpProductId)
            : eq(productEmbeddings.productId, product.productId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(productEmbeddings)
        .set({
          embedding,
          visualDescription: visualDescription || existing.visualDescription,
          imageUrl: product.imageUrl,
          cachedName: product.name,
          lastSyncedAt: new Date(),
          syncVersion: (existing.syncVersion || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(productEmbeddings.id, existing.id));
    } else {
      await db.insert(productEmbeddings).values({
        businessAccountId: this.businessAccountId,
        productId: product.erpProductId ? undefined : product.productId,
        erpProductId: product.erpProductId,
        imageUrl: product.imageUrl,
        embedding,
        visualDescription,
        cachedName: product.name,
        lastSyncedAt: new Date(),
        syncVersion: 1,
        isActive: "true",
      });
    }
  }

  private async saveVisualDescription(
    product: { productId: string; erpProductId?: string; imageUrl: string; name: string },
    description: string
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(productEmbeddings)
      .where(
        and(
          eq(productEmbeddings.businessAccountId, this.businessAccountId),
          product.erpProductId
            ? eq(productEmbeddings.erpProductId, product.erpProductId)
            : eq(productEmbeddings.productId, product.productId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(productEmbeddings)
        .set({
          visualDescription: description,
          updatedAt: new Date(),
        })
        .where(eq(productEmbeddings.id, existing.id));
    }
  }

  async getPendingBatchJobs(): Promise<OpenAiBatchJob[]> {
    return await db
      .select()
      .from(openAiBatchJobs)
      .where(
        and(
          eq(openAiBatchJobs.businessAccountId, this.businessAccountId),
          eq(openAiBatchJobs.status, "in_progress")
        )
      );
  }

  async getRecentBatchJobs(limit: number = 10): Promise<OpenAiBatchJob[]> {
    return await db
      .select()
      .from(openAiBatchJobs)
      .where(eq(openAiBatchJobs.businessAccountId, this.businessAccountId))
      .orderBy(openAiBatchJobs.createdAt)
      .limit(limit);
  }

  async cancelBatchJob(batchJobId: string): Promise<boolean> {
    const [batchJob] = await db
      .select()
      .from(openAiBatchJobs)
      .where(
        and(
          eq(openAiBatchJobs.id, batchJobId),
          eq(openAiBatchJobs.businessAccountId, this.businessAccountId)
        )
      )
      .limit(1);

    if (!batchJob || !batchJob.openAiBatchId) {
      return false;
    }

    if (!await this.initialize()) {
      return false;
    }

    try {
      await this.openai!.batches.cancel(batchJob.openAiBatchId);

      await db
        .update(openAiBatchJobs)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(openAiBatchJobs.id, batchJobId));

      return true;
    } catch (error: any) {
      console.error("[OpenAI Batch] Failed to cancel batch:", error.message);
      return false;
    }
  }
}

export function createOpenAiBatchService(businessAccountId: string): OpenAiBatchService {
  return new OpenAiBatchService(businessAccountId);
}
