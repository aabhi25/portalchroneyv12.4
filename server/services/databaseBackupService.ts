import { spawn } from "child_process";
import { createGunzip, createGzip } from "zlib";
import { Readable } from "stream";
import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { r2Storage } from "./r2StorageService";
import { backupJobManager, BackupJobStatus } from "./backupJobManager";
import { storage } from "../storage";

interface RestoreResult {
  success: boolean;
  error?: string;
  duration?: number;
}

interface BackupResult {
  success: boolean;
  filename?: string;
  size?: number;
  type?: "daily" | "weekly" | "monthly" | "manual";
  error?: string;
  duration?: number;
}

interface BackupFile {
  key: string;
  size: number;
  lastModified: Date;
  type: "daily" | "weekly" | "monthly" | "manual";
  url: string;
}

export interface VerificationResult {
  tableName: string;
  expected: number;
  actual: number;
  status: 'ok' | 'mismatch' | 'recovered' | 'failed';
  errorMessage?: string;
}

export interface RestoreProgress {
  active: boolean;
  stage: string;
  stageNumber: number;
  totalStages: number;
  percent: number;
  detail: string;
  startedAt: number;
  error?: string;
  verificationReport?: VerificationResult[];
}

const BACKUP_PREFIX = "database-backups";
const RETENTION_DAYS = {
  daily: 3,
  weekly: 28,
  monthly: 90,
};

const PG_DUMP_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes for large databases
const STREAMING_BACKUP_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes for streaming backup

class DatabaseBackupService {
  private activePgDump: ReturnType<typeof spawn> | null = null;
  private activeAbortSignal: { aborted: boolean } | null = null;
  private restoreProgress: RestoreProgress | null = null;

  getRestoreProgress(): RestoreProgress | null {
    return this.restoreProgress;
  }

  private setRestoreProgress(stage: string, stageNumber: number, totalStages: number, percent: number, detail: string) {
    this.restoreProgress = {
      active: true,
      stage,
      stageNumber,
      totalStages,
      percent,
      detail,
      startedAt: this.restoreProgress?.startedAt || Date.now(),
    };
  }

  private clearRestoreProgress(error?: string, verificationReport?: VerificationResult[]) {
    if (error) {
      this.restoreProgress = {
        active: false,
        stage: 'failed',
        stageNumber: 0,
        totalStages: 0,
        percent: 0,
        detail: error,
        startedAt: this.restoreProgress?.startedAt || Date.now(),
        error,
      };
      setTimeout(() => { this.restoreProgress = null; }, 30000);
    } else {
      const okCount = verificationReport?.filter(r => r.status === 'ok').length ?? 0;
      const recoveredCount = verificationReport?.filter(r => r.status === 'recovered').length ?? 0;
      const failedCount = verificationReport?.filter(r => r.status === 'failed').length ?? 0;
      const failedNames = verificationReport?.filter(r => r.status === 'failed').map(r => r.tableName) ?? [];
      let detail: string;
      if (verificationReport) {
        detail = `Verified ${okCount} tables OK${recoveredCount > 0 ? `, ${recoveredCount} auto-recovered` : ''}`;
        if (failedCount > 0) {
          detail += `, ${failedCount} skipped/failed: ${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? '...' : ''}`;
        } else {
          detail += '.';
        }
      } else {
        detail = 'Restore completed successfully';
      }
      this.restoreProgress = {
        active: false,
        stage: 'completed',
        stageNumber: 0,
        totalStages: 0,
        percent: 100,
        detail,
        startedAt: this.restoreProgress?.startedAt || Date.now(),
        verificationReport,
      };
      setTimeout(() => { this.restoreProgress = null; }, 30000);
    }
  }

  cancelActiveBackup(): boolean {
    const activeJob = backupJobManager.getActiveJob();
    if (!activeJob) {
      return false;
    }

    this.log('CANCEL', 'Cancelling active backup...');

    if (this.activeAbortSignal) {
      this.activeAbortSignal.aborted = true;
      this.activeAbortSignal = null;
    }

    if (this.activePgDump && !this.activePgDump.killed) {
      this.activePgDump.kill('SIGTERM');
      this.activePgDump = null;
    }

    backupJobManager.completeJob(activeJob.id, {
      success: false,
      error: 'Backup cancelled by user',
    });

    this.log('CANCEL', 'Backup cancelled successfully');
    return true;
  }

  private getBackupType(date: Date): "daily" | "weekly" | "monthly" {
    // Use IST (UTC+5:30) to determine type so the 4 AM IST scheduler
    // classifies monthly/weekly correctly (server runs in UTC).
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + IST_OFFSET_MS);
    const dayOfMonth = istDate.getUTCDate();
    const dayOfWeek = istDate.getUTCDay();

