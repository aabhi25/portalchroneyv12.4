import { db } from "../db";
import { systemSettings } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt, encryptJSON, decryptJSON } from "./encryptionService";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl?: string;
}

const R2_CONFIG_KEY = "r2_storage_config";

class SystemSettingsService {
  private cache: Map<string, { value: any; expiresAt: number }> = new Map();
  private CACHE_TTL = 5 * 60 * 1000;

  async getSetting(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);

      if (!setting) return null;

      let value: string;
      if (setting.isEncrypted === "true") {
        try {
          value = decrypt(setting.value);
        } catch (error) {
          console.error(`[SystemSettings] Failed to decrypt setting: ${key}`, error);
          return null;
        }
      } else {
        value = setting.value;
      }

      this.cache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL });
      return value;
    } catch (error) {
      console.error(`[SystemSettings] Error getting setting: ${key}`, error);
      return null;
    }
  }

  async setSetting(key: string, value: string, isEncrypted: boolean = true, description?: string): Promise<boolean> {
    try {
      const storedValue = isEncrypted ? encrypt(value) : value;

      const existing = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(systemSettings)
          .set({
            value: storedValue,
            isEncrypted: isEncrypted ? "true" : "false",
            description,
            updatedAt: new Date(),
          })
          .where(eq(systemSettings.key, key));
      } else {
        await db.insert(systemSettings).values({
          key,
          value: storedValue,
          isEncrypted: isEncrypted ? "true" : "false",
          description,
        });
      }

      this.cache.delete(key);
      console.log(`[SystemSettings] Setting saved: ${key}`);
      return true;
    } catch (error) {
      console.error(`[SystemSettings] Error saving setting: ${key}`, error);
      return false;
    }
  }

  async deleteSetting(key: string): Promise<boolean> {
    try {
      await db.delete(systemSettings).where(eq(systemSettings.key, key));
      this.cache.delete(key);
      console.log(`[SystemSettings] Setting deleted: ${key}`);
      return true;
    } catch (error) {
      console.error(`[SystemSettings] Error deleting setting: ${key}`, error);
      return false;
    }
  }

  async getR2Config(): Promise<R2Config | null> {
    const cached = this.cache.get(R2_CONFIG_KEY);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, R2_CONFIG_KEY))
        .limit(1);

      if (!setting) return null;

      const config = decryptJSON<R2Config>(setting.value);
      this.cache.set(R2_CONFIG_KEY, { value: config, expiresAt: Date.now() + this.CACHE_TTL });
      return config;
    } catch (error) {
      console.error("[SystemSettings] Error getting R2 config:", error);
      return null;
    }
  }

  async setR2Config(config: R2Config): Promise<boolean> {
    try {
      const sanitizedConfig: R2Config = {
        accountId: config.accountId.trim().replace(/[\n\r\s]/g, ''),
        accessKeyId: config.accessKeyId.trim().replace(/[\n\r\s]/g, ''),
        secretAccessKey: config.secretAccessKey.trim().replace(/[\n\r\s]/g, ''),
        bucketName: config.bucketName.trim().replace(/[\n\r\s]/g, ''),
        publicUrl: config.publicUrl?.trim().replace(/[\n\r\s]/g, '') || undefined,
      };
      
      const encryptedValue = encryptJSON(sanitizedConfig);

      const existing = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, R2_CONFIG_KEY))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(systemSettings)
          .set({
            value: encryptedValue,
            updatedAt: new Date(),
          })
          .where(eq(systemSettings.key, R2_CONFIG_KEY));
      } else {
        await db.insert(systemSettings).values({
          key: R2_CONFIG_KEY,
          value: encryptedValue,
          isEncrypted: "true",
          description: "Cloudflare R2 storage configuration",
        });
      }

      this.cache.delete(R2_CONFIG_KEY);
      console.log("[SystemSettings] R2 config saved successfully");
      return true;
    } catch (error) {
      console.error("[SystemSettings] Error saving R2 config:", error);
      return false;
    }
  }

  async deleteR2Config(): Promise<boolean> {
    return this.deleteSetting(R2_CONFIG_KEY);
  }

  async hasR2Config(): Promise<boolean> {
    try {
      const [setting] = await db
        .select({ id: systemSettings.id })
        .from(systemSettings)
        .where(eq(systemSettings.key, R2_CONFIG_KEY))
        .limit(1);
      return !!setting;
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const systemSettingsService = new SystemSettingsService();
