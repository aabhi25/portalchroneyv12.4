import { db } from "../db";
import { documentTypes, documentTypePromptHistory } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

const ALLOWED_SCAN_MODELS = new Set(["gpt-4o-mini", "gpt-4o"]);
function normalizeScanModel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALLOWED_SCAN_MODELS.has(value) ? value : null;
}

export interface ExtractionField {
  key: string;
  label: string;
  required: boolean;
  formatRegex?: string;
  formatDescription?: string;
}

export interface ValidationRules {
  duplicateCheck?: boolean;
  duplicateField?: string;
}

export interface LeadFieldMapping {
  extractionFieldKey: string;
  leadFieldKey: string;
}

export interface DocumentTypeConfig {
  id: string;
  businessAccountId: string;
  key: string;
  name: string;
  isSystemDefault: boolean;
  isActive: boolean;
  promptTemplate: string | null;
  extractionFields: ExtractionField[];
  validationRules: ValidationRules | null;
  leadFieldMappings: LeadFieldMapping[];
  confirmationRequired: string | null;
  scanModel: string | null;
  version: number;
}

const SYSTEM_DEFAULTS: Omit<DocumentTypeConfig, "id" | "businessAccountId" | "version">[] = [
  {
    key: "aadhaar",
    name: "Aadhaar Card",
    isSystemDefault: true,
    isActive: true,
    promptTemplate: "You are an expert document analyzer specializing in Indian Aadhaar cards. Carefully analyze the image provided.\n\nAadhaar cards have TWO sides:\n- FRONT side: Shows the holder's photograph, full name, date of birth, gender, and the 12-digit Aadhaar number (printed below the photo).\n- BACK side: Shows the holder's complete residential address (door/flat number, street, locality, city, state, PIN code), a QR code, and the 12-digit Aadhaar number again.\n\nInstructions:\n1. Identify which side this is and set 'side' to 'front' or 'back'.\n2. FRONT side: Extract aadhaar_number, full_name, dob, gender (and father_name if visible). Set address to null.\n3. BACK side: Extract the complete address from the address block — include every line (house/flat number, street, area/locality, city, state, PIN code). NEVER return null for address when the back side is provided. Also extract aadhaar_number if visible.\n4. Single image showing BOTH sides (e.g. digital/e-Aadhaar printout or scanned sheet): extract ALL fields including address.\n5. Set side='back' when you see an address block and QR code but no photograph.\n6. Be precise: verify all 12 Aadhaar digits carefully.",
    extractionFields: [
      { key: "aadhaar_number", label: "Aadhaar Number", required: true, formatRegex: "^\\d{12}$", formatDescription: "12-digit number" },
      { key: "full_name", label: "Full Name", required: true },
      { key: "address", label: "Address", required: true },
      { key: "dob", label: "Date of Birth", required: false, formatDescription: "DD/MM/YYYY or DD-MM-YYYY" },
      { key: "gender", label: "Gender", required: false },
      { key: "father_name", label: "Father's Name", required: false },
    ],
    validationRules: {
      duplicateCheck: true,
      duplicateField: "aadhaar_number",
    },
    leadFieldMappings: [
      { extractionFieldKey: "aadhaar_number", leadFieldKey: "aadhaar" },
      { extractionFieldKey: "address", leadFieldKey: "permanent_address" },
    ],
    confirmationRequired: null,
    scanModel: null,
  },
  {
    key: "pan",
    name: "PAN Card",
    isSystemDefault: true,
    isActive: true,
    promptTemplate: "You are an expert document analyzer. Analyze this PAN card image/document carefully. Extract the information accurately. PAN number format is 5 letters + 4 digits + 1 letter (e.g., ABCDE1234F). Verify the format strictly.",
    extractionFields: [
      { key: "pan_number", label: "PAN Number", required: true, formatRegex: "^[A-Z]{5}\\d{4}[A-Z]$", formatDescription: "Format: ABCDE1234F" },
      { key: "full_name", label: "Full Name", required: true },
      { key: "dob", label: "Date of Birth", required: false },
      { key: "father_name", label: "Father's Name", required: false },
    ],
    validationRules: {
      duplicateCheck: true,
      duplicateField: "pan_number",
    },
    leadFieldMappings: [
      { extractionFieldKey: "full_name", leadFieldKey: "customer_name" },
      { extractionFieldKey: "pan_number", leadFieldKey: "pan" },
      { extractionFieldKey: "dob", leadFieldKey: "date_of_birth" },
    ],
    confirmationRequired: null,
    scanModel: null,
  },
  {
    key: "bank_statement",
    name: "Bank Statement",
    isSystemDefault: true,
    isActive: true,
    promptTemplate: "You are an expert document analyzer. Analyze this bank statement image/document carefully. Extract account details and key financial information accurately.",
    extractionFields: [
      { key: "account_number", label: "Account Number", required: true },
      { key: "account_holder", label: "Account Holder Name", required: true },
      { key: "bank_name", label: "Bank Name", required: false },
      { key: "ifsc_code", label: "IFSC Code", required: false },
      { key: "branch", label: "Branch", required: false },
    ],
    validationRules: null,
    leadFieldMappings: [],
    confirmationRequired: null,
    scanModel: null,
  },
  {
    key: "driving_license",
    name: "Driving License",
    isSystemDefault: true,
    isActive: true,
    promptTemplate: "You are an expert document analyzer. Analyze this driving license image/document carefully. Extract the license details accurately.",
    extractionFields: [
      { key: "license_number", label: "License Number", required: true },
      { key: "full_name", label: "Full Name", required: true },
      { key: "dob", label: "Date of Birth", required: false },
      { key: "address", label: "Address", required: false },
      { key: "validity", label: "Valid Till", required: false },
    ],
    validationRules: {
      duplicateCheck: true,
      duplicateField: "license_number",
    },
    leadFieldMappings: [],
    confirmationRequired: null,
    scanModel: null,
  },
];

