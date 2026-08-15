import OpenAI from "openai";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import path from "path";
import { documentTypeService, DocumentTypeConfig } from "./documentTypeService";
import { renderPdfPagesToJpegs, PdfRenderError } from "./pdfRenderer";

export interface DocumentIdentificationResult {
  documentType: string;
  confidence: number;
  extractedData: Record<string, any>;
  isValid: boolean;
  validationNotes?: string;
  side?: "front" | "back";
  // PR1: required-field validation failures (fail-closed). Populated by validateAndCorrectDocumentType.
  // When non-empty AND any failure has reason='format', the validator drops confidence to 0.2 so the
  // caller's existing low-confidence vision-fallback gate fires automatically.
  _validationFailures?: Array<{
    field: string;
    label?: string;
    value: string;
    expected: string;
    reason: 'format' | 'missing';
  }>;
  // PR2: which extraction tier produced this result. Used by callers to decide whether to escalate
  // or to send the user a "please re-upload" message after the final tier fails.
  _extractionTier?: 'text' | 'vision-mini' | 'vision-strict-mini' | 'vision-strict-gpt4o';
  // PR2: 1-indexed page number for multi-page (PDF) extraction.
  _pageNumber?: number;
  // Set when PDF rasterization itself failed (system/dependency/timeout/file-too-large),
  // distinct from "AI couldn't classify the document". Callers should show an honest
  // "we're having trouble processing your PDF" message instead of a content-rejection.
  _infraError?: boolean;
  _infraErrorCode?: string;
}

export interface PdfExtractionResult {
  success: boolean;
  text?: string;
  isPasswordProtected?: boolean;
  isScannedDocument?: boolean;
  error?: string;
}

class DocumentIdentificationService {
  private async buildSystemPrompt(businessAccountId: string): Promise<string> {
    const docTypes = await documentTypeService.getActiveDocumentTypes(businessAccountId);

    if (docTypes.length === 0) {
      return this.getDefaultSystemPrompt();
    }

    const docTypeDescriptions = docTypes.map((dt) => {
      const fieldList = dt.extractionFields
        .map((f) => `${f.label}${f.required ? " (REQUIRED)" : ""}`)
        .join(", ");
      const customNote = dt.promptTemplate ? ` — ${dt.promptTemplate}` : "";
      return `- ${dt.name.toUpperCase()} (key: "${dt.key}"): ${fieldList}${customNote}`;
    }).join("\n");

    const validTypeKeys = docTypes.map((dt) => `"${dt.key}"`).join(" | ");

    const fieldDescriptions = docTypes.map((dt) => {
      const fields = dt.extractionFields.map((f) => {
        let desc = `    "${f.key}": "${f.label}${f.required ? " (REQUIRED)" : ""}"`;
        if (f.formatDescription) desc += ` // format: ${f.formatDescription}`;
        else if (f.formatRegex) desc += ` // must match: ${f.formatRegex}`;
        return desc;
      }).join(",\n");
      return `  For ${dt.key}:\n${fields}`;
    }).join("\n\n");

    return `You are an expert document identification and extraction AI. Analyze uploaded images/text to:
1. Identify the document type
2. Extract relevant information from the document
3. Validate if the document appears genuine

Configured Document Types and Expected Fields:
${docTypeDescriptions}

Return a JSON object with this exact structure:
{
  "documentType": ${validTypeKeys} | "unknown",
  "confidence": 0.0 to 1.0,
  "extractedData": {
    // Include only keys relevant to the identified document type:
${fieldDescriptions}
  },
  "isValid": true/false,
  "validationNotes": "Any issues or observations about the document",
  "side": "front" | "back"
}

IMPORTANT - Document Side Detection:
- For Aadhaar cards:
  * FRONT side: Has the holder's photograph, full name, date of birth, gender, and 12-digit Aadhaar number. Set address=null for front-only images.
  * BACK side: Has the complete residential address block (door/flat number, street, locality, city, state, PIN code) and a QR code. When you see the back, ALWAYS extract the full address — never return null for the address field if the back side is visible. Set full_name = null for back side — the "C/O SomeName" text inside the address block is the guardian's or parent's name, NOT the cardholder's name; never populate full_name from the back side. Set aadhaar_number = null for back side — extract the Aadhaar number from the front (photo) side only.
  * Set side="back" when there is an address block and QR code but no photograph.
  * If a single image shows BOTH sides (digital Aadhaar / printed sheet), extract all fields including address.
- For PAN cards: Usually single-sided, always set side to "front".
- For other documents: Set "front" if it shows the main identifying information, "back" if it shows secondary/supplementary info.
- Always include the "side" field in your response.

Only include fields that are relevant to the identified document type. For any field you cannot find or read, use null.
For unreadable or invalid documents, set confidence low and explain in validationNotes.

IMPORTANT: When the image is NOT a recognized document (documentType is "unknown"), you MUST describe what you actually see in the image in the validationNotes field. Be brief and specific about what is visible.`;
  }

