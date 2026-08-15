import { databaseBackupService } from "./databaseBackupService";
import { backupJobManager } from "./backupJobManager";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TARGET_HOUR_IST = 4;
const TARGET_MINUTE_IST = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

class BackupScheduler {
  private timeoutId: NodeJS.Timeout | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  private getNextRunMs(): number {
    const now = Date.now();
    const nowIST = new Date(now + IST_OFFSET_MS);
    const todayTargetIST = new Date(Date.UTC(
      nowIST.getUTCFullYear(),
      nowIST.getUTCMonth(),
      nowIST.getUTCDate(),
      TARGET_HOUR_IST,
      TARGET_MINUTE_IST,
      0,
      0
    ));
    let targetUTC = todayTargetIST.getTime() - IST_OFFSET_MS;
    if (targetUTC < now) {
      targetUTC += DAY_MS;
    }
    return targetUTC - now;
  }

  private formatIST(date: Date): string {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }

  private async runBackup(): Promise<void> {
    if (backupJobManager.hasActiveJob()) {
      console.log("[BackupScheduler] Skipping — a backup is already running");
      return;
    }

    const jobId = backupJobManager.generateJobId();
    backupJobManager.createJob(jobId);

    console.log(`[BackupScheduler] Triggering daily backup at ${this.formatIST(new Date())} IST (jobId: ${jobId})`);
    try {
      const result = await databaseBackupService.createBackup(jobId, "scheduler");
      if (result.success) {
        console.log(`[BackupScheduler] Backup completed — ${result.type} | ${result.filename} | ${((result.size || 0) / 1024 / 1024).toFixed(2)} MB`);
      } else {
        console.error(`[BackupScheduler] Backup failed: ${result.error}`);
      }
    } catch (error) {
      console.error("[BackupScheduler] Unexpected error during backup:", error);
      backupJobManager.completeJob(jobId, { success: false, error: String(error) });
    }
  }

  start(): void {
    if (this.timeoutId || this.intervalId) {
      console.log("[BackupScheduler] Already running, ignoring duplicate start");
      return;
    }
    const delayMs = this.getNextRunMs();
    const nextRun = new Date(Date.now() + delayMs);
    console.log(`[BackupScheduler] Started — next backup at ${this.formatIST(nextRun)} IST (in ${Math.round(delayMs / 60000)} min)`);

    this.timeoutId = setTimeout(() => {
      this.runBackup();
      this.intervalId = setInterval(() => {
        this.runBackup();
      }, DAY_MS);
    }, delayMs);
  }

  stop(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.intervalId) clearInterval(this.intervalId);
    this.timeoutId = null;
    this.intervalId = null;
    console.log("[BackupScheduler] Stopped");
  }
}

export const backupScheduler = new BackupScheduler();
