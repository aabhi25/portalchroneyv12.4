import { storage } from "../storage";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { InsertJob } from "@shared/schema";
import dns from "dns/promises";
import net from "net";

export interface JobImportFieldMapping {
  title: string;
  description?: string;
  requirements?: string;
  location?: string;
  salaryMin?: string;
  salaryMax?: string;
  currency?: string;
  jobType?: string;
  experienceLevel?: string;
  department?: string;
  skills?: string;
  externalId: string;
}

export interface JobImportSyncStats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface JobImportConfig {
  apiUrl: string;
  authHeader?: string;
  fieldMapping: JobImportFieldMapping;
  lastSyncedAt?: string;
  lastSyncStatus?: 'idle' | 'syncing' | 'completed' | 'failed';
  lastSyncError?: string;
  lastSyncStats?: JobImportSyncStats;
}

interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("::ffff:")) {
      if (lower.startsWith("::ffff:")) {
        const mapped = lower.slice(7);
        if (net.isIPv4(mapped)) return isPrivateIP(mapped);
      }
      return true;
    }
  }
  return false;
}

async function validateExternalUrl(apiUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTPS and HTTP URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = [
    "localhost", "metadata.google.internal",
  ];
  if (blockedHosts.includes(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    throw new Error("Internal/private addresses are not allowed");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error("Private network addresses are not allowed");
    }
  } else {
    let allAddresses: string[] = [];
    try {
      const ipv4 = await dns.resolve4(hostname);
      allAddresses = allAddresses.concat(ipv4);
    } catch {
    }
    try {
      const ipv6 = await dns.resolve6(hostname);
      allAddresses = allAddresses.concat(ipv6);
    } catch {
    }
    if (allAddresses.length === 0) {
      throw new Error("DNS resolution failed for the provided URL");
    }
    for (const addr of allAddresses) {
      if (isPrivateIP(addr)) {
        throw new Error("URL resolves to a private network address");
      }
    }
  }
}

function extractItemsArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data != null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const items = obj.data || obj.results || obj.items || obj.jobs || obj.records;
    if (Array.isArray(items)) return items;
  }
  throw new Error("Response is not an array and no recognized array field (data, results, items, jobs, records) found");
}

export class JobImportService {
  async testConnection(apiUrl: string, authHeader?: string): Promise<{ success: boolean; sampleCount?: number; error?: string }> {
    try {
      await validateExternalUrl(apiUrl);

      const headers: Record<string, string> = {
        "Accept": "application/json",
      };
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(apiUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      const items = extractItemsArray(data);

      return { success: true, sampleCount: items.length };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === "AbortError") {
        return { success: false, error: "Connection timed out after 10 seconds" };
      }
      return { success: false, error: err.message };
    }
  }

  async fetchExternalJobs(apiUrl: string, authHeader?: string): Promise<unknown[]> {
    await validateExternalUrl(apiUrl);

    const headers: Record<string, string> = {
      "Accept": "application/json",
    };
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return extractItemsArray(data);
  }

  mapJobFields(rawItem: any, fieldMapping: JobImportConfig["fieldMapping"]): Partial<InsertJob> & { externalRefId: string } {
    const externalId = String(getNestedValue(rawItem, fieldMapping.externalId) || "");
    if (!externalId) {
      throw new Error("External ID field is empty");
    }

    const title = String(getNestedValue(rawItem, fieldMapping.title) || "");
    if (!title) {
      throw new Error("Title field is empty");
    }

    const mapped: Partial<InsertJob> & { externalRefId: string } = {
      title,
      externalRefId: externalId,
      source: "import",
    };

    if (fieldMapping.description) {
      const val = getNestedValue(rawItem, fieldMapping.description);
      if (val != null) mapped.description = String(val);
    }
    if (fieldMapping.requirements) {
      const val = getNestedValue(rawItem, fieldMapping.requirements);
      if (val != null) mapped.requirements = String(val);
    }
    if (fieldMapping.location) {
      const val = getNestedValue(rawItem, fieldMapping.location);
      if (val != null) mapped.location = String(val);
    }
    if (fieldMapping.salaryMin) {
      const val = getNestedValue(rawItem, fieldMapping.salaryMin);
      if (val != null) mapped.salaryMin = String(val);
    }
    if (fieldMapping.salaryMax) {
      const val = getNestedValue(rawItem, fieldMapping.salaryMax);
      if (val != null) mapped.salaryMax = String(val);
    }
    if (fieldMapping.currency) {
      const val = getNestedValue(rawItem, fieldMapping.currency);
      if (val != null) mapped.currency = String(val);
    }
    if (fieldMapping.jobType) {
      const val = getNestedValue(rawItem, fieldMapping.jobType);
      if (val != null) mapped.jobType = String(val);
    }
    if (fieldMapping.experienceLevel) {
      const val = getNestedValue(rawItem, fieldMapping.experienceLevel);
      if (val != null) mapped.experienceLevel = String(val);
    }
    if (fieldMapping.department) {
      const val = getNestedValue(rawItem, fieldMapping.department);
      if (val != null) mapped.department = String(val);
    }
    if (fieldMapping.skills) {
      const val = getNestedValue(rawItem, fieldMapping.skills);
      if (val != null) {
        if (Array.isArray(val)) {
          mapped.skills = val.map(String);
        } else if (typeof val === "string") {
          mapped.skills = val.split(",").map(s => s.trim()).filter(Boolean);
        }
      }
    }

    return mapped;
  }