  private getDefaultSystemPrompt(): string {
    return `You are an expert document identification and extraction AI. Analyze uploaded images to:
1. Identify the document type (aadhaar, pan, bank_statement, driving_license, or unknown)
2. Extract relevant information from the document
3. Validate if the document appears genuine

Document Types and Expected Fields:
- AADHAAR Card: 12-digit number, name, date of birth, address, gender
- PAN Card: 10-character alphanumeric (format: ABCDE1234F), name, father's name, date of birth
- Bank Statement: Bank name, account number, IFSC code, statement period
- Driving License: License number, name, date of birth, issue date, expiry date, address

Return a JSON object with this exact structure:
{
  "documentType": "aadhaar" | "pan" | "bank_statement" | "driving_license" | "unknown",
  "confidence": 0.0 to 1.0,
  "extractedData": {
    "name": "...",
    "documentNumber": "...",
    "dateOfBirth": "...",
    "address": "...",
    "fatherName": "...",
    "issueDate": "...",
    "expiryDate": "...",
    "bankName": "...",
    "accountNumber": "...",
    "ifscCode": "..."
  },
  "isValid": true/false,
  "validationNotes": "Any issues or observations about the document",
  "side": "front" | "back"
}

Only include fields that are relevant to the document type. For unreadable or invalid documents, set confidence low and explain in validationNotes.

IMPORTANT: When the image is NOT a recognized document (documentType is "unknown"), you MUST describe what you actually see in the image in the validationNotes field. Be brief and specific about what is visible.`;
  }

