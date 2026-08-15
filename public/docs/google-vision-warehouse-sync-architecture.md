# Google Vision Warehouse Sync - Complete Architecture Documentation

**Version:** 1.0  
**Last Updated:** January 2026  
**Platform:** Hi Chroney AI Business Chatbot Platform

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Database Schema](#4-database-schema)
5. [Sync Pipeline Phases](#5-sync-pipeline-phases)
6. [API Endpoints](#6-api-endpoints)
7. [Service Layer Architecture](#7-service-layer-architecture)
8. [Resumption & Fault Tolerance](#8-resumption--fault-tolerance)
9. [Security Considerations](#9-security-considerations)
10. [Error Handling](#10-error-handling)
11. [Known Limitations](#11-known-limitations)

---

## 1. Executive Summary

The Google Vision Warehouse Sync feature enables businesses to sync their product catalog images to Google Cloud's Vision AI Warehouse service for visual similarity search. This allows end-users to upload an image and find visually similar products from the business's catalog.

### Key Capabilities:
- **Dual-Model Support**: Platform supports both Jina CLIP v2 (local embeddings) and Google Vision Warehouse (managed cloud service)
- **Automated Pipeline**: Full sync workflow from asset upload through index deployment
- **Crash Recovery**: Intelligent resumption of interrupted sync operations
- **Multi-Tenant**: Each business account has isolated Vision Warehouse resources (corpus, index, endpoint)

---

## 2. System Overview

### Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express.js |
| Database | PostgreSQL with Drizzle ORM |
| Cloud Service | Google Vision AI Warehouse API |
| Authentication | Google Service Account (JWT) |
| Encryption | AES-256-GCM for credential storage |

### High-Level Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Business User  │────▶│  Express API     │────▶│  Google Vision      │
│  (Dashboard)    │     │  (routes.ts)     │     │  Warehouse API      │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  PostgreSQL DB   │
                        │  (sync state)    │
                        └──────────────────┘
```

---

## 3. Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE VISION WAREHOUSE SYNC                         │
└────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Visual Search Settings Page                                                │
│  ├── Model Selection (Jina CLIP v2 / Google Vision Warehouse)              │
│  ├── Credentials Configuration (Service Account JSON)                       │
│  ├── Corpus/Index/Endpoint ID Display                                       │
│  └── Sync Status & Progress UI                                              │
│                                                                              │
│  Products Page                                                               │
│  ├── "Google Vision Warehouse Sync" Card                                    │
│  ├── Sync Progress Indicator                                                │
│  ├── Cancel Button                                                          │
│  └── Resync All Button                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER (routes.ts)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  GET  /api/vision-warehouse/sync-status      → Get current sync status      │
│  GET  /api/vision-warehouse/sync-progress    → Start bulk sync (SSE)        │
│  POST /api/vision-warehouse/reset-sync       → Reset all product sync flags │
│  POST /api/vision-warehouse/force-cancel     → Force cancel sync            │
│  POST /api/vision-warehouse/clear-sync-flag  → Clear in-progress flag       │
│  GET  /api/vision-warehouse/operations       → List running operations      │
│  POST /api/vision-warehouse/cancel-operation → Cancel specific operation    │
│  POST /api/vision-warehouse/credentials      → Save encrypted credentials   │
│  POST /api/vision-warehouse/test-credentials → Validate credentials         │
│  GET  /api/vision-warehouse/assets           → List synced products         │
│  DELETE /api/vision-warehouse/assets/:id     → Delete specific asset        │
│  DELETE /api/vision-warehouse/assets         → Delete all assets            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVICE LAYER                                      │
├──────────────────────────────────┬──────────────────────────────────────────┤
│  visionWarehouseSyncService.ts   │  visionWarehouseService.ts               │
│  ─────────────────────────────   │  ────────────────────────                │
│  Orchestration & State Mgmt      │  Google API Wrapper                      │
│  ├── bulkSyncProducts()          │  ├── createCorpus()                      │
│  ├── persistSyncStatus()         │  ├── createAsset()                       │
│  ├── clearSyncStatus()           │  ├── analyzeCorpus()                     │
│  ├── resumeInterruptedSyncs()    │  ├── createIndex()                       │
│  ├── pollOperationCompletion()   │  ├── createIndexEndpoint()               │
│  ├── createIndexInfrastructure() │  ├── deployIndex()                       │
│  ├── rehydrateResource...()      │  ├── updateIndex()                       │
│  └── syncSingleProduct()         │  ├── searchByImage()                     │
│                                  │  ├── listOperations()                    │
│                                  │  ├── getOperationStatus()                │
│                                  │  └── cancelOperation()                   │
└──────────────────────────────────┴──────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE CLOUD VISION WAREHOUSE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Corpus (Container)                                                          │
│  ├── Assets (Product Images)                                                 │
│  │   ├── Asset p-{product-uuid-1}                                           │
│  │   ├── Asset p-{product-uuid-2}                                           │
│  │   └── ...                                                                │
│  │                                                                           │
│  └── Index (Embeddings)                                                      │
│      └── Deployed to IndexEndpoint                                           │
│                                                                              │
│  IndexEndpoint (Search Serving)                                              │
│  └── Receives search queries with image embeddings                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Schema

### Business Accounts Table (relevant fields)

```sql
-- Visual Search Model Selection
visual_search_model TEXT DEFAULT 'jina_clip'  -- 'jina_clip' | 'google_vision_warehouse'

-- Google Vision Warehouse Configuration
google_vision_warehouse_corpus_id TEXT        -- Corpus ID for this business
google_vision_warehouse_index_id TEXT         -- Index ID (created during first sync)
google_vision_warehouse_endpoint_id TEXT      -- Endpoint ID (created during first sync)
google_vision_warehouse_credentials TEXT      -- AES-256-GCM encrypted service account JSON
google_vision_warehouse_project_number TEXT   -- Google Cloud project NUMBER (numeric)

-- Sync State Persistence (survives server restarts)
vision_warehouse_sync_phase TEXT DEFAULT 'idle'           -- 'idle'|'uploading'|'analyzing'|'indexing'|'completed'|'failed'
vision_warehouse_sync_progress NUMERIC DEFAULT 0          -- Current product count
vision_warehouse_sync_total NUMERIC DEFAULT 0             -- Total products to sync
vision_warehouse_sync_success_count NUMERIC DEFAULT 0     -- Successful uploads
vision_warehouse_sync_failed_count NUMERIC DEFAULT 0      -- Failed uploads
vision_warehouse_sync_error TEXT                          -- Error message if failed
vision_warehouse_sync_started_at TIMESTAMP                -- Sync start time
vision_warehouse_sync_analyze_op_name TEXT                -- Current analyze operation name
vision_warehouse_sync_index_op_name TEXT                  -- Current index operation name
vision_warehouse_sync_index_op_type TEXT                  -- 'create_index'|'create_endpoint'|'deploy_index'|'update_index'
```

### Products Table (relevant fields)

```sql
vision_warehouse_asset_id TEXT      -- Google Vision Warehouse asset ID (e.g., 'p-{uuid}')
vision_warehouse_synced_at TIMESTAMP -- When last synced to Vision Warehouse
```

---

## 5. Sync Pipeline Phases

The sync process consists of **4 sequential phases**:

### Phase 1: Asset Upload

```
For each product with an image:
  1. Create asset in Vision Warehouse corpus
  2. Upload image content via signed URI
  3. Store asset ID in product record
  4. Update sync progress in database
```

**Duration:** ~200ms per product (rate limited)

### Phase 2: Corpus Analysis (AnalyzeCorpus)

```
1. Check for existing in-progress analyze operation
2. If found: resume polling that operation
3. If not found: start new AnalyzeCorpus operation
4. Poll operation status until complete
5. Clear operation reference immediately after completion
```

**Duration:** 2-10 minutes (depends on corpus size)  
**Google Limit:** 1 concurrent AnalyzeCorpus operation per corpus

### Phase 3: Index Infrastructure (Initial Sync Only)

For first-time syncs, creates the search infrastructure:

```
Step 3a: CreateIndex
  ├── Start long-running operation
  ├── Persist operation name + type
  ├── Poll until complete
  └── Save index ID to database

Step 3b: CreateIndexEndpoint
  ├── Start long-running operation
  ├── Persist operation name + type
  ├── Poll until complete
  └── Save endpoint ID to database

Step 3c: DeployIndex
  ├── Deploy index to endpoint
  ├── Persist operation name + type
  ├── Poll until complete
  └── Clear operation references
```

**Duration:** 5-15 minutes total

### Phase 4: Index Update (Incremental Syncs)

For subsequent syncs when products are added/changed:

```
1. Start UpdateIndex operation
2. Persist operation name + type ('update_index')
3. Poll until complete
4. Clear operation references
5. Mark sync complete
```

**Duration:** 2-5 minutes

---

## 6. API Endpoints

### Sync Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vision-warehouse/sync-status` | GET | Returns current sync status and counts |
| `/api/vision-warehouse/sync-progress` | GET | Starts bulk sync with SSE progress updates |
| `/api/vision-warehouse/reset-sync` | POST | Clears all product sync flags (visionWarehouseAssetId) |
| `/api/vision-warehouse/force-cancel` | POST | Force clears all sync state |
| `/api/vision-warehouse/clear-sync-flag` | POST | Clears in-progress memory flag |

### Operation Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vision-warehouse/operations` | GET | Lists all operations for the business's corpus |
| `/api/vision-warehouse/cancel-operation` | POST | Cancels a specific long-running operation |
| `/api/vision-warehouse/operation-status` | GET | Gets status of a specific operation |

### Credentials Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vision-warehouse/credentials` | POST | Saves encrypted service account credentials |
| `/api/vision-warehouse/test-credentials` | POST | Validates credentials work with Google API |

### Asset Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vision-warehouse/assets` | GET | Lists all synced products with asset IDs |
| `/api/vision-warehouse/assets/:productId` | DELETE | Deletes a specific asset from Vision Warehouse |
| `/api/vision-warehouse/assets` | DELETE | Deletes all assets from Vision Warehouse |

### Visual Search

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vision-warehouse/search` | GET | Text-based search (if supported) |
| `/api/visual-search` | POST | Image-based search (main search endpoint) |

---

## 7. Service Layer Architecture

### VisionWarehouseService (`visionWarehouseService.ts`)

Low-level wrapper for Google Vision Warehouse REST API.

**Key Methods:**

```typescript
// Authentication
async getAccessToken(encryptedCredentials: string): Promise<string>
async testCredentials(encryptedCredentials: string): Promise<{valid, projectId, error}>

// Corpus Management
async createCorpus(credentials, name, ttlDays, location): Promise<{corpusId, name}>
async listCorpora(credentials): Promise<Array<{corpusId, displayName}>>

// Asset Management
async createAsset(credentials, corpusId, assetId, imageUrl, annotations, projectNumber): Promise<void>
async deleteAsset(credentials, corpusId, assetId, projectNumber): Promise<void>

// Analysis
async analyzeCorpus(credentials, corpusId, projectNumber): Promise<{operationName}>

// Index Management
async createIndex(credentials, corpusId, displayName, projectNumber): Promise<{indexId, operationName}>
async createIndexEndpoint(credentials, displayName, projectNumber): Promise<{endpointId, operationName}>
async deployIndex(credentials, endpointId, corpusId, indexId, projectNumber): Promise<{operationName}>
async updateIndex(credentials, corpusId, indexId, projectNumber): Promise<{operationName}>

// Operations
async listOperations(credentials, corpusId, projectNumber): Promise<Array<Operation>>
async getOperationStatus(credentials, operationName): Promise<{done, error, response}>
async cancelOperation(credentials, operationName): Promise<{success, error}>

// Search
async searchByImage(credentials, endpointId, imageBase64, limit): Promise<Array<{assetId, score}>>
```

### VisionWarehouseSyncService (`visionWarehouseSyncService.ts`)

High-level orchestration service that manages the sync pipeline.

**Key Methods:**

```typescript
// Main Sync Entry Point
async bulkSyncProducts(businessAccountId, onProgress?): Promise<{success, successCount, failedCount, errors}>

// State Management
async persistSyncStatus(businessAccountId, progress): Promise<void>
async clearSyncStatus(businessAccountId): Promise<void>
async getPersistedSyncStatus(businessAccountId): Promise<SyncProgress | null>
async forceClearAllSyncState(businessAccountId): Promise<void>

// Resume Logic
async resumeInterruptedSyncs(): Promise<void>  // Called on server startup
private async resumeSyncFromOperation(businessAccountId, phase, operationName, operationType): Promise<void>

// Infrastructure
private async createIndexInfrastructure(businessAccountId): Promise<void>
private async runIndexUpdate(businessAccountId): Promise<void>

// Polling
private async pollOperationCompletion(credentials, operationName, onStatus?): Promise<{success, error, response}>

// Resource Rehydration
private async rehydrateResourceFromOperationResponse(businessAccountId, resourceName, operationType): Promise<void>
```

---

## 8. Resumption & Fault Tolerance

### Problem Statement

Google Vision Warehouse operations can take 5-15 minutes. If the server crashes mid-operation, we need to:
1. Detect the interrupted state on restart
2. Find the running operation on Google's side
3. Resume polling without creating duplicate resources

### Solution: Operation Tracking with Type Information

**Key Design Decisions:**

1. **Persist operation name AND type immediately** before polling
2. **Clear operation reference immediately** after each step completes
3. **Use idempotent infrastructure creation** that checks existing resources
4. **Track operation types** to know how to rehydrate state

### Operation Types

```typescript
type IndexOperationType = 'create_index' | 'create_endpoint' | 'deploy_index' | 'update_index';
```

### Resume Flow

```
Server Startup
    │
    ▼
resumeInterruptedSyncs()
    │
    ├── Find all accounts with phase = 'analyzing' or 'indexing'
    │
    ├── For each account:
    │   │
    │   ├── Has stored operation name?
    │   │   ├── YES: resumeSyncFromOperation(phase, opName, opType)
    │   │   │        └── Poll until complete, then continue pipeline
    │   │   │
    │   │   └── NO: Search for running operations via listOperations()
    │   │           ├── Found: Save it, then resume
    │   │           └── Not Found (indexing phase): 
    │   │                   └── Call createIndexInfrastructure() (idempotent)
    │   │
    │   └── Continue with remaining pipeline steps
    │
    └── Done
```

### Idempotent Infrastructure Creation

`createIndexInfrastructure()` is designed to be called at any point:

```
1. Check if index exists → if not, create it
2. Check if endpoint exists → if not, create it  
3. Check if index is deployed → if not, deploy it
4. Clear sync status (mark complete)
```

---

## 9. Security Considerations

### Credential Storage

- Service account JSON is encrypted using **AES-256-GCM** before database storage
- Encryption key is stored in environment variable `ENCRYPTION_KEY`
- Credentials are decrypted only when making API calls
- Auth tokens are cached per-business with **55-minute TTL** (tokens expire in 60)

### API Authentication

- Uses Google Service Account authentication (JWT-based)
- Scopes: `https://www.googleapis.com/auth/cloud-platform`
- Token refresh handled automatically by google-auth-library

### Data Isolation

- Each business account has its own corpus, index, and endpoint
- All API calls filter by `businessAccountId`
- No cross-business data access possible

### Encryption Implementation

```typescript
// encryptionService.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

---

## 10. Error Handling

### Retry Logic

The service implements exponential backoff for transient failures:

```typescript
async function fetchWithRetry(url, options, maxRetries = 3, baseDelayMs = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    
    if (response.status === 429 || response.status >= 500) {
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
      continue;
    }
    
    return response;
  }
}
```

### RESOURCE_EXHAUSTED Handling

When AnalyzeCorpus returns 429 (limit: 1 concurrent operation):

```typescript
// 1. Wait 10 seconds
// 2. Search for running analyze operation via listOperations()
// 3. If found, resume polling that operation
// 4. Retry up to 5 times
```

### Operation Polling Errors

Polling tolerates up to 10 consecutive errors before failing:

```typescript
private async pollOperationCompletion(credentials, operationName, onStatus?) {
  const maxConsecutiveErrors = 10;
  let consecutiveErrors = 0;
  
  while (true) {
    try {
      const status = await visionWarehouseService.getOperationStatus(credentials, operationName);
      consecutiveErrors = 0; // Reset on success
      
      if (status.done) {
        return status.error 
          ? { success: false, error: status.error }
          : { success: true, response: status.response };
      }
      
      await sleep(5000); // 5 second poll interval
    } catch (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        return { success: false, error: `Polling failed after ${maxConsecutiveErrors} errors` };
      }
      await sleep(5000);
    }
  }
}
```

---

## 11. Known Limitations

### API Limitations

1. **Operations Endpoint**: Operations are listed at location level, not corpus level
   - Correct: `GET /v1/projects/{PROJECT}/locations/{LOCATION}/operations`
   - Filter by corpus using query parameter

2. **AnalyzeCorpus Limit**: Only 1 concurrent AnalyzeCorpus operation per corpus

3. **Filter Support**: The `filter` query parameter may not be supported; fallback to unfiltered listing with local filtering

### Implementation Considerations

1. **Long-Running Operations**: Index creation and deployment can take 10-15 minutes

2. **Memory Flag vs Database State**: 
   - `syncInProgress` Map is in-memory (lost on restart)
   - Database fields persist across restarts

3. **No Partial Asset Deletion**: Resync deletes all assets before re-uploading (for initial implementation)

4. **Polling Interval**: Fixed 5-second interval may be suboptimal for very large operations

### Future Improvements

1. Add corpus-level filtering in `listOperations` response processing
2. Implement partial/delta sync for changed products only
3. Add webhook support for operation completion (when Google adds it)
4. Optimize polling interval based on operation type and size

---

## Appendix A: Google Vision Warehouse API Reference

Base URL: `https://warehouse-visionai.googleapis.com/v1`

### Key Endpoints Used

| Operation | Method | Path |
|-----------|--------|------|
| Create Corpus | POST | `/projects/{projectId}/locations/{location}/corpora` |
| Create Asset | POST | `/projects/{projectNumber}/locations/{location}/corpora/{corpusId}/assets` |
| Analyze Corpus | POST | `/projects/{projectNumber}/locations/{location}/corpora/{corpusId}:analyzeCorpus` |
| Create Index | POST | `/projects/{projectNumber}/locations/{location}/corpora/{corpusId}/indexes` |
| Create Endpoint | POST | `/projects/{projectNumber}/locations/{location}/indexEndpoints` |
| Deploy Index | POST | `/indexEndpoints/{endpointId}:deployIndex` |
| Update Index | PATCH | `/indexes/{indexId}?update_mask=entire_corpus` |
| List Operations | GET | `/projects/{projectNumber}/locations/{location}/operations` |
| Get Operation | GET | `/{operationName}` |
| Cancel Operation | POST | `/{operationName}:cancel` |
| Search | POST | `/indexEndpoints/{endpointId}:searchIndexEndpoint` |

---

## Appendix B: Sync Progress Data Structure

```typescript
interface SyncProgress {
  status: 'idle' | 'uploading' | 'analyzing' | 'indexing' | 'completed' | 'failed';
  phase: 'upload' | 'analyze' | 'index' | 'done';
  currentProduct: number;
  totalProducts: number;
  successCount: number;
  failedCount: number;
  currentProductName?: string;
  analyzeOperationName?: string;
  indexOperationName?: string;
  indexOperationType?: 'create_index' | 'create_endpoint' | 'deploy_index' | 'update_index';
  error?: string;
  failedPhase?: 'upload' | 'analyze' | 'index';
  startedAt?: Date;
}
```

---

## Appendix C: File Structure

```
server/
├── services/
│   ├── visionWarehouseService.ts      # Google API wrapper
│   ├── visionWarehouseSyncService.ts  # Sync orchestration
│   └── encryptionService.ts           # AES-256-GCM encryption
├── routes.ts                          # API endpoints
└── init.ts                            # Server startup (calls resumeInterruptedSyncs)

shared/
└── schema.ts                          # Database schema (Drizzle ORM)

client/
└── src/
    └── pages/
        ├── VisualSearchSettings.tsx   # Credentials & model configuration
        └── Products.tsx               # Sync UI component
```

---

**Document prepared for third-party architectural review.**
