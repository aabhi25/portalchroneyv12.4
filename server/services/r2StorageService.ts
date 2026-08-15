import { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand, 
  GetObjectCommand, 
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { createWriteStream } from "fs";
import { createGunzip } from "zlib";
import { randomUUID } from "crypto";
import path from "path";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl?: string;
}

class R2StorageService {
  private client: S3Client | null = null;
  private bucketName: string = "";
  private publicUrl: string = "";
  private isConfigured: boolean = false;
  private initPromise: Promise<void> | null = null;
  private configSource: "database" | "environment" | "none" = "none";

  constructor() {
    this.initFromEnv();
  }

  private initFromEnv() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      console.log("[R2 Storage] Environment variables not set. Will check database on first use.");
      this.isConfigured = false;
      return;
    }

    this.configureClient({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      publicUrl,
    });
    this.configSource = "environment";
  }

  private configureClient(config: R2Config) {
    try {
      this.client = new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });

      this.bucketName = config.bucketName;
      
      const trimmedPublicUrl = config.publicUrl?.trim();
      if (trimmedPublicUrl && trimmedPublicUrl.length > 0) {
        this.publicUrl = trimmedPublicUrl;
      } else {
        this.publicUrl = `https://pub-${config.accountId}.r2.dev`;
      }
      
      this.isConfigured = true;
      console.log("[R2 Storage] Initialized successfully with bucket:", config.bucketName, "publicUrl:", this.publicUrl);
    } catch (error) {
      console.error("[R2 Storage] Failed to initialize:", error);
      this.isConfigured = false;
    }
  }

  async initFromDatabase(): Promise<boolean> {
    if (this.isConfigured && this.configSource === "database") {
      return true;
    }

    try {
      const { systemSettingsService } = await import("./systemSettingsService");
      const config = await systemSettingsService.getR2Config();
      
      if (config && config.accountId && config.accessKeyId && config.secretAccessKey && config.bucketName) {
        this.configureClient(config);
        this.configSource = "database";
        console.log("[R2 Storage] Loaded configuration from database");
        return true;
      }
    } catch (error) {
      console.error("[R2 Storage] Error loading from database:", error);
    }
    
    return false;
  }

  async ensureInitialized(): Promise<boolean> {
    if (this.isConfigured) {
      return true;
    }

    if (!this.initPromise) {
      this.initPromise = this.initFromDatabase().then(success => {
        if (!success) {
          console.log("[R2 Storage] Not configured - files will be stored locally.");
        }
        this.initPromise = null;
      });
    }

    await this.initPromise;
    return this.isConfigured;
  }

  isEnabled(): boolean {
    return this.isConfigured;
  }

  async refreshFromDatabase(): Promise<boolean> {
    this.client = null;
    this.isConfigured = false;
    this.configSource = "none";
    
    const envConfigured = this.tryEnvConfig();
    if (envConfigured) {
      return true;
    }
    
    return await this.initFromDatabase();
  }

  private tryEnvConfig(): boolean {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (accountId && accessKeyId && secretAccessKey && bucketName) {
      this.configureClient({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
        publicUrl,
      });
      this.configSource = "environment";
      return true;
    }
    return false;
  }

  getConfigSource(): "database" | "environment" | "none" {
    return this.configSource;
  }

  async uploadFile(
    fileBuffer: Buffer,
    originalFilename: string,
    folder: string,
    contentType: string,
    businessAccountId?: string
  ): Promise<{ success: boolean; url?: string; key?: string; error?: string }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const ext = path.extname(originalFilename);
      const timestamp = Date.now();
      const uniqueId = randomUUID();
      
      let key: string;
      if (businessAccountId) {
        key = `${folder}/${businessAccountId}/${timestamp}-${uniqueId}${ext}`;
      } else {
        key = `${folder}/${timestamp}-${uniqueId}${ext}`;
      }

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      });

      await this.client.send(command);

      const url = `${this.publicUrl}/${key}`;
      console.log("[R2 Storage] File uploaded successfully:", key);
      
      return { success: true, url, key };
    } catch (error: any) {
      console.error("[R2 Storage] Upload failed:", error);
      return { success: false, error: error.message };
    }
  }

  async uploadWithExactKey(
    fileBuffer: Buffer,
    key: string,
    contentType: string
  ): Promise<{ success: boolean; url?: string; key?: string; error?: string }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      });

      await this.client.send(command);

      const url = `${this.publicUrl}/${key}`;
      console.log("[R2 Storage] File uploaded with exact key:", key);
      
      return { success: true, url, key };
    } catch (error: any) {
      console.error("[R2 Storage] Upload failed:", error);
      return { success: false, error: error.message };
    }
  }

  async verifyGzipHeader(key: string): Promise<{ valid: boolean; error?: string }> {
    await this.ensureInitialized();

    if (!this.isConfigured || !this.client) {
      return { valid: false, error: "R2 storage not configured" };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Range: "bytes=0-1",
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        return { valid: false, error: "No data returned from R2" };
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(Buffer.from(chunk));
      }
      const header = Buffer.concat(chunks);

      if (header.length < 2) {
        return { valid: false, error: `Header too short: ${header.length} bytes` };
      }

      if (header[0] === 0x1f && header[1] === 0x8b) {
        console.log(`[R2 Storage] Gzip header verified for: ${key}`);
        return { valid: true };
      }

      return {
        valid: false,
        error: `Invalid gzip header: expected 1f 8b, got ${header[0].toString(16).padStart(2, '0')} ${header[1].toString(16).padStart(2, '0')}`,
      };
    } catch (error: any) {
      console.error("[R2 Storage] Gzip header verification failed:", error);
      return { valid: false, error: error.message };
    }
  }

  async verifyGzipIntegrity(key: string): Promise<{ valid: boolean; error?: string }> {
    await this.ensureInitialized();

    if (!this.isConfigured || !this.client) {
      return { valid: false, error: "R2 storage not configured" };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        return { valid: false, error: "No data returned from R2" };
      }

      await new Promise<void>((resolve, reject) => {
        const gunzip = createGunzip();
        gunzip.on('error', (err) => reject(err));
        gunzip.on('finish', () => resolve());
        (response.Body as Readable).on('error', (err) => reject(err));
        (response.Body as Readable).pipe(gunzip);
        gunzip.resume();
      });

      console.log(`[R2 Storage] Gzip integrity verified (full stream) for: ${key}`);
      return { valid: true };
    } catch (error: any) {
      console.error("[R2 Storage] Gzip integrity verification failed:", error);
      return { valid: false, error: error.message };
    }
  }

  async verifyPgdmpHeader(key: string): Promise<{ valid: boolean; error?: string }> {
    await this.ensureInitialized();

    if (!this.isConfigured || !this.client) {
      return { valid: false, error: "R2 storage not configured" };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Range: "bytes=0-4",
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        return { valid: false, error: "No data returned from R2" };
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(Buffer.from(chunk));
      }
      const header = Buffer.concat(chunks);

      if (header.length < 5) {
        return { valid: false, error: `Header too short: ${header.length} bytes` };
      }

      const PGDMP = Buffer.from([0x50, 0x47, 0x44, 0x4d, 0x50]);
      if (header.slice(0, 5).equals(PGDMP)) {
        console.log(`[R2 Storage] PGDMP magic verified for: ${key}`);
        return { valid: true };
      }

      const got = Array.from(header.slice(0, 5)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      return {
        valid: false,
        error: `Invalid PGDMP magic: expected 50 47 44 4d 50, got ${got}`,
      };
    } catch (error: any) {
      console.error("[R2 Storage] PGDMP header verification failed:", error);
      return { valid: false, error: error.message };
    }
  }

  async deleteFile(key: string): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
      console.log("[R2 Storage] File deleted successfully:", key);
      
      return { success: true };
    } catch (error: any) {
      console.error("[R2 Storage] Delete failed:", error);
      return { success: false, error: error.message };
    }
  }

  async getFile(key: string): Promise<{ success: boolean; data?: Buffer; contentType?: string; error?: string }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        return { success: false, error: "File not found" };
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);

      return { 
        success: true, 
        data, 
        contentType: response.ContentType 
      };
    } catch (error: any) {
      console.error("[R2 Storage] Get file failed:", error);
      return { success: false, error: error.message };
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<{ success: boolean; sizeBytes?: number; error?: string }> {
    await this.ensureInitialized();

    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        return { success: false, error: "File not found or empty body" };
      }

      const writeStream = createWriteStream(destPath);
      let sizeBytes = 0;

      await new Promise<void>((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        (async () => {
          try {
            for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
              sizeBytes += chunk.length;
              const ok = writeStream.write(chunk);
              if (!ok) {
                await new Promise<void>(res => writeStream.once('drain', res));
              }
            }
            writeStream.end();
          } catch (err) {
            writeStream.destroy(err as Error);
            reject(err);
          }
        })();
      });

      console.log(`[R2 Storage] Downloaded ${key} to ${destPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
      return { success: true, sizeBytes };
    } catch (error: any) {
      console.error("[R2 Storage] Download to file failed:", error);
      return { success: false, error: error.message };
    }
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  extractKeyFromUrl(url: string): string | null {
    if (!url) return null;
    
    // Check against configured public URL first
    if (this.publicUrl && url.startsWith(this.publicUrl)) {
      return url.replace(`${this.publicUrl}/`, "");
    }
    
    // Handle R2 URLs with .r2.dev or .r2.cloudflarestorage.com patterns
    if (url.startsWith("https://")) {
      try {
        const urlObj = new URL(url);
        // Extract the path (remove leading slash)
        const path = urlObj.pathname.slice(1);
        if (path) {
          console.log('[R2 Storage] Extracted key from URL path:', path);
          return path;
        }
      } catch (e) {
        console.error('[R2 Storage] Failed to parse URL:', url, e);
      }
    }
    
    return null;
  }

  async listFiles(prefix: string): Promise<{ success: boolean; files?: { key: string; size: number; lastModified: Date }[]; error?: string }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await this.client.send(command);
      
      const files = (response.Contents || []).map(obj => ({
        key: obj.Key || "",
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
      }));

      return { success: true, files };
    } catch (error: any) {
      console.error("[R2 Storage] List files failed:", error);
      return { success: false, error: error.message };
    }
  }

  async uploadStreamMultipart(
    stream: Readable,
    key: string,
    contentType: string,
    onProgress?: (bytesUploaded: number, partNumber: number) => void,
    abortSignal?: { aborted: boolean }
  ): Promise<{ success: boolean; url?: string; key?: string; error?: string; totalBytes?: number }> {
    await this.ensureInitialized();
    
    if (!this.isConfigured || !this.client) {
      return { success: false, error: "R2 storage not configured" };
    }

    const PART_SIZE = 25 * 1024 * 1024; // 25MB chunks for faster uploads (R2/S3 minimum is 5MB except last part)
    let uploadId: string | undefined;
    const uploadedParts: { ETag: string; PartNumber: number }[] = [];
    let totalBytesUploaded = 0;

    const checkAborted = () => {
      if (abortSignal?.aborted) {
        throw new Error('Upload aborted');
      }
    };

    try {
      checkAborted();
      console.log(`[R2 Storage] Starting multipart upload for: ${key}`);
      
      // 1. Initiate multipart upload
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
      });
      const createResponse = await this.client.send(createCommand);
      uploadId = createResponse.UploadId;
      
      if (!uploadId) {
        throw new Error("Failed to initiate multipart upload - no UploadId returned");
      }
      
      console.log(`[R2 Storage] Multipart upload initiated with ID: ${uploadId}`);

      // 2. Stream data and upload parts
      let partNumber = 1;
      let buffer = Buffer.alloc(0);

      for await (const chunk of stream) {
        checkAborted();
        buffer = Buffer.concat([buffer, chunk]);
        
        // When buffer reaches PART_SIZE, upload a part
        while (buffer.length >= PART_SIZE) {
          checkAborted();
          const partData = buffer.slice(0, PART_SIZE);
          buffer = buffer.slice(PART_SIZE);
          
          const uploadPartCommand = new UploadPartCommand({
            Bucket: this.bucketName,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: partData,
          });
          
          const partResponse = await this.client.send(uploadPartCommand);
          
          if (!partResponse.ETag) {
            throw new Error(`No ETag returned for part ${partNumber}`);
          }
          
          uploadedParts.push({
            ETag: partResponse.ETag,
            PartNumber: partNumber,
          });
          
          totalBytesUploaded += partData.length;
          console.log(`[R2 Storage] Uploaded part ${partNumber}: ${(partData.length / 1024 / 1024).toFixed(2)} MB (total: ${(totalBytesUploaded / 1024 / 1024).toFixed(2)} MB)`);
          
          if (onProgress) {
            onProgress(totalBytesUploaded, partNumber);
          }
          
          partNumber++;
        }
      }

      checkAborted();

      // 3. Upload remaining data as final part (can be smaller than 5MB)
      if (buffer.length > 0) {
        const uploadPartCommand = new UploadPartCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buffer,
        });
        
        const partResponse = await this.client.send(uploadPartCommand);
        
        if (!partResponse.ETag) {
          throw new Error(`No ETag returned for final part ${partNumber}`);
        }
        
        uploadedParts.push({
          ETag: partResponse.ETag,
          PartNumber: partNumber,
        });
        
        totalBytesUploaded += buffer.length;
        console.log(`[R2 Storage] Uploaded final part ${partNumber}: ${(buffer.length / 1024 / 1024).toFixed(2)} MB (total: ${(totalBytesUploaded / 1024 / 1024).toFixed(2)} MB)`);
        
        if (onProgress) {
          onProgress(totalBytesUploaded, partNumber);
        }
      }

      checkAborted();

      // 4. Complete multipart upload
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber),
        },
      });
      
      await this.client.send(completeCommand);
      
      const url = `${this.publicUrl}/${key}`;
      console.log(`[R2 Storage] Multipart upload completed: ${key} (${(totalBytesUploaded / 1024 / 1024).toFixed(2)} MB)`);
      
      return { success: true, url, key, totalBytes: totalBytesUploaded };
    } catch (error: any) {
      console.error("[R2 Storage] Multipart upload failed:", error);
      
      // Abort the multipart upload on failure
      if (uploadId) {
        try {
          const abortCommand = new AbortMultipartUploadCommand({
            Bucket: this.bucketName,
            Key: key,
            UploadId: uploadId,
          });
          await this.client.send(abortCommand);
          console.log(`[R2 Storage] Aborted multipart upload: ${uploadId}`);
        } catch (abortError) {
          console.error("[R2 Storage] Failed to abort multipart upload:", abortError);
        }
      }
      
      return { success: false, error: error.message };
    }
  }
}

export const r2Storage = new R2StorageService();
