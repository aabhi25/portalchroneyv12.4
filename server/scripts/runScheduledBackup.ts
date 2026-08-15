import { databaseBackupService } from "../services/databaseBackupService";

async function runScheduledBackup() {
  console.log("[Scheduled Backup] Starting automated backup at", new Date().toISOString());
  
  try {
    const result = await databaseBackupService.createBackup();
    
    if (result.success) {
      console.log(`[Scheduled Backup] ${result.type} backup completed successfully`);
      console.log(`[Scheduled Backup] File: ${result.filename}`);
      console.log(`[Scheduled Backup] Size: ${((result.size || 0) / 1024 / 1024).toFixed(2)} MB`);
      process.exit(0);
    } else {
      console.error("[Scheduled Backup] Backup failed:", result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error("[Scheduled Backup] Error:", error);
    process.exit(1);
  }
}

runScheduledBackup();
