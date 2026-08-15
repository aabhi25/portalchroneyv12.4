import { GoogleAuth } from 'google-auth-library';
import { decrypt } from './encryptionService';

interface VisionWarehouseConfig {
  projectId: string;
  projectNumber?: string; // Use project number for API calls (e.g., 1059444719642)
  location: string;
  corpusId: string;
  indexId?: string;
  endpointId?: string;
}

interface SearchResult {
  assetId: string;
  score: number;
  annotations?: Record<string, any>;
}

interface Asset {
  name: string;
  assetId: string;
  gcsUri?: string;
}

const DEFAULT_LOCATION = 'us-central1';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.log(`[VisionWarehouse] Retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delayMs);
        continue;
      }
      
      return response;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.log(`[VisionWarehouse] Network error, retrying after ${delayMs}ms: ${error.message}`);
        await sleep(delayMs);
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

// Cache auth clients per business to avoid re-creating them
const authClientCache = new Map<string, { auth: GoogleAuth; credentials: any; expiresAt: number }>();
const AUTH_CACHE_TTL = 55 * 60 * 1000; // 55 minutes (tokens expire in 60)

class VisionWarehouseService {
  private defaultLocation: string = DEFAULT_LOCATION;

  /**
   * Parse and validate credentials from encrypted database storage or JSON string
   */
  private parseCredentials(encryptedOrPlainCredentials: string): any {
    if (!encryptedOrPlainCredentials) {
      throw new Error('Vision Warehouse credentials not configured');
    }

    try {
      // Try to decrypt first (if it's encrypted)
      const decrypted = decrypt(encryptedOrPlainCredentials);
      return JSON.parse(decrypted);
    } catch (decryptError) {
      // If decryption fails, try parsing as plain JSON (for backwards compatibility)
      try {
        return JSON.parse(encryptedOrPlainCredentials);
      } catch (parseError) {
        throw new Error('Failed to parse Vision Warehouse credentials');
      }
    }
  }

  /**
   * Get or create an authenticated client for a specific set of credentials
   */
  private async getAuthClientForCredentials(encryptedCredentials: string): Promise<{ auth: GoogleAuth; credentials: any }> {
    const cacheKey = encryptedCredentials.substring(0, 32); // Use first 32 chars as cache key
    const cached = authClientCache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return { auth: cached.auth, credentials: cached.credentials };
    }

    const credentials = this.parseCredentials(encryptedCredentials);
    
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    authClientCache.set(cacheKey, {
      auth,
      credentials,
      expiresAt: Date.now() + AUTH_CACHE_TTL
    });
    
    return { auth, credentials };
  }

  private async getAccessToken(encryptedCredentials: string): Promise<string> {
    const { auth } = await this.getAuthClientForCredentials(encryptedCredentials);
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    
    if (!tokenResponse.token) {
      throw new Error('Failed to obtain access token');
    }
    
    return tokenResponse.token;
  }

  getProjectId(encryptedCredentials: string): string {
    const credentials = this.parseCredentials(encryptedCredentials);
    return credentials.project_id;
  }

  setLocation(location: string): void {
    this.defaultLocation = location;
  }

  getLocation(): string {
    return this.defaultLocation;
  }

  /**
   * Test if credentials are valid by attempting to authenticate
   */
  async testCredentials(encryptedCredentials: string): Promise<{ valid: boolean; projectId?: string; error?: string }> {
    try {
      const credentials = this.parseCredentials(encryptedCredentials);
      const token = await this.getAccessToken(encryptedCredentials);
      
      if (token) {
        return { valid: true, projectId: credentials.project_id };
      }
      return { valid: false, error: 'Failed to obtain access token' };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  async createCorpus(encryptedCredentials: string, corpusName: string, ttlDays: number = 3650, location?: string): Promise<{ corpusId: string; name: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const loc = location || this.defaultLocation;
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${loc}/corpora`;
    
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: corpusName,
        description: `Jewelry catalog for ${corpusName}`,
        default_ttl: {
          seconds: ttlDays * 24 * 60 * 60,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create corpus: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const corpusId = data.name?.split('/').pop() || '';
    
    console.log(`[VisionWarehouse] Created corpus: ${corpusId}`);
    return { corpusId, name: data.name };
  }

  async listCorpora(encryptedCredentials: string): Promise<Array<{ corpusId: string; displayName: string }>> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list corpora: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return (data.corpora || []).map((corpus: any) => ({
      corpusId: corpus.name?.split('/').pop() || '',
      displayName: corpus.displayName || corpus.display_name || '',
    }));
  }

  /**
   * Creates an asset in Vision Warehouse and uploads image content.
   * Uses the correct two-step process:
   * 1. Create empty asset
   * 2. Upload image via :upload endpoint
   * @param projectNumber - REQUIRED: The numeric Google Cloud project number (e.g., 1059444719642)
   */
  async createAsset(
    encryptedCredentials: string,
    corpusId: string,
    assetId: string,
    imageUrl: string,
    annotations?: Record<string, any>,
    projectNumber?: string
  ): Promise<{ assetName: string; alreadyExists?: boolean }> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use projectNumber if provided, otherwise fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    // Step 1: Create empty asset
    const createUrl = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}/assets?asset_id=${assetId}`;
    
    const createResponse = await fetchWithRetry(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // Empty body for asset creation
    });

    let assetName: string;
    let alreadyExists = false;
    
    // Handle 409 ALREADY_EXISTS - asset already has content, treat as success
    if (createResponse.status === 409) {
      assetName = `projects/${projectId}/locations/${location}/corpora/${corpusId}/assets/${assetId}`;
      alreadyExists = true;
      console.log(`[VisionWarehouse] Asset already exists and synced: ${assetId}`);
      // Skip upload step - Vision Warehouse doesn't allow re-uploading content
      return { assetName, alreadyExists };
    } else if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create asset: ${createResponse.status} - ${errorText}`);
    } else {
      const createData = await createResponse.json();
      assetName = createData.name;
      console.log(`[VisionWarehouse] Created asset: ${assetId}`);
    }

    // Step 2: Upload image via :upload endpoint (only for new assets)
    const uploadUrl = `https://warehouse-visionai.googleapis.com/v1/${assetName}:upload`;
    
    let assetSource: any;
    
    if (imageUrl.startsWith('gs://')) {
      // Use GCS URI directly
      assetSource = {
        assetGcsSource: {
          gcsUri: imageUrl
        }
      };
    } else {
      // Fetch image and upload as base64
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${imageUrl}`);
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      
      assetSource = {
        assetContentData: {
          assetContentData: base64Image
        }
      };
    }

    const uploadResponse = await fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assetSource }),
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload asset content: ${uploadResponse.status} - ${errorText}`);
    }

    console.log(`[VisionWarehouse] Uploaded content for asset: ${assetId}`);

    // Step 3: Add annotations if provided (separate API call)
    if (annotations && Object.keys(annotations).length > 0) {
      await this.addAnnotations(encryptedCredentials, corpusId, assetId, annotations, projectNumber);
    }

    return { assetName, alreadyExists };
  }

  /**
   * Add annotations to an existing asset
   */
  private async addAnnotations(
    encryptedCredentials: string,
    corpusId: string,
    assetId: string,
    annotations: Record<string, any>,
    projectNumber?: string
  ): Promise<void> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use projectNumber if provided, otherwise fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    // Create annotations one by one (API requirement)
    for (const [key, value] of Object.entries(annotations)) {
      const annotationUrl = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}/assets/${assetId}/annotations`;
      
      const annotationData = {
        userSpecifiedAnnotation: {
          key,
          value: {
            strValue: typeof value === 'string' ? value : String(value)
          }
        }
      };

      const annotationResponse = await fetchWithRetry(annotationUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(annotationData),
      });

      if (!annotationResponse.ok) {
        const errorText = await annotationResponse.text();
        console.warn(`[VisionWarehouse] Failed to add annotation '${key}': ${annotationResponse.status} - ${errorText}`);
        // Continue with other annotations even if one fails
      }
    }
    
    console.log(`[VisionWarehouse] Added annotations for asset: ${assetId}`);
  }

  /**
   * Creates an asset in Vision Warehouse and uploads base64 image content.
   * Uses the correct two-step process:
   * 1. Create empty asset
   * 2. Upload base64 image via :upload endpoint
   */
  async uploadAssetFromBase64(
    encryptedCredentials: string,
    corpusId: string,
    assetId: string,
    base64Image: string,
    annotations?: Record<string, any>
  ): Promise<{ assetName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    // Step 1: Create empty asset
    const createUrl = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}/assets?asset_id=${assetId}`;
    
    const createResponse = await fetchWithRetry(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // Empty body for asset creation
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create asset: ${createResponse.status} - ${errorText}`);
    }

    const createData = await createResponse.json();
    const assetName = createData.name;
    console.log(`[VisionWarehouse] Created asset: ${assetId}`);

    // Step 2: Upload base64 image via :upload endpoint
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    
    const uploadUrl = `https://warehouse-visionai.googleapis.com/v1/${assetName}:upload`;
    
    const assetSource = {
      assetContentData: {
        assetContentData: cleanBase64
      }
    };

    const uploadResponse = await fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assetSource }),
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload asset content: ${uploadResponse.status} - ${errorText}`);
    }

    console.log(`[VisionWarehouse] Uploaded base64 content for asset: ${assetId}`);

    // Step 3: Add annotations if provided (separate API call)
    if (annotations && Object.keys(annotations).length > 0) {
      await this.addAnnotations(encryptedCredentials, corpusId, assetId, annotations);
    }

    return { assetName };
  }

  async analyzeAsset(encryptedCredentials: string, corpusId: string, assetId: string, projectNumber?: string): Promise<void> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use projectNumber if provided, otherwise fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const assetName = `projects/${projectId}/locations/${location}/corpora/${corpusId}/assets/${assetId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${assetName}:analyze`;
    
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to analyze asset: ${response.status} - ${errorText}`);
    }

    console.log(`[VisionWarehouse] Analyzed asset: ${assetId}`);
  }

  async createIndex(encryptedCredentials: string, corpusId: string, indexDisplayName: string, projectNumber?: string): Promise<{ indexId: string; operationName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use provided project number (required for Vision Warehouse), fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}/indexes`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: indexDisplayName,
        description: `Search index for ${indexDisplayName}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create index: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const indexId = data.name?.split('/indexes/').pop()?.split('/')[0] || '';
    
    console.log(`[VisionWarehouse] Created index: ${indexId}`);
    return { indexId, operationName: data.name };
  }

  async createIndexEndpoint(encryptedCredentials: string, endpointDisplayName: string, projectNumber?: string): Promise<{ endpointId: string; operationName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use provided project number (required for Vision Warehouse), fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/indexEndpoints`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: endpointDisplayName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create index endpoint: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    // Response name format: projects/{PROJECT}/locations/{LOC}/indexEndpoints/{ENDPOINT_ID}/operations/{OP_ID}
    // Extract the endpoint ID from the correct position
    let endpointId = '';
    if (data.name?.includes('/indexEndpoints/')) {
      endpointId = data.name.split('/indexEndpoints/')[1]?.split('/')[0] || '';
    } else {
      endpointId = data.name?.split('/').pop() || '';
    }
    
    console.log(`[VisionWarehouse] Created index endpoint: ${endpointId}, operation: ${data.name}`);
    return { endpointId, operationName: data.name };
  }

  async deployIndex(encryptedCredentials: string, endpointId: string, corpusId: string, indexId: string, projectNumber?: string): Promise<{ operationName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use provided project number (required for Vision Warehouse), fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/indexEndpoints/${endpointId}:deployIndex`;
    
    const indexName = `projects/${projectId}/locations/${location}/corpora/${corpusId}/indexes/${indexId}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deployed_index: {
          index: indexName,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to deploy index: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[VisionWarehouse] Started deploying index ${indexId} to endpoint ${endpointId}, operation: ${data.name}`);
    return { operationName: data.name };
  }

  async searchByImage(
    encryptedCredentials: string,
    endpointId: string,
    imageBase64: string,
    topK: number = 10,
    filters?: Record<string, string[]>,
    projectNumber?: string
  ): Promise<SearchResult[]> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use provided project number (required for Vision Warehouse), fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = this.defaultLocation;
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/indexEndpoints/${endpointId}:searchIndexEndpoint`;
    
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    const requestBody: any = {
      imageQuery: {
        inputImage: cleanBase64,
      },
      pageSize: 10, // Return top 10 most relevant results (already sorted by relevance)
    };
    
    if (filters) {
      requestBody.criteria = Object.entries(filters).map(([field, values]) => ({
        field,
        text_array: { txt_values: values },
      }));
    }

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search by image: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Handle both camelCase (searchResultItems) and snake_case (search_result_items) responses
    const searchItems = data.searchResultItems || data.search_result_items || [];
    
    console.log(`[VisionWarehouse] Search API response - found ${searchItems.length} items`);
    
    const results: SearchResult[] = searchItems.map((item: any) => ({
      assetId: item.asset?.split('/').pop() || '',
      score: item.relevance || 0,
      annotations: item.annotations?.reduce((acc: any, ann: any) => {
        acc[ann.key] = ann.value?.string_value || ann.value;
        return acc;
      }, {}),
    }));

    console.log(`[VisionWarehouse] Found ${results.length} results for image search`);
    return results;
  }

  async searchByText(
    encryptedCredentials: string,
    endpointId: string,
    textQuery: string,
    topK: number = 10,
    filters?: Record<string, string[]>
  ): Promise<SearchResult[]> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const location = this.defaultLocation;
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/indexEndpoints/${endpointId}:searchIndexEndpoint`;
    
    const requestBody: any = {
      text_query: textQuery,
      page_size: topK,
    };
    
    if (filters) {
      requestBody.criteria = Object.entries(filters).map(([field, values]) => ({
        field,
        text_array: { txt_values: values },
      }));
    }

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search by text: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Handle both camelCase (searchResultItems) and snake_case (search_result_items) responses
    const searchItems = data.searchResultItems || data.search_result_items || [];
    
    const results: SearchResult[] = searchItems.map((item: any) => ({
      assetId: item.asset?.split('/').pop() || '',
      score: item.relevance || 0,
      annotations: item.annotations?.reduce((acc: any, ann: any) => {
        acc[ann.key] = ann.value?.string_value || ann.value;
        return acc;
      }, {}),
    }));

    console.log(`[VisionWarehouse] Found ${results.length} results for text search: "${textQuery}"`);
    return results;
  }

  async deleteAsset(encryptedCredentials: string, corpusId: string, assetId: string, projectNumber?: string): Promise<void> {
    const token = await this.getAccessToken(encryptedCredentials);
    // Use projectNumber if provided, otherwise fall back to project_id from credentials
    const projectId = projectNumber || this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const assetName = `projects/${projectId}/locations/${location}/corpora/${corpusId}/assets/${assetId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${assetName}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete asset: ${response.status} - ${errorText}`);
    }

    console.log(`[VisionWarehouse] Deleted asset: ${assetId}`);
  }

  async getCorpusInfo(encryptedCredentials: string, corpusId: string): Promise<any> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get corpus info: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async listAssets(encryptedCredentials: string, corpusId: string, pageSize: number = 100): Promise<Asset[]> {
    const token = await this.getAccessToken(encryptedCredentials);
    const projectId = this.getProjectId(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectId}/locations/${location}/corpora/${corpusId}/assets?page_size=${pageSize}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list assets: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return (data.assets || []).map((asset: any) => ({
      name: asset.name,
      assetId: asset.name?.split('/').pop() || '',
      gcsUri: asset.asset_gcs_source?.gcs_uri,
    }));
  }

  /**
   * Check if credentials are configured (either in env or provided)
   */
  isConfigured(encryptedCredentials?: string): boolean {
    return !!(encryptedCredentials || process.env.GOOGLE_VISION_WAREHOUSE_CREDENTIALS);
  }

  /**
   * Poll an operation until it completes or times out
   * @param operationName - Full operation resource name
   * @param maxWaitMs - Maximum time to wait (default 5 minutes)
   * @param pollIntervalMs - Time between polls (default 5 seconds)
   */
  async waitForOperation(
    encryptedCredentials: string,
    operationName: string,
    maxWaitMs: number = 5 * 60 * 1000,
    pollIntervalMs: number = 5000
  ): Promise<{ done: boolean; error?: any; response?: any }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const url = `https://warehouse-visionai.googleapis.com/v1/${operationName}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get operation status: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.done) {
        if (data.error) {
          return { done: true, error: data.error };
        }
        return { done: true, response: data.response };
      }
      
      console.log(`[VisionWarehouse] Operation ${operationName.split('/').pop()} in progress...`);
      await sleep(pollIntervalMs);
    }
    
    return { done: false, error: { message: 'Operation timed out' } };
  }

  /**
   * Get the status of an index endpoint
   */
  async getIndexEndpointStatus(
    encryptedCredentials: string,
    endpointId: string,
    projectNumber: string
  ): Promise<{ state: string; isDeployed: boolean; deployedIndexes: any[]; displayName?: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/indexEndpoints/${endpointId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get index endpoint status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Log full raw response to debug field names
    console.log(`[VisionWarehouse] Raw endpoint response keys:`, Object.keys(data));
    console.log(`[VisionWarehouse] Raw endpoint response:`, JSON.stringify(data, null, 2));
    
    // Check multiple possible field names for deployed indexes (camelCase and snake_case)
    let deployedIndexes = data.deployedIndexes || data.deployed_indexes || data.deployedIndex || data.deployed_index || [];
    
    // Handle case where deployedIndexes might be a nested object
    if (typeof deployedIndexes === 'object' && !Array.isArray(deployedIndexes)) {
      // Convert single object to array
      deployedIndexes = [deployedIndexes];
    }
    
    // Check for deployedAssets which might be used in some API versions
    const deployedAssets = data.deployedAssets || data.deployed_assets || [];
    
    // Count deployed resources
    const deployedIndexCount = Array.isArray(deployedIndexes) ? deployedIndexes.length : 0;
    const deployedAssetCount = Array.isArray(deployedAssets) ? deployedAssets.length : 0;
    
    // Consider deployed if any indexes or assets are deployed
    const isDeployed = deployedIndexCount > 0 || deployedAssetCount > 0;
    
    console.log(`[VisionWarehouse] Endpoint ${endpointId} status: state=${data.state}, deployedIndexCount=${deployedIndexCount}, deployedAssetCount=${deployedAssetCount}, isDeployed=${isDeployed}`);
    
    return {
      state: data.state || 'UNKNOWN',
      isDeployed,
      deployedIndexes,
      displayName: data.displayName || data.display_name,
    };
  }

  /**
   * Undeploy an index from an endpoint (stops serving costs)
   */
  async undeployIndex(
    encryptedCredentials: string,
    endpointId: string,
    projectNumber: string
  ): Promise<void> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/indexEndpoints/${endpointId}:undeployIndex`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to undeploy index: ${response.status} - ${errorText}`);
    }

    console.log(`[VisionWarehouse] Undeployed index from endpoint ${endpointId}`);
  }

  /**
   * Analyze all assets in a corpus (batch operation)
   * This generates embeddings for all assets that don't have them yet
   */
  async analyzeCorpus(
    encryptedCredentials: string,
    corpusId: string,
    projectNumber: string
  ): Promise<{ operationName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const corpusName = `projects/${projectNumber}/locations/${location}/corpora/${corpusId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${corpusName}:analyze`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VisionWarehouse] Analyze corpus failed: ${response.status} - ${errorText}`);
      throw new Error(`Failed to analyze corpus: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[VisionWarehouse] Started corpus analysis: ${data.name}`);
    return { operationName: data.name };
  }

  /**
   * Get the status of an index
   */
  async getIndexStatus(
    encryptedCredentials: string,
    corpusId: string,
    indexId: string,
    projectNumber: string
  ): Promise<{ state: string; displayName?: string; assetCount?: number }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/corpora/${corpusId}/indexes/${indexId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get index status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return {
      state: data.state || 'UNKNOWN',
      displayName: data.displayName || data.display_name,
      assetCount: data.assetCount || data.asset_count,
    };
  }

  /**
   * Get the status of a long-running operation (like corpus analysis)
   */
  async getOperationStatus(
    encryptedCredentials: string,
    operationName: string
  ): Promise<{ done: boolean; error?: string; metadata?: any; response?: any }> {
    const token = await this.getAccessToken(encryptedCredentials);
    
    const url = `https://warehouse-visionai.googleapis.com/v1/${operationName}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get operation status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return {
      done: data.done === true,
      error: data.error?.message,
      metadata: data.metadata,
      response: data.response, // Contains the created resource on completion
    };
  }

  /**
   * Update index to include new embeddings from analyzed corpus
   * This syncs the index with the latest analyzed data
   */
  async updateIndex(
    encryptedCredentials: string,
    corpusId: string,
    indexId: string,
    projectNumber: string
  ): Promise<{ operationName: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const indexName = `projects/${projectNumber}/locations/${location}/corpora/${corpusId}/indexes/${indexId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${indexName}?update_mask=entire_corpus`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entire_corpus: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VisionWarehouse] Update index failed: ${response.status} - ${errorText}`);
      throw new Error(`Failed to update index: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[VisionWarehouse] Started index update: ${data.name}`);
    return { operationName: data.name };
  }

  /**
   * List operations for a location (to see if any are running)
   * Uses the location-level endpoint: projects/{projectId}/locations/{location}/operations
   * With optional filter for corpus-specific operations
   */
  async listOperations(
    encryptedCredentials: string,
    corpusId: string,
    projectNumber: string
  ): Promise<Array<{ name: string; done: boolean; error?: string; createTime?: string; updateTime?: string; metadata?: any; methodType?: string }>> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    // Use location-level operations endpoint (operations are children of location, not corpus)
    // Add filter to get only operations related to this corpus
    const corpusName = `projects/${projectNumber}/locations/${location}/corpora/${corpusId}`;
    const filter = encodeURIComponent(`metadata.corpus="${corpusName}"`);
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/operations?filter=${filter}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // If filter doesn't work, try without filter and filter locally
      if (response.status === 400) {
        console.log(`[VisionWarehouse] Filter not supported, trying without filter...`);
        return this.listOperationsUnfiltered(encryptedCredentials, projectNumber, corpusId);
      }
      // If 404 or 403, the API endpoint may not support listing - return empty array gracefully
      if (response.status === 404 || response.status === 403) {
        console.log(`[VisionWarehouse] Operations list not available: ${response.status}`);
        return [];
      }
      const errorText = await response.text();
      throw new Error(`Failed to list operations: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const operations = data.operations || [];
    
    return operations.map((op: any) => this.parseOperationResponse(op));
  }

  /**
   * List all operations without filter (fallback), then filter locally by corpus
   */
  private async listOperationsUnfiltered(
    encryptedCredentials: string,
    projectNumber: string,
    corpusId: string
  ): Promise<Array<{ name: string; done: boolean; error?: string; createTime?: string; updateTime?: string; metadata?: any; methodType?: string }>> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/operations`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 403) {
        console.log(`[VisionWarehouse] Operations list not available: ${response.status}`);
        return [];
      }
      const errorText = await response.text();
      throw new Error(`Failed to list operations: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const allOperations = data.operations || [];
    
    // Build the full corpus name to match against metadata
    const corpusName = `projects/${projectNumber}/locations/${location}/corpora/${corpusId}`;
    
    // Filter operations locally to only include ones for this corpus
    const filteredOperations = allOperations.filter((op: any) => {
      // Check multiple possible locations for corpus info in metadata
      const possibleCorpusFields = [
        op.metadata?.corpus,
        op.metadata?.request?.corpus,
        op.metadata?.analyzeCorpusRequest?.corpus,
        op.metadata?.resource,
      ];
      
      for (const field of possibleCorpusFields) {
        if (field && (field === corpusName || field.includes(corpusId))) {
          return true;
        }
      }
      
      // Check if operation name contains the corpus ID (most reliable)
      if (op.name && op.name.includes(corpusId)) {
        return true;
      }
      
      return false;
    });
    
    console.log(`[VisionWarehouse] Found ${filteredOperations.length} operations for corpus ${corpusId} (of ${allOperations.length} total)`);
    
    // SAFETY FALLBACK: If we found no matches but there are running AnalyzeCorpus operations
    // with unknown corpus, include them to prevent accidental duplicate operations.
    // This is safer than potentially starting a duplicate AnalyzeCorpus (which would fail with 429).
    if (filteredOperations.length === 0) {
      const unknownAnalyzeOps = allOperations.filter((op: any) => {
        if (op.done) return false;
        const typeString = op.metadata?.['@type'] || '';
        return typeString.includes('AnalyzeCorpus');
      });
      
      if (unknownAnalyzeOps.length > 0) {
        console.log(`[VisionWarehouse] FALLBACK: Including ${unknownAnalyzeOps.length} running AnalyzeCorpus operations with unknown corpus to prevent duplicates`);
        return unknownAnalyzeOps.map((op: any) => this.parseOperationResponse(op));
      }
    }
    
    return filteredOperations.map((op: any) => this.parseOperationResponse(op));
  }

  /**
   * Parse operation response into a consistent format
   */
  private parseOperationResponse(op: any): { name: string; done: boolean; error?: string; createTime?: string; updateTime?: string; metadata?: any; methodType?: string } {
    // Extract method type from metadata @type or operation name
    let methodType = 'Unknown';
    const typeString = op.metadata?.['@type'] || op.name || '';
    
    if (typeString.includes('AnalyzeCorpus') || typeString.includes('analyzeCorpus')) {
      methodType = 'AnalyzeCorpus';
    } else if (typeString.includes('CreateIndex') || typeString.includes('createIndex')) {
      methodType = 'CreateIndex';
    } else if (typeString.includes('CreateIndexEndpoint') || typeString.includes('createIndexEndpoint')) {
      methodType = 'CreateIndexEndpoint';
    } else if (typeString.includes('DeployIndex') || typeString.includes('deployIndex')) {
      methodType = 'DeployIndex';
    } else if (typeString.includes('UpdateIndex') || typeString.includes('updateIndex')) {
      methodType = 'UpdateIndex';
    }
    
    return {
      name: op.name,
      done: op.done === true,
      error: op.error?.message,
      createTime: op.metadata?.createTime || op.metadata?.create_time,
      updateTime: op.metadata?.updateTime || op.metadata?.update_time,
      metadata: op.metadata,
      methodType,
    };
  }

  /**
   * Find an in-progress analyze operation for the corpus.
   * Returns the operation name if found, null otherwise.
   */
  async findInProgressAnalyzeOperation(
    encryptedCredentials: string,
    corpusId: string,
    projectNumber: string
  ): Promise<string | null> {
    try {
      const operations = await this.listOperations(encryptedCredentials, corpusId, projectNumber);
      
      // Find any in-progress analyze operation
      const inProgressAnalyze = operations.find(op => 
        !op.done && 
        (op.methodType === 'AnalyzeCorpus' || op.name?.includes('AnalyzeCorpus') || op.metadata?.['@type']?.includes('AnalyzeCorpus'))
      );
      
      if (inProgressAnalyze) {
        console.log(`[VisionWarehouse] Found in-progress analyze operation: ${inProgressAnalyze.name}`);
        return inProgressAnalyze.name;
      }
      
      return null;
    } catch (error: any) {
      console.error(`[VisionWarehouse] Error finding in-progress analyze: ${error.message}`);
      return null;
    }
  }

  /**
   * Cancel a long-running operation
   */
  async cancelOperation(
    encryptedCredentials: string,
    operationName: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = await this.getAccessToken(encryptedCredentials);
    
    const url = `https://warehouse-visionai.googleapis.com/v1/${operationName}:cancel`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VisionWarehouse] Cancel operation failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to cancel: ${response.status} - ${errorText}` };
    }

    console.log(`[VisionWarehouse] Operation cancelled: ${operationName}`);
    return { success: true };
  }

  /**
   * Get an index by ID to check if it exists
   */
  async getIndex(
    encryptedCredentials: string,
    corpusId: string,
    indexId: string,
    projectNumber: string
  ): Promise<{ exists: boolean; state?: string; deployedIndexes?: string[] }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const indexName = `projects/${projectNumber}/locations/${location}/corpora/${corpusId}/indexes/${indexId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${indexName}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VisionWarehouse] Get index failed: ${response.status} - ${errorText}`);
      return { exists: false };
    }

    const data = await response.json();
    return {
      exists: true,
      state: data.state,
      deployedIndexes: data.deployedIndexes || [],
    };
  }

  /**
   * Get an index endpoint by ID to check if it exists
   */
  async getIndexEndpoint(
    encryptedCredentials: string,
    endpointId: string,
    projectNumber: string
  ): Promise<{ exists: boolean; state?: string; deployedIndexes?: Array<{ index: string }> }> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const endpointName = `projects/${projectNumber}/locations/${location}/indexEndpoints/${endpointId}`;
    const url = `https://warehouse-visionai.googleapis.com/v1/${endpointName}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VisionWarehouse] Get index endpoint failed: ${response.status} - ${errorText}`);
      return { exists: false };
    }

    const data = await response.json();
    return {
      exists: true,
      state: data.state,
      deployedIndexes: data.deployedIndexes || [],
    };
  }

  /**
   * List indexes for a corpus
   */
  async listIndexes(
    encryptedCredentials: string,
    corpusId: string,
    projectNumber: string
  ): Promise<Array<{ id: string; name: string; state: string; displayName?: string }>> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/corpora/${corpusId}/indexes`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      const errorText = await response.text();
      console.error(`[VisionWarehouse] List indexes failed: ${response.status} - ${errorText}`);
      return [];
    }

    const data = await response.json();
    const indexes = data.indexes || [];
    
    return indexes.map((idx: any) => {
      const idMatch = idx.name?.match(/indexes\/([^\/]+)$/);
      return {
        id: idMatch ? idMatch[1] : idx.name,
        name: idx.name,
        state: idx.state || 'UNKNOWN',
        displayName: idx.displayName,
      };
    });
  }

  /**
   * List index endpoints for a project
   */
  async listIndexEndpoints(
    encryptedCredentials: string,
    projectNumber: string
  ): Promise<Array<{ id: string; name: string; state: string; displayName?: string; deployedIndexes?: Array<{ index: string }> }>> {
    const token = await this.getAccessToken(encryptedCredentials);
    const location = 'us-central1';
    
    const url = `https://warehouse-visionai.googleapis.com/v1/projects/${projectNumber}/locations/${location}/indexEndpoints`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      const errorText = await response.text();
      console.error(`[VisionWarehouse] List index endpoints failed: ${response.status} - ${errorText}`);
      return [];
    }

    const data = await response.json();
    const endpoints = data.indexEndpoints || [];
    
    return endpoints.map((ep: any) => {
      const idMatch = ep.name?.match(/indexEndpoints\/([^\/]+)$/);
      return {
        id: idMatch ? idMatch[1] : ep.name,
        name: ep.name,
        state: ep.state || 'UNKNOWN',
        displayName: ep.displayName,
        deployedIndexes: ep.deployedIndexes || [],
      };
    });
  }
}

export const visionWarehouseService = new VisionWarehouseService();