class DocumentTypeService {
  private cache = new Map<string, { data: DocumentTypeConfig[]; expiry: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  async seedDefaultsForAccount(businessAccountId: string): Promise<void> {
    for (const def of SYSTEM_DEFAULTS) {
      const existing = await db
        .select({ id: documentTypes.id })
        .from(documentTypes)
        .where(and(eq(documentTypes.businessAccountId, businessAccountId), eq(documentTypes.key, def.key)))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(documentTypes).values({
          businessAccountId,
          key: def.key,
          name: def.name,
          isSystemDefault: def.isSystemDefault,
          isActive: def.isActive,
          promptTemplate: def.promptTemplate,
          extractionFields: def.extractionFields,
          validationRules: def.validationRules,
          leadFieldMappings: def.leadFieldMappings,
          version: 1,
        });
      } else if (def.leadFieldMappings.length > 0) {
        const row = await db
          .select({ leadFieldMappings: documentTypes.leadFieldMappings })
          .from(documentTypes)
          .where(eq(documentTypes.id, existing[0].id))
          .limit(1);
        const current = (row[0]?.leadFieldMappings as LeadFieldMapping[]) || [];
        if (current.length === 0) {
          await db
            .update(documentTypes)
            .set({ leadFieldMappings: def.leadFieldMappings })
            .where(eq(documentTypes.id, existing[0].id));
        }
      }
    }
  }