  private async updateImportConfig(businessAccountId: string, config: JobImportConfig): Promise<void> {
    await db.update(businessAccounts)
      .set({ jobImportConfig: config })
      .where(eq(businessAccounts.id, businessAccountId));
  }

  private getConfig(account: { jobImportConfig: unknown }): JobImportConfig | null {
    const raw = account.jobImportConfig;
    if (!raw || typeof raw !== "object") return null;
    const config = raw as JobImportConfig;
    if (!config.apiUrl || !config.fieldMapping) return null;
    return config;
  }

  async syncJobs(businessAccountId: string): Promise<SyncStats> {
    const account = await storage.getBusinessAccount(businessAccountId);
    if (!account) throw new Error("Business account not found");

    const config = this.getConfig(account);
    if (!config) {
      throw new Error("Import configuration not set up");
    }

    await this.updateImportConfig(businessAccountId, {
      ...config,
      lastSyncStatus: "syncing",
      lastSyncError: undefined,
    });

    const stats: SyncStats = { created: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [] };

    try {
      const rawItems = await this.fetchExternalJobs(config.apiUrl, config.authHeader);
      console.log(`[JobImport] Fetched ${rawItems.length} items from external API for account ${businessAccountId}`);

      for (const rawItem of rawItems) {
        try {
          const mappedJob = this.mapJobFields(rawItem, config.fieldMapping);
          const existing = await storage.getJobByExternalRefId(mappedJob.externalRefId, businessAccountId);

          if (existing) {
            const fieldsToCheck = [
              "title", "description", "requirements", "location",
              "salaryMin", "salaryMax", "currency", "jobType",
              "experienceLevel", "department",
            ] as const;
            const existingRecord = existing as Record<string, unknown>;
            const mappedRecord = mappedJob as Record<string, unknown>;
            const hasChanges = fieldsToCheck.some(field => {
              if (mappedRecord[field] === undefined) return false;
              return String(mappedRecord[field] ?? "") !== String(existingRecord[field] ?? "");
            }) || (mappedJob.skills && JSON.stringify(mappedJob.skills) !== JSON.stringify(existing.skills));

            if (hasChanges) {
              await storage.updateJob(existing.id, businessAccountId, {
                ...mappedJob,
                source: "import",
              });
              stats.updated++;
            } else {
              stats.skipped++;
            }
          } else {
            const newJob: InsertJob = {
              title: mappedJob.title,
              businessAccountId,
              source: "import",
              status: "active",
              jobType: mappedJob.jobType || "full-time",
              externalRefId: mappedJob.externalRefId,
              description: mappedJob.description,
              requirements: mappedJob.requirements,
              location: mappedJob.location,
              salaryMin: mappedJob.salaryMin,
              salaryMax: mappedJob.salaryMax,
              currency: mappedJob.currency,
              experienceLevel: mappedJob.experienceLevel,
              department: mappedJob.department,
              skills: mappedJob.skills,
            };
            await storage.createJob(newJob);
            stats.created++;
          }
        } catch (itemError: unknown) {
          stats.errors++;
          stats.errorDetails.push(itemError instanceof Error ? itemError.message : String(itemError));
        }
      }

      await this.updateImportConfig(businessAccountId, {
        ...config,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: "completed",
        lastSyncError: undefined,
        lastSyncStats: { created: stats.created, updated: stats.updated, skipped: stats.skipped, errors: stats.errors },
      });

      console.log(`[JobImport] Sync completed for ${businessAccountId}: created=${stats.created}, updated=${stats.updated}, skipped=${stats.skipped}, errors=${stats.errors}`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.updateImportConfig(businessAccountId, {
        ...config,
        lastSyncStatus: "failed",
        lastSyncError: errMsg,
      });
      throw error;
    }

    return stats;
  }
}

export const jobImportService = new JobImportService();
