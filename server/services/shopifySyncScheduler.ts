import { storage } from "../storage";
import { ShopifyService } from "./shopifyService";

export class ShopifySyncScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.isRunning) {
      console.log('[Shopify Sync] Scheduler already running');
      return;
    }

    this.isRunning = true;
    console.log('[Shopify Sync] Starting background sync scheduler');

    const checkInterval = 5 * 60 * 1000;

    this.intervalId = setInterval(async () => {
      await this.runSyncCheck();
    }, checkInterval);

    this.runSyncCheck();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[Shopify Sync] Background sync scheduler stopped');
  }

  private async runSyncCheck() {
    try {
      console.log('[Shopify Sync] Checking for accounts that need syncing...');

      const accountsNeedingSync = await storage.getAccountsNeedingShopifySync();

      if (accountsNeedingSync.length === 0) {
        console.log('[Shopify Sync] No accounts need syncing at this time');
        return;
      }

      console.log(`[Shopify Sync] Found ${accountsNeedingSync.length} account(s) needing sync`);

      for (const account of accountsNeedingSync) {
        await this.syncAccount(account.id);
        
        await this.sleep(2000);
      }

    } catch (error: any) {
      console.error('[Shopify Sync] Error during sync check:', error.message);
    }
  }

  private async syncAccount(businessAccountId: string) {
    try {
      console.log(`[Shopify Sync] Starting sync for account: ${businessAccountId}`);

      // Check if account is already syncing
      const currentSettings = await storage.getShopifyAutoSyncSettings(businessAccountId);
      if (currentSettings.syncStatus === 'syncing') {
        console.log(`[Shopify Sync] Account ${businessAccountId} is already syncing, skipping`);
        return;
      }

      await storage.updateShopifySyncStatus(businessAccountId, 'syncing');

      const credentials = await storage.getShopifyCredentials(businessAccountId);
      
      if (!credentials.storeUrl || !credentials.accessToken) {
        console.log(`[Shopify Sync] Account ${businessAccountId} has no Shopify credentials configured, skipping`);
        await storage.updateShopifySyncStatus(businessAccountId, 'idle');
        return;
      }

      const shopifyService = new ShopifyService(credentials.storeUrl, credentials.accessToken);

      const isConnected = await shopifyService.testConnection();
      if (!isConnected) {
        console.error(`[Shopify Sync] Failed to connect to Shopify for account ${businessAccountId}`);
        await storage.updateShopifySyncStatus(businessAccountId, 'failed');
        return;
      }

      const shopifyProducts = await shopifyService.fetchProducts(250);
      console.log(`[Shopify Sync] Fetched ${shopifyProducts.length} products for account ${businessAccountId}`);

      // Cache existing products once and build a Map for O(1) lookups
      const existingProducts = await storage.getAllProducts(businessAccountId);
      const existingProductsMap = new Map(
        existingProducts
          .filter(p => p.shopifyProductId)
          .map(p => [p.shopifyProductId!, p])
      );
      console.log(`[Shopify Sync] Loaded ${existingProducts.length} existing products (${existingProductsMap.size} from Shopify) from database`);

      let importedCount = 0;
      let updatedCount = 0;

      for (const shopifyProduct of shopifyProducts) {
        try {
          const existing = existingProductsMap.get(shopifyProduct.shopifyId);

          if (existing) {
            await storage.updateProduct(existing.id, businessAccountId, {
              name: shopifyProduct.name,
              description: shopifyProduct.description,
              price: shopifyProduct.price || undefined,
              imageUrl: shopifyProduct.imageUrl || undefined,
              shopifyLastSyncedAt: new Date(),
            });
            updatedCount++;
          } else {
            await storage.createProduct({
              businessAccountId,
              name: shopifyProduct.name,
              description: shopifyProduct.description,
              price: shopifyProduct.price || undefined,
              imageUrl: shopifyProduct.imageUrl || undefined,
              source: 'shopify',
              shopifyProductId: shopifyProduct.shopifyId,
              shopifyLastSyncedAt: new Date(),
              isEditable: 'false',
            });
            importedCount++;
          }
        } catch (productError) {
          console.error('[Shopify Sync] Failed to sync product:', productError);
        }
      }

      await storage.updateShopifySyncStatus(businessAccountId, 'completed');
      await storage.updateShopifyLastSyncedAt(businessAccountId);

      console.log(`[Shopify Sync] Completed sync for account ${businessAccountId}: ${importedCount} new, ${updatedCount} updated`);

    } catch (error: any) {
      console.error(`[Shopify Sync] Error syncing account ${businessAccountId}:`, error.message);
      await storage.updateShopifySyncStatus(businessAccountId, 'failed');
    }
  }

  async syncNow(businessAccountId: string): Promise<{ success: boolean; message: string; stats?: { imported: number; updated: number } }> {
    try {
      console.log(`[Shopify Sync] Manual sync requested for account: ${businessAccountId}`);

      // Check if account is already syncing
      const currentSettings = await storage.getShopifyAutoSyncSettings(businessAccountId);
      if (currentSettings.syncStatus === 'syncing') {
        return {
          success: false,
          message: 'A sync is already in progress. Please wait for it to complete.'
        };
      }

      await storage.updateShopifySyncStatus(businessAccountId, 'syncing');

      const credentials = await storage.getShopifyCredentials(businessAccountId);
      
      if (!credentials.storeUrl || !credentials.accessToken) {
        await storage.updateShopifySyncStatus(businessAccountId, 'idle');
        return {
          success: false,
          message: 'Shopify credentials not configured'
        };
      }

      const shopifyService = new ShopifyService(credentials.storeUrl, credentials.accessToken);

      const isConnected = await shopifyService.testConnection();
      if (!isConnected) {
        await storage.updateShopifySyncStatus(businessAccountId, 'failed');
        return {
          success: false,
          message: 'Failed to connect to Shopify. Please check your credentials.'
        };
      }

      const shopifyProducts = await shopifyService.fetchProducts(250);

      // Cache existing products once and build a Map for O(1) lookups
      const existingProducts = await storage.getAllProducts(businessAccountId);
      const existingProductsMap = new Map(
        existingProducts
          .filter(p => p.shopifyProductId)
          .map(p => [p.shopifyProductId!, p])
      );

      let importedCount = 0;
      let updatedCount = 0;

      for (const shopifyProduct of shopifyProducts) {
        try {
          const existing = existingProductsMap.get(shopifyProduct.shopifyId);

          if (existing) {
            await storage.updateProduct(existing.id, businessAccountId, {
              name: shopifyProduct.name,
              description: shopifyProduct.description,
              price: shopifyProduct.price || undefined,
              imageUrl: shopifyProduct.imageUrl || undefined,
              shopifyLastSyncedAt: new Date(),
            });
            updatedCount++;
          } else {
            await storage.createProduct({
              businessAccountId,
              name: shopifyProduct.name,
              description: shopifyProduct.description,
              price: shopifyProduct.price || undefined,
              imageUrl: shopifyProduct.imageUrl || undefined,
              source: 'shopify',
              shopifyProductId: shopifyProduct.shopifyId,
              shopifyLastSyncedAt: new Date(),
              isEditable: 'false',
            });
            importedCount++;
          }
        } catch (productError) {
          console.error('[Shopify Sync] Failed to sync product:', productError);
        }
      }

      await storage.updateShopifySyncStatus(businessAccountId, 'completed');
      await storage.updateShopifyLastSyncedAt(businessAccountId);

      return {
        success: true,
        message: `Successfully synced ${shopifyProducts.length} products from Shopify`,
        stats: { imported: importedCount, updated: updatedCount }
      };

    } catch (error: any) {
      console.error(`[Shopify Sync] Error during manual sync:`, error.message);
      await storage.updateShopifySyncStatus(businessAccountId, 'failed');
      return {
        success: false,
        message: error.message || 'Failed to sync products from Shopify'
      };
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const shopifySyncScheduler = new ShopifySyncScheduler();