  async getDocumentTypes(businessAccountId: string): Promise<DocumentTypeConfig[]> {
    const cached = this.cache.get(businessAccountId);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    await this.seedDefaultsForAccount(businessAccountId);

    const rows = await db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.businessAccountId, businessAccountId));

    const configs: DocumentTypeConfig[] = rows.map((r) => {
      let fields = (r.extractionFields as ExtractionField[]) || [];
      const rawRules = r.validationRules as any;
      let rules: ValidationRules | null = null;

      if (rawRules) {
        if (rawRules.formatRegex || rawRules.formatDescription) {
          const dupField = rawRules.duplicateField || rawRules.duplicateCheck ? fields.find(f => f.required)?.key : undefined;
          if (dupField || rawRules.duplicateField) {
            const targetKey = rawRules.duplicateField || dupField;
            fields = fields.map(f =>
              f.key === targetKey
                ? { ...f, formatRegex: f.formatRegex || rawRules.formatRegex, formatDescription: f.formatDescription || rawRules.formatDescription }
                : f
            );
          } else if (fields.length > 0) {
            fields = fields.map((f, i) =>
              i === 0
                ? { ...f, formatRegex: f.formatRegex || rawRules.formatRegex, formatDescription: f.formatDescription || rawRules.formatDescription }
                : f
            );
          }
        }
        if (rawRules.duplicateCheck) {
          rules = { duplicateCheck: rawRules.duplicateCheck, duplicateField: rawRules.duplicateField };
        }
      }

      return {
        id: r.id,
        businessAccountId: r.businessAccountId,
        key: r.key,
        name: r.name,
        isSystemDefault: r.isSystemDefault,
        isActive: r.isActive,
        promptTemplate: r.promptTemplate,
        extractionFields: fields,
        validationRules: rules,
        leadFieldMappings: (r.leadFieldMappings as LeadFieldMapping[]) || [],
        confirmationRequired: r.confirmationRequired ?? null,
        scanModel: r.scanModel ?? null,
        version: r.version,
      };
    });

    this.cache.set(businessAccountId, { data: configs, expiry: Date.now() + this.CACHE_TTL_MS });
    return configs;
  }

  async getActiveDocumentTypes(businessAccountId: string): Promise<DocumentTypeConfig[]> {
    const all = await this.getDocumentTypes(businessAccountId);
    return all.filter((d) => d.isActive);
  }

  async getDocumentTypeByKey(businessAccountId: string, key: string): Promise<DocumentTypeConfig | undefined> {
    const all = await this.getDocumentTypes(businessAccountId);
    return all.find((d) => d.key === key);
  }

  async createDocumentType(
    businessAccountId: string,
    data: { key: string; name: string; promptTemplate?: string; extractionFields: ExtractionField[]; validationRules?: ValidationRules; leadFieldMappings?: LeadFieldMapping[]; confirmationRequired?: string | null; scanModel?: string | null }
  ): Promise<DocumentTypeConfig> {
    const [row] = await db
      .insert(documentTypes)
      .values({
        businessAccountId,
        key: data.key,
        name: data.name,
        isSystemDefault: false,
        isActive: true,
        promptTemplate: data.promptTemplate || null,
        extractionFields: data.extractionFields,
        validationRules: data.validationRules || null,
        leadFieldMappings: data.leadFieldMappings || [],
        confirmationRequired: data.confirmationRequired ?? null,
        scanModel: normalizeScanModel(data.scanModel),
        version: 1,
      })
      .returning();

    this.invalidateCache(businessAccountId);
    return {
      id: row.id,
      businessAccountId: row.businessAccountId,
      key: row.key,
      name: row.name,
      isSystemDefault: row.isSystemDefault,
      isActive: row.isActive,
      promptTemplate: row.promptTemplate,
      extractionFields: (row.extractionFields as ExtractionField[]) || [],
      validationRules: (row.validationRules as ValidationRules) || null,
      leadFieldMappings: (row.leadFieldMappings as LeadFieldMapping[]) || [],
      confirmationRequired: row.confirmationRequired ?? null,
      scanModel: row.scanModel ?? null,
      version: row.version,
    };
  }

  async updateDocumentType(
    id: string,
    businessAccountId: string,
    data: { name?: string; promptTemplate?: string; extractionFields?: ExtractionField[]; validationRules?: ValidationRules; leadFieldMappings?: LeadFieldMapping[]; isActive?: boolean; confirmationRequired?: string | null; scanModel?: string | null },
    changedBy?: string
  ): Promise<DocumentTypeConfig | null> {
    const existing = await db
      .select()
      .from(documentTypes)
      .where(and(eq(documentTypes.id, id), eq(documentTypes.businessAccountId, businessAccountId)))
      .limit(1);

    if (existing.length === 0) return null;
    const old = existing[0];

    const promptChanged =
      data.promptTemplate !== undefined && data.promptTemplate !== old.promptTemplate;
    const fieldsChanged =
      data.extractionFields !== undefined &&
      JSON.stringify(data.extractionFields) !== JSON.stringify(old.extractionFields);

    if (promptChanged || fieldsChanged) {
      await db.insert(documentTypePromptHistory).values({
        documentTypeId: id,
        promptTemplate: old.promptTemplate,
        extractionFields: (old.extractionFields as ExtractionField[]) || [],
        validationRules: (old.validationRules as ValidationRules) || null,
        version: old.version,
        changedBy: changedBy || null,
      });
    }

    const newVersion = promptChanged || fieldsChanged ? old.version + 1 : old.version;

    const updateData: Record<string, any> = { updatedAt: new Date(), version: newVersion };
    if (data.name !== undefined) updateData.name = data.name;
    if ("promptTemplate" in data) updateData.promptTemplate = data.promptTemplate ?? null;
    if (data.extractionFields !== undefined) updateData.extractionFields = data.extractionFields;
    if ("validationRules" in data) updateData.validationRules = data.validationRules ?? null;
    if (data.leadFieldMappings !== undefined) updateData.leadFieldMappings = data.leadFieldMappings;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if ("confirmationRequired" in data) updateData.confirmationRequired = data.confirmationRequired ?? null;
    if ("scanModel" in data) updateData.scanModel = normalizeScanModel(data.scanModel);

    const [updated] = await db
      .update(documentTypes)
      .set(updateData)
      .where(and(eq(documentTypes.id, id), eq(documentTypes.businessAccountId, businessAccountId)))
      .returning();

    this.invalidateCache(businessAccountId);
    return {
      id: updated.id,
      businessAccountId: updated.businessAccountId,
      key: updated.key,
      name: updated.name,
      isSystemDefault: updated.isSystemDefault,
      isActive: updated.isActive,
      promptTemplate: updated.promptTemplate,
      extractionFields: (updated.extractionFields as ExtractionField[]) || [],
      validationRules: (updated.validationRules as ValidationRules) || null,
      leadFieldMappings: (updated.leadFieldMappings as LeadFieldMapping[]) || [],
      confirmationRequired: updated.confirmationRequired ?? null,
      scanModel: updated.scanModel ?? null,
      version: updated.version,
    };
  }

  async deleteDocumentType(id: string, businessAccountId: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(documentTypes)
      .where(and(eq(documentTypes.id, id), eq(documentTypes.businessAccountId, businessAccountId)))
      .limit(1);

    if (existing.length === 0) return false;
    if (existing[0].isSystemDefault) return false;

    await db.delete(documentTypes).where(eq(documentTypes.id, id));
    this.invalidateCache(businessAccountId);
    return true;
  }

  async getPromptHistory(documentTypeId: string) {
    return db
      .select()
      .from(documentTypePromptHistory)
      .where(eq(documentTypePromptHistory.documentTypeId, documentTypeId))
      .orderBy(documentTypePromptHistory.changedAt);
  }

  buildExtractionPrompt(config: DocumentTypeConfig): string {
    const fieldList = config.extractionFields
      .map((f) => {
        let line = `- "${f.key}": ${f.label}${f.required ? " (REQUIRED)" : " (optional)"}`;
        if (f.formatDescription) line += ` — expected format: ${f.formatDescription}`;
        if (f.formatRegex && !f.formatDescription) line += ` — must match: ${f.formatRegex}`;
        return line;
      })
      .join("\n");

    const basePrompt = config.promptTemplate || `You are an expert document analyzer. Analyze this ${config.name} image/document carefully.`;

    return `${basePrompt}

Extract the following fields from this document:
${fieldList}

Return a JSON object with these exact keys. For any field you cannot find or read, use null.
Also include:
- "documentType": "${config.key}"
- "confidence": a number 0-1 indicating how confident you are this is a ${config.name}
- "isValid": boolean indicating if the document appears genuine and readable`;
  }

  private invalidateCache(businessAccountId: string): void {
    this.cache.delete(businessAccountId);
  }
}

export const documentTypeService = new DocumentTypeService();