    if (dayOfMonth === 1) {
      return "monthly";
    }
    if (dayOfWeek === 0) {
      return "weekly";
    }
    return "daily";
  }

  private formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private formatTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}-${mm}-${ss}-${ms}`;
  }

  private getBackupFilename(type: "daily" | "weekly" | "monthly", date: Date): string {
    const dateStr = this.formatDate(date);
    const timeStr = this.formatTime(date);
    return `${BACKUP_PREFIX}/${type}/backup_${dateStr}_${timeStr}.sql.gz`;
  }

  private log(stage: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[Database Backup] [${stage}] ${message}`;
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  private logError(stage: string, message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    console.error(`[Database Backup] [${stage}] ERROR: ${message}`, error || '');
  }

  private async createStreamingBackup(
    databaseUrl: string,
    filename: string,
    onProgress?: (stage: string, message: string, progress: number) => void
  ): Promise<{ success: boolean; totalBytes: number; duration: number; error?: string }> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let resolved = false;
      let timeoutId: NodeJS.Timeout | null = null;
      let pgDumpTimeoutId: NodeJS.Timeout | null = null;

      const safeResolve = (result: { success: boolean; totalBytes: number; duration: number; error?: string }) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (pgDumpTimeoutId) clearTimeout(pgDumpTimeoutId);
        resolve(result);
      };

      const abortSignal = { aborted: false };
      this.activeAbortSignal = abortSignal;

      const cleanup = (pgDump: ReturnType<typeof spawn>) => {
        try {
          abortSignal.aborted = true;
          if (!pgDump.killed) pgDump.kill('SIGTERM');
          this.activePgDump = null;
          this.activeAbortSignal = null;
        } catch (e) {
          this.logError('STREAM', 'Cleanup error', e);
        }
      };

      this.log('STREAM', 'Starting streaming backup (pg_dump plain SQL -> gzip -> R2 multipart upload)...');
      onProgress?.('dumping', 'Starting streaming database dump (plain SQL + gzip)...', 15);

      const pgDump = spawn('pg_dump', ['--format=plain', '--no-owner', '--no-acl', databaseUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.activePgDump = pgDump;

      const errorChunks: string[] = [];
      let pgDumpExited = false;

      let pgDumpResolve: (code: number) => void;
      const pgDumpComplete = new Promise<number>((res) => {
        pgDumpResolve = res;
      });

      const gzipStream = createGzip();

      pgDumpTimeoutId = setTimeout(() => {
        if (!pgDumpExited) {
          this.logError('STREAM', `pg_dump timed out after ${PG_DUMP_TIMEOUT_MS / 1000 / 60} minutes`);
          gzipStream.destroy();
          cleanup(pgDump);
          safeResolve({
            success: false,
            totalBytes: 0,
            duration: Date.now() - startTime,
            error: `pg_dump timed out after ${PG_DUMP_TIMEOUT_MS / 1000 / 60} minutes`,
          });
        }
      }, PG_DUMP_TIMEOUT_MS);

      pgDump.stderr.on('data', (chunk: Buffer) => {
        errorChunks.push(chunk.toString());
      });

      pgDump.on('error', (error) => {
        this.logError('STREAM', 'pg_dump process error', error);
        gzipStream.destroy();
        cleanup(pgDump);
        safeResolve({
          success: false,
          totalBytes: 0,
          duration: Date.now() - startTime,
          error: `pg_dump process error: ${error.message}`,
        });
      });

      pgDump.on('close', (code) => {
        pgDumpExited = true;
        pgDumpResolve(code ?? -1);
        if (pgDumpTimeoutId) clearTimeout(pgDumpTimeoutId);

        if (code !== 0) {
          const errorMsg = errorChunks.join('') || `pg_dump exited with code ${code}`;
          this.logError('STREAM', `pg_dump failed with exit code ${code}`, errorMsg);
          gzipStream.destroy();
          cleanup(pgDump);
          safeResolve({
            success: false,
            totalBytes: 0,
            duration: Date.now() - startTime,
            error: `pg_dump failed: ${errorMsg}`,
          });
        } else {
          this.log('STREAM', 'pg_dump completed successfully, waiting for gzip + upload to finish...');
        }
      });

      pgDump.stdout.pipe(gzipStream);

      onProgress?.('uploading', 'Starting multipart upload to R2...', 20);

      r2Storage.uploadStreamMultipart(
        gzipStream,
        filename,
        'application/octet-stream',
        (bytesUploaded, partNumber) => {
          const mbUploaded = (bytesUploaded / 1024 / 1024).toFixed(1);
          this.log('STREAM', `Streaming progress: ${mbUploaded} MB (part ${partNumber})`);
          onProgress?.('uploading', `Uploaded part ${partNumber} (${mbUploaded} MB total)...`, Math.min(95, 30 + partNumber * 5));
        },
        abortSignal
      ).then(async (uploadResult) => {
        const duration = Date.now() - startTime;

        if (!uploadResult.success) {
          this.logError('STREAM', 'Multipart upload failed', uploadResult.error);
          safeResolve({
            success: false,
            totalBytes: 0,
            duration,
            error: uploadResult.error || 'Multipart upload failed',
          });
          return;
        }

        this.log('STREAM', 'Upload complete, waiting for pg_dump to confirm success...');
        const exitCode = await pgDumpComplete;

        if (exitCode !== 0) {
          const errorMsg = errorChunks.join('') || `pg_dump exited with code ${exitCode}`;
          this.logError('STREAM', 'pg_dump failed after upload completed, deleting uploaded backup');
          try {
            await r2Storage.deleteFile(filename);
            this.log('STREAM', 'Deleted partial backup file');
          } catch (deleteError) {
            this.logError('STREAM', 'Failed to delete partial backup', deleteError);
          }
          safeResolve({
            success: false,
            totalBytes: uploadResult.totalBytes || 0,
            duration: Date.now() - startTime,
            error: `pg_dump failed: ${errorMsg}`,
          });
          return;
        }

        const finalDuration = Date.now() - startTime;
        this.log('STREAM', `Streaming backup (plain SQL + gzip) completed successfully`, {
          totalBytes: uploadResult.totalBytes,
          totalMB: ((uploadResult.totalBytes || 0) / 1024 / 1024).toFixed(2),
          durationSec: (finalDuration / 1000).toFixed(1),
        });

        safeResolve({
          success: true,
          totalBytes: uploadResult.totalBytes || 0,
          duration: finalDuration,
        });
      }).catch((error) => {
        const duration = Date.now() - startTime;
        this.logError('STREAM', 'Streaming backup failed', error);
        cleanup(pgDump, progressStream);
        safeResolve({
          success: false,
          totalBytes: 0,
          duration,
          error: error.message || 'Unknown streaming error',
        });
      });

      timeoutId = setTimeout(() => {
        this.logError('STREAM', `Overall backup timed out after ${STREAMING_BACKUP_TIMEOUT_MS / 1000 / 60} minutes`);
        cleanup(pgDump, progressStream);
        safeResolve({
          success: false,
          totalBytes: 0,
          duration: Date.now() - startTime,
          error: `Streaming backup timed out after ${STREAMING_BACKUP_TIMEOUT_MS / 1000 / 60} minutes`,
        });
      }, STREAMING_BACKUP_TIMEOUT_MS);
    });
  }

  async createBackup(jobId?: string, triggeredBy: string = 'system'): Promise<BackupResult> {
    const overallStartTime = Date.now();
    const now = new Date();
    const backupType = this.getBackupType(now);
    const filename = this.getBackupFilename(backupType, now);
    const correlationId = jobId || `backup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const updateProgress = (status: BackupJobStatus, message: string, progress: number) => {
      if (jobId) {
        backupJobManager.setStatus(jobId, status, message, progress);
      }
    };

    this.log('START', `Beginning ${backupType} backup`, { filename, correlationId });
    updateProgress('pending', 'Initializing backup...', 5);

    // Create persistent backup job record
    try {
      await storage.createBackupJob({
        correlationId,
        operation: 'create',
        status: 'running',
        backupType,
        backupKey: filename,
        triggeredBy,
      });
    } catch (dbError) {
      this.logError('DB_LOG', 'Failed to create backup job record', dbError);
    }

    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        const errorMsg = "Database connection not configured";
        this.logError('CONFIG', 'DATABASE_URL environment variable not set');
        const result = { success: false, error: errorMsg };
        if (jobId) backupJobManager.completeJob(jobId, result);
        await this.updateBackupJobFailed(correlationId, errorMsg, 'DATABASE_URL environment variable not set');
        return result;
      }

      this.log('CONFIG', 'Database URL found, checking R2 storage...');
      updateProgress('pending', 'Checking R2 storage configuration...', 10);
      
      const r2Configured = await r2Storage.ensureInitialized();
      if (!r2Configured) {
        const errorMsg = "Cloud storage not configured. Please configure R2 settings first.";
        this.logError('CONFIG', 'R2 storage is not configured');
        const result = { success: false, error: errorMsg };
        if (jobId) backupJobManager.completeJob(jobId, result);
        await this.updateBackupJobFailed(correlationId, errorMsg, 'R2 storage environment variables not set');
        return result;
      }
      
      this.log('CONFIG', 'R2 storage is configured and ready');
      updateProgress('dumping', 'Starting streaming backup (memory-efficient)...', 15);

      // Use streaming approach for large databases - pipes pg_dump through gzip directly to R2
      const streamingResult = await this.createStreamingBackup(
        databaseUrl,
        filename,
        (stage, message, progress) => {
          updateProgress(stage as BackupJobStatus, message, progress);
        }
      );

      if (!streamingResult.success) {
        const errorMsg = streamingResult.error || 'Streaming backup failed';
        const result = { success: false, error: errorMsg };
        if (jobId) backupJobManager.completeJob(jobId, result);
        await this.updateBackupJobFailed(correlationId, errorMsg, errorMsg);
        return result;
      }

      const backupDuration = streamingResult.duration;

      if (filename.endsWith('.sql.gz')) {
        const uploadedSizeMB = (streamingResult.totalBytes / 1024 / 1024).toFixed(2);
        this.log('VERIFY', `Verifying uploaded backup integrity (full gzip decompression test, ${uploadedSizeMB} MB)...`);
        const verification = await r2Storage.verifyGzipIntegrity(filename);
        if (!verification.valid) {
          const errorMsg = `Backup uploaded but failed integrity check: ${verification.error}`;
          this.logError('VERIFY', errorMsg);
          this.log('VERIFY', 'Deleting corrupted backup from R2...');
          await r2Storage.deleteFile(filename);
          const result = { success: false, error: errorMsg };
          if (jobId) backupJobManager.completeJob(jobId, result);
          await this.updateBackupJobFailed(correlationId, errorMsg, errorMsg);
          return result;
        }
        this.log('VERIFY', `Backup integrity verified — gzip stream (${uploadedSizeMB} MB) fully decompressed without errors`);
      } else if (filename.endsWith('.dump')) {
        this.log('VERIFY', 'Verifying uploaded backup integrity (PGDMP magic bytes check)...');
        const verification = await r2Storage.verifyPgdmpHeader(filename);
        if (!verification.valid) {
          const errorMsg = `Backup uploaded but failed PGDMP integrity check: ${verification.error}`;
          this.logError('VERIFY', errorMsg);
          this.log('VERIFY', 'Deleting corrupted backup from R2...');
          await r2Storage.deleteFile(filename);
          const result = { success: false, error: errorMsg };
          if (jobId) backupJobManager.completeJob(jobId, result);
          await this.updateBackupJobFailed(correlationId, errorMsg, errorMsg);
          return result;
        }
        this.log('VERIFY', 'Backup integrity verified — valid PGDMP archive');
      }

      this.log('COMPLETE', `Streaming backup completed successfully`, {
        type: backupType,
        filename,
        compressedSizeMB: (streamingResult.totalBytes / 1024 / 1024).toFixed(2),
        totalDurationSec: (backupDuration / 1000).toFixed(1)
      });

      // Update persistent job record with success
      try {
        await storage.updateBackupJob(correlationId, {
          status: 'completed',
          fileSizeBytes: String(streamingResult.totalBytes),
          durationMs: String(backupDuration),
          metadata: {
            streamingBackup: true,
            compressedBytes: streamingResult.totalBytes,
          },
        });
      } catch (dbError) {
        this.logError('DB_LOG', 'Failed to update backup job record', dbError);
      }

      this.log('CLEANUP', 'Starting old backup cleanup...');
      await this.cleanupOldBackups();

      const result = {
        success: true,
        filename,
        size: streamingResult.totalBytes,
        type: backupType,
        duration: backupDuration,
      };

      if (jobId) backupJobManager.completeJob(jobId, result);

      return result;
    } catch (error: any) {
      const totalDuration = Date.now() - overallStartTime;
      const userFriendlyError = this.getUserFriendlyError(error);
      this.logError('FAILED', `Backup failed after ${(totalDuration / 1000).toFixed(1)}s`, {
        error: error.message,
        stack: error.stack
      });
      
      await this.updateBackupJobFailed(correlationId, userFriendlyError, error.stack || error.message, totalDuration);
      
      const result = { success: false, error: userFriendlyError, duration: totalDuration };
      if (jobId) backupJobManager.completeJob(jobId, result);
      return result;
    }
  }

  private getUserFriendlyError(error: any): string {
    const message = error.message || String(error);
    if (message.includes('pg_dump')) {
      return 'Database export failed. Please try again or contact support.';
    }
    if (message.includes('R2') || message.includes('upload') || message.includes('S3')) {
      return 'Failed to upload backup to cloud storage. Please check your storage configuration.';
    }
    if (message.includes('timeout') || message.includes('Timeout')) {
      return 'Backup operation timed out. The database may be too large or the connection is slow.';
    }
    if (message.includes('permission') || message.includes('Permission') || message.includes('access')) {
      return 'Permission denied. Please check database and storage access rights.';
    }
    return 'Backup failed. Please try again or contact support if the issue persists.';
  }

  private async updateBackupJobFailed(correlationId: string, userError: string, technicalDetails: string, durationMs?: number): Promise<void> {
    try {
      await storage.updateBackupJob(correlationId, {
        status: 'failed',
        errorMessage: userError,
        errorDetails: technicalDetails,
        durationMs: durationMs ? String(durationMs) : undefined,
      });
    } catch (dbError) {
      this.logError('DB_LOG', 'Failed to update backup job failure record', dbError);
    }
  }

  async listBackups(): Promise<BackupFile[]> {
    const isConfigured = await r2Storage.ensureInitialized();
    if (!isConfigured) {
      this.logError('LIST', 'R2 storage not configured');
      return [];
    }

    const result = await r2Storage.listFiles(BACKUP_PREFIX);
    
    if (!result.success || !result.files) {
      this.logError('LIST', 'Failed to list backups from R2', result.error);
      return [];
    }

    return result.files
      .filter(f => f.key.endsWith(".sql.gz") || f.key.endsWith(".dump") || f.key.includes("/manual/"))
      .map(f => {
        let type: "daily" | "weekly" | "monthly" | "manual" = "daily";
        if (f.key.includes("/manual/")) type = "manual";
        else if (f.key.includes("/weekly/")) type = "weekly";
        else if (f.key.includes("/monthly/")) type = "monthly";
        
        return {
          key: f.key,
          size: f.size,
          lastModified: f.lastModified,
          type,
          url: r2Storage.getPublicUrl(f.key),
        };
      })
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  async cleanupOldBackups(): Promise<{ deleted: number; errors: number }> {
    const now = new Date();
    const backups = await this.listBackups();
    
    let deleted = 0;
    let errors = 0;

    for (const backup of backups) {
      const retentionDays = RETENTION_DAYS[backup.type];
      const ageMs = now.getTime() - backup.lastModified.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > retentionDays) {
        this.log('CLEANUP', `Deleting old ${backup.type} backup: ${backup.key} (${ageDays.toFixed(1)} days old)`);
        
        const deleteResult = await r2Storage.deleteFile(backup.key);
        if (deleteResult.success) {
          deleted++;
        } else {
          this.logError('CLEANUP', `Failed to delete ${backup.key}`, deleteResult.error);
          errors++;
        }
      }
    }

    if (deleted > 0) {
      this.log('CLEANUP', `Cleanup complete: ${deleted} old backups deleted`);
    } else {
      this.log('CLEANUP', 'No old backups to clean up');
    }

    return { deleted, errors };
  }

  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    byType: { daily: number; weekly: number; monthly: number; manual: number };
    oldestBackup: Date | null;
    newestBackup: Date | null;
  }> {
    const backups = await this.listBackups();
    
    const stats = {
      totalBackups: backups.length,
      totalSize: backups.reduce((sum, b) => sum + b.size, 0),
      byType: { daily: 0, weekly: 0, monthly: 0, manual: 0 },
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].lastModified : null,
      newestBackup: backups.length > 0 ? backups[0].lastModified : null,
    };

    for (const backup of backups) {
      stats.byType[backup.type]++;
    }

    return stats;
  }

  async restoreBackup(backupKey: string, triggeredBy: string = 'manual'): Promise<RestoreResult> {
    const overallStartTime = Date.now();
    const correlationId = `restore_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    // Extract backup type from key
    let backupType: 'daily' | 'weekly' | 'monthly' = 'daily';
    if (backupKey.includes('/weekly/')) backupType = 'weekly';
    if (backupKey.includes('/monthly/')) backupType = 'monthly';
    
    this.log('RESTORE_START', `Beginning restore from backup`, { backupKey, correlationId });

    // Create persistent restore job record
    try {
      await storage.createBackupJob({
        correlationId,
        operation: 'restore',
        status: 'running',
        backupType,
        backupKey,
        triggeredBy,
      });
    } catch (dbError) {
      this.logError('DB_LOG', 'Failed to create restore job record', dbError);
    }

    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        const errorMsg = "Database connection not configured";
        this.logError('RESTORE_CONFIG', 'DATABASE_URL environment variable not set');
        await this.updateBackupJobFailed(correlationId, errorMsg, 'DATABASE_URL environment variable not set');
        return { success: false, error: errorMsg };
      }

      const isConfigured = await r2Storage.ensureInitialized();
      if (!isConfigured) {
        const errorMsg = "Cloud storage not configured";
        this.logError('RESTORE_CONFIG', 'R2 storage not configured');
        await this.updateBackupJobFailed(correlationId, errorMsg, 'R2 storage environment variables not set');
        return { success: false, error: errorMsg };
      }

      this.setRestoreProgress('Downloading', 1, 8, 5, 'Downloading backup from cloud storage...');
      this.log('RESTORE_DOWNLOAD', `Downloading backup from R2...`, { backupKey });
      const downloadStartTime = Date.now();

      const isCustomFormat = backupKey.endsWith('.dump');
      let restoreDuration: number;
      let verificationReport: VerificationResult[] | undefined;
      let downloadedSizeBytes = 0;

      if (isCustomFormat) {
        const tempFile = path.join(os.tmpdir(), `pg_restore_download_${Date.now()}.dump`);
        this.log('RESTORE_DATA', 'Routing to pg_restore path — streaming .dump directly to temp file (no memory buffer)');
        const dlResult = await r2Storage.downloadToFile(backupKey, tempFile);
        if (!dlResult.success) {
          const errorMsg = "Failed to download backup file from cloud storage";
          this.logError('RESTORE_DOWNLOAD', 'Failed to download backup', dlResult.error);
          this.clearRestoreProgress(errorMsg);
          await this.updateBackupJobFailed(correlationId, errorMsg, dlResult.error || 'R2 downloadToFile failed');
          return { success: false, error: errorMsg };
        }
        downloadedSizeBytes = dlResult.sizeBytes ?? 0;
        const downloadDuration = Date.now() - downloadStartTime;
        const sizeMB = (downloadedSizeBytes / 1024 / 1024).toFixed(1);
        this.log('RESTORE_DOWNLOAD', `Downloaded in ${(downloadDuration / 1000).toFixed(1)}s`, { sizeMB });
        this.setRestoreProgress('Downloading', 1, 8, 15, `Downloaded ${sizeMB} MB`);

        try {
          const result = await this.runPgRestoreDataRestore(databaseUrl, tempFile);
          restoreDuration = result.duration;
          verificationReport = result.verificationReport;
        } finally {
          try { await fs.promises.unlink(tempFile); } catch (_) {}
        }
      } else {
        this.log('RESTORE_DATA', 'Routing to schema-aware legacy streaming path (.sql.gz)');
        const downloadResult = await r2Storage.getFile(backupKey);
        if (!downloadResult.success || !downloadResult.data) {
          const errorMsg = "Failed to download backup file from cloud storage";
          this.logError('RESTORE_DOWNLOAD', 'Failed to download backup', downloadResult.error);
          this.clearRestoreProgress(errorMsg);
          await this.updateBackupJobFailed(correlationId, errorMsg, downloadResult.error || 'R2 getFile failed');
          return { success: false, error: errorMsg };
        }
        downloadedSizeBytes = downloadResult.data.length;
        const downloadDuration = Date.now() - downloadStartTime;
        const sizeMB = (downloadedSizeBytes / 1024 / 1024).toFixed(1);
        this.log('RESTORE_DOWNLOAD', `Downloaded in ${(downloadDuration / 1000).toFixed(1)}s`, { sizeMB });
        this.setRestoreProgress('Downloading', 1, 8, 15, `Downloaded ${sizeMB} MB`);
        const result = await this.runStreamingDataRestore(databaseUrl, downloadResult.data);
        restoreDuration = result.duration;
        verificationReport = result.verificationReport;
      }

      const totalDuration = Date.now() - overallStartTime;

      this.log('RESTORE_COMPLETE', `Restore completed successfully`, {
        backupKey,
        restoreDurationSec: (restoreDuration / 1000).toFixed(1),
        totalDurationSec: (totalDuration / 1000).toFixed(1),
      });

      try {
        await storage.updateBackupJob(correlationId, {
          status: 'completed',
          fileSizeBytes: String(downloadedSizeBytes),
          durationMs: String(totalDuration),
          metadata: {
            restoreDurationMs: restoreDuration,
          },
        });
      } catch (dbError) {
        this.logError('DB_LOG', 'Failed to update restore job record', dbError);
      }

      this.clearRestoreProgress(undefined, verificationReport);
      return { success: true, duration: totalDuration };
    } catch (error: any) {
      const totalDuration = Date.now() - overallStartTime;
      const userFriendlyError = this.getRestoreUserFriendlyError(error);
      this.logError('RESTORE_FAILED', `Restore failed after ${(totalDuration / 1000).toFixed(1)}s`, {
        error: error.message,
        stack: error.stack
      });
      this.clearRestoreProgress(userFriendlyError);
      await this.updateBackupJobFailed(correlationId, userFriendlyError, error.stack || error.message, totalDuration);
      return { success: false, error: userFriendlyError, duration: totalDuration };
    }
  }

  private getRestoreUserFriendlyError(error: any): string {
    const message = error.message || String(error);
    if (message.includes('psql') || message.includes('PSQL')) {
      return 'Database restore failed. The backup file may be corrupted or incompatible.';
    }
    if (message.includes('gunzip') || message.includes('decompress') || message.includes('incorrect header')) {
      return 'Failed to decompress backup file. The file may be corrupted.';
    }
    if (message.includes('download') || message.includes('R2') || message.includes('S3')) {
      return 'Failed to download backup from cloud storage.';
    }
    if (message.includes('timeout') || message.includes('Timeout')) {
      return 'Restore operation timed out. The backup may be too large.';
    }
    return 'Restore failed. Please try again or contact support.';
  }

  private async runPsqlCommand(databaseUrl: string, sql: string, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const errorChunks: string[] = [];

      const psql = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timeoutId = setTimeout(() => {
        psql.kill('SIGTERM');
        reject(new Error(`${label} timed out`));
      }, PG_DUMP_TIMEOUT_MS);

      psql.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (!text.includes('NOTICE:')) {
          errorChunks.push(text);
        }
      });

      psql.on('close', (code) => {
        clearTimeout(timeoutId);
        const criticalErrors = errorChunks.filter(e =>
          e.includes('ERROR') || e.includes('FATAL')
        );
        if (code !== 0 || criticalErrors.length > 0) {
          const errorMsg = criticalErrors.join('\n') || `psql exited with code ${code}`;
          this.logError(label, `Failed`, errorMsg);
          reject(new Error(`${label} failed: ${errorMsg}`));
          return;
        }
        resolve();
      });

      psql.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`${label} process error: ${error.message}`));
      });

      psql.stdin.write(sql);
      psql.stdin.end();
    });
  }

  private async runPsqlQuery(databaseUrl: string, sql: string, label: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const psql = spawn('psql', [databaseUrl, '-t', '-A', '-F', '\t', '-c', sql], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      const stderrChunks: string[] = [];
      psql.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      psql.stderr.on('data', (d: Buffer) => { stderrChunks.push(d.toString()); });
      psql.on('close', (code) => {
        if (code !== 0) {
          const errText = stderrChunks.join('').trim() || `exit ${code}`;
          reject(new Error(`${label} failed: ${errText}`));
        } else {
          resolve(stdout);
        }
      });
      psql.on('error', (err) => reject(new Error(`${label} process error: ${err.message}`)));
    });
  }

  /**
   * Verify the current DB role can TRUNCATE and ALTER each public table. Fails fast
   * with an explicit error before destructive ops if any privilege is missing
   * (typical when the DB has been migrated to a non-owner role).
   */
  private async assertCanModifyTables(databaseUrl: string, tables: string[]): Promise<void> {
    if (tables.length === 0) return;
    const sql = `
      SELECT t.tablename,
             has_table_privilege(current_user, format('public.%I', t.tablename)::regclass, 'TRUNCATE') AS can_truncate,
             (t.tableowner = current_user) AS is_owner
      FROM pg_tables t
      WHERE t.schemaname = 'public'
    `;
    const out = await this.runPsqlQuery(databaseUrl, sql, 'RESTORE_PREFLIGHT');
    const lacking: string[] = [];
    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      const [tableName, canTruncate, isOwner] = line.split('\t');
      if (canTruncate !== 't' || isOwner !== 't') {
        lacking.push(`${tableName}(truncate=${canTruncate},owner=${isOwner})`);
      }
    }
    if (lacking.length > 0) {
      throw new Error(
        `RESTORE_PREFLIGHT failed: current DB role lacks TRUNCATE or ownership on ${lacking.length} table(s). ` +
        `Restore requires the role that owns the public schema. First few: ${lacking.slice(0, 5).join(', ')}`
      );
    }
  }

  /**
   * Snapshot all foreign-key constraints in the public schema (or for a single table
   * when tableName is provided). Returns rows suitable for drop+recreate.
   */
  private async snapshotForeignKeys(
    databaseUrl: string,
    tableName?: string,
  ): Promise<Array<{ conname: string; tableName: string; definition: string }>> {
    const filter = tableName
      ? `AND conrelid = format('public.%I', '${tableName.replace(/'/g, "''")}')::regclass`
      : '';
    const sql = `
      SELECT conname,
             (SELECT relname FROM pg_class WHERE oid = conrelid) AS table_name,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
        ${filter}
      ORDER BY conname
    `;
    const out = await this.runPsqlQuery(databaseUrl, sql, 'RESTORE_SNAPSHOT_FKS');
    const fks: Array<{ conname: string; tableName: string; definition: string }> = [];
    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const conname = parts[0];
      const tName = parts[1];
      const definition = parts.slice(2).join('\t'); // rejoin in case definition contained tabs
      if (conname && tName && definition) {
        fks.push({ conname, tableName: tName, definition });
      }
    }
    return fks;
  }

  private async dropForeignKeys(
    databaseUrl: string,
    fks: Array<{ conname: string; tableName: string }>,
  ): Promise<void> {
    if (fks.length === 0) return;
    const sql = fks
      .map(fk => `ALTER TABLE "${fk.tableName}" DROP CONSTRAINT IF EXISTS "${fk.conname}";`)
      .join('\n');
    await this.runPsqlCommand(databaseUrl, sql, 'RESTORE_DROP_FKS');
  }

  /**
   * Recreate FKs as NOT VALID first (instant, restores write-time enforcement),
   * then VALIDATE each one. Per-FK validation failures are collected and returned
   * so the restore can complete and the operator can fix them manually.
   */
  private buildAddFkSql(fk: { conname: string; tableName: string; definition: string }): string {
    // Strip any trailing NOT VALID from pg_get_constraintdef output (defensive; current
    // FKs are validated, but pg may emit "FOREIGN KEY (...) REFERENCES ... NOT VALID"
    // for previously-not-validated FKs). Re-append our own NOT VALID for fast recreate.
    const def = fk.definition.replace(/\s+NOT\s+VALID\s*$/i, '').trim();
    return `ALTER TABLE "${fk.tableName}" ADD CONSTRAINT "${fk.conname}" ${def} NOT VALID;`;
  }

  private async recreateForeignKeys(
    databaseUrl: string,
    fks: Array<{ conname: string; tableName: string; definition: string }>,
  ): Promise<{ failures: Array<{ conname: string; tableName: string; error: string; sql: string }> }> {
    const failures: Array<{ conname: string; tableName: string; error: string; sql: string }> = [];
    if (fks.length === 0) return { failures };

    // Phase 1: ADD CONSTRAINT … NOT VALID (batched, fast)
    const added: typeof fks = [];
    const addNotValidSQL = fks.map(fk => this.buildAddFkSql(fk)).join('\n');
    try {
      await this.runPsqlCommand(databaseUrl, addNotValidSQL, 'RESTORE_RECREATE_FKS');
      added.push(...fks);
    } catch (e: any) {
      // Fall back to per-FK ADD so a single bad definition doesn't lose them all.
      this.log('RESTORE_RECREATE_FKS', `Batch add failed (${e.message}); falling back to per-FK add`);
      for (const fk of fks) {
        const sql = this.buildAddFkSql(fk);
        try {
          await this.runPsqlCommand(databaseUrl, sql, 'RESTORE_RECREATE_FK');
          added.push(fk);
        } catch (innerErr: any) {
          failures.push({ conname: fk.conname, tableName: fk.tableName, error: innerErr.message, sql });
        }
      }
    }

    // Phase 2: VALIDATE CONSTRAINT — only for FKs that were successfully added.
    for (const fk of added) {
      const sql = `ALTER TABLE "${fk.tableName}" VALIDATE CONSTRAINT "${fk.conname}";`;
      try {
        await this.runPsqlCommand(databaseUrl, sql, 'RESTORE_VALIDATE_FK');
      } catch (e: any) {
        failures.push({ conname: fk.conname, tableName: fk.tableName, error: e.message, sql });
      }
    }
    return { failures };
  }

  /**
   * Log the full recreate SQL for an FK snapshot before any destructive op, so a
   * crash between drop and recreate leaves the operator with all the SQL needed
   * to manually restore FKs from deployment logs.
   */
  private logFkRecoverySnapshot(
    label: string,
    fks: Array<{ conname: string; tableName: string; definition: string }>,
  ): void {
    if (fks.length === 0) return;
    this.log(label, `FK_RECOVERY_SNAPSHOT_BEGIN (${fks.length} constraints) — copy these statements if restore aborts before recreate completes:`);
    for (const fk of fks) {
      this.log(label, `  ${this.buildAddFkSql(fk)}`);
    }
    this.log(label, 'FK_RECOVERY_SNAPSHOT_END');
  }

  private async runStreamingDataRestore(databaseUrl: string, compressedData: Buffer): Promise<{ duration: number; verificationReport?: VerificationResult[] }> {
    const startTime = Date.now();

    this.setRestoreProgress('Preparing', 2, 8, 18, 'Getting list of database tables and schema...');
    this.log('RESTORE_DATA', 'Step 1: Getting list of tables and current schema...');

    const [tableListResult, schemaMap] = await Promise.all([
      new Promise<string>((resolve, reject) => {
        const psql = spawn('psql', [databaseUrl, '-t', '-A', '-c',
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'drizzle.__drizzle_migrations' ORDER BY tablename"
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        psql.stdout.on('data', (d: Buffer) => { output += d.toString(); });
        psql.on('close', () => resolve(output.trim()));
        psql.on('error', reject);
      }),
      this.buildSchemaMap(databaseUrl),
    ]);
    const tables = tableListResult.split('\n').filter(t => t.trim());
    this.log('RESTORE_DATA', `Found ${tables.length} tables, ${schemaMap.size} tables in current schema`);

    this.setRestoreProgress('Preflight', 3, 8, 22, `Checking restore privileges on ${tables.length} tables...`);
    this.log('RESTORE_DATA', 'Step 2a: Preflight — verifying TRUNCATE + ownership privileges...');
    await this.assertCanModifyTables(databaseUrl, tables);

    this.setRestoreProgress('Disabling Constraints', 3, 8, 25, 'Snapshotting foreign-key constraints...');
    this.log('RESTORE_DATA', 'Step 2b: Snapshotting and dropping FK constraints (Neon-safe; cannot disable system triggers)...');
    const fkSnapshot = await this.snapshotForeignKeys(databaseUrl);
    this.log('RESTORE_DATA', `Snapshotted ${fkSnapshot.length} FK constraint(s)`);
    this.logFkRecoverySnapshot('RESTORE_DATA', fkSnapshot);
    await this.dropForeignKeys(databaseUrl, fkSnapshot);

    this.setRestoreProgress('Truncating Tables', 4, 8, 30, `Emptying ${tables.length} tables...`);
    this.log('RESTORE_DATA', 'Step 3: Truncating all tables (CASCADE) — sessions table is reset; users will need to re-login...');
    const truncateSQL = `SET lock_timeout = '30s';\n` + tables
      .map(t => `TRUNCATE TABLE "${t}" CASCADE;`)
      .join('\n');
    await this.runPsqlCommand(databaseUrl, truncateSQL, 'RESTORE_TRUNCATE');

    this.setRestoreProgress('Restoring Data', 5, 8, 35, 'Streaming data into database (schema-aware)...');
    this.log('RESTORE_DATA', 'Step 4: Streaming data into database with schema-aware column filtering...');
    const { dataLines, errorCount, sampleErrors, skippedTables } = await this.streamFilteredDataToPsql(databaseUrl, compressedData, schemaMap);
    this.log('RESTORE_DATA', `Streamed ${dataLines} data lines`, {
      errorCount,
      skippedTables: skippedTables.length > 0 ? skippedTables : undefined,
      sampleErrors: sampleErrors.length > 0 ? sampleErrors : undefined,
    });

    this.setRestoreProgress('Enabling Constraints', 6, 8, 90, `Recreating ${fkSnapshot.length} FK constraints...`);
    this.log('RESTORE_DATA', 'Step 5: Recreating FK constraints (NOT VALID then VALIDATE per FK)...');
    const { failures: fkFailures } = await this.recreateForeignKeys(databaseUrl, fkSnapshot);
    if (fkFailures.length > 0) {
      this.log('RESTORE_DATA', `WARNING: ${fkFailures.length} FK(s) failed to recreate/validate — manual fix needed:`);
      for (const f of fkFailures) {
        this.log('RESTORE_DATA', `  FK "${f.conname}" on "${f.tableName}": ${f.error}`);
        this.log('RESTORE_DATA', `  Manual SQL: ${f.sql}`);
      }
    } else {
      this.log('RESTORE_DATA', `All ${fkSnapshot.length} FK constraints recreated and validated successfully`);
    }

    this.setRestoreProgress('Resetting Sequences', 7, 8, 95, 'Resetting auto-increment counters...');
    this.log('RESTORE_DATA', 'Step 6: Resetting sequences...');
    const resetSeqSQL = `
DO $$
DECLARE
  r RECORD;
  max_val BIGINT;
BEGIN
  FOR r IN
    SELECT s.relname AS seq_name, t.relname AS table_name, a.attname AS column_name
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid
    JOIN pg_class t ON d.refobjid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S' AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', r.column_name, r.table_name) INTO max_val;
    IF max_val > 0 THEN
      EXECUTE format('SELECT setval(%L, %s)', r.seq_name, max_val);
    END IF;
  END LOOP;
END$$;
`;
    await this.runPsqlCommand(databaseUrl, resetSeqSQL, 'RESTORE_RESET_SEQUENCES');

    this.setRestoreProgress('Verifying Data', 8, 8, 97, 'Scanning backup for expected row counts...');
    this.log('RESTORE_DATA', 'Step 7: Verifying restored row counts...');
    let verificationReport: VerificationResult[] | undefined;
    try {
      const expectedCounts = await this.extractExpectedRowCounts(compressedData);
      this.log('RESTORE_DATA', `Extracted expected counts for ${expectedCounts.size} tables`);

      if (expectedCounts.size > 0) {
        this.setRestoreProgress('Verifying Data', 8, 8, 98, `Checking row counts for ${expectedCounts.size} tables...`);
        verificationReport = await this.verifyRestoredCounts(databaseUrl, expectedCounts);

        const mismatches = verificationReport.filter(r => r.status === 'mismatch');
        this.log('RESTORE_DATA', `Verification: ${verificationReport.filter(r => r.status === 'ok').length} OK, ${mismatches.length} mismatch(es)`);

        if (mismatches.length > 0) {
          this.setRestoreProgress('Auto-Recovering', 8, 8, 98, `Fixing ${mismatches.length} table(s) with row count mismatches...`);
          this.log('RESTORE_DATA', `Auto-recovering ${mismatches.length} table(s): ${mismatches.map(m => m.tableName).join(', ')}`);

          for (const mismatch of mismatches) {
            this.log('RESTORE_DATA', `Recovering table "${mismatch.tableName}": expected ${mismatch.expected}, got ${mismatch.actual}`);
            try {
              await this.recoverMismatchedTable(databaseUrl, mismatch.tableName, compressedData, schemaMap);
              const rechecked = await this.verifyRestoredCounts(databaseUrl, new Map([[mismatch.tableName, mismatch.expected]]));
              const result = rechecked[0];
              const idx = verificationReport.findIndex(r => r.tableName === mismatch.tableName);
              if (result && result.actual === mismatch.expected) {
                verificationReport[idx] = { ...result, status: 'recovered' };
                this.log('RESTORE_DATA', `Recovered table "${mismatch.tableName}" successfully`);
              } else {
                verificationReport[idx] = { ...mismatch, actual: result?.actual ?? 0, status: 'failed' };
                this.log('RESTORE_DATA', `Recovery failed for "${mismatch.tableName}": got ${result?.actual ?? 0}`);
              }
            } catch (recoverErr: any) {
              const idx = verificationReport.findIndex(r => r.tableName === mismatch.tableName);
              verificationReport[idx] = { ...mismatch, status: 'failed' };
              this.log('RESTORE_DATA', `Recovery error for "${mismatch.tableName}": ${recoverErr.message}`);
            }
          }
        }
      }
    } catch (verifyErr: any) {
      this.log('RESTORE_DATA', `Warning: Verification step failed: ${verifyErr.message}`);
    }

    const duration = Date.now() - startTime;
    this.log('RESTORE_DATA', `Data-only restore completed in ${(duration / 1000).toFixed(1)}s`, {
      tables: tables.length,
      dataLines,
      errorCount,
      verificationSummary: verificationReport ? {
        ok: verificationReport.filter(r => r.status === 'ok').length,
        recovered: verificationReport.filter(r => r.status === 'recovered').length,
        failed: verificationReport.filter(r => r.status === 'failed').length,
      } : 'skipped',
    });
    return { duration, verificationReport };
  }

  private async buildSchemaMap(databaseUrl: string): Promise<Map<string, Set<string>>> {
    return new Promise((resolve, reject) => {
      const psql = spawn('psql', [databaseUrl, '-t', '-A', '-F', '\t', '-c',
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      psql.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      psql.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Schema query failed with code ${code}`));
          return;
        }
        const schemaMap = new Map<string, Set<string>>();
        for (const line of output.trim().split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          const tableName = parts[0];
          const columnName = parts[1];
          if (!tableName || !columnName) continue;
          if (!schemaMap.has(tableName)) {
            schemaMap.set(tableName, new Set());
          }
          schemaMap.get(tableName)!.add(columnName);
        }
        resolve(schemaMap);
      });
      psql.on('error', reject);
    });
  }

  private parseCopyHeader(line: string): { tableName: string; columns: string[] } | null {
    const match = line.match(/^COPY\s+(?:(?:public|"\w+")\.)?(?:"([^"]+)"|(\S+))\s*\(([^)]+)\)\s+FROM\s+stdin/i);
    if (!match) return null;
    const tableName = (match[1] || match[2] || '').replace(/^"|"$/g, '');
    const columnsStr = match[3] || '';
    const columns = columnsStr.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return { tableName, columns };
  }

  private async runPgRestoreDataRestore(
    databaseUrl: string,
    dumpFilePath: string
  ): Promise<{ duration: number; verificationReport?: VerificationResult[] }> {
    const startTime = Date.now();

    this.setRestoreProgress('Validating', 2, 8, 10, 'Validating backup archive before restore...');
    this.log('RESTORE_PG', 'Step 0: Validating backup archive with pg_restore --list (before any DB changes)...');
    await new Promise<void>((resolve, reject) => {
      const listStderr: string[] = [];
      const pgList = spawn('pg_restore', ['--list', dumpFilePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      pgList.stderr.on('data', (chunk: Buffer) => listStderr.push(chunk.toString()));
      pgList.on('error', (err) => reject(new Error(`pg_restore --list process error: ${err.message}`)));
      pgList.on('close', (code) => {
        if (code !== 0) {
          const errText = listStderr.join('').slice(0, 500);
          reject(new Error(`Backup archive is invalid or corrupted (pg_restore --list exited ${code}): ${errText}`));
        } else {
          resolve();
        }
      });
    });
    this.log('RESTORE_PG', 'Step 0 passed — backup archive is a valid pg_dump custom-format file');

    this.setRestoreProgress('Preparing', 2, 8, 18, 'Getting list of database tables...');
    this.log('RESTORE_PG', 'Step 1: Getting list of tables...');
    const tableListResult = await new Promise<string>((resolve, reject) => {
      const psql = spawn('psql', [databaseUrl, '-t', '-A', '-c',
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      psql.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      psql.on('close', (code) => {
        if (code !== 0) reject(new Error(`Table list query failed with code ${code}`));
        else resolve(output.trim());
      });
      psql.on('error', reject);
    });
    const tables = tableListResult.split('\n').filter(t => t.trim());
    this.log('RESTORE_PG', `Found ${tables.length} tables`);

    this.setRestoreProgress('Preflight', 3, 8, 20, `Checking restore privileges on ${tables.length} tables...`);
    this.log('RESTORE_PG', 'Step 2a: Preflight — verifying TRUNCATE + ownership privileges...');
    await this.assertCanModifyTables(databaseUrl, tables);

    this.setRestoreProgress('Disabling Constraints', 3, 8, 22, 'Snapshotting foreign-key constraints...');
    this.log('RESTORE_PG', 'Step 2b: Snapshotting and dropping FK constraints (Neon-safe)...');
    const fkSnapshot = await this.snapshotForeignKeys(databaseUrl);
    this.log('RESTORE_PG', `Snapshotted ${fkSnapshot.length} FK constraint(s)`);
    this.logFkRecoverySnapshot('RESTORE_PG', fkSnapshot);
    await this.dropForeignKeys(databaseUrl, fkSnapshot);

    this.setRestoreProgress('Truncating Tables', 4, 8, 28, `Emptying ${tables.length} tables...`);
    this.log('RESTORE_PG', 'Step 3: Truncating all tables (CASCADE) — sessions table is reset; users will need to re-login...');
    const truncateSQL = `SET lock_timeout = '30s';\n` + tables.map(t => `TRUNCATE TABLE "${t}" CASCADE;`).join('\n');
    await this.runPsqlCommand(databaseUrl, truncateSQL, 'RESTORE_TRUNCATE');

    this.setRestoreProgress('Restoring Data', 5, 8, 35, 'Running pg_restore...');
    this.log('RESTORE_PG', `Step 4: Running pg_restore --data-only --exit-on-error --no-data-for-failed-tables --jobs=4 on ${dumpFilePath}`);

    const pgRestoreStderr: string[] = [];
    const tableErrors = new Map<string, string>();
    const skippedTables: string[] = [];
    let pgRestoreExitCode = 0;
    let currentlyRestoringTable = '';

    await new Promise<void>((resolve) => {
      const pgRestore = spawn('pg_restore', [
        '--data-only',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--no-data-for-failed-tables',
        '--jobs=4',
        '--verbose',
        `--dbname=${databaseUrl}`,
        dumpFilePath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      const progressInterval = setInterval(() => {
        const progress = Math.min(35 + Math.floor((Date.now() - startTime) / 1000), 82);
        const detail = currentlyRestoringTable
          ? `pg_restore running... (table: ${currentlyRestoringTable})`
          : 'pg_restore running...';
        this.setRestoreProgress('Restoring Data', 5, 8, progress, detail);
      }, 2000);

      pgRestore.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) this.log('RESTORE_PG', `pg_restore stdout: ${text}`);
      });

      pgRestore.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        pgRestoreStderr.push(text);
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('pg_restore: processing data for table')) {
            const m = trimmed.match(/table "([^"]+)"\."([^"]+)"/);
            if (m) currentlyRestoringTable = m[2];
          }
          if (trimmed.includes('no data for failed table:')) {
            const m = trimmed.match(/table "?(\S+)"?/i);
            const tbl = m ? m[1].replace(/"/g, '') : '';
            if (tbl && !skippedTables.includes(tbl)) {
              skippedTables.push(tbl);
              tableErrors.set(tbl, trimmed);
            }
          }
          if (trimmed.includes('error') || trimmed.includes('ERROR')) {
            this.log('RESTORE_PG', `pg_restore stderr: ${trimmed}`);
            if (currentlyRestoringTable && !tableErrors.has(currentlyRestoringTable)) {
              tableErrors.set(currentlyRestoringTable, trimmed.slice(0, 200));
            }
          }
        }
      });

      pgRestore.on('close', (code) => {
        clearInterval(progressInterval);
        pgRestoreExitCode = code ?? 0;
        resolve();
      });

      pgRestore.on('error', (err) => {
        clearInterval(progressInterval);
        pgRestoreStderr.push(`pg_restore process error: ${err.message}`);
        resolve();
      });
    });

    if (pgRestoreExitCode > 1) {
      const errorSample = pgRestoreStderr.join('').slice(-1000);
      throw new Error(`pg_restore exited with fatal code ${pgRestoreExitCode}: ${errorSample}`);
    }

    if (pgRestoreExitCode === 1) {
      const fullStderr = pgRestoreStderr.join('');
      const archiveFatalPatterns = [
        'not a valid archive',
        'invalid archive',
        'could not read archive',
        'magic number mismatch',
        'unexpected end of file',
        'file does not appear to be a valid archive',
      ];
      const fatalMatch = archiveFatalPatterns.find(p => fullStderr.toLowerCase().includes(p));
      if (fatalMatch) {
        const errorSample = fullStderr.slice(-1000);
        throw new Error(`pg_restore failed with archive-level error ("${fatalMatch}"): ${errorSample}`);
      }
      this.log('RESTORE_PG', `pg_restore completed with warnings/skipped tables (exit 1)`, {
        skippedTables,
        errorCount: tableErrors.size,
      });
    } else {
      this.log('RESTORE_PG', 'pg_restore completed successfully (exit code 0)');
    }

    this.setRestoreProgress('Enabling Constraints', 6, 8, 85, `Recreating ${fkSnapshot.length} FK constraints...`);
    this.log('RESTORE_PG', 'Step 5: Recreating FK constraints (NOT VALID then VALIDATE per FK)...');
    const { failures: fkFailures } = await this.recreateForeignKeys(databaseUrl, fkSnapshot);
    if (fkFailures.length > 0) {
      this.log('RESTORE_PG', `WARNING: ${fkFailures.length} FK(s) failed to recreate/validate — manual fix needed:`);
      for (const f of fkFailures) {
        this.log('RESTORE_PG', `  FK "${f.conname}" on "${f.tableName}": ${f.error}`);
        this.log('RESTORE_PG', `  Manual SQL: ${f.sql}`);
      }
    } else {
      this.log('RESTORE_PG', `All ${fkSnapshot.length} FK constraints recreated and validated successfully`);
    }

    this.setRestoreProgress('Resetting Sequences', 7, 8, 92, 'Resetting auto-increment counters...');
    this.log('RESTORE_PG', 'Step 7: Resetting sequences...');
    const resetSeqSQL = `
DO $$
DECLARE
  r RECORD;
  max_val BIGINT;
BEGIN
  FOR r IN
    SELECT s.relname AS seq_name, t.relname AS table_name, a.attname AS column_name
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid
    JOIN pg_class t ON d.refobjid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S' AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', r.column_name, r.table_name) INTO max_val;
    IF max_val > 0 THEN
      EXECUTE format('SELECT setval(%L, %s)', r.seq_name, max_val);
    END IF;
  END LOOP;
END$$;
`;
    await this.runPsqlCommand(databaseUrl, resetSeqSQL, 'RESTORE_RESET_SEQUENCES');

    this.setRestoreProgress('Verifying Data', 8, 8, 97, 'Checking row counts...');
    this.log('RESTORE_PG', 'Step 8: Verifying restored row counts (checking for empty tables that should have data)...');
    let verificationReport: VerificationResult[] | undefined;
    try {
      const tableCountsResult = await new Promise<string>((resolve, reject) => {
        const psql = spawn('psql', [databaseUrl, '-t', '-A', '-F', '\t', '-c',
          "SELECT tablename, (xpath('/row/c/text()', query_to_xml(format('SELECT COUNT(*) AS c FROM %I.%I', table_schema, tablename), FALSE, TRUE, '')))[1]::TEXT::INT FROM information_schema.tables WHERE table_schema = 'public' ORDER BY tablename"
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        psql.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        psql.on('close', (code) => {
          if (code !== 0) reject(new Error(`Row count query failed with code ${code}`));
          else resolve(out.trim());
        });
        psql.on('error', reject);
      });

      verificationReport = [];
      for (const line of tableCountsResult.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const tableName = parts[0];
        const actual = parseInt(parts[1] || '0') || 0;
        const isSkipped = skippedTables.includes(tableName);
        const entry: VerificationResult = {
          tableName,
          expected: actual,
          actual,
          status: isSkipped ? 'failed' : 'ok',
        };
        if (isSkipped && tableErrors.has(tableName)) {
          entry.errorMessage = tableErrors.get(tableName);
        }
        verificationReport.push(entry);
      }

      if (skippedTables.length > 0) {
        this.log('RESTORE_PG', `Tables skipped by pg_restore due to schema drift: ${skippedTables.join(', ')}`);
      }

      const okCount = verificationReport.filter(r => r.status === 'ok').length;
      const failedCount = verificationReport.filter(r => r.status === 'failed').length;
      this.log('RESTORE_PG', `Verification complete: ${okCount} tables OK, ${failedCount} tables skipped/failed`);
    } catch (verifyErr: any) {
      this.log('RESTORE_PG', `Warning: Verification step failed: ${verifyErr.message}`);
    }

    const duration = Date.now() - startTime;
    this.log('RESTORE_PG', `pg_restore data restore completed in ${(duration / 1000).toFixed(1)}s`, {
      tables: tables.length,
      skippedTables,
      pgRestoreExitCode,
    });

    return { duration, verificationReport };
  }

  private async extractExpectedRowCounts(compressedData: Buffer): Promise<Map<string, number>> {
    return new Promise((resolve, reject) => {
      const counts = new Map<string, number>();
      const preservedTables = new Set(['sessions']);
      let inCopyBlock = false;
      let currentTable = '';
      let currentCount = 0;

      const gunzipStream = createGunzip();
      const sourceStream = Readable.from(compressedData);
      const rl = readline.createInterface({ input: sourceStream.pipe(gunzipStream), crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        if (inCopyBlock) {
          if (line === '\\.') {
            inCopyBlock = false;
            if (currentTable && !preservedTables.has(currentTable) && currentCount > 0) {
              counts.set(currentTable, currentCount);
            }
            currentCount = 0;
          } else {
            currentCount++;
          }
          return;
        }
        if (line.startsWith('COPY ') && line.includes(' FROM stdin')) {
          const tableMatch = line.match(/COPY\s+(?:public\.)?(?:"([^"]+)"|(\S+))\s/);
          currentTable = tableMatch ? (tableMatch[1] || tableMatch[2] || '') : '';
          if (currentTable) {
            inCopyBlock = true;
            currentCount = 0;
          }
        }
      });

      rl.on('close', () => resolve(counts));
      rl.on('error', reject);
      gunzipStream.on('error', reject);
    });
  }

  private async verifyRestoredCounts(
    databaseUrl: string,
    expectedCounts: Map<string, number>
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    for (const [tableName, expected] of Array.from(expectedCounts.entries())) {
      try {
        const actual = await new Promise<number>((resolve, reject) => {
          const psql = spawn('psql', [databaseUrl, '-t', '-A', '-c',
            `SELECT COUNT(*) FROM "${tableName}"`
          ], { stdio: ['pipe', 'pipe', 'pipe'] });
          let output = '';
          psql.stdout.on('data', (d: Buffer) => { output += d.toString(); });
          psql.on('close', (code) => {
            if (code !== 0) reject(new Error(`Count query failed for ${tableName}`));
            else resolve(parseInt(output.trim()) || 0);
          });
          psql.on('error', reject);
        });
        results.push({ tableName, expected, actual, status: actual === expected ? 'ok' : 'mismatch' });
      } catch {
        results.push({ tableName, expected, actual: 0, status: 'failed' });
      }
    }
    return results;
  }

  private async recoverMismatchedTable(
    databaseUrl: string,
    tableName: string,
    compressedData: Buffer,
    schemaMap: Map<string, Set<string>>
  ): Promise<void> {
    // Neon-safe: snapshot + drop FKs on this table, restore data, then recreate FKs.
    const tableFks = await this.snapshotForeignKeys(databaseUrl, tableName);
    this.logFkRecoverySnapshot('RESTORE_DATA', tableFks);
    await this.dropForeignKeys(databaseUrl, tableFks);
    await this.runPsqlCommand(databaseUrl, `SET lock_timeout = '30s';\nTRUNCATE TABLE "${tableName}" CASCADE;`, 'RECOVERY_TRUNCATE');

    const currentColumns = schemaMap.get(tableName);

    await new Promise<void>((resolve, reject) => {
      let inCopyBlock = false;
      let isTargetTable = false;
      let validColIndices: number[] = [];
      let needsColFiltering = false;
      let settled = false;

      const gunzipStream = createGunzip();
      const sourceStream = Readable.from(compressedData);
      const psql = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      psql.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('FATAL') || text.includes('ERROR')) {
          this.log('RESTORE_DATA', `Recovery psql error for "${tableName}": ${text.trim()}`);
        }
      });
      psql.on('error', (error) => { gunzipStream.destroy(); finish(new Error(`psql error: ${error.message}`)); });
      psql.on('close', (code) => {
        if (!settled) {
          if (code !== 0) finish(new Error(`Recovery psql exited with code ${code} for "${tableName}"`));
          else finish();
        }
      });

      const rl = readline.createInterface({ input: sourceStream.pipe(gunzipStream), crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        if (inCopyBlock) {
          if (line === '\\.') {
            inCopyBlock = false;
            if (isTargetTable) psql.stdin.write(line + '\n');
            isTargetTable = false;
            needsColFiltering = false;
            validColIndices = [];
          } else if (isTargetTable) {
            if (needsColFiltering && validColIndices.length > 0) {
              const fields = line.split('\t');
              const filtered = validColIndices.map(i => fields[i] ?? '\\N').join('\t');
              psql.stdin.write(filtered + '\n');
            } else {
              psql.stdin.write(line + '\n');
            }
          }
          return;
        }
        if (line.startsWith('COPY ') && line.includes(' FROM stdin')) {
          const parsed = this.parseCopyHeader(line);
          if (!parsed) return;
          inCopyBlock = true;
          isTargetTable = parsed.tableName === tableName;
          if (isTargetTable) {
            if (currentColumns) {
              const backupCols = parsed.columns;
              const validCols = backupCols.filter(c => currentColumns.has(c));
              const missingCols = backupCols.filter(c => !currentColumns.has(c));
              if (missingCols.length > 0) {
                this.log('RESTORE_DATA', `Recovery: table "${tableName}" removing ${missingCols.length} obsolete columns: ${missingCols.join(', ')}`);
                validColIndices = backupCols.map((c, i) => currentColumns.has(c) ? i : -1).filter(i => i !== -1);
                needsColFiltering = true;
                const newHeader = `COPY "${tableName}" (${validCols.map(c => `"${c}"`).join(', ')}) FROM stdin;`;
                psql.stdin.write(newHeader + '\n');
              } else {
                needsColFiltering = false;
                validColIndices = [];
                psql.stdin.write(line + '\n');
              }
            } else {
              psql.stdin.write(line + '\n');
            }
          }
        }
      });
      rl.on('close', () => { psql.stdin.end(); });
      rl.on('error', (err) => { psql.kill('SIGTERM'); finish(new Error(`Stream read error: ${err.message}`)); });
      gunzipStream.on('error', (err) => { psql.kill('SIGTERM'); finish(new Error(`Decompression error: ${err.message}`)); });
    });

    const { failures: recoverFkFailures } = await this.recreateForeignKeys(databaseUrl, tableFks);
    if (recoverFkFailures.length > 0) {
      this.log('RESTORE_DATA', `Recovery: ${recoverFkFailures.length} FK(s) failed to recreate on "${tableName}":`);
      for (const f of recoverFkFailures) {
        this.log('RESTORE_DATA', `  ${f.conname}: ${f.error}`);
      }
    }
  }

  private async streamFilteredDataToPsql(
    databaseUrl: string,
    compressedData: Buffer,
    schemaMap: Map<string, Set<string>>
  ): Promise<{ dataLines: number; errorCount: number; sampleErrors: string[]; skippedTables: string[] }> {
    return new Promise((resolve, reject) => {
      let dataLines = 0;
      let errorCount = 0;
      const sampleErrors: string[] = [];
      const skippedTables: string[] = [];
      let inCopyBlock = false;
      let skipCopyBlock = false;
      let settled = false;
      let currentTable = '';
      let tableCount = 0;
      let lastProgressUpdate = 0;
      let needsColFiltering = false;
      let validColIndices: number[] = [];
      const preservedTables = new Set(['sessions']);

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (err) reject(err);
      };

      const gunzipStream = createGunzip();
      const sourceStream = Readable.from(compressedData);

      const psql = spawn('psql', [databaseUrl], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      psql.stdin.setMaxListeners(0);

      const timeoutId = setTimeout(() => {
        psql.kill('SIGTERM');
        gunzipStream.destroy();
        finish(new Error('Streaming data restore timed out'));
      }, PG_DUMP_TIMEOUT_MS);

      psql.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('FATAL')) {
          sampleErrors.push(text.trim());
          psql.kill('SIGTERM');
          gunzipStream.destroy();
          finish(new Error(`Data restore fatal error: ${text.trim()}`));
          return;
        }
        if (text.includes('ERROR')) {
          errorCount++;
          if (errorCount <= 10) {
            sampleErrors.push(text.trim());
          }
        }
      });

      psql.on('error', (error) => {
        gunzipStream.destroy();
        finish(new Error(`psql process error: ${error.message}`));
      });

      psql.on('close', (code) => {
        if (settled) return;
        clearTimeout(timeoutId);
        if (code !== 0 && errorCount === 0) {
          settled = true;
          reject(new Error(`psql exited with code ${code} during data restore`));
          return;
        }
        settled = true;
        resolve({ dataLines, errorCount, sampleErrors, skippedTables });
      });

      const writeLine = (line: string) => {
        dataLines++;
        const canContinue = psql.stdin.write(line + '\n');
        if (!canContinue) {
          rl.pause();
          psql.stdin.once('drain', () => {
            rl.resume();
          });
        }
      };

      const rl = readline.createInterface({
        input: sourceStream.pipe(gunzipStream),
        crlfDelay: Infinity,
      });

      rl.on('line', (line: string) => {
        if (inCopyBlock) {
          if (line === '\\.') {
            inCopyBlock = false;
            if (skipCopyBlock) {
              skipCopyBlock = false;
              needsColFiltering = false;
              validColIndices = [];
              return;
            }
            writeLine(line);
          } else if (!skipCopyBlock) {
            if (needsColFiltering && validColIndices.length > 0) {
              const fields = line.split('\t');
              const filtered = validColIndices.map(i => fields[i] ?? '\\N').join('\t');
              writeLine(filtered);
            } else {
              writeLine(line);
            }
          }
          return;
        }

        if (line.startsWith('COPY ') && line.includes(' FROM stdin')) {
          inCopyBlock = true;
          tableCount++;
          needsColFiltering = false;
          validColIndices = [];

          const parsed = this.parseCopyHeader(line);
          if (!parsed) {
            skipCopyBlock = true;
            this.log('RESTORE_DATA', `Skipping unparseable COPY header: ${line.substring(0, 80)}`);
            return;
          }
          currentTable = parsed.tableName;

          if (preservedTables.has(currentTable)) {
            skipCopyBlock = true;
            this.log('RESTORE_DATA', `Skipping COPY for preserved table: ${currentTable}`);
            return;
          }

          const currentColumns = schemaMap.get(currentTable);
          if (!currentColumns) {
            skipCopyBlock = true;
            skippedTables.push(currentTable);
            this.log('RESTORE_DATA', `Skipping COPY for table not in current schema: ${currentTable}`);
            return;
          }

          const backupCols = parsed.columns;
          const validCols = backupCols.filter(c => currentColumns.has(c));
          const missingCols = backupCols.filter(c => !currentColumns.has(c));

          if (missingCols.length > 0) {
            this.log('RESTORE_DATA', `Table "${currentTable}": removing ${missingCols.length} obsolete column(s) from COPY header: ${missingCols.join(', ')}`);
            validColIndices = backupCols.map((c, i) => currentColumns.has(c) ? i : -1).filter(i => i !== -1);
            needsColFiltering = true;
            const newHeader = `COPY "${currentTable}" (${validCols.map(c => `"${c}"`).join(', ')}) FROM stdin;`;
            const now = Date.now();
            if (now - lastProgressUpdate > 500) {
              lastProgressUpdate = now;
              const progressPct = Math.min(35 + Math.round((tableCount / Math.max(tableCount + 5, 30)) * 50), 85);
              this.setRestoreProgress('Restoring Data', 5, 8, progressPct, `Copying ${currentTable} (${tableCount} tables, ${dataLines.toLocaleString()} rows)...`);
            }
            writeLine(newHeader);
          } else {
            const now = Date.now();
            if (now - lastProgressUpdate > 500) {
              lastProgressUpdate = now;
              const progressPct = Math.min(35 + Math.round((tableCount / Math.max(tableCount + 5, 30)) * 50), 85);
              this.setRestoreProgress('Restoring Data', 5, 8, progressPct, `Copying ${currentTable} (${tableCount} tables, ${dataLines.toLocaleString()} rows)...`);
            }
            writeLine(line);
          }
          return;
        }

        if (line.startsWith('INSERT INTO ')) {
          writeLine(line);
          return;
        }

        if (line.startsWith('SELECT pg_catalog.setval(')) {
          writeLine(line);
          return;
        }
      });

      rl.on('close', () => {
        psql.stdin.end();
      });

      rl.on('error', (err) => {
        psql.kill('SIGTERM');
        finish(new Error(`Stream read error: ${err.message}`));
      });

      gunzipStream.on('error', (err) => {
        psql.kill('SIGTERM');
        finish(new Error(`Decompression error: ${err.message}`));
      });
    });
  }
}

export const databaseBackupService = new DatabaseBackupService();