  async identifyDocument(
    businessAccountId: string,
    imageUrl: string,
    sideHint?: string,
    allowedDocTypes?: string[]
  ): Promise<DocumentIdentificationResult> {
    // Classify-then-strict path (new): when caller scopes to a specific upload step,
    // classify first then run per-doc strict extraction with the configured custom prompt.
    if (allowedDocTypes && allowedDocTypes.length > 0) {
      return this.classifyAndStrictExtract(businessAccountId, [imageUrl], allowedDocTypes, sideHint);
    }
    try {
      const [account] = await db
        .select({ openaiApiKey: businessAccounts.openaiApiKey })
        .from(businessAccounts)
        .where(eq(businessAccounts.id, businessAccountId))
        .limit(1);

      const apiKey = account?.openaiApiKey;
      if (!apiKey) {
        console.warn(`[Document ID] OpenAI API key not configured for business ${businessAccountId}`);
        return {
          documentType: "unknown",
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: "OpenAI API key not configured"
        };
      }

      const systemPrompt = await this.buildSystemPrompt(businessAccountId);
      const openai = new OpenAI({ apiKey, timeout: 30000 });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: sideHint
                  ? `${sideHint}\n\nIdentify this document, extract all visible information, and validate its authenticity.`
                  : "Identify this document, extract all visible information, and validate its authenticity."
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || "";
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn("[Document ID] No JSON found in response:", content);
        return {
          documentType: "unknown",
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: "Could not parse document"
        };
      }

      const result = JSON.parse(jsonMatch[0]) as DocumentIdentificationResult;
      result._extractionTier = 'vision-mini';
      console.log(`[Document ID] Identified: ${result.documentType} with ${result.confidence} confidence`);
      
      await this.validateAndCorrectDocumentType(result, businessAccountId);
      
      return result;
    } catch (error: any) {
      console.error("[Document ID] Error identifying document:", error);
      const isTimeoutOrNetwork = error.message?.includes("timeout") || 
        error.message?.includes("Timeout") || 
        error.message?.includes("fetch") ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("network");
      return {
        documentType: "unknown",
        confidence: 0,
        extractedData: {},
        isValid: false,
        validationNotes: isTimeoutOrNetwork 
          ? "Could not process the image. The file may have expired or failed to load." 
          : "Could not analyze this image. Please try uploading again."
      };
    }
  }

  async extractTextFromPdf(pdfBuffer: Buffer, password?: string): Promise<PdfExtractionResult> {
    let parser: any = null;
    let PasswordException: any = null;
    try {
      const pdfModule = await import("pdf-parse") as any;
      const PDFParse = pdfModule.PDFParse;
      PasswordException = pdfModule.PasswordException;
      const options: any = {
        data: new Uint8Array(pdfBuffer),
        verbosity: 0,
      };
      if (password) {
        options.password = password;
      }
      parser = new PDFParse(options);
      const result = await parser.getText();
      const text = (result?.text || "").trim();
      if (!text || text.length < 10) {
        return {
          success: false,
          isScannedDocument: true,
          error: "PDF contains no readable text. It may be a scanned document."
        };
      }
      return { success: true, text };
    } catch (error: any) {
      if (
        (PasswordException && error instanceof PasswordException) ||
        error.constructor?.name === "PasswordException" ||
        (error.name || "").includes("PasswordException") ||
        (error.message || "").toLowerCase().includes("password") ||
        (error.message || "").toLowerCase().includes("encrypted")
      ) {
        return {
          success: false,
          isPasswordProtected: true,
          error: "PDF is password protected"
        };
      }
      console.error("[Document ID] PDF extraction error:", error.message || error);
      return {
        success: false,
        error: "Could not read this PDF file. Please try uploading a photo of the document instead."
      };
    } finally {
      if (parser) {
        try { parser.destroy(); } catch (_) {}
      }
    }
  }

  /**
   * Probe-only check for PDF encryption. Returns whether the PDF requires a password,
   * and (if a password is supplied) whether it is correct. Does NOT use any extracted
   * text for identification — extraction is always performed by vision downstream.
   */
  async isPdfEncrypted(pdfBuffer: Buffer, password?: string): Promise<{ encrypted: boolean; passwordValid?: boolean }> {
    const probe = await this.extractTextFromPdf(pdfBuffer);
    if (probe.isPasswordProtected) {
      if (!password) return { encrypted: true };
      const probeWithPw = await this.extractTextFromPdf(pdfBuffer, password);
      return { encrypted: true, passwordValid: !probeWithPw.isPasswordProtected };
    }
    return { encrypted: false };
  }

  async identifyDocumentFromPdfImages(
    businessAccountId: string,
    pdfBuffer: Buffer,
    allowedDocTypes?: string[],
    password?: string
  ): Promise<DocumentIdentificationResult[]> {
    const startTime = Date.now();
    let renderedPages: { pageFile: string; dataUrl: string }[];

    try {
      const pages = await renderPdfPagesToJpegs(pdfBuffer, { password, maxPages: 6 });
      renderedPages = pages.map((p) => ({
        pageFile: `page-${p.pageNumber}`,
        dataUrl: `data:image/jpeg;base64,${p.jpegBuffer.toString('base64')}`,
      }));
      console.log(`[Document ID] Rendered ${renderedPages.length} PDF pages via pdfjs-dist in ${Date.now() - startTime}ms`);
    } catch (renderErr: any) {
      const code = renderErr instanceof PdfRenderError ? renderErr.code : 'RENDER_FAILED';
      const isInfra = code === 'DEPENDENCY_MISSING' || code === 'RENDER_FAILED' || code === 'NO_PAGES';
      const isLimit = code === 'FILE_TOO_LARGE' || code === 'RENDER_TIMEOUT';
      const note = isLimit
        ? 'PDF rendering timed out (file too long or complex)'
        : `PDF rendering failed: ${renderErr?.message || 'unknown error'} [${code}]`;
      console.warn(`[Document ID] pdf render failed: ${note}`);
      return [{
        documentType: 'unknown',
        confidence: 0,
        extractedData: {},
        isValid: false,
        validationNotes: note,
        _infraError: isInfra,
        _infraErrorCode: code,
      }];
    }

    const pageFiles = renderedPages.map((p) => p.pageFile);

    try {
      const pageDataUrls = renderedPages;

      // Verify-style fast path: when the step expects a single doc type that has no
      // required-format fields (e.g. Bank Statement), do ONE consolidated AI call
      // across all rendered pages instead of treating each page independently.
      // This honors prompt instructions like "analyze all pages" and avoids per-page
      // false negatives when only the cover page contains the bank header.
      if (allowedDocTypes && allowedDocTypes.length === 1) {
        const onlyKey = allowedDocTypes[0];
        const onlyCfg =
          await documentTypeService.getDocumentTypeByKey(businessAccountId, onlyKey) ||
          await documentTypeService.getDocumentTypeByKey(businessAccountId, onlyKey.toLowerCase().replace(/_card$/, ''));
        if (onlyCfg && this.isVerifyStyleDocType(onlyCfg)) {
          const tier1Model: 'gpt-4o-mini' | 'gpt-4o' =
            onlyCfg.scanModel === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini';
          console.log(`[Document ID] Verify-style consolidated call: docType=${onlyKey}, model=${tier1Model}, pages=${pageDataUrls.length}`);
          const consolidated = await this.extractFieldsStrict(
            businessAccountId,
            onlyKey,
            pageDataUrls.map(p => p.dataUrl),
            { model: tier1Model, verifyStyle: true }
          );
          if (consolidated.documentType !== 'unknown') consolidated.documentType = onlyKey;
          consolidated._pageNumber = 1;
          console.log(`[Document ID] Verify-style result for ${onlyKey}: isValid=${consolidated.isValid}, confidence=${consolidated.confidence} (${Date.now() - startTime}ms)`);
          if (!consolidated.isValid && consolidated.documentType !== 'unknown') {
            return [{
              ...consolidated,
              documentType: 'unknown',
            }];
          }
          return [consolidated];
        }
      }

      const visionResults = await Promise.all(
        pageDataUrls.map(async ({ pageFile, dataUrl }, idx) => {
          // New classify-then-strict path when caller provides scoped allowedDocTypes.
          // The strict extract path already performs Tier 1 (mini) + Tier 2 (gpt-4o) escalation
          // internally via classifyAndStrictExtract, so the legacy tier block below is skipped.
          if (allowedDocTypes && allowedDocTypes.length > 0) {
            const r = await this.classifyAndStrictExtract(businessAccountId, [dataUrl], allowedDocTypes);
            r._pageNumber = idx + 1;
            console.log(`[Document ID] PDF page ${pageFile}: ${r.documentType} (confidence: ${r.confidence}, tier: ${r._extractionTier})`);
            return r;
          }

          const result = await this.identifyDocument(businessAccountId, dataUrl);
          result._pageNumber = idx + 1;
          if (result.documentType !== 'unknown' && result.confidence > 0.3) {
            console.log(`[Document ID] PDF page ${pageFile}: identified ${result.documentType} (confidence: ${result.confidence})`);
          } else {
            console.log(`[Document ID] PDF page ${pageFile}: no document identified (${result.documentType}, confidence: ${result.confidence})`);
          }

          // PR2: Tier escalation for KYC docs (aadhaar/pan).
          // Tier 1 (gpt-4o-mini, generic prompt) → if format failure or low confidence,
          // re-extract with Tier 1-strict (gpt-4o-mini, per-doc strict prompt + json_schema).
          // If still failing → Tier 2-strict (gpt-4o, same strict pipeline with escalation reason).
          if (this.isStrictKycType(result.documentType)) {
            const tier1Failed =
              (result._validationFailures && result._validationFailures.some(f => f.reason === 'format')) ||
              result.confidence < 0.85;
            if (tier1Failed) {
              // Resolve the per-doc-type configured strict model. When configured = gpt-4o,
              // run the strict pipeline directly with gpt-4o (no Tier 2 escalation needed).
              const docCfg =
                await documentTypeService.getDocumentTypeByKey(businessAccountId, result.documentType) ||
                await documentTypeService.getDocumentTypeByKey(businessAccountId, result.documentType.toLowerCase().replace(/_card$/, ''));
              const strictTier1Model: 'gpt-4o-mini' | 'gpt-4o' =
                docCfg?.scanModel === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini';

              const reason1 = result._validationFailures?.length
                ? `Tier 1 produced format-invalid values: ${result._validationFailures.map(f => `${f.field}="${f.value}"`).join(', ')}`
                : `Tier 1 confidence ${result.confidence} below 0.85 threshold`;
              console.log(`[Document ID] PDF page ${pageFile} (${result.documentType}): Tier 1 inadequate — ${reason1}. Escalating to strict-${strictTier1Model}.`);
              const tier1Strict = await this.extractFieldsStrict(businessAccountId, result.documentType, [dataUrl], { model: strictTier1Model, escalationReason: reason1 });
              tier1Strict._pageNumber = idx + 1;

              // If we already used gpt-4o, no further escalation is possible.
              if (strictTier1Model === 'gpt-4o') return tier1Strict;

              const tier1StrictFailed =
                (tier1Strict._validationFailures && tier1Strict._validationFailures.some(f => f.reason === 'format')) ||
                tier1Strict.confidence < 0.85;
              if (tier1StrictFailed) {
                const reason2 = tier1Strict._validationFailures?.length
                  ? `Tier 1-strict still produced format-invalid values: ${tier1Strict._validationFailures.map(f => `${f.field}="${f.value}"`).join(', ')}`
                  : `Tier 1-strict confidence ${tier1Strict.confidence} below 0.85`;
                console.log(`[Document ID] PDF page ${pageFile} (${result.documentType}): escalating to Tier 2 (gpt-4o strict). ${reason2}`);
                const tier2Strict = await this.extractFieldsStrict(businessAccountId, result.documentType, [dataUrl], { model: 'gpt-4o', escalationReason: reason2 });
                tier2Strict._pageNumber = idx + 1;
                return tier2Strict;
              }
              return tier1Strict;
            }
          }

          return result;
        })
      );

      // PR2 critical: keep final-tier (vision-strict-gpt4o) failures and any result that has
      // recorded format failures, even when fail-closed dropped confidence to 0.2. Otherwise the
      // explicit "please re-upload sharper" prompt in handleDocumentResult would never fire and
      // the user would get the generic "no recognizable documents" message instead.
      const results = visionResults.filter(
        r => r.documentType !== 'unknown' && (
          r.confidence > 0.3 ||
          r._extractionTier === 'vision-strict-gpt4o' ||
          (r._validationFailures && r._validationFailures.length > 0) ||
          r.isValid === true
        )
      );
      console.log(`[Document ID] Vision AI parallel processing took ${Date.now() - startTime}ms for ${pageFiles.length} pages, found ${results.length} documents`);

      if (results.length === 0) {
        return [{
          documentType: "unknown",
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: "No recognizable documents found in PDF pages"
        }];
      }

      return results;
    } catch (error: any) {
      console.error('[Document ID] PDF-to-image conversion error:', error.message);
      return [{
        documentType: "unknown",
        confidence: 0,
        extractedData: {},
        isValid: false,
        validationNotes: `Failed to convert PDF to images: ${error.message}`,
        _infraError: true,
        _infraErrorCode: 'RENDER_FAILED',
      }];
    }
  }

  async identifyDocumentFromText(
    businessAccountId: string,
    text: string
  ): Promise<DocumentIdentificationResult> {
    try {
      const [account] = await db
        .select({ openaiApiKey: businessAccounts.openaiApiKey })
        .from(businessAccounts)
        .where(eq(businessAccounts.id, businessAccountId))
        .limit(1);

      const apiKey = account?.openaiApiKey;
      if (!apiKey) {
        return {
          documentType: "unknown",
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: "OpenAI API key not configured"
        };
      }

      const systemPrompt = await this.buildSystemPrompt(businessAccountId);
      const openai = new OpenAI({ apiKey, timeout: 30000 });
      const truncatedText = text.substring(0, 5000);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Identify this document from its extracted text and extract all relevant information:\n\n${truncatedText}`
          }
        ],
        max_tokens: 1000,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          documentType: "unknown",
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: "Could not parse document text"
        };
      }

      const result = JSON.parse(jsonMatch[0]) as DocumentIdentificationResult;
      result._extractionTier = 'text';
      console.log(`[Document ID] Identified from text: ${result.documentType} with ${result.confidence} confidence`);
      await this.validateAndCorrectDocumentType(result, businessAccountId);
      return result;
    } catch (error: any) {
      console.error("[Document ID] Error identifying document from text:", error);
      return {
        documentType: "unknown",
        confidence: 0,
        extractedData: {},
        isValid: false,
        validationNotes: "Could not analyze this document. Please try uploading again."
      };
    }
  }

  private static PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  private static AADHAAR_REGEX = /^\d{12}$/;

  // PR2: Doc types that opt into strict json_schema vision extraction by default.
  // Other types fall back to legacy non-strict behavior (no behavior change for them).
  private static STRICT_KYC_TYPES = new Set(['aadhaar', 'pan', 'aadhaar_card', 'pan_card']);

  isStrictKycType(docType: string): boolean {
    if (!docType) return false;
    return DocumentIdentificationService.STRICT_KYC_TYPES.has(docType.toLowerCase());
  }

  /**
   * A doc type is "verify-style" when it has no required field with a format regex.
   * For these (e.g. Bank Statement), we honor the admin's promptTemplate as-written,
   * skip the strict-KYC wrapper, send all PDF pages in one AI call, and trust the
   * model's own isValid + confidence rather than enforcing the 0.85 KYC floor.
   * Aadhaar (12-digit aadhaar_number) and PAN (PAN-format pan_number) have required
   * fields with format regex, so they automatically stay on the strict path.
   */
  isVerifyStyleDocType(config: DocumentTypeConfig): boolean {
    if (!config?.extractionFields?.length) return true;
    return !config.extractionFields.some(f => f.required && !!f.formatRegex);
  }

  private async validateAndCorrectDocumentType(result: DocumentIdentificationResult, businessAccountId: string): Promise<void> {
    if (result.documentType === "unknown") return;

    const docNumber = result.extractedData?.documentNumber || result.extractedData?.aadhaar_number || result.extractedData?.pan_number;
    if (docNumber && result.confidence >= 0.5) {
      const cleanNumber = String(docNumber).replace(/[\s-]/g, '').toUpperCase();
      const isPanFormat = DocumentIdentificationService.PAN_REGEX.test(cleanNumber);
      const isAadhaarFormat = DocumentIdentificationService.AADHAAR_REGEX.test(cleanNumber);

      if (result.documentType === "aadhaar" && isPanFormat && !isAadhaarFormat) {
        console.log(`[Document ID] Format correction: AI said aadhaar but document number "${cleanNumber}" matches PAN format — correcting to pan`);
        result.documentType = "pan";
        result.validationNotes = (result.validationNotes || "") + " [Auto-corrected from aadhaar to pan based on document number format]";
      } else if (result.documentType === "pan" && isAadhaarFormat && !isPanFormat) {
        console.log(`[Document ID] Format correction: AI said pan but document number "${cleanNumber}" matches Aadhaar format — correcting to aadhaar`);
        result.documentType = "aadhaar";
        result.validationNotes = (result.validationNotes || "") + " [Auto-corrected from pan to aadhaar based on document number format]";
      }
    }

    const docTypeConfig = await documentTypeService.getDocumentTypeByKey(businessAccountId, result.documentType);
    if (!docTypeConfig) return;

    // PR1 FAIL-CLOSED VALIDATION
    // Required field whose value is present but does NOT match formatRegex:
    //   1. null out the field (so downstream code never sees a corrupt value)
    //   2. record the failure
    //   3. drop confidence to 0.2 so the caller's existing vision-fallback gate fires automatically
    // Optional field that fails formatRegex stays a non-blocking warning (legacy behavior).
    // Missing required fields are NOT marked as fail-closed here because multi-page docs (e.g. Aadhaar
    // back-side address) can fill them in via merging in handleDocumentResult. Only isDocTypeComplete
    // (called after merge) enforces required-presence + format gate.
    const failures: NonNullable<DocumentIdentificationResult['_validationFailures']> = [];

    for (const field of docTypeConfig.extractionFields) {
      const fieldValue = result.extractedData?.[field.key];
      const isEmpty = fieldValue === null || fieldValue === undefined || String(fieldValue).trim() === '';
      if (isEmpty || !field.formatRegex) continue;
      const cleanValue = String(fieldValue).replace(/[\s-]/g, '').toUpperCase();
      try {
        const regex = new RegExp(field.formatRegex);
        if (regex.test(cleanValue)) continue;

        if (field.required) {
          console.log(`[Document ID] FAIL-CLOSED: required field "${field.key}" value "${cleanValue}" does not match formatRegex ${field.formatRegex} — nulling field & marking failure`);
          failures.push({
            field: field.key,
            label: field.label,
            value: String(fieldValue),
            expected: field.formatDescription || field.formatRegex,
            reason: 'format',
          });
          if (result.extractedData) result.extractedData[field.key] = null;
        } else {
          result.validationNotes = (result.validationNotes || "") + ` [Format warning for ${field.label}: expected ${field.formatDescription || field.formatRegex}]`;
        }
      } catch (_) {}
    }

    if (failures.length > 0) {
      result._validationFailures = (result._validationFailures || []).concat(failures);
      if (result.confidence > 0.25) {
        console.log(`[Document ID] Lowering confidence ${result.confidence} → 0.2 due to ${failures.length} required-field format failure(s): ${failures.map(f => f.field).join(', ')} — caller's vision-fallback gate will trigger`);
        result.confidence = 0.2;
      }
    }
  }

  private buildStrictPromptForDoc(config: DocumentTypeConfig, escalationReason?: string, verifyStyle: boolean = false): string {
    const requiredFields = config.extractionFields.filter(f => f.required);
    const optionalFields = config.extractionFields.filter(f => !f.required);

    const formatLine = (f: { formatDescription?: string | null; formatRegex?: string | null }): string => {
      const parts: string[] = [];
      if (f.formatDescription) parts.push(`format: ${f.formatDescription}`);
      if (f.formatRegex) parts.push(`MUST match regex /${f.formatRegex}/`);
      return parts.length > 0 ? ` — ${parts.join('; ')}` : '';
    };

    const requiredList = requiredFields.length > 0
      ? requiredFields.map(f => `- "${f.key}" (${f.label}): REQUIRED${formatLine(f)}`).join('\n')
      : '(none)';
    const optionalList = optionalFields.length > 0
      ? optionalFields.map(f => `- "${f.key}" (${f.label}): optional${formatLine(f)}`).join('\n')
      : '(none)';

    const customInstructions = (config.promptTemplate || '').trim();
    const escalationBlock = escalationReason
      ? `\n\n══════ TIER 2 RETRY ══════\nThe previous extraction attempt failed: ${escalationReason}\nLook MORE carefully this time. Read each character one by one. Zoom mentally on the document number — count the digits.\n══════════════════════════`
      : '';

    // Verify-style doc types (e.g. Bank Statement): no required field has a format regex.
    // Honor the admin's promptTemplate as-authored — drop the strict-KYC wrapper.
    if (verifyStyle) {
      const allFieldsList = config.extractionFields.length > 0
        ? config.extractionFields
            .map(f => `- "${f.key}" (${f.label})${f.required ? ' [preferred]' : ' [optional]'}${formatLine(f)}`)
            .join('\n')
        : '(no fields configured — extraction object should be empty)';

      const primary = customInstructions
        || `You are a document verifier for ${config.name}. Look at the image(s) and decide whether they constitute a valid ${config.name}.`;

      return `${primary}

═══════════════════════════════════════════════════════════
HOW TO ANSWER
═══════════════════════════════════════════════════════════
You may receive ONE OR MORE pages of the same document. Treat the pages as a single document and reason holistically across all of them before answering.

- Set isValid=true ONLY when the document genuinely matches a ${config.name}. Set isValid=false when it does not (and explain briefly in validationNotes — e.g. "appears to be a PAN card", "blank page", "unrelated screenshot").
- Set confidence between 0 and 1 reflecting how sure you are.
- When isValid=true, fill in the fields below where they are clearly visible anywhere in the document. Use null for any field you cannot read with certainty. Do NOT guess.
- When isValid=false, leave every field as null.

FIELDS TO POPULATE WHEN VALID:
${allFieldsList}

Return JSON exactly matching the enforced schema. Do not add prose outside the JSON.`;
    }

    return `You are a strict KYC document extraction specialist for ${config.name}.

═══════════════════════════════════════════════════════════
DOCUMENT TYPE VERIFICATION (DO THIS FIRST)
═══════════════════════════════════════════════════════════
The image you receive is EXPECTED to be a ${config.name}. Before extracting any field:
- Verify the image actually IS a ${config.name}.
- If it is something else (different document type, selfie, blank page, screenshot of unrelated content, illegible image), set isValid=false, leave every field null, set confidence=0, and put a short note in validationNotes describing what you actually see (e.g. "actual_type=pan_card", "appears to be a selfie", "blank page").
- Only proceed to extract fields when you are confident the image IS a ${config.name}.

═══════════════════════════════════════════════════════════
NON-NEGOTIABLE RULES — VIOLATING ANY OF THESE = SET FIELD TO NULL
═══════════════════════════════════════════════════════════
1. NEVER guess. NEVER pad numbers. NEVER drop digits or characters.
2. If a required field is not 100% legible AND format-valid, return null and explain in validationNotes.
3. Count digits/characters carefully — a wrong-length number is WORSE than no number.
4. A blurry, glared, partially occluded, or ambiguous value MUST be returned as null.
5. confidence = 1.0 ONLY when every required field is unambiguous AND format-valid; otherwise lower it honestly (e.g. 0.5 if you guessed a digit).
6. Set isValid=false if the document looks tampered, expired, illegible, or is a photocopy of a photocopy.
${customInstructions ? '\nDOC-TYPE-SPECIFIC RULES:\n' + customInstructions + '\n' : ''}
═══════════════════════════════════════════════════════════
FIELDS TO EXTRACT (output schema is enforced)
═══════════════════════════════════════════════════════════
REQUIRED:
${requiredList}

OPTIONAL:
${optionalList}

side: "front" if the photograph + ID number are visible; "back" if only the address block + QR code are visible; null if neither applies or both sides are present in one image.${escalationBlock}

Return JSON exactly matching the enforced schema. Do not add prose outside the JSON.`;
  }

  private buildJsonSchemaForDoc(config: DocumentTypeConfig): Record<string, any> {
    // OpenAI strict json_schema requires every property to be listed in `required` and uses union
    // types like ["string", "null"] for nullable fields. We deliberately do NOT include `pattern`
    // here because (a) strict mode rejects some pattern flavors and (b) validateAndCorrectDocumentType
    // re-enforces the regex server-side and fails closed if the model returns an invalid value.
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const f of config.extractionFields) {
      let description = f.label || f.key;
      if (f.formatDescription) description += ` (format: ${f.formatDescription})`;
      else if (f.formatRegex) description += ` (must match: ${f.formatRegex})`;
      properties[f.key] = { type: ['string', 'null'], description };
      required.push(f.key);
    }
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        extractedData: {
          type: 'object',
          additionalProperties: false,
          properties,
          required,
        },
        confidence: { type: 'number' },
        isValid: { type: 'boolean' },
        validationNotes: { type: ['string', 'null'] },
        side: { type: ['string', 'null'] },
      },
      required: ['extractedData', 'confidence', 'isValid', 'validationNotes', 'side'],
    };
  }

  /**
   * PR2: Strict per-doc-type extraction using vision + OpenAI json_schema strict mode.
   * Used as Tier 1 (gpt-4o-mini) and Tier 2 (gpt-4o) escalation for KYC docs.
   * Falls back to a structured error result on any failure (never throws).
   */
  async extractFieldsStrict(
    businessAccountId: string,
    docTypeKey: string,
    imageDataUrls: string[],
    options: { model?: 'gpt-4o-mini' | 'gpt-4o'; escalationReason?: string; sideHint?: string; verifyStyle?: boolean } = {}
  ): Promise<DocumentIdentificationResult> {
    const model = options.model || 'gpt-4o-mini';
    const tierLabel: NonNullable<DocumentIdentificationResult['_extractionTier']> =
      model === 'gpt-4o' ? 'vision-strict-gpt4o' : 'vision-strict-mini';
    const normalizedKey = docTypeKey.toLowerCase().replace(/_card$/, '');

    try {
      const docTypeConfig =
        await documentTypeService.getDocumentTypeByKey(businessAccountId, docTypeKey) ||
        await documentTypeService.getDocumentTypeByKey(businessAccountId, normalizedKey);
      if (!docTypeConfig) {
        return {
          documentType: normalizedKey,
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: `No configured document type for "${docTypeKey}"`,
          _extractionTier: tierLabel,
        };
      }

      const [account] = await db
        .select({ openaiApiKey: businessAccounts.openaiApiKey })
        .from(businessAccounts)
        .where(eq(businessAccounts.id, businessAccountId))
        .limit(1);
      const apiKey = account?.openaiApiKey;
      if (!apiKey) {
        return {
          documentType: normalizedKey,
          confidence: 0,
          extractedData: {},
          isValid: false,
          validationNotes: 'OpenAI API key not configured',
          _extractionTier: tierLabel,
        };
      }

      const verifyStyle = options.verifyStyle ?? this.isVerifyStyleDocType(docTypeConfig);
      const systemPrompt = this.buildStrictPromptForDoc(docTypeConfig, options.escalationReason, verifyStyle);
      const schema = this.buildJsonSchemaForDoc(docTypeConfig);
      const openai = new OpenAI({ apiKey, timeout: 45000 });

      const userInstruction = verifyStyle
        ? `Decide whether the image(s) below constitute a valid ${docTypeConfig.name}, then return JSON exactly as instructed. Treat all attached images as pages of the same document.`
        : `Extract the ${docTypeConfig.name} fields from the image(s) below. Follow the NON-NEGOTIABLE RULES exactly.`;

      const userContent: any[] = [
        {
          type: 'text',
          text: options.sideHint ? `${options.sideHint}\n\n${userInstruction}` : userInstruction,
        },
        ...imageDataUrls.map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'high' as const } })),
      ];

      console.log(`[Document ID] Strict extraction: docType=${normalizedKey}, model=${model}, images=${imageDataUrls.length}${options.escalationReason ? ', escalation=' + options.escalationReason : ''}`);
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1500,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'kyc_extraction', strict: true, schema },
        } as any,
      });

      const content = response.choices[0]?.message?.content || '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        console.warn(`[Document ID] Strict mode failed to parse JSON: ${content.slice(0, 200)}`);
        parsed = {};
      }

      const result: DocumentIdentificationResult = {
        documentType: normalizedKey,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        extractedData: parsed.extractedData || {},
        isValid: parsed.isValid !== false,
        validationNotes: parsed.validationNotes || undefined,
        side: (parsed.side === 'front' || parsed.side === 'back') ? parsed.side : undefined,
        _extractionTier: tierLabel,
      };

      console.log(`[Document ID] Strict ${tierLabel} for ${normalizedKey}: confidence=${result.confidence}, side=${result.side || 'n/a'}, data=${JSON.stringify(result.extractedData)}`);
      await this.validateAndCorrectDocumentType(result, businessAccountId);
      return result;
    } catch (error: any) {
      console.error(`[Document ID] Strict extraction error (${tierLabel}, ${normalizedKey}):`, error.message || error);
      return {
        documentType: normalizedKey,
        confidence: 0,
        extractedData: {},
        isValid: false,
        validationNotes: `Strict extraction failed: ${error.message || 'unknown error'}`,
        _extractionTier: tierLabel,
      };
    }
  }

  /**
   * Lightweight scoped classifier — given the doc types this upload step accepts,
   * return ONE of those keys (or "unknown") with a confidence score. No field extraction.
   * Used by classifyAndStrictExtract to route to the per-doc strict extractor.
   */
  private async classifyDocumentScoped(
    businessAccountId: string,
    imageDataUrls: string[],
    allowedDocTypes: string[]
  ): Promise<{ docType: string; confidence: number; validationNotes?: string }> {
    // Preserve each allowed key's original form (e.g. "aadhaar_card") so callers that compare
    // result.documentType against their step-config keys work regardless of "_card" suffix style.
    // We still classify on the normalized form because the per-doc strict extractor uses normalized keys.
    const allowedPairs = Array.from(
      new Map(
        allowedDocTypes
          .filter(Boolean)
          .map(k => {
            const norm = k.toLowerCase().replace(/_card$/, '');
            return [norm, { original: k, norm }] as const;
          })
      ).values()
    );
    if (allowedPairs.length === 0) {
      return { docType: 'unknown', confidence: 0, validationNotes: 'No allowed doc types configured' };
    }
    if (allowedPairs.length === 1) {
      // Single-doc step: skip the classify call entirely. The strict prompt's built-in
      // "verify doc type" check will set isValid=false when the image doesn't match.
      console.log(`[Document ID] Classified ${allowedPairs[0].original} (single-doc step, classifier skipped)`);
      return { docType: allowedPairs[0].original, confidence: 1.0 };
    }
    const allowedNorm = allowedPairs.map(p => p.norm);

    try {
      const [account] = await db
        .select({ openaiApiKey: businessAccounts.openaiApiKey })
        .from(businessAccounts)
        .where(eq(businessAccounts.id, businessAccountId))
        .limit(1);
      const apiKey = account?.openaiApiKey;
      if (!apiKey) {
        return { docType: 'unknown', confidence: 0, validationNotes: 'OpenAI API key not configured' };
      }

      const allTypes = await documentTypeService.getActiveDocumentTypes(businessAccountId);
      const typeListLines = allowedPairs.map(({ norm }) => {
        const cfg = allTypes.find(t => (t.key || '').toLowerCase().replace(/_card$/, '') === norm);
        const desc = cfg ? `${cfg.name}${(cfg as any).description ? ' — ' + (cfg as any).description : ''}` : norm;
        return `- "${norm}": ${desc}`;
      });

      const systemPrompt = `You are a document type classifier. Look at the image(s) and pick exactly ONE of the allowed types below.

ALLOWED TYPES:
${typeListLines.join('\n')}
- "unknown": image is not any of the allowed types above (e.g. user uploaded a different document, a selfie, a blank page, a screenshot of unrelated content, or an illegible image).

Return JSON only: {"docType": "<key>", "confidence": 0.0-1.0, "validationNotes": "<short reason if unknown or low confidence>"}

Rules:
- Pick "unknown" if the image is clearly NOT one of the allowed types — even if it is a real document of a different type. Briefly note what you actually saw (e.g. "appears to be a PAN card", "appears to be a selfie").
- confidence > 0.8 only when you are sure of the type.
- Do NOT extract any fields. Classification only.`;

      const openai = new OpenAI({ apiKey, timeout: 20000 });
      const userContent: any[] = [
        { type: 'text', text: 'Classify the document below.' },
        ...imageDataUrls.map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
      ];

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' } as any,
      });

      const content = response.choices[0]?.message?.content || '{}';
      let parsed: any = {};
      try { parsed = JSON.parse(content); } catch (_) {}
      const rawDocType = String(parsed.docType || 'unknown').toLowerCase().replace(/_card$/, '');
      const matched = allowedPairs.find(p => p.norm === rawDocType);
      const finalDocType = matched ? matched.original : 'unknown';
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      const validationNotes = typeof parsed.validationNotes === 'string' ? parsed.validationNotes : undefined;
      console.log(`[Document ID] Classified ${finalDocType} (confidence=${confidence}, allowed=[${allowedPairs.map(p => p.original).join(',')}])`);
      return { docType: finalDocType, confidence, validationNotes };
    } catch (e: any) {
      console.error('[Document ID] Classification error:', e.message || e);
      return { docType: 'unknown', confidence: 0, validationNotes: `Classification failed: ${e.message || 'unknown error'}` };
    }
  }

  /**
   * Classify-then-strict extraction. The primary extraction path for upload steps:
   * 1. Classify the image scoped to the upload step's allowed doc types.
   * 2. If "unknown" → return an unknown result so the caller's mismatch path fires.
   * 3. Otherwise → strict-extract with the per-doc custom prompt + json_schema (Tier 1: gpt-4o-mini).
   *    On format failure or low confidence, escalate to Tier 2 (gpt-4o) with the same strict pipeline.
   */
  private async classifyAndStrictExtract(
    businessAccountId: string,
    imageDataUrls: string[],
    allowedDocTypes: string[],
    sideHint?: string
  ): Promise<DocumentIdentificationResult> {
    const cls = await this.classifyDocumentScoped(businessAccountId, imageDataUrls, allowedDocTypes);
    if (cls.docType === 'unknown') {
      return {
        documentType: 'unknown',
        confidence: cls.confidence,
        extractedData: {},
        isValid: false,
        validationNotes: cls.validationNotes || 'Could not classify document as one of the expected types.',
        _extractionTier: 'vision-strict-mini',
      };
    }

    // Resolve the per-doc-type configured Tier 1 model. Defaults to gpt-4o-mini.
    // When the configured model is already gpt-4o, skip Tier 2 escalation (no higher tier exists).
    const docCfg =
      await documentTypeService.getDocumentTypeByKey(businessAccountId, cls.docType) ||
      await documentTypeService.getDocumentTypeByKey(businessAccountId, cls.docType.toLowerCase().replace(/_card$/, ''));
    const tier1Model: 'gpt-4o-mini' | 'gpt-4o' =
      docCfg?.scanModel === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini';
    const verifyStyle = docCfg ? this.isVerifyStyleDocType(docCfg) : false;

    const tier1 = await this.extractFieldsStrict(
      businessAccountId,
      cls.docType,
      imageDataUrls,
      { model: tier1Model, sideHint, verifyStyle }
    );
    // extractFieldsStrict normalizes the doc type internally (strips _card). Restore the original
    // allowed-key form so callers comparing against step-config keys (which may use _card) match.
    if (tier1.documentType !== 'unknown') tier1.documentType = cls.docType;

    // If configured model is already gpt-4o, no escalation possible — return as-is.
    if (tier1Model === 'gpt-4o') return tier1;

    // Verify-style doc types (e.g. Bank Statement) have no required-format fields,
    // so the 0.85 KYC confidence floor doesn't apply. Trust the prompt's own isValid —
    // and when the model says it ISN'T the expected document, surface that as 'unknown'
    // so the caller routes through the unsupported-document path instead of accepting it.
    if (verifyStyle) {
      if (tier1.isValid === false) {
        return {
          ...tier1,
          documentType: 'unknown',
        };
      }
      return tier1;
    }

    const tier1Failed =
      (tier1._validationFailures && tier1._validationFailures.some(f => f.reason === 'format')) ||
      tier1.confidence < 0.85;

    if (!tier1Failed) return tier1;

    const reason = tier1._validationFailures?.length
      ? `Tier 1-strict produced format-invalid values: ${tier1._validationFailures.map(f => `${f.field}="${f.value}"`).join(', ')}`
      : `Tier 1-strict confidence ${tier1.confidence} below 0.85`;
    console.log(`[Document ID] Escalating ${cls.docType} to Tier 2 (gpt-4o strict). ${reason}`);
    const tier2 = await this.extractFieldsStrict(
      businessAccountId,
      cls.docType,
      imageDataUrls,
      { model: 'gpt-4o', escalationReason: reason, sideHint }
    );
    if (tier2.documentType !== 'unknown') tier2.documentType = cls.docType;
    return tier2;
  }

  async validateDocumentType(
    result: DocumentIdentificationResult,
    expectedTypes: string[]
  ): Promise<{ matches: boolean; matchedType?: string }> {
    if (result.documentType === "unknown") {
      return { matches: false };
    }

    const matches = expectedTypes.includes(result.documentType);
    return {
      matches,
      matchedType: matches ? result.documentType : undefined
    };
  }
}

export const documentIdentificationService = new DocumentIdentificationService();
