import { visionWarehouseService } from './visionWarehouseService';
import { storage } from '../storage';
import type { Product, BusinessAccount } from '@shared/schema';

// Operation types to track what kind of indexing operation is in progress
export type IndexOperationType = 'create_index' | 'create_endpoint' | 'deploy_index' | 'update_index';

export interface SyncProgress {
  status: 'idle' | 'uploading' | 'analyzing' | 'indexing' | 'completed' | 'failed';
  phase: 'upload' | 'analyze' | 'index' | 'done';
  currentProduct: number;
  totalProducts: number;
  successCount: number;
  failedCount: number;
  currentProductName?: string;
  analyzeOperationName?: string;
  indexOperationName?: string;
  indexOperationType?: IndexOperationType;  // Track what kind of index operation is running
  error?: string;
  failedPhase?: 'upload' | 'analyze' | 'index';
  startedAt?: Date;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

class VisionWarehouseSyncService {
  private syncInProgress: Map<string, boolean> = new Map();

  async persistSyncStatus(businessAccountId: string, progress: SyncProgress): Promise<void> {
    try {
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncPhase: progress.status,
        visionWarehouseSyncProgress: progress.currentProduct.toString(),
        visionWarehouseSyncTotal: progress.totalProducts.toString(),
        visionWarehouseSyncSuccessCount: progress.successCount.toString(),
        visionWarehouseSyncFailedCount: progress.failedCount.toString(),
        visionWarehouseSyncError: progress.error || null,
        visionWarehouseSyncStartedAt: progress.startedAt || new Date(),
        visionWarehouseSyncAnalyzeOpName: progress.analyzeOperationName || null,
        visionWarehouseSyncIndexOpName: progress.indexOperationName || null,
        visionWarehouseSyncIndexOpType: progress.indexOperationType || null,
      } as any);
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to persist sync status:', error.message);
    }
  }

  async clearSyncStatus(businessAccountId: string): Promise<void> {
    try {
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncPhase: 'idle',
        visionWarehouseSyncProgress: '0',
        visionWarehouseSyncTotal: '0',
        visionWarehouseSyncSuccessCount: '0',
        visionWarehouseSyncFailedCount: '0',
        visionWarehouseSyncError: null,
        visionWarehouseSyncStartedAt: null,
        visionWarehouseSyncAnalyzeOpName: null,
        visionWarehouseSyncIndexOpName: null,
        visionWarehouseSyncIndexOpType: null,
      } as any);
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to clear sync status:', error.message);
    }
  }

  async markSyncCancelled(businessAccountId: string): Promise<void> {
    try {
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncPhase: 'failed',
        visionWarehouseSyncError: 'Operation cancelled by user',
      } as any);
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to mark sync cancelled:', error.message);
    }
  }

  async getPersistedSyncStatus(businessAccountId: string): Promise<SyncProgress | null> {
    try {
      const account = await storage.getBusinessAccount(businessAccountId);
      if (!account) return null;
      
      const phase = (account as any).visionWarehouseSyncPhase || 'idle';
      if (phase === 'idle') return null;
      
      return {
        status: phase as SyncProgress['status'],
        phase: this.statusToPhase(phase),
        currentProduct: parseInt((account as any).visionWarehouseSyncProgress || '0', 10),
        totalProducts: parseInt((account as any).visionWarehouseSyncTotal || '0', 10),
        successCount: parseInt((account as any).visionWarehouseSyncSuccessCount || '0', 10),
        failedCount: parseInt((account as any).visionWarehouseSyncFailedCount || '0', 10),
        error: (account as any).visionWarehouseSyncError || undefined,
        startedAt: (account as any).visionWarehouseSyncStartedAt || undefined,
        analyzeOperationName: (account as any).visionWarehouseSyncAnalyzeOpName || undefined,
        indexOperationName: (account as any).visionWarehouseSyncIndexOpName || undefined,
        indexOperationType: (account as any).visionWarehouseSyncIndexOpType || undefined,
      };
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to get sync status:', error.message);
      return null;
    }
  }

  private statusToPhase(status: string): 'upload' | 'analyze' | 'index' | 'done' {
    switch (status) {
      case 'uploading': return 'upload';
      case 'analyzing': return 'analyze';
      case 'indexing': return 'index';
      case 'completed': return 'done';
      default: return 'upload';
    }
  }

  isSyncInProgress(businessAccountId: string): boolean {
    return this.syncInProgress.get(businessAccountId) || false;
  }

  clearSyncFlag(businessAccountId: string): void {
    this.syncInProgress.set(businessAccountId, false);
  }

  async forceClearAllSyncState(businessAccountId: string): Promise<void> {
    console.log('[VisionWarehouseSync] Force clearing all sync state for:', businessAccountId);
    this.syncInProgress.set(businessAccountId, false);
    
    try {
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncPhase: 'idle',
        visionWarehouseSyncProgress: '0',
        visionWarehouseSyncTotal: '0',
        visionWarehouseSyncSuccessCount: '0',
        visionWarehouseSyncFailedCount: '0',
        visionWarehouseSyncError: null,
        visionWarehouseSyncStartedAt: null,
        visionWarehouseSyncAnalyzeOpName: null,
        visionWarehouseSyncIndexOpName: null,
        visionWarehouseSyncIndexOpType: null,
      } as any);
      console.log('[VisionWarehouseSync] Force cleared all sync state successfully');
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to force clear sync state:', error.message);
      throw error;
    }
  }

  async resetSyncStatus(businessAccountId: string): Promise<void> {
    const products = await storage.getAllProducts(businessAccountId);
    for (const product of products) {
      if (product.visionWarehouseAssetId) {
        await storage.updateProduct(product.id, businessAccountId, { visionWarehouseAssetId: null });
      }
    }
  }

  async syncProductToVisionWarehouse(
    product: Product,
    corpusId: string,
    encryptedCredentials: string,
    projectNumber?: string
  ): Promise<{ success: boolean; assetId?: string; error?: string }> {
    try {
      if (!product.imageUrl) {
        return { success: false, error: 'Product has no image URL' };
      }

      const assetId = `p-${product.id.toLowerCase()}`;

      await visionWarehouseService.createAsset(
        encryptedCredentials,
        corpusId,
        assetId,
        product.imageUrl,
        {},
        projectNumber
      );

      return { success: true, assetId };
    } catch (error: any) {
      console.error(`[VisionWarehouseSync] Failed to sync product ${product.id}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async bulkSyncProducts(
    businessAccountId: string,
    onProgress?: SyncProgressCallback
  ): Promise<{ success: boolean; successCount: number; failedCount: number; errors: Array<{ productId: string; error: string }>; failedPhase?: string }> {
    if (this.syncInProgress.get(businessAccountId)) {
      throw new Error('Sync already in progress for this business');
    }

    this.syncInProgress.set(businessAccountId, true);

    const progress: SyncProgress = {
      status: 'uploading',
      phase: 'upload',
      currentProduct: 0,
      totalProducts: 0,
      successCount: 0,
      failedCount: 0,
      startedAt: new Date(),
    };

    try {
      await this.persistSyncStatus(businessAccountId, progress);
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      if (!businessAccount) {
        throw new Error('Business account not found');
      }

      if (businessAccount.visualSearchModel !== 'google_vision_warehouse') {
        throw new Error('Vision Warehouse is not the selected visual search model');
      }

      const corpusId = businessAccount.googleVisionWarehouseCorpusId;
      if (!corpusId) {
        throw new Error('Vision Warehouse corpus ID not configured');
      }

      const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
      if (!encryptedCredentials) {
        throw new Error('Vision Warehouse credentials not configured. Please add your credentials in Visual Search Settings.');
      }

      const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;
      if (!projectNumber) {
        throw new Error('Vision Warehouse project number not configured. Please add your Google Cloud project number in Visual Search Settings.');
      }

      const products = await storage.getAllProducts(businessAccountId);
      const productsWithImages = products.filter(p => p.imageUrl);

      progress.totalProducts = productsWithImages.length;
      await this.persistSyncStatus(businessAccountId, progress);
      onProgress?.(progress);

      const errors: Array<{ productId: string; error: string }> = [];

      for (let i = 0; i < productsWithImages.length; i++) {
        const product = productsWithImages[i];
        progress.currentProduct = i + 1;
        progress.currentProductName = product.name;
        onProgress?.(progress);

        const result = await this.syncProductToVisionWarehouse(product, corpusId, encryptedCredentials, projectNumber);

        if (result.success && result.assetId) {
          await storage.updateProduct(product.id, businessAccountId, {
            visionWarehouseAssetId: result.assetId,
            visionWarehouseSyncedAt: new Date(),
          } as any);
          progress.successCount++;
        } else {
          progress.failedCount++;
          errors.push({ productId: product.id, error: result.error || 'Unknown error' });
        }

        onProgress?.(progress);
        
        // Persist every 5 products to avoid too many DB writes
        if (progress.currentProduct % 5 === 0 || progress.currentProduct === progress.totalProducts) {
          await this.persistSyncStatus(businessAccountId, progress);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // CORRECT ORDER: Upload → Analyze → Create Index → Create Endpoint → Deploy Index
      // (Update Index is only for incremental syncs when adding new products later)
      
      if (progress.successCount > 0) {
        let indexId = businessAccount.googleVisionWarehouseIndexId;
        let endpointId = businessAccount.googleVisionWarehouseEndpointId;
        const isIncrementalSync = !!indexId; // If index already exists, this is an incremental sync
        
        // ========================================
        // PHASE 2: ANALYZE CORPUS (generates embeddings from images)
        // This MUST happen BEFORE creating the index!
        // Smart strategy: Check for existing analyze operation before starting a new one
        // ========================================
        progress.status = 'analyzing';
        progress.phase = 'analyze';
        await this.persistSyncStatus(businessAccountId, progress);
        onProgress?.(progress);
        
        console.log('[VisionWarehouseSync] Phase 2: Starting corpus analysis (generating embeddings)...');
        try {
          let analyzeOperationName: string | null = null;
          
          // Step 1: Check if we have a persisted analyze operation from a previous attempt
          if (progress.analyzeOperationName) {
            console.log(`[VisionWarehouseSync] Found persisted analyze operation: ${progress.analyzeOperationName}`);
            // Verify if it's still valid/running
            try {
              const status = await visionWarehouseService.getOperationStatus(encryptedCredentials, progress.analyzeOperationName);
              if (!status.done) {
                console.log('[VisionWarehouseSync] Persisted analyze operation is still running, resuming polling...');
                analyzeOperationName = progress.analyzeOperationName;
              } else if (status.error) {
                console.log('[VisionWarehouseSync] Persisted analyze operation failed, will start new one');
              } else {
                console.log('[VisionWarehouseSync] Persisted analyze operation already completed!');
                // Already done successfully, skip to next phase
                analyzeOperationName = null; // Signal to skip polling
              }
            } catch (e: any) {
              console.log(`[VisionWarehouseSync] Could not check persisted operation: ${e.message}, will look for alternatives`);
            }
          }
          
          // Step 2: If no persisted operation, check for any in-progress analyze operations on the corpus
          if (!analyzeOperationName && !progress.analyzeOperationName) {
            console.log('[VisionWarehouseSync] Checking for existing in-progress analyze operations...');
            const existingOp = await visionWarehouseService.findInProgressAnalyzeOperation(
              encryptedCredentials, 
              corpusId, 
              projectNumber
            );
            
            if (existingOp) {
              console.log(`[VisionWarehouseSync] Found existing in-progress analyze: ${existingOp}`);
              analyzeOperationName = existingOp;
              progress.analyzeOperationName = existingOp;
              await this.persistSyncStatus(businessAccountId, progress);
            }
          }
          
          // Step 3: If still no operation found, start a new analyze
          if (!analyzeOperationName) {
            console.log('[VisionWarehouseSync] No existing analyze operation found, starting new one...');
            
            // Retry loop in case we hit RESOURCE_EXHAUSTED (try to find the existing operation)
            const maxRetries = 5;
            const retryDelay = 10000; // 10 seconds
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const analyzeResult = await visionWarehouseService.analyzeCorpus(encryptedCredentials, corpusId, projectNumber);
                analyzeOperationName = analyzeResult.operationName;
                console.log(`[VisionWarehouseSync] Started new analyze operation: ${analyzeOperationName}`);
                break;
              } catch (retryError: any) {
                const isResourceExhausted = retryError.message?.includes('429') || 
                                           retryError.message?.includes('RESOURCE_EXHAUSTED') ||
                                           retryError.message?.includes('Too many AnalyzeCorpus');
                
                if (isResourceExhausted) {
                  console.log(`[VisionWarehouseSync] RESOURCE_EXHAUSTED - another analyze is running, searching for it...`);
                  
                  // Wait a bit then try to find the running operation
                  await new Promise(resolve => setTimeout(resolve, retryDelay));
                  
                  const existingOp = await visionWarehouseService.findInProgressAnalyzeOperation(
                    encryptedCredentials, 
                    corpusId, 
                    projectNumber
                  );
                  
                  if (existingOp) {
                    console.log(`[VisionWarehouseSync] Found the running analyze operation: ${existingOp}`);
                    analyzeOperationName = existingOp;
                    break;
                  }
                  
                  if (attempt < maxRetries) {
                    console.log(`[VisionWarehouseSync] Could not find operation, retry ${attempt}/${maxRetries}...`);
                    continue;
                  }
                }
                throw retryError;
              }
            }
            
            if (!analyzeOperationName) {
              throw new Error('Failed to start or find corpus analysis operation');
            }
          }
          
          // Step 4: Persist and poll the analyze operation
          if (analyzeOperationName) {
            progress.analyzeOperationName = analyzeOperationName;
            await this.persistSyncStatus(businessAccountId, progress);
            onProgress?.(progress);
            
            // Poll for analyze completion (no timeout - wait for Google to finish)
            console.log('[VisionWarehouseSync] Waiting for corpus analysis to complete...');
            const analyzeComplete = await this.pollOperationCompletion(
              encryptedCredentials,
              analyzeOperationName,
              (status) => {
                console.log(`[VisionWarehouseSync] Analyze status: ${status.done ? 'complete' : 'in progress'}`);
              }
            );
            
            if (!analyzeComplete.success) {
              progress.status = 'failed';
              progress.error = analyzeComplete.error || 'Analysis failed';
              progress.failedPhase = 'analyze';
              onProgress?.(progress);
              return {
                success: false,
                successCount: progress.successCount,
                failedCount: progress.failedCount,
                errors: [...errors, { productId: 'analyze', error: progress.error }],
                failedPhase: 'analyze',
              };
            }
            
            // Clear analyze operation reference IMMEDIATELY after completion
            progress.analyzeOperationName = undefined;
            await storage.updateBusinessAccount(businessAccountId, {
              visionWarehouseSyncAnalyzeOpName: null,
            } as any);
          }
          
          console.log('[VisionWarehouseSync] Corpus analysis completed successfully!');
        } catch (analyzeError: any) {
          console.error('[VisionWarehouseSync] Analyze failed:', analyzeError.message);
          progress.status = 'failed';
          progress.error = `Analysis failed: ${analyzeError.message}`;
          progress.failedPhase = 'analyze';
          onProgress?.(progress);
          return {
            success: false,
            successCount: progress.successCount,
            failedCount: progress.failedCount,
            errors: [...errors, { productId: 'analyze', error: analyzeError.message }],
            failedPhase: 'analyze',
          };
        }

        // ========================================
        // PHASE 3: CREATE INDEX INFRASTRUCTURE (only for initial sync)
        // Now that analysis is complete, we can create the index
        // ========================================
        if (!isIncrementalSync) {
          progress.status = 'indexing';
          progress.phase = 'index';
          await this.persistSyncStatus(businessAccountId, progress);
          onProgress?.(progress);
          
          console.log('[VisionWarehouseSync] Phase 3: Setting up index infrastructure...');
          
          try {
            // Step 3a: Create Index (now safe - corpus is already analyzed)
            if (!indexId) {
              console.log('[VisionWarehouseSync] Creating index...');
              
              // Set operation type BEFORE starting for UI display
              progress.indexOperationType = 'create_index';
              await this.persistSyncStatus(businessAccountId, progress);
              onProgress?.(progress);
              
              const createIndexResult = await visionWarehouseService.createIndex(
                encryptedCredentials,
                corpusId,
                `Visual Search Index`,
                projectNumber
              );
              
              indexId = createIndexResult.indexId;
              
              // Persist operation name for resumability
              progress.indexOperationName = createIndexResult.operationName;
              await this.persistSyncStatus(businessAccountId, progress);
              
              // Wait for index creation to complete
              console.log('[VisionWarehouseSync] Waiting for index creation to complete...');
              const indexCreateComplete = await this.pollOperationCompletion(
                encryptedCredentials,
                createIndexResult.operationName,
                (status) => {
                  console.log(`[VisionWarehouseSync] Index creation: ${status.done ? 'complete' : 'in progress'}`);
                }
              );
              
              if (!indexCreateComplete.success) {
                throw new Error(`Index creation failed: ${indexCreateComplete.error}`);
              }
              
              // Clear operation reference IMMEDIATELY after completion to prevent re-polling on crash
              progress.indexOperationName = undefined;
              progress.indexOperationType = undefined;
              
              // Save the index ID
              await storage.updateBusinessAccount(businessAccountId, {
                googleVisionWarehouseIndexId: indexId,
                visionWarehouseSyncIndexOpName: null,
                visionWarehouseSyncIndexOpType: null,
              } as any);
              console.log(`[VisionWarehouseSync] Index created: ${indexId}`);
            }
            
            // Step 3b: Create Index Endpoint
            if (!endpointId) {
              console.log('[VisionWarehouseSync] Creating endpoint...');
              
              // Set operation type BEFORE starting for UI display
              progress.indexOperationType = 'create_endpoint';
              await this.persistSyncStatus(businessAccountId, progress);
              onProgress?.(progress);
              
              const createEndpointResult = await visionWarehouseService.createIndexEndpoint(
                encryptedCredentials,
                `Visual Search Endpoint`,
                projectNumber
              );
              endpointId = createEndpointResult.endpointId;
              
              // Persist operation name for resumability
              progress.indexOperationName = createEndpointResult.operationName;
              await this.persistSyncStatus(businessAccountId, progress);
              
              // Wait for endpoint creation to complete
              console.log('[VisionWarehouseSync] Waiting for endpoint creation to complete...');
              const endpointCreateComplete = await this.pollOperationCompletion(
                encryptedCredentials,
                createEndpointResult.operationName,
                (status) => {
                  console.log(`[VisionWarehouseSync] Endpoint creation: ${status.done ? 'complete' : 'in progress'}`);
                }
              );
              
              if (!endpointCreateComplete.success) {
                throw new Error(`Endpoint creation failed: ${endpointCreateComplete.error}`);
              }
              
              // Clear operation reference IMMEDIATELY after completion to prevent re-polling on crash
              progress.indexOperationName = undefined;
              progress.indexOperationType = undefined;
              
              // Save the endpoint ID
              await storage.updateBusinessAccount(businessAccountId, {
                googleVisionWarehouseEndpointId: endpointId,
                visionWarehouseSyncIndexOpName: null,
                visionWarehouseSyncIndexOpType: null,
              } as any);
              console.log(`[VisionWarehouseSync] Endpoint created: ${endpointId}`);
            }
            
            // Step 3c: Deploy Index to Endpoint
            console.log('[VisionWarehouseSync] Deploying index to endpoint...');
            
            // Set operation type BEFORE starting for UI display
            progress.indexOperationType = 'deploy_index';
            await this.persistSyncStatus(businessAccountId, progress);
            onProgress?.(progress);
            
            const deployResult = await visionWarehouseService.deployIndex(
              encryptedCredentials,
              endpointId,
              corpusId,
              indexId,
              projectNumber
            );
            
            // Persist operation name for resumability
            progress.indexOperationName = deployResult.operationName;
            await this.persistSyncStatus(businessAccountId, progress);
            
            // Wait for deployment to complete
            console.log('[VisionWarehouseSync] Waiting for index deployment to complete...');
            const deployComplete = await this.pollOperationCompletion(
              encryptedCredentials,
              deployResult.operationName,
              (status) => {
                console.log(`[VisionWarehouseSync] Index deployment: ${status.done ? 'complete' : 'in progress'}`);
              }
            );
            
            if (!deployComplete.success) {
              throw new Error(`Index deployment failed: ${deployComplete.error}`);
            }
            
            // Clear operation reference after successful deployment
            progress.indexOperationName = undefined;
            progress.indexOperationType = undefined;
            await storage.updateBusinessAccount(businessAccountId, {
              visionWarehouseSyncIndexOpName: null,
              visionWarehouseSyncIndexOpType: null,
            } as any);
            console.log('[VisionWarehouseSync] Index successfully deployed to endpoint!');
            
          } catch (infraError: any) {
            console.error('[VisionWarehouseSync] Infrastructure setup failed:', infraError.message);
            progress.status = 'failed';
            progress.error = `Infrastructure setup failed: ${infraError.message}`;
            progress.failedPhase = 'index';
            onProgress?.(progress);
            return {
              success: false,
              successCount: progress.successCount,
              failedCount: progress.failedCount,
              errors: [...errors, { productId: 'infrastructure', error: infraError.message }],
              failedPhase: 'index',
            };
          }
        } else {
          // ========================================
          // INCREMENTAL SYNC: Update existing index with new products
          // ========================================
          progress.status = 'indexing';
          progress.phase = 'index';
          await this.persistSyncStatus(businessAccountId, progress);
          onProgress?.(progress);
          
          console.log('[VisionWarehouseSync] Incremental sync: Updating existing index...');
          try {
            const indexResult = await visionWarehouseService.updateIndex(
              encryptedCredentials,
              corpusId,
              indexId!, // We know it exists because isIncrementalSync is true
              projectNumber
            );
            // Persist operation name and type for resumability
            progress.indexOperationName = indexResult.operationName;
            progress.indexOperationType = 'update_index';
            await this.persistSyncStatus(businessAccountId, progress);
            onProgress?.(progress);
            
            // Poll for index update completion
            const indexComplete = await this.pollOperationCompletion(
              encryptedCredentials,
              indexResult.operationName,
              (status) => {
                console.log(`[VisionWarehouseSync] Index update status: ${status.done ? 'complete' : 'in progress'}`);
              }
            );
            
            if (!indexComplete.success) {
              progress.status = 'failed';
              progress.error = indexComplete.error || 'Index update failed';
              progress.failedPhase = 'index';
              onProgress?.(progress);
              return {
                success: false,
                successCount: progress.successCount,
                failedCount: progress.failedCount,
                errors: [...errors, { productId: 'index', error: progress.error }],
                failedPhase: 'index',
              };
            }
            
            // Clear operation reference after successful update
            progress.indexOperationName = undefined;
            progress.indexOperationType = undefined;
            await storage.updateBusinessAccount(businessAccountId, {
              visionWarehouseSyncIndexOpName: null,
              visionWarehouseSyncIndexOpType: null,
            } as any);
            console.log('[VisionWarehouseSync] Index update completed successfully!');
          } catch (indexError: any) {
            console.error('[VisionWarehouseSync] Index update failed:', indexError.message);
            progress.status = 'failed';
            progress.error = `Index update failed: ${indexError.message}`;
            progress.failedPhase = 'index';
            onProgress?.(progress);
            return {
              success: false,
              successCount: progress.successCount,
              failedCount: progress.failedCount,
              errors: [...errors, { productId: 'index', error: indexError.message }],
              failedPhase: 'index',
            };
          }
        }
      }

      progress.status = 'completed';
      progress.phase = 'done';
      await this.clearSyncStatus(businessAccountId);
      onProgress?.(progress);

      return {
        success: true,
        successCount: progress.successCount,
        failedCount: progress.failedCount,
        errors,
      };
    } catch (error: any) {
      progress.status = 'failed';
      progress.error = error.message;
      await this.persistSyncStatus(businessAccountId, progress);
      onProgress?.(progress);
      throw error;
    } finally {
      this.syncInProgress.set(businessAccountId, false);
    }
  }

  /**
   * Poll for a long-running operation to complete.
   * Polls indefinitely for normal "in progress" status, but fails after repeated consecutive errors.
   * Returns the operation response which may contain the created resource on completion.
   */
  private async pollOperationCompletion(
    encryptedCredentials: string,
    operationName: string,
    onStatus?: (status: { done: boolean; error?: string }) => void
  ): Promise<{ success: boolean; error?: string; response?: any }> {
    const pollInterval = 5000; // 5 seconds
    const maxConsecutiveErrors = 10; // Fail after 10 consecutive polling errors
    let consecutiveErrors = 0;
    let lastError = '';
    
    while (true) {
      try {
        const status = await visionWarehouseService.getOperationStatus(encryptedCredentials, operationName);
        consecutiveErrors = 0; // Reset error counter on successful poll
        onStatus?.(status);
        
        if (status.done) {
          if (status.error) {
            return { success: false, error: status.error };
          }
          // Return the response which contains the created resource (e.g., index, endpoint)
          return { success: true, response: status.response };
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        consecutiveErrors++;
        lastError = error.message;
        console.error(`[VisionWarehouseSync] Error polling operation (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          return { success: false, error: `Operation polling failed after ${maxConsecutiveErrors} consecutive errors: ${lastError}` };
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }

  async deleteProductFromVisionWarehouse(
    product: Product,
    corpusId: string,
    encryptedCredentials: string,
    projectNumber?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!product.visionWarehouseAssetId) {
        return { success: true };
      }

      await visionWarehouseService.deleteAsset(encryptedCredentials, corpusId, product.visionWarehouseAssetId, projectNumber);

      return { success: true };
    } catch (error: any) {
      console.error(`[VisionWarehouseSync] Failed to delete product ${product.id}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async syncSingleProduct(
    businessAccountId: string,
    product: Product
  ): Promise<{ success: boolean; assetId?: string; error?: string }> {
    try {
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      if (!businessAccount) {
        return { success: false, error: 'Business account not found' };
      }

      const corpusId = businessAccount.googleVisionWarehouseCorpusId;
      if (!corpusId) {
        return { success: false, error: 'Vision Warehouse corpus ID not configured' };
      }

      const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
      if (!encryptedCredentials) {
        return { success: false, error: 'Vision Warehouse credentials not configured' };
      }

      const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;
      if (!projectNumber) {
        return { success: false, error: 'Vision Warehouse project number not configured' };
      }

      const result = await this.syncProductToVisionWarehouse(product, corpusId, encryptedCredentials, projectNumber);

      if (result.success && result.assetId) {
        await storage.updateProduct(product.id, businessAccountId, {
          visionWarehouseAssetId: result.assetId,
          visionWarehouseSyncedAt: new Date(),
        } as any);
      }

      return result;
    } catch (error: any) {
      console.error(`[VisionWarehouseSync] Failed to sync single product ${product.id}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getSyncStatus(businessAccountId: string): Promise<{
    totalProducts: number;
    syncedProducts: number;
    unsyncedProducts: number;
    isSyncing: boolean;
  }> {
    const products = await storage.getAllProducts(businessAccountId);
    const productsWithImages = products.filter(p => p.imageUrl);
    const syncedProducts = productsWithImages.filter(p => p.visionWarehouseAssetId);

    return {
      totalProducts: productsWithImages.length,
      syncedProducts: syncedProducts.length,
      unsyncedProducts: productsWithImages.length - syncedProducts.length,
      isSyncing: this.syncInProgress.get(businessAccountId) || false,
    };
  }

  async ensureIndexAndEndpoint(businessAccountId: string): Promise<{
    indexId: string;
    endpointId: string;
    isNewlyCreated: boolean;
  }> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const corpusId = businessAccount.googleVisionWarehouseCorpusId;
    if (!corpusId) {
      throw new Error('Vision Warehouse corpus ID not configured');
    }

    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    if (!encryptedCredentials) {
      throw new Error('Vision Warehouse credentials not configured');
    }

    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;
    if (!projectNumber) {
      throw new Error('Vision Warehouse project number not configured');
    }

    let indexId = businessAccount.googleVisionWarehouseIndexId;
    let endpointId = businessAccount.googleVisionWarehouseEndpointId;
    let isNewlyCreated = false;

    if (!indexId) {
      // Use shortened display name (max 32 chars for Google Vision Warehouse)
      const shortId = businessAccountId.slice(0, 8);
      const indexResult = await visionWarehouseService.createIndex(encryptedCredentials, corpusId, `idx_${shortId}`, projectNumber);
      indexId = indexResult.indexId;
      isNewlyCreated = true;

      await storage.updateBusinessAccountVisualSearchModel(businessAccountId, {
        googleVisionWarehouseIndexId: indexId,
      });
    }

    if (!endpointId) {
      // Use shortened display name (max 32 chars for Google Vision Warehouse)
      const shortId = businessAccountId.slice(0, 8);
      const endpointResult = await visionWarehouseService.createIndexEndpoint(encryptedCredentials, `ep_${shortId}`, projectNumber);
      endpointId = endpointResult.endpointId;
      isNewlyCreated = true;

      await storage.updateBusinessAccountVisualSearchModel(businessAccountId, {
        googleVisionWarehouseEndpointId: endpointId,
      });
    }

    return { indexId, endpointId, isNewlyCreated };
  }

  async deploySearchIndex(businessAccountId: string): Promise<void> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const corpusId = businessAccount.googleVisionWarehouseCorpusId;
    const indexId = businessAccount.googleVisionWarehouseIndexId;
    const endpointId = businessAccount.googleVisionWarehouseEndpointId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;

    if (!corpusId || !indexId || !endpointId) {
      throw new Error('Missing Vision Warehouse configuration (corpus, index, or endpoint)');
    }

    if (!encryptedCredentials) {
      throw new Error('Vision Warehouse credentials not configured');
    }

    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;
    if (!projectNumber) {
      throw new Error('Vision Warehouse project number not configured');
    }

    await visionWarehouseService.deployIndex(encryptedCredentials, endpointId, corpusId, indexId, projectNumber);
  }

  isSyncing(businessAccountId: string): boolean {
    return this.syncInProgress.get(businessAccountId) || false;
  }

  /**
   * Undeploy index from endpoint (stops serving costs)
   */
  async undeploySearchIndex(businessAccountId: string): Promise<void> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const endpointId = businessAccount.googleVisionWarehouseEndpointId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;

    if (!endpointId) {
      throw new Error('No index endpoint configured');
    }

    if (!encryptedCredentials || !projectNumber) {
      throw new Error('Vision Warehouse credentials not configured');
    }

    await visionWarehouseService.undeployIndex(encryptedCredentials, endpointId, projectNumber);
  }

  /**
   * Get the current status of the index endpoint
   */
  async getEndpointStatus(businessAccountId: string): Promise<{
    state: string;
    isDeployed: boolean;
    deployedIndexes: any[];
  }> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const endpointId = businessAccount.googleVisionWarehouseEndpointId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;

    if (!endpointId || !encryptedCredentials || !projectNumber) {
      return { state: 'NOT_CONFIGURED', isDeployed: false, deployedIndexes: [] };
    }

    try {
      const status = await visionWarehouseService.getIndexEndpointStatus(
        encryptedCredentials,
        endpointId,
        projectNumber
      );
      
      return {
        state: status.state,
        isDeployed: (status.deployedIndexes?.length || 0) > 0,
        deployedIndexes: status.deployedIndexes || [],
      };
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to get endpoint status:', error.message);
      return { state: 'ERROR', isDeployed: false, deployedIndexes: [] };
    }
  }

  /**
   * Analyze all assets in the corpus (generates embeddings)
   */
  async analyzeAllAssets(businessAccountId: string): Promise<{ operationName: string }> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const corpusId = businessAccount.googleVisionWarehouseCorpusId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;

    if (!corpusId || !encryptedCredentials || !projectNumber) {
      throw new Error('Vision Warehouse not configured');
    }

    return await visionWarehouseService.analyzeCorpus(encryptedCredentials, corpusId, projectNumber);
  }

  /**
   * Check status of a long-running operation (like corpus analysis)
   */
  async getOperationStatus(businessAccountId: string, operationName: string): Promise<{ done: boolean; error?: string; metadata?: any }> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    if (!encryptedCredentials) {
      throw new Error('Vision Warehouse credentials not configured');
    }

    return await visionWarehouseService.getOperationStatus(encryptedCredentials, operationName);
  }

  /**
   * Update index to sync with newly analyzed embeddings
   */
  async updateIndex(businessAccountId: string): Promise<{ operationName: string }> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const corpusId = businessAccount.googleVisionWarehouseCorpusId;
    const indexId = businessAccount.googleVisionWarehouseIndexId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;

    if (!corpusId || !indexId || !encryptedCredentials || !projectNumber) {
      throw new Error('Vision Warehouse index not configured');
    }

    return await visionWarehouseService.updateIndex(encryptedCredentials, corpusId, indexId, projectNumber);
  }
  /**
   * Resume any interrupted syncs on server startup.
   * Checks all business accounts for in-progress syncs and resumes polling their operations.
   */
  async resumeInterruptedSyncs(): Promise<void> {
    console.log('[VisionWarehouseSync] Checking for interrupted syncs to resume...');
    
    try {
      // Get all business accounts with active sync state
      const allAccounts = await storage.getAllBusinessAccounts();
      
      for (const account of allAccounts) {
        const phase = (account as any).visionWarehouseSyncPhase;
        
        // Only resume 'analyzing' or 'indexing' phases - these have long-running operations
        if (phase !== 'analyzing' && phase !== 'indexing') {
          continue;
        }
        
        const analyzeOpName = (account as any).visionWarehouseSyncAnalyzeOpName;
        const indexOpName = (account as any).visionWarehouseSyncIndexOpName;
        const indexOpType = (account as any).visionWarehouseSyncIndexOpType as IndexOperationType | null;
        const encryptedCredentials = account.googleVisionWarehouseCredentials;
        const corpusId = account.googleVisionWarehouseCorpusId;
        const projectNumber = account.googleVisionWarehouseProjectNumber;
        
        if (!encryptedCredentials || !corpusId || !projectNumber) {
          console.log(`[VisionWarehouseSync] Skipping ${account.id} - missing credentials`);
          continue;
        }
        
        console.log(`[VisionWarehouseSync] Found interrupted sync for ${account.name} (${account.id}), phase: ${phase}`);
        
        // Check if there's an operation to poll
        const operationToResume = phase === 'analyzing' ? analyzeOpName : indexOpName;
        const opType = phase === 'indexing' ? indexOpType : null;
        
        if (operationToResume) {
          // Resume polling in background (don't await - fire and forget)
          this.resumeSyncFromOperation(account.id, phase, operationToResume, opType).catch(err => {
            console.error(`[VisionWarehouseSync] Failed to resume sync for ${account.id}:`, err.message);
          });
        } else {
          // No operation name saved - check if there's one running on Google's side
          console.log(`[VisionWarehouseSync] No operation name found for ${phase} phase, searching for in-progress operations...`);
          
          // Get all operations and find the right type based on phase
          const operations = await visionWarehouseService.listOperations(
            encryptedCredentials,
            corpusId,
            projectNumber
          );
          
          // Find in-progress operation matching the phase
          let existingOp: string | null = null;
          let discoveredOpType: IndexOperationType | null = null;
          
          if (phase === 'analyzing') {
            const analyzeOp = operations.find(op => !op.done && op.methodType === 'AnalyzeCorpus');
            existingOp = analyzeOp?.name || null;
          } else if (phase === 'indexing') {
            // For indexing, look for CreateIndex, CreateIndexEndpoint, DeployIndex, or UpdateIndex operations
            const indexOp = operations.find(op => 
              !op.done && 
              (op.methodType === 'CreateIndex' || op.methodType === 'CreateIndexEndpoint' || 
               op.methodType === 'DeployIndex' || op.methodType === 'UpdateIndex')
            );
            existingOp = indexOp?.name || null;
            
            // Map Google's method type to our operation type
            if (indexOp?.methodType === 'CreateIndex') discoveredOpType = 'create_index';
            else if (indexOp?.methodType === 'CreateIndexEndpoint') discoveredOpType = 'create_endpoint';
            else if (indexOp?.methodType === 'DeployIndex') discoveredOpType = 'deploy_index';
            else if (indexOp?.methodType === 'UpdateIndex') discoveredOpType = 'update_index';
          }
          
          if (existingOp) {
            console.log(`[VisionWarehouseSync] Found in-progress ${phase} operation: ${existingOp}, type: ${discoveredOpType}`);
            
            // Save it and resume
            const updateFields = phase === 'analyzing' 
              ? { visionWarehouseSyncAnalyzeOpName: existingOp }
              : { visionWarehouseSyncIndexOpName: existingOp, visionWarehouseSyncIndexOpType: discoveredOpType };
            
            await storage.updateBusinessAccount(account.id, updateFields as any);
            
            this.resumeSyncFromOperation(account.id, phase, existingOp, discoveredOpType).catch(err => {
              console.error(`[VisionWarehouseSync] Failed to resume sync for ${account.id}:`, err.message);
            });
          } else {
            // For indexing phase without an operation, check if we can continue building infrastructure
            if (phase === 'indexing') {
              const hasIndex = !!account.googleVisionWarehouseIndexId;
              const hasEndpoint = !!account.googleVisionWarehouseEndpointId;
              
              // Continue building infrastructure from current state (idempotent)
              console.log(`[VisionWarehouseSync] Resuming infrastructure build (index: ${hasIndex}, endpoint: ${hasEndpoint})...`);
              this.syncInProgress.set(account.id, true);
              
              // Launch resume operation - use .finally() on the promise to guarantee flag cleanup
              Promise.resolve()
                .then(() => this.createIndexInfrastructure(account.id))
                .then(() => {
                  console.log(`[VisionWarehouseSync] Infrastructure resumed successfully for ${account.id}`);
                })
                .catch(async (err: any) => {
                  console.error(`[VisionWarehouseSync] Failed to continue infrastructure for ${account.id}:`, err.message);
                  try {
                    await storage.updateBusinessAccount(account.id, {
                      visionWarehouseSyncPhase: 'failed',
                      visionWarehouseSyncError: `Resume failed: ${err.message}`,
                    } as any);
                  } catch (dbErr) {
                    console.error(`[VisionWarehouseSync] Failed to persist error state:`, dbErr);
                  }
                })
                .finally(() => {
                  this.syncInProgress.set(account.id, false);
                });
            } else {
              console.log(`[VisionWarehouseSync] No running operation found for analyze phase - marking as failed`);
              await storage.updateBusinessAccount(account.id, {
                visionWarehouseSyncPhase: 'failed',
                visionWarehouseSyncError: 'No running operation found after restart',
              } as any);
            }
          }
        }
      }
      
      console.log('[VisionWarehouseSync] Finished checking for interrupted syncs');
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Error resuming interrupted syncs:', error.message);
    }
  }

  /**
   * Rehydrate resource IDs from a completed operation response.
   * Uses operation type to know what kind of resource was created.
   */
  private async rehydrateResourceFromOperationResponse(
    businessAccountId: string,
    resourceName: string,
    operationType: IndexOperationType
  ): Promise<void> {
    try {
      // Only rehydrate for operations that create new resources
      if (operationType === 'create_index') {
        // Extract index ID from path like: projects/.../corpora/.../indexes/{indexId}
        const indexId = resourceName.split('/indexes/').pop()?.split('/')[0];
        if (indexId) {
          console.log(`[VisionWarehouseSync] Rehydrating indexId from create_index operation: ${indexId}`);
          await storage.updateBusinessAccount(businessAccountId, {
            googleVisionWarehouseIndexId: indexId,
          } as any);
        }
      } else if (operationType === 'create_endpoint') {
        // Extract endpoint ID from path like: projects/.../indexEndpoints/{endpointId}
        const endpointId = resourceName.split('/indexEndpoints/').pop()?.split('/')[0];
        if (endpointId) {
          console.log(`[VisionWarehouseSync] Rehydrating endpointId from create_endpoint operation: ${endpointId}`);
          await storage.updateBusinessAccount(businessAccountId, {
            googleVisionWarehouseEndpointId: endpointId,
          } as any);
        }
      }
      // deploy_index and update_index don't create new resources, so nothing to rehydrate
    } catch (error: any) {
      console.error('[VisionWarehouseSync] Failed to rehydrate resource from operation:', error.message);
      // Non-fatal - continue with infrastructure checks
    }
  }

  /**
   * Resume sync by polling an existing operation and completing remaining phases.
   * Uses operation type to properly rehydrate state and continue the pipeline.
   */
  private async resumeSyncFromOperation(
    businessAccountId: string,
    phase: 'analyzing' | 'indexing',
    operationName: string,
    operationType?: IndexOperationType | null
  ): Promise<void> {
    console.log(`[VisionWarehouseSync] Resuming sync for ${businessAccountId} from ${phase} phase, operation: ${operationName}, type: ${operationType}`);
    
    // Mark as in progress
    this.syncInProgress.set(businessAccountId, true);
    
    try {
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      if (!businessAccount) {
        throw new Error('Business account not found');
      }
      
      const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
      const corpusId = businessAccount.googleVisionWarehouseCorpusId;
      const projectNumber = businessAccount.googleVisionWarehouseProjectNumber;
      
      if (!encryptedCredentials || !corpusId || !projectNumber) {
        throw new Error('Missing Vision Warehouse configuration');
      }
      
      // Poll the operation until complete
      console.log(`[VisionWarehouseSync] Polling ${phase} operation...`);
      const result = await this.pollOperationCompletion(
        encryptedCredentials,
        operationName,
        (status) => {
          console.log(`[VisionWarehouseSync] ${phase} status: ${status.done ? 'complete' : 'in progress'}`);
        }
      );
      
      if (!result.success) {
        console.error(`[VisionWarehouseSync] ${phase} failed:`, result.error);
        await storage.updateBusinessAccount(businessAccountId, {
          visionWarehouseSyncPhase: 'failed',
          visionWarehouseSyncError: result.error || `${phase} failed`,
        } as any);
        return;
      }
      
      console.log(`[VisionWarehouseSync] ${phase} completed successfully!`);
      
      // Rehydrate resource IDs based on operation type (more reliable than parsing response name)
      if (result.response?.name && operationType) {
        await this.rehydrateResourceFromOperationResponse(businessAccountId, result.response.name, operationType);
      }
      
      // Clear the completed operation reference to prevent re-polling on next restart
      if (phase === 'analyzing') {
        await storage.updateBusinessAccount(businessAccountId, {
          visionWarehouseSyncAnalyzeOpName: null,
        } as any);
      } else if (phase === 'indexing') {
        await storage.updateBusinessAccount(businessAccountId, {
          visionWarehouseSyncIndexOpName: null,
          visionWarehouseSyncIndexOpType: null,
        } as any);
      }
      
      // If we just finished analyzing, continue with index creation
      if (phase === 'analyzing') {
        // Re-fetch to get any rehydrated state
        const refreshedAccount = await storage.getBusinessAccount(businessAccountId);
        const indexId = refreshedAccount?.googleVisionWarehouseIndexId;
        
        if (!indexId) {
          // Need to create index infrastructure
          console.log('[VisionWarehouseSync] Continuing with index creation...');
          await this.createIndexInfrastructure(businessAccountId);
        } else {
          // Just need to update the index
          console.log('[VisionWarehouseSync] Continuing with index update...');
          await this.runIndexUpdate(businessAccountId);
        }
      }
      
      // If we finished an indexing operation, determine next step based on operation type
      if (phase === 'indexing') {
        // For update_index, just mark complete
        if (operationType === 'update_index') {
          await this.clearSyncStatus(businessAccountId);
          console.log('[VisionWarehouseSync] Index update sync completed successfully!');
          return;
        }
        
        // For deploy_index, just mark complete (deployment was the final step)
        if (operationType === 'deploy_index') {
          await this.clearSyncStatus(businessAccountId);
          console.log('[VisionWarehouseSync] Deployment sync completed successfully!');
          return;
        }
        
        // For create_index or create_endpoint, continue with remaining infrastructure steps
        // Re-fetch to get updated state
        const updatedAccount = await storage.getBusinessAccount(businessAccountId);
        if (!updatedAccount) {
          throw new Error('Business account not found after operation');
        }
        
        // Continue building infrastructure - createIndexInfrastructure is idempotent
        console.log('[VisionWarehouseSync] Continuing with remaining infrastructure steps...');
        await this.createIndexInfrastructure(businessAccountId);
      }
      
    } catch (error: any) {
      console.error(`[VisionWarehouseSync] Error resuming sync:`, error.message);
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncPhase: 'failed',
        visionWarehouseSyncError: error.message,
      } as any);
    } finally {
      this.syncInProgress.set(businessAccountId, false);
    }
  }

  /**
   * Create index infrastructure after corpus analysis is complete.
   * This function is smart about resuming - it checks what already exists and only creates what's missing.
   */
  private async createIndexInfrastructure(businessAccountId: string): Promise<void> {
    // Always fetch fresh state to check what already exists
    let businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) throw new Error('Business account not found');
    
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials!;
    const corpusId = businessAccount.googleVisionWarehouseCorpusId!;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber!;
    
    await storage.updateBusinessAccount(businessAccountId, {
      visionWarehouseSyncPhase: 'indexing',
    } as any);
    
    let indexId = businessAccount.googleVisionWarehouseIndexId;
    let endpointId = businessAccount.googleVisionWarehouseEndpointId;
    
    // Step 1: Create index (if not exists)
    if (!indexId) {
      console.log('[VisionWarehouseSync] Creating index...');
      const createIndexResult = await visionWarehouseService.createIndex(
        encryptedCredentials,
        corpusId,
        `Visual Search Index`,
        projectNumber
      );
      
      indexId = createIndexResult.indexId;
      
      // Persist operation name and type immediately so we can resume if interrupted
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncIndexOpName: createIndexResult.operationName,
        visionWarehouseSyncIndexOpType: 'create_index',
      } as any);
      
      // Wait for index creation
      const indexCreateComplete = await this.pollOperationCompletion(
        encryptedCredentials,
        createIndexResult.operationName,
        (status) => console.log(`[VisionWarehouseSync] Index creation: ${status.done ? 'complete' : 'in progress'}`)
      );
      
      if (!indexCreateComplete.success) {
        throw new Error(`Index creation failed: ${indexCreateComplete.error}`);
      }
      
      // Clear operation reference and save index ID
      await storage.updateBusinessAccount(businessAccountId, {
        googleVisionWarehouseIndexId: indexId,
        visionWarehouseSyncIndexOpName: null,
        visionWarehouseSyncIndexOpType: null,
      } as any);
      console.log(`[VisionWarehouseSync] Index created: ${indexId}`);
    } else {
      console.log(`[VisionWarehouseSync] Index already exists: ${indexId}`);
    }
    
    // Step 2: Create endpoint (if not exists)
    if (!endpointId) {
      console.log('[VisionWarehouseSync] Creating endpoint...');
      const createEndpointResult = await visionWarehouseService.createIndexEndpoint(
        encryptedCredentials,
        `Visual Search Endpoint`,
        projectNumber
      );
      
      endpointId = createEndpointResult.endpointId;
      
      // Persist operation name and type
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncIndexOpName: createEndpointResult.operationName,
        visionWarehouseSyncIndexOpType: 'create_endpoint',
      } as any);
      
      const endpointCreateComplete = await this.pollOperationCompletion(
        encryptedCredentials,
        createEndpointResult.operationName,
        (status) => console.log(`[VisionWarehouseSync] Endpoint creation: ${status.done ? 'complete' : 'in progress'}`)
      );
      
      if (!endpointCreateComplete.success) {
        throw new Error(`Endpoint creation failed: ${endpointCreateComplete.error}`);
      }
      
      // Clear operation reference and save endpoint ID
      await storage.updateBusinessAccount(businessAccountId, {
        googleVisionWarehouseEndpointId: endpointId,
        visionWarehouseSyncIndexOpName: null,
        visionWarehouseSyncIndexOpType: null,
      } as any);
      console.log(`[VisionWarehouseSync] Endpoint created: ${endpointId}`);
    } else {
      console.log(`[VisionWarehouseSync] Endpoint already exists: ${endpointId}`);
    }
    
    // Step 3: Deploy index to endpoint (check if already deployed)
    let isDeployed = false;
    try {
      const endpointInfo = await visionWarehouseService.getIndexEndpoint(
        encryptedCredentials,
        endpointId!,
        projectNumber
      );
      isDeployed = endpointInfo.deployedIndexes?.some(
        (deployed) => deployed.index?.includes(indexId!)
      ) ?? false;
    } catch (e) {
      // If we can't check, assume not deployed
      console.log('[VisionWarehouseSync] Could not check deployment status, will attempt deploy');
    }
    
    if (!isDeployed) {
      console.log('[VisionWarehouseSync] Deploying index to endpoint...');
      const deployResult = await visionWarehouseService.deployIndex(
        encryptedCredentials,
        endpointId!,
        corpusId,
        indexId!,
        projectNumber
      );
      
      // Persist operation name and type
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncIndexOpName: deployResult.operationName,
        visionWarehouseSyncIndexOpType: 'deploy_index',
      } as any);
      
      const deployComplete = await this.pollOperationCompletion(
        encryptedCredentials,
        deployResult.operationName,
        (status) => console.log(`[VisionWarehouseSync] Deployment: ${status.done ? 'complete' : 'in progress'}`)
      );
      
      if (!deployComplete.success) {
        throw new Error(`Deployment failed: ${deployComplete.error}`);
      }
      
      // Clear operation reference after successful deployment
      await storage.updateBusinessAccount(businessAccountId, {
        visionWarehouseSyncIndexOpName: null,
        visionWarehouseSyncIndexOpType: null,
      } as any);
      console.log('[VisionWarehouseSync] Index deployed successfully!');
    } else {
      console.log('[VisionWarehouseSync] Index already deployed to endpoint');
    }
    
    console.log('[VisionWarehouseSync] Index infrastructure setup complete!');
    await this.clearSyncStatus(businessAccountId);
  }

  /**
   * Run index update for incremental syncs.
   */
  private async runIndexUpdate(businessAccountId: string): Promise<void> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) throw new Error('Business account not found');
    
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials!;
    const corpusId = businessAccount.googleVisionWarehouseCorpusId!;
    const indexId = businessAccount.googleVisionWarehouseIndexId!;
    const projectNumber = businessAccount.googleVisionWarehouseProjectNumber!;
    
    await storage.updateBusinessAccount(businessAccountId, {
      visionWarehouseSyncPhase: 'indexing',
    } as any);
    
    const indexResult = await visionWarehouseService.updateIndex(
      encryptedCredentials,
      corpusId,
      indexId,
      projectNumber
    );
    
    await storage.updateBusinessAccount(businessAccountId, {
      visionWarehouseSyncIndexOpName: indexResult.operationName,
      visionWarehouseSyncIndexOpType: 'update_index',
    } as any);
    
    const indexComplete = await this.pollOperationCompletion(
      encryptedCredentials,
      indexResult.operationName,
      (status) => console.log(`[VisionWarehouseSync] Index update: ${status.done ? 'complete' : 'in progress'}`)
    );
    
    if (!indexComplete.success) {
      throw new Error(`Index update failed: ${indexComplete.error}`);
    }
    
    console.log('[VisionWarehouseSync] Index update complete!');
    await this.clearSyncStatus(businessAccountId);
  }
}

export const visionWarehouseSyncService = new VisionWarehouseSyncService();
