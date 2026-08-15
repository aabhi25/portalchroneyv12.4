import { db } from '../server/db';
import { productJewelryEmbeddings } from '../shared/schema';
import { embeddingService } from '../server/services/embeddingService';
import { isNull, eq } from 'drizzle-orm';

async function generateMissingDescriptionEmbeddings() {
  console.log('[Script] Finding jewelry items without description embeddings...');
  
  // Find jewelry embeddings that have descriptions but no description embeddings
  const missing = await db.select({
    id: productJewelryEmbeddings.id,
    productId: productJewelryEmbeddings.productId,
    businessAccountId: productJewelryEmbeddings.businessAccountId,
    description: productJewelryEmbeddings.description,
    jewelryType: productJewelryEmbeddings.jewelryType
  })
  .from(productJewelryEmbeddings)
  .where(isNull(productJewelryEmbeddings.descriptionEmbedding));
  
  console.log(`[Script] Found ${missing.length} jewelry items without description embeddings`);
  
  // Check how many have descriptions
  const withDescriptions = missing.filter(m => m.description);
  console.log(`[Script] ${withDescriptions.length} have descriptions to embed`);
  
  if (withDescriptions.length === 0) {
    console.log('[Script] No items need description embedding generation');
    return;
  }
  
  let processed = 0;
  let failed = 0;
  
  for (const item of withDescriptions) {
    try {
      console.log(`[Script] (${processed + 1}/${withDescriptions.length}) Generating embedding for ${item.jewelryType}...`);
      
      const embedding = await embeddingService.generateEmbedding(item.description!, item.businessAccountId);
      
      await db.update(productJewelryEmbeddings)
        .set({ descriptionEmbedding: embedding })
        .where(eq(productJewelryEmbeddings.id, item.id));
      
      processed++;
      console.log(`[Script] ✓ Generated ${embedding.length}-dim embedding`);
    } catch (error: any) {
      failed++;
      console.error(`[Script] ✗ Failed: ${error.message}`);
    }
  }
  
  console.log(`\n[Script] Complete! Processed: ${processed}, Failed: ${failed}`);
}

generateMissingDescriptionEmbeddings()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
