export type BackupJobStatus = 'pending' | 'dumping' | 'compressing' | 'uploading' | 'completed' | 'failed';

export interface BackupJob {
  id: string;
  status: BackupJobStatus;
  progress: number;
  message: string;
  startedAt: Date;
  completedAt?: Date;
  result?: {
    success: boolean;
    filename?: string;
    size?: number;
    type?: 'daily' | 'weekly' | 'monthly';
    error?: string;
    duration?: number;
  };
}

class BackupJobManager {
  private jobs: Map<string, BackupJob> = new Map();
  private readonly JOB_RETENTION_MS = 60 * 60 * 1000;

  generateJobId(): string {
    return `backup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  createJob(jobId: string): BackupJob {
    const job: BackupJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      message: 'Backup job queued',
      startedAt: new Date(),
    };
    this.jobs.set(jobId, job);
    this.cleanupOldJobs();
    return job;
  }

  updateJob(jobId: string, update: Partial<BackupJob>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, update);
    }
  }

  getJob(jobId: string): BackupJob | undefined {
    return this.jobs.get(jobId);
  }

  setStatus(jobId: string, status: BackupJobStatus, message: string, progress: number): void {
    this.updateJob(jobId, { status, message, progress });
  }

  completeJob(jobId: string, result: BackupJob['result']): void {
    this.updateJob(jobId, {
      status: result?.success ? 'completed' : 'failed',
      progress: result?.success ? 100 : 0,
      message: result?.success ? 'Backup completed successfully' : (result?.error || 'Backup failed'),
      completedAt: new Date(),
      result,
    });
  }

  private cleanupOldJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && (now - job.completedAt.getTime()) > this.JOB_RETENTION_MS) {
        this.jobs.delete(jobId);
      }
    }
  }

  getActiveJob(): BackupJob | undefined {
    for (const job of this.jobs.values()) {
      if (['pending', 'dumping', 'compressing', 'uploading'].includes(job.status)) {
        return job;
      }
    }
    return undefined;
  }

  hasActiveJob(): boolean {
    return this.getActiveJob() !== undefined;
  }
}

export const backupJobManager = new BackupJobManager();
