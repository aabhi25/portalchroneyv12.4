import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, uuid, numeric, jsonb, customType, integer, index, uniqueIndex, boolean, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Custom vector type for pgvector embeddings (768 dimensions for Jina CLIP v2)
const vector768 = customType<{  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'vector(768)'; // Jina CLIP v2 uses 768 dimensions for image embeddings
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// Custom vector type for pgvector embeddings (1536 dimensions for OpenAI text embeddings)
const vector1536 = customType<{  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'vector(1536)'; // OpenAI text-embedding-3-small uses 1536 dimensions
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// Business Accounts table
export const businessAccounts = pgTable("business_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  website: text("website").notNull(), // Mandatory website URL for the business
  description: text("description").default(""),
  openaiApiKey: text("openai_api_key"), // Business-specific OpenAI API key
  elevenlabsApiKey: text("elevenlabs_api_key"), // Business-specific ElevenLabs API key for TTS voices
  jinaApiKey: text("jina_api_key"), // Business-specific Jina AI API key for CLIP image embeddings
  status: text("status").notNull().default("active"), // 'active' | 'suspended'
  productTier: text("product_tier").notNull().default("chroney"), // 'chroney' | 'jewelry_showcase' | 'jewelry_showcase_chroney'
  shopifyAutoSyncEnabled: text("shopify_auto_sync_enabled").notNull().default("false"), // 'true' | 'false'
  shopifySyncFrequency: numeric("shopify_sync_frequency", { precision: 5, scale: 0 }).default("24"), // Sync frequency in hours (6, 12, 24, 48)
  shopifyLastSyncedAt: timestamp("shopify_last_synced_at"), // When products were last synced from Shopify
  shopifySyncStatus: text("shopify_sync_status").default("idle"), // 'idle' | 'syncing' | 'completed' | 'failed'
  shopifyEnabled: text("shopify_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Shopify features (text for consistency with other flags)
  appointmentsEnabled: text("appointments_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Appointment features (text for consistency with other flags)
  voiceModeEnabled: text("voice_mode_enabled").notNull().default("true"), // 'true' | 'false' - SuperAdmin toggle for Voice Mode feature (text for consistency with other flags)
  visualSearchEnabled: text("visual_search_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Visual Product Search feature (default OFF)
  jewelryShowcaseEnabled: text("jewelry_showcase_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Jewelry Showcase feature (default OFF)
  jewelryDetectionEnabled: text("jewelry_detection_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for AI Jewelry Detection & Cropping (premium feature, default OFF)
  supportTicketsEnabled: text("support_tickets_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Support Tickets feature (default OFF)
  whatsappEnabled: text("whatsapp_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for WhatsApp AI Agent feature (default OFF)
  instagramEnabled: text("instagram_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Instagram AI Agent feature (default OFF)
  facebookEnabled: text("facebook_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Facebook AI Agent feature (default OFF)
  chroneyEnabled: text("chroney_enabled").notNull().default("true"), // 'true' | 'false' - SuperAdmin toggle for Chroney Chat feature (default ON)
  k12EducationEnabled: text("k12_education_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for K12 Education feature (default OFF)
  k12ImageUploadEnabled: text("k12_image_upload_enabled").notNull().default("false"), // 'true' | 'false' - Business user toggle for K12 photo-upload-a-question feature (default OFF)
  k12ContentOnlyMode: text("k12_content_only_mode").notNull().default("false"), // 'true' | 'false' - When ON, AI answers only from uploaded content (FAQs, docs, K12 topics) and refuses to use general knowledge
  k12VerbatimContentMode: text("k12_verbatim_content_mode").notNull().default("false"), // 'true' | 'false' - When ON, AI reproduces source content exactly as written without paraphrasing
  jobPortalEnabled: text("job_portal_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Job Portal feature (default OFF)
  demoOrdersEnabled: text("demo_orders_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for Demo Orders feature (default OFF)
  whatsappMarketingEnabled: text("whatsapp_marketing_enabled").notNull().default("false"), // 'true' | 'false' - SuperAdmin toggle for WhatsApp Marketing Campaigns feature (default OFF)
  jobImportConfig: jsonb("job_import_config").$type<{
    apiUrl: string;
    authHeader?: string;
    fieldMapping: {
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
    };
    lastSyncedAt?: string;
    lastSyncStatus?: 'idle' | 'syncing' | 'completed' | 'failed';
    lastSyncError?: string;
    lastSyncStats?: { created: number; updated: number; skipped: number; errors: number };
  }>(),
  systemMode: text("system_mode").notNull().default("full"), // 'full' | 'essential' - Full = all features, Essential = core pages only
  topscholarApiBaseUrl: text("topscholar_api_base_url"),
  topscholarApiToken: text("topscholar_api_token"),
  // TopScholar client-hosted RAG curriculum mode (scoped to the TopScholar account; default OFF)
  topscholarRagEnabled: text("topscholar_rag_enabled").notNull().default("false"), // 'true' | 'false' - master flag for cp_id-scoped curriculum RAG
  topscholarContentDbUrl: text("topscholar_content_db_url"), // Connection string to the client-hosted content DB. pgvector (postgres://) OR MongoDB Atlas (mongodb+srv://). NULL => use local pgvector stand-in
  topscholarContentDbDisabled: text("topscholar_content_db_disabled").notNull().default("false"), // 'true' | 'false' - when 'true', ignore the saved external content DB URL and fall back to the built-in local pgvector store WITHOUT erasing the saved connection details. Missing/'false' => external DB active (back-compat).
  topscholarContentDbName: text("topscholar_content_db_name"), // MongoDB Atlas database name (only used when content DB URL is a mongodb connection string)
  topscholarContentDbIndex: text("topscholar_content_db_index"), // MongoDB Atlas Vector Search index name (only used for mongodb)
  topscholarContentDbCollection: text("topscholar_content_db_collection"), // MongoDB Atlas collection name for curriculum embeddings (only used for mongodb). NULL => default 'topscholar_embeddings'
  topscholarCmsBaseUrl: text("topscholar_cms_base_url"), // DEPRECATED (unused): legacy content-by-cp-id CMS path, superseded by the Content Bundle API (topscholarApiBaseUrl). Kept for expand-only schema compat; no code reads it.
  topscholarCmsToken: text("topscholar_cms_token"), // DEPRECATED (unused): legacy CMS auth token paired with topscholarCmsBaseUrl. Kept for expand-only schema compat; no code reads it.
  topscholarTokenSecret: text("topscholar_token_secret"), // HMAC secret to verify signed launch tokens from TopScholar
  topscholarUatPlainCpId: text("topscholar_uat_plain_cp_id").notNull().default("false"), // 'true' | 'false' - UAT only: accept an unsigned cp_id query param
  topscholarRequireSignedToken: text("topscholar_require_signed_token").notNull().default("false"), // 'true' | 'false' - secure mode: trust ONLY signed launch tokens; ignore plain scope/cp_id attributes and refuse unsigned launches
  // TopScholar doubt-sync: base URL for the client's conversation-sync + doubt-close APIs.
  // All messages exchanged in a session are mirrored here; configurable so dev/prod can differ.
  topscholarDoubtSyncBaseUrl: text("topscholar_doubt_sync_base_url"),
  // TopScholar doubt-resolution prompt: how long (in seconds) a doubt-scoped session
  // stays idle after the AI answers before the widget asks "Did this resolve your doubt?".
  // Nullable/expand-only; null falls back to DEFAULT_DOUBT_RESOLUTION_COOLDOWN_SECONDS.
  topscholarDoubtResolutionCooldownSeconds: integer("topscholar_doubt_resolution_cooldown_seconds"),
  // Content Bundle API (plan-and-promo service) — extraction source. Driven by Plan IDs.
  topscholarAutoSyncEnabled: text("topscholar_auto_sync_enabled").notNull().default("false"), // 'true' | 'false' - run the scheduled plan-ID auto-sync
  topscholarSyncMode: text("topscholar_sync_mode").notNull().default("full"), // 'sample' | 'full' - mode used by Sync now / auto-sync
  topscholarSyncIntervalMinutes: integer("topscholar_sync_interval_minutes").notNull().default(1440), // auto-sync cadence in minutes (default daily)
  topscholarLastAutoSyncAt: timestamp("topscholar_last_auto_sync_at"), // last time the scheduled auto-sync ran for this account
  questionBankEnabled: text("question_bank_enabled").notNull().default("true"), // 'true' | 'false' - SuperAdmin toggle for Question Bank feature (text for consistency with other flags)
  autoResolutionEnabled: text("auto_resolution_enabled").notNull().default("true"), // 'true' | 'false' - Enable/disable autonomous support ticket resolution
  autoResolutionConfidence: numeric("auto_resolution_confidence", { precision: 3, scale: 0 }).default("75"), // 60-90% confidence threshold for auto-resolution
  escalationSensitivity: text("escalation_sensitivity").notNull().default("medium"), // 'low' | 'medium' | 'high' - How quickly to escalate to human
  humanOnlyCategories: text("human_only_categories").default(""), // Comma-separated categories that always go to human (e.g. "billing,refunds")
  // Nudge settings
  inactivityNudgeEnabled: text("inactivity_nudge_enabled").notNull().default("true"), // 'true' | 'false' - Show nudge if visitor is inactive during conversation
  inactivityNudgeDelay: numeric("inactivity_nudge_delay", { precision: 5, scale: 0 }).default("45"), // Delay in seconds before showing inactivity nudge
  inactivityNudgeMessage: text("inactivity_nudge_message").default("Still there? Let me know if you need any help!"), // Message to show for inactivity nudge
  proactiveNudgeEnabled: text("proactive_nudge_enabled").notNull().default("true"), // 'true' | 'false' - Show nudge to visitors who haven't started chatting
  proactiveNudgeDelay: numeric("proactive_nudge_delay", { precision: 5, scale: 0 }).default("15"), // Delay in seconds before showing proactive nudge
  proactiveNudgeMessage: text("proactive_nudge_message").default("Need help finding something? I'm here to assist!"), // Message to show for proactive nudge
  // AI Product Processing settings
  aiProductProcessingEnabled: text("ai_product_processing_enabled").notNull().default("false"), // 'true' | 'false' - Enable AI processing (embeddings, jewelry detection) for manually uploaded products (default OFF)
  // Vista Studio AI Model settings
  vistaImageProvider: text("vista_image_provider").notNull().default("openai"), // 'openai' | 'google' - Which AI provider to use for Vista Studio image generation
  googleNanoBananaApiKey: text("google_nano_banana_api_key"), // Encrypted Google Nano Banana Pro API key (for gemini-3-pro-image-preview)
  // Visual Search Model settings
  visualSearchModel: text("visual_search_model").notNull().default("google_product_search"), // 'google_vision_warehouse' | 'google_product_search' - Which model to use for visual product search
  googleVisionWarehouseCorpusId: text("google_vision_warehouse_corpus_id"), // Google Vision Warehouse corpus ID for this business
  googleVisionWarehouseIndexId: text("google_vision_warehouse_index_id"), // Google Vision Warehouse index ID
  googleVisionWarehouseEndpointId: text("google_vision_warehouse_endpoint_id"), // Google Vision Warehouse deployed endpoint ID
  googleVisionWarehouseCredentials: text("google_vision_warehouse_credentials"), // Encrypted Google Vision Warehouse service account credentials JSON
  googleVisionWarehouseProjectNumber: text("google_vision_warehouse_project_number"), // Google Cloud project NUMBER (numeric, e.g., 1059444719642) - required for Vision Warehouse API
  // Google Vision Product Search settings (cost-effective alternative to Vision Warehouse)
  googleProductSearchProductSetId: text("google_product_search_product_set_id"), // Product Set ID for this business
  googleProductSearchLocation: text("google_product_search_location").default("us-east1"), // Location for Product Search (us-east1, us-west1, europe-west1, asia-east1)
  googleProductSearchCredentials: text("google_product_search_credentials"), // Encrypted Google Cloud service account credentials JSON
  googleProductSearchProjectId: text("google_product_search_project_id"), // Google Cloud project ID for Product Search
  // Product Search sync status
  productSearchSyncPhase: text("product_search_sync_phase").default("idle"), // 'idle' | 'syncing' | 'indexing' | 'completed' | 'failed'
  productSearchSyncProgress: numeric("product_search_sync_progress", { precision: 10, scale: 0 }).default("0"),
  productSearchSyncTotal: numeric("product_search_sync_total", { precision: 10, scale: 0 }).default("0"),
  productSearchSyncError: text("product_search_sync_error"),
  productSearchLastSyncedAt: timestamp("product_search_last_synced_at"),
  // Vision Warehouse sync status (persists across page refreshes)
  visionWarehouseSyncPhase: text("vision_warehouse_sync_phase").default("idle"), // 'idle' | 'uploading' | 'analyzing' | 'indexing' | 'completed' | 'failed'
  visionWarehouseSyncProgress: numeric("vision_warehouse_sync_progress", { precision: 10, scale: 0 }).default("0"), // Current progress count
  visionWarehouseSyncTotal: numeric("vision_warehouse_sync_total", { precision: 10, scale: 0 }).default("0"), // Total items to process
  visionWarehouseSyncSuccessCount: numeric("vision_warehouse_sync_success_count", { precision: 10, scale: 0 }).default("0"), // Successful uploads
  visionWarehouseSyncFailedCount: numeric("vision_warehouse_sync_failed_count", { precision: 10, scale: 0 }).default("0"), // Failed uploads
  visionWarehouseSyncError: text("vision_warehouse_sync_error"), // Error message if sync failed
  visionWarehouseSyncStartedAt: timestamp("vision_warehouse_sync_started_at"), // When current sync started
  visionWarehouseSyncAnalyzeOpName: text("vision_warehouse_sync_analyze_op_name"), // Current analyze operation name (for cancellation)
  visionWarehouseSyncIndexOpName: text("vision_warehouse_sync_index_op_name"), // Current index operation name (for cancellation)
  visionWarehouseSyncIndexOpType: text("vision_warehouse_sync_index_op_type"), // Type of index operation: create_index, create_endpoint, deploy_index, update_index
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Users table with roles and business account association
// One user per business account (1:1 relationship)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tempPassword: text("temp_password"), // Temporary password for viewing/copying
  tempPasswordExpiry: timestamp("temp_password_expiry"), // When temp password expires
  mustChangePassword: text("must_change_password").notNull().default("false"), // 'true' | 'false' - Force password change on next login
  role: text("role").notNull(), // 'super_admin' | 'business_user' | 'account_group_admin'
  businessAccountId: varchar("business_account_id").unique().references(() => businessAccounts.id, { onDelete: "cascade" }), // Unique constraint enforces 1:1 relationship (nulls allowed for superadmins)
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Sessions table for authentication
export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  activeBusinessAccountId: varchar("active_business_account_id").references(() => businessAccounts.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Phone OTP challenges — opt-in mobile-number verification for widget chats.
// Scoped per (businessAccountId, conversationId, phoneE164). Stores HMAC-hashed
// codes only (never plaintext). One row per send-event; latest row is canonical
// for state derivation (active code, attempts, resends, lockout).
export const phoneOtpChallenges = pgTable("phone_otp_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  // Telemetry fields (nullable, expand-only — see Task #14 spec)
  leadId: varchar("lead_id"), // FK-soft (no constraint) to leads.id; nullable since lead may not exist yet
  channelOrigin: text("channel_origin"), // 'widget' | 'whatsapp' | 'instagram' | 'facebook' | 'other'
  providerMessageId: text("provider_message_id"), // ID returned by SMS provider for last send
  failureReason: text("failure_reason"), // e.g. 'wrong_code', 'expired', 'send_failed'
  invalidatedAt: timestamp("invalidated_at"), // set when this challenge is force-invalidated
  // Delivery channel for this OTP send (Task #3). 'sms' | 'whatsapp'. Nullable
  // for backward compatibility — legacy rows pre-dating WhatsApp OTP are SMS.
  deliveryChannel: text("delivery_channel"),
  phoneE164: text("phone_e164").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  resendCount: integer("resend_count").notNull().default(0),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at"),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  convIdx: index("otp_challenges_business_conv_idx").on(table.businessAccountId, table.conversationId, table.createdAt),
  phoneIdx: index("otp_challenges_business_phone_idx").on(table.businessAccountId, table.phoneE164, table.createdAt),
}));

// Password reset tokens table
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").references(() => businessAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Chat"),
  visitorCity: text("visitor_city"),
  visitorToken: text("visitor_token"), // Token to identify the visitor for conversation history filtering
  isInternalTest: text("is_internal_test").notNull().default("false"), // 'true' | 'false' - Conversations started by business users testing their own chatbot
  category: text("category"), // AI-detected conversation topic (dynamic, business-context-aware)
  subcategory: text("subcategory"), // AI-detected specific subtopic within the category
  categoryConfidence: numeric("category_confidence", { precision: 5, scale: 2 }), // AI confidence score 0-100
  relevance: text("relevance"), // AI-determined: 'relevant' or 'irrelevant' to the business
  summary: text("summary"),
  topicKeywords: text("topic_keywords"),
  // Task #8: timestamp of when `summary`/`topicKeywords` were last generated.
  // NULL = never summarized. The idle/close summary sweep treats a conversation
  // as having a stale summary when `summarized_at` is NULL or older than
  // `updated_at` (i.e. new messages arrived since the last summary). Nullable +
  // no default to honor the expand-only schema rule.
  summarizedAt: timestamp("summarized_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  // Task #18: when true, this conversation is pending OTP verification and
  // must NOT be counted in analytics. A background sweep hard-deletes rows
  // that never get verified. Cleared on successful OTP verify.
  awaitingVerification: boolean("awaiting_verification").notNull().default(false),
  // TopScholar curriculum handoff: cp_id binds this conversation to one board+medium+grade content package;
  // studentId/studentName come from the signed launch token for personalization and the students view.
  topscholarCpId: text("topscholar_cp_id"),
  studentId: text("student_id"),
  studentName: text("student_name"),
  // TopScholar subject-scoped sessions (Task #14): the curriculum subject this
  // conversation is bound to. One conversation per (visitor/student + subject),
  // resumable for 24h from creation, independent of chapter. NULL for every
  // non-curriculum chat (expand-only: nullable, no default). Chapter is
  // intentionally NOT stored here — switching chapters keeps the same thread.
  subject: text("subject"),
  // Coarse learner sentiment for TopScholar analytics, AI-derived best-effort and
  // backfilled by a batch enrichment job: 'positive' | 'neutral' | 'confused'.
  // NULL means not yet classified (shown as "unlabeled" in analytics).
  sentiment: text("sentiment"),
  // CAPTCHA verification outcome for the mobile-number gate (reCAPTCHA v2),
  // mutually exclusive with the OTP gate. 'verified' | 'unverified'.
  // NULL means CAPTCHA was never required/attempted for this conversation.
  captchaStatus: text("captcha_status"),
  // Conversion tracking (Google Ads): one-time dedupe marker. Set true the
  // first time a mobile number is captured/confirmed for this conversation so
  // the hidden conversion-page iframe fires exactly once (no double counting on
  // reconnect, re-render, or repeated messages). The actual URL load happens in
  // the visitor's browser — the server only flips this flag.
  conversionFired: boolean("conversion_fired").notNull().default(false),
  // TopScholar doubt-sync integration: doubtId from the signed launch token.
  // Each AI chat session is tied to one doubt on the client platform; all
  // messages are mirrored to their conversation sync API and the doubt is
  // closed when the session ends. Nullable + no default (expand-only).
  topscholarDoubtId: text("topscholar_doubt_id"),
  // StudentPlanMappingId from the signed token — stored for reference / future use.
  topscholarStudentPlanMappingId: text("topscholar_student_plan_mapping_id"),
  // PlanId from the signed token — stored for reference / plan-level reporting.
  topscholarPlanId: text("topscholar_plan_id"),
  // TopScholar retry-once escalation flow (expand-only, nullable, TopScholar-only):
  // NULL = no retry ever offered; 'attempted' = student said "not resolved" once and
  // the bot delivered its one clarify/simplify retry; 'resolved' = student confirmed
  // resolved AFTER the retry (retry success); 'escalated' = still unresolved after
  // the retry → ticket + client escalation email fired (retry failure).
  doubtRetryStatus: text("doubt_retry_status"),
}, (table) => ({
  businessCreatedIdx: index("conversations_business_created_idx").on(table.businessAccountId, table.createdAt),
  businessCategoryIdx: index("conversations_business_category_idx").on(table.businessAccountId, table.category),
  awaitingVerificationIdx: index("conversations_awaiting_verification_idx").on(table.awaitingVerification, table.updatedAt),
  // Task #8: supports the idle/close summary sweep, which scans by recency
  // (updatedAt) and compares against summarizedAt to find stale summaries.
  summarizedSweepIdx: index("conversations_summarized_sweep_idx").on(table.updatedAt, table.summarizedAt),
  businessStudentIdx: index("conversations_business_student_idx").on(table.businessAccountId, table.studentId),
}));

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  imageUrl: text("image_url"), // Optional - URL to uploaded image for visual product search
  metadata: text("metadata"), // JSON string storing product IDs and other metadata: { productIds?: string[] }
  interactionSource: text("interaction_source").notNull().default("chat"), // 'chat' | 'form' | 'journey' - which interaction type generated this message
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  conversationCreatedIdx: index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
}));

// Uploaded images for visual search tracking
export const uploadedImages = pgTable("uploaded_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(), // Full URL to the image (R2 or local)
  processedImageUrl: text("processed_image_url"), // DEPRECATED: Single processed image URL (kept for backwards compatibility)
  processedImages: text("processed_images"), // JSON array of processed images: [{label: string, dataUrl: string}]
  r2Key: text("r2_key"), // R2 storage key for deletion (null if local)
  originalFilename: text("original_filename"), // Original filename from upload
  fileSize: integer("file_size"), // File size in bytes
  source: text("source").notNull().default("visual_search"), // 'visual_search' | 'chat' | 'other'
  matchedProducts: text("matched_products"), // JSON array of matched products with similarity scores
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }),
  imageUrl: text("image_url"),
  croppedJewelryUrl: text("cropped_jewelry_url"), // AI-cropped image focusing only on the jewelry (no mannequin/background)
  detectedJewelryType: text("detected_jewelry_type"), // AI-detected jewelry type (necklace, earring, bangle, etc.)
  source: text("source").notNull().default("manual"), // 'manual' | 'shopify'
  shopifyProductId: text("shopify_product_id"), // Original Shopify product ID
  shopifyLastSyncedAt: timestamp("shopify_last_synced_at"), // When last synced from Shopify
  isEditable: text("is_editable").notNull().default("true"), // 'true' | 'false' - Whether user can edit this product
  visualDescription: text("visual_description"), // AI-generated visual description of product image
  imageEmbedding: vector768("image_embedding"), // Vector embedding for visual similarity search using Jina CLIP (768 dimensions) - stores CROPPED jewelry embedding when jewelry detection is enabled
  fullImageEmbedding: vector768("full_image_embedding"), // Vector embedding of the FULL original product image (uncropped) for exact match detection
  imageHash: text("image_hash"), // Perceptual hash (pHash) for exact image matching - 16 char hex string
  visionWarehouseAssetId: text("vision_warehouse_asset_id"), // Google Vision Warehouse asset ID for visual search
  visionWarehouseSyncedAt: timestamp("vision_warehouse_synced_at"), // When last synced to Vision Warehouse
  productSearchProductId: text("product_search_product_id"), // Google Product Search product ID (format: projects/{project}/locations/{location}/products/{product_id})
  productSearchSyncedAt: timestamp("product_search_synced_at"), // When last synced to Product Search
  textEmbedding: vector1536("text_embedding"), // Vector embedding for semantic product search using OpenAI text-embedding-3-small (1536 dimensions) - generated from title + description
  textEmbeddingGeneratedAt: timestamp("text_embedding_generated_at"), // When text embedding was last generated
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessUpdatedIdx: index("products_business_updated_idx").on(table.businessAccountId, table.updatedAt),
}));

// Product Jewelry Embeddings - Store multiple jewelry item embeddings per product
// When a product image contains multiple jewelry items (necklace + earrings + bangles),
// each item gets its own embedding for better visual search matching
export const productJewelryEmbeddings = pgTable("product_jewelry_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Jewelry item details
  jewelryType: text("jewelry_type").notNull(), // 'necklace' | 'earring-pair' | 'bangle' | 'ring' | 'pendant' | etc.
  confidence: numeric("confidence", { precision: 5, scale: 4 }), // Detection confidence (0-1)
  
  // Cropped image data
  croppedImageUrl: text("cropped_image_url"), // URL or data URL of cropped jewelry image
  processedImageUrl: text("processed_image_url"), // Background-removed version of cropped image (cached to skip redundant processing)
  boundingBox: jsonb("bounding_box"), // { x, y, width, height } - location in original image
  
  // Embedding data
  embedding: vector768("embedding"), // Vector embedding for visual similarity search using Jina CLIP (768 dimensions)
  
  // AI-generated description for text-based similarity matching
  description: text("description"), // Detailed AI description of the jewelry item (e.g., "Yellow gold necklace with kundan work, red enamel medallions, floral motifs")
  descriptionEmbedding: vector1536("description_embedding"), // Text embedding of description for semantic matching using OpenAI text-embedding-3-small
  
  // Structured attributes for attribute-based matching
  attributes: jsonb("attributes").$type<{
    metalType?: string; // yellow gold, white gold, rose gold, silver, platinum, mixed
    finish?: string; // polished, matte, antique, oxidized, textured
    designComplexity?: string; // minimal, moderate, elaborate, intricate
    style?: string; // traditional, contemporary, fusion, temple, kundan, meenakari
    hasStones?: boolean;
    stoneTypes?: string[]; // diamond, ruby, emerald, pearl, kundan, polki, cz, meenakari
    stoneColors?: string[]; // red, green, blue, white, pink, multicolor
    stoneSetting?: string; // prong, bezel, pave, channel, kundan, none
    dangleElements?: string; // none, few, moderate, many
    layers?: string; // single, double, multi-tier
    motifs?: string[]; // floral, paisley, coin, temple, geometric, leaf, peacock, elephant
    centerpiece?: string; // none, small pendant, large medallion, elaborate focal
    edgeStyle?: string; // smooth, scalloped, beaded, fringed
    // Type-specific attributes
    necklineStyle?: string; // choker, collar, princess, matinee, opera (for necklaces)
    earringStyle?: string; // stud, jhumka, chandbali, hoop, drop, chandelier (for earrings)
    bangleStyle?: string; // solid, openable, kada, thin stack (for bangles)
    ringProfile?: string; // openwork, solid-face, solitaire, halo, band (for rings)
    ringFaceShape?: string; // star, petal, flower, round, oval, rectangular, square, heart, geometric, irregular (for rings)
  }>(),
  
  // Metadata
  isPrimary: text("is_primary").notNull().default("false"), // 'true' | 'false' - Is this the primary/largest item
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Index for fast lookup by product
  productIdx: index("product_jewelry_embeddings_product_idx").on(table.productId),
  // Index for fast lookup by business account
  businessIdx: index("product_jewelry_embeddings_business_idx").on(table.businessAccountId),
  // Note: Vector embedding index should be created with HNSW (not btree) via raw SQL for similarity search
  // Index for filtering by jewelry type
  typeIdx: index("product_jewelry_embeddings_type_idx").on(table.jewelryType),
}));

export const faqs = pgTable("faqs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category"),
  embedding: vector1536("embedding"), // Vector embedding for semantic search using OpenAI (1536 dimensions)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdx: index("faqs_business_idx").on(table.businessAccountId),
}));

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name"), // Optional - customer may not provide name
  email: text("email"), // Optional - customer may provide only phone
  phone: text("phone"), // Optional - customer may provide only email
  message: text("message"),
  city: text("city"), // Visitor city from IP geolocation
  sourceUrl: text("source_url"), // Page URL where the lead was captured
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  topicsOfInterest: jsonb("topics_of_interest").$type<string[]>(), // AI-extracted topics from conversation (3-4 labels)
  
  // LeadSquared CRM sync tracking
  leadsquaredSyncStatus: text("leadsquared_sync_status"), // null | 'pending' | 'synced' | 'failed' | 'disqualified' (terminal: lead form answer did not match configured qualifying values)
  leadsquaredSyncedAt: timestamp("leadsquared_synced_at"), // When was it synced to LeadSquared
  leadsquaredLeadId: text("leadsquared_lead_id"), // LeadSquared's lead ID after successful sync
  leadsquaredSyncError: text("leadsquared_sync_error"), // Error message if sync failed
  leadsquaredSyncPayload: jsonb("leadsquared_sync_payload"), // Actual payload sent to LeadSquared (for debugging)
  leadsquaredRetryCount: numeric("leadsquared_retry_count", { precision: 2, scale: 0 }).default("0"), // Number of retry attempts (max 3)
  leadsquaredNextRetryAt: timestamp("leadsquared_next_retry_at"), // When to next retry the sync

  // Salesforce CRM sync tracking
  salesforceSyncStatus: text("salesforce_sync_status"), // null | 'synced' | 'failed'
  salesforceSyncedAt: timestamp("salesforce_synced_at"),
  salesforceLeadId: text("salesforce_lead_id"),
  salesforceSyncError: text("salesforce_sync_error"),

  // Custom CRM sync tracking
  customCrmSyncStatus: text("custom_crm_sync_status"),
  customCrmSyncedAt: timestamp("custom_crm_synced_at"),
  customCrmLeadId: text("custom_crm_lead_id"),
  customCrmSyncError: text("custom_crm_sync_error"),
  customCrmSyncPayload: jsonb("custom_crm_sync_payload"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessCreatedIdx: index("leads_business_created_idx").on(table.businessAccountId, table.createdAt),
}));

// Question Bank - Track questions/issues that AI couldn't handle or answer properly
export const questionBankEntries = pgTable("question_bank_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }), // Optional - may be manually added
  messageId: varchar("message_id").references(() => messages.id, { onDelete: "set null" }), // Optional - may be manually added
  question: text("question").notNull(), // The actual question user asked
  aiResponse: text("ai_response"), // What AI attempted to answer
  userContext: text("user_context"), // Additional context (products mentioned, intent, etc.) as JSON
  status: text("status").notNull().default("new"), // 'new' | 'reviewing' | 'resolved'
  category: text("category"), // Optional tags for grouping (e.g., "pricing", "features", "technical")
  confidenceScore: numeric("confidence_score", { precision: 3, scale: 2 }), // 0.00-1.00 confidence score from AI
  notes: text("notes"), // Business user notes/comments
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const widgetSettings = pgTable("widget_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  chatColor: text("chat_color").notNull().default("#9333ea"), // Start color for gradient
  chatColorEnd: text("chat_color_end").notNull().default("#3b82f6"), // End color for gradient
  widgetHeaderText: text("widget_header_text").notNull().default("Hi Chroney"), // Customizable header text
  welcomeMessageType: text("welcome_message_type").notNull().default("custom"), // 'custom' | 'ai_generated'
  welcomeMessage: text("welcome_message").notNull().default("Hi! How can I help you today?"),
  buttonStyle: text("button_style").notNull().default("circular"), // 'circular' | 'rounded' | 'pill' | 'minimal'
  buttonAnimation: text("button_animation").notNull().default("pulse"), // 'pulse' | 'bounce' | 'glow' | 'none'
  personality: text("personality").notNull().default("friendly"), // 'friendly' | 'professional' | 'funny' | 'polite' | 'casual'
  currency: text("currency").notNull().default("USD"),
  customInstructions: text("custom_instructions"), // Natural language instructions for customizing Chroney's behavior
  cachedIntro: text("cached_intro"), // Cached AI-generated intro message to avoid regenerating on every page load
  appointmentBookingEnabled: text("appointment_booking_enabled").notNull().default("true"), // 'true' | 'false' - Master toggle for appointment booking feature
  appointmentSuggestRules: jsonb("appointment_suggest_rules"), // Array of trigger rules: [{id, keywords: string[], prompt: string, enabled: boolean}] - when keywords detected, AI uses prompt to suggest booking
  shopifyStoreUrl: text("shopify_store_url"), // e.g., "mystore.myshopify.com"
  shopifyAccessToken: text("shopify_access_token"), // OAuth access token (encrypted)
  shopifyClientId: text("shopify_client_id"), // OAuth Client ID from Shopify Partner Dashboard
  shopifyClientSecret: text("shopify_client_secret"), // OAuth Client Secret (encrypted)
  shopifyOAuthState: text("shopify_oauth_state"), // CSRF protection state for OAuth flow
  shopifyOAuthStateExpiry: timestamp("shopify_oauth_state_expiry"), // When the OAuth state expires
  twilioAccountSid: text("twilio_account_sid"), // Twilio Account SID for WhatsApp
  twilioAuthToken: text("twilio_auth_token"), // Twilio Auth Token for WhatsApp
  twilioWhatsappFrom: text("twilio_whatsapp_from"), // Twilio WhatsApp number (e.g., whatsapp:+14155238886)
  
  // Widget size customization
  widgetWidth: numeric("widget_width", { precision: 5, scale: 0 }).notNull().default("400"), // Widget width in pixels
  widgetHeight: numeric("widget_height", { precision: 5, scale: 0 }).notNull().default("600"), // Widget height in pixels
  widgetPosition: text("widget_position").notNull().default("bottom-right"), // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  bubbleSize: numeric("bubble_size", { precision: 3, scale: 0 }).notNull().default("60"), // Chat bubble button size in pixels
  sizePreset: text("size_preset").notNull().default("medium"), // 'small' | 'medium' | 'large' | 'custom'
  pillBottomOffset: numeric("pill_bottom_offset", { precision: 4, scale: 0 }).notNull().default("20"), // Bottom offset in pixels for pill/launcher
  pillSideOffset: numeric("pill_side_offset", { precision: 4, scale: 0 }).notNull().default("20"), // Side offset in pixels for pill/launcher
  
  // AI Response Length
  responseLength: text("response_length").notNull().default("balanced"), // 'concise' | 'balanced' | 'detailed' - Controls AI response verbosity

  // Chat message font size
  chatFontSize: text("chat_font_size").notNull().default("medium"), // 'small' | 'medium' | 'large' - Font size of chat message text in the embedded widget

  // Footer Label
  footerLabelEnabled: text("footer_label_enabled").notNull().default("false"), // 'true' | 'false'
  footerLabelText: text("footer_label_text").notNull().default("AI may make mistakes"),
  poweredByEnabled: text("powered_by_enabled").notNull().default("true"), // 'true' | 'false'
  
  // Widget behavior
  autoOpenChat: text("auto_open_chat").notNull().default("false"), // 'off' | 'desktop' | 'mobile' | 'both' - Auto-open chat on page load
  autoOpenFrequency: text("auto_open_frequency").notNull().default("once"), // 'once' | 'always' - How often to auto-open: once per visitor or every page load
  openingSoundEnabled: text("opening_sound_enabled").notNull().default("true"), // 'true' | 'false' - Play AI activation sound when chat opens
  openingSoundStyle: text("opening_sound_style").notNull().default("chime"), // 'chime' | 'bell' | 'pop' - Sound style for AI activation
  
  // Lead training configuration (for Train Chroney page)
  leadTrainingConfig: jsonb("lead_training_config"), // Smart lead capture configuration: {fields: [{id, enabled, required, priority, captureStrategy}]} - each field has own timing strategy: 'smart'|'start'|'end'

  // CAPTCHA (reCAPTCHA v2) secret key, AES-256-GCM encrypted (iv:authTag:cipher).
  // The public site key + provider + enabled toggle live in leadTrainingConfig
  // (mobile field). This is the sensitive server-side secret used for siteverify.
  // NEVER spread into public/widget responses.
  captchaSecretKeyEnc: text("captcha_secret_key_enc"),
  
  // Avatar customization
  avatarType: text("avatar_type").notNull().default("none"), // 'none' | 'preset-female-1' | 'preset-female-2' | 'preset-female-3' | 'preset-male-1' | 'preset-male-2' | 'preset-male-3' | 'custom'
  avatarUrl: text("avatar_url"), // Custom avatar URL (only used when avatarType is 'custom')
  customAvatars: jsonb("custom_avatars"), // Array of custom avatar URLs: [{url: string, uploadedAt: string}]
  
  // Voice Mode customization
  voiceSelection: text("voice_selection").notNull().default("shimmer"), // 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' - OpenAI Realtime API voices
  voiceModeStyle: text("voice_mode_style").notNull().default("circular"), // 'circular' | 'morphing' | 'distorted' | 'angular' - Voice orb shape style
  chatMode: text("chat_mode").notNull().default("both"), // 'both' | 'chat-only' | 'voice-only' - Which modes are available in embedded widget
  
  // AI Conversation Starters
  conversationStarters: text("conversation_starters"), // JSON array of 3-5 suggested questions to help users start conversations ["Question 1?", "Question 2?", ...]
  conversationStartersEnabled: text("conversation_starters_enabled").notNull().default("true"), // 'true' | 'false' - Show/hide conversation starters in chat interface
  showStartersOnPill: text("show_starters_on_pill").notNull().default("false"), // 'true' | 'false' - Show conversation starters floating above the chat pill when chat is inactive
  
  // Nudge settings
  inactivityNudgeEnabled: text("inactivity_nudge_enabled").notNull().default("true"), // 'true' | 'false' - Show nudge if visitor is inactive during conversation
  inactivityNudgeDelay: numeric("inactivity_nudge_delay", { precision: 5, scale: 0 }).notNull().default("45"), // Delay in seconds before showing inactivity nudge
  inactivityNudgeMessage: text("inactivity_nudge_message").notNull().default("Still there? Let me know if you need any help!"), // Message to show for inactivity nudge (legacy, single message)
  inactivityNudgeMessages: jsonb("inactivity_nudge_messages"), // Array of sequential messages: [{message: string, delay: number}] - delay is seconds to wait before showing this message
  smartNudgeEnabled: text("smart_nudge_enabled").notNull().default("false"), // 'true' | 'false' - Use AI to generate contextual follow-up questions instead of static messages
  proactiveNudgeEnabled: text("proactive_nudge_enabled").notNull().default("true"), // 'true' | 'false' - Show nudge to visitors who haven't started chatting
  proactiveNudgeDelay: numeric("proactive_nudge_delay", { precision: 5, scale: 0 }).notNull().default("15"), // Delay in seconds before showing first proactive nudge
  proactiveNudgeMessage: text("proactive_nudge_message").notNull().default("Need help finding something? I'm here to assist!"), // Message to show for proactive nudge (legacy, single message)
  proactiveNudgeMessages: jsonb("proactive_nudge_messages"), // Array of sequential messages: [{message: string, delay: number}] - delay is seconds to wait before showing this message
  proactiveNudgeRepeat: text("proactive_nudge_repeat").notNull().default("false"), // 'true' | 'false' - Show popup on every page load vs once per session
  proactiveNudgeBgColor: text("proactive_nudge_bg_color").notNull().default("#ffffff"),
  proactiveNudgeBgColorEnd: text("proactive_nudge_bg_color_end").notNull().default("#ffffff"),
  proactiveNudgeTextColor: text("proactive_nudge_text_color").notNull().default("#1f2937"),
  
  // Center Banner settings - personalized popup that opens in center of screen
  centerBannerEnabled: text("center_banner_enabled").notNull().default("false"), // 'true' | 'false' - Enable/disable center banner
  centerBannerDelay: numeric("center_banner_delay", { precision: 5, scale: 0 }).notNull().default("10"), // Delay in seconds before showing banner
  centerBannerTitle: text("center_banner_title").notNull().default("Need Help?"), // Main headline for the banner
  centerBannerDescription: text("center_banner_description").notNull().default("Let me help you find exactly what you're looking for."), // Description text
  centerBannerButtonText: text("center_banner_button_text").notNull().default("Start Chat"), // CTA button text
  centerBannerShowOnce: text("center_banner_show_once").notNull().default("true"), // 'true' | 'false' - Show only once per session vs every page load
  centerBannerBackgroundStyle: text("center_banner_background_style").notNull().default("gradient"), // 'gradient' | 'image'
  centerBannerStartColor: text("center_banner_start_color").notNull().default("#9333ea"), // Gradient start color
  centerBannerEndColor: text("center_banner_end_color").notNull().default("#3b82f6"), // Gradient end color
  centerBannerTextColor: text("center_banner_text_color").notNull().default("white"), // 'white' | 'black' - Text color for readability
  centerBannerImageUrl: text("center_banner_image_url"), // Optional background image URL (for 'image' style)
  
  // Re-engagement Banner settings - second banner that shows if user dismisses first banner and continues browsing
  reengagementBannerEnabled: text("reengagement_banner_enabled").notNull().default("false"), // 'true' | 'false' - Enable re-engagement after first banner dismissal
  reengagementBannerDelay: numeric("reengagement_banner_delay", { precision: 5, scale: 0 }).notNull().default("60"), // Delay in seconds after first banner dismissal
  reengagementBannerTitle: text("reengagement_banner_title").notNull().default("Still looking around?"), // Main headline for re-engagement
  reengagementBannerDescription: text("reengagement_banner_description").notNull().default("I'm here whenever you're ready to chat!"), // Description text
  reengagementBannerButtonText: text("reengagement_banner_button_text").notNull().default("Chat Now"), // CTA button text
  
  // LeadSquared CRM Integration
  leadsquaredAccessKey: text("leadsquared_access_key"), // LeadSquared API Access Key
  leadsquaredSecretKey: text("leadsquared_secret_key"), // LeadSquared API Secret Key (encrypted)
  leadsquaredRegion: text("leadsquared_region"), // 'india' | 'us' | 'other'
  leadsquaredCustomHost: text("leadsquared_custom_host"), // Custom API host for 'other' region
  leadsquaredEnabled: text("leadsquared_enabled").notNull().default("false"), // 'true' | 'false' - Auto-sync leads to LeadSquared

  // Salesforce CRM Integration
  salesforceEnabled: text("salesforce_enabled").notNull().default("false"), // 'true' | 'false'
  salesforceClientId: text("salesforce_client_id"), // Consumer Key from Connected App
  salesforceClientSecret: text("salesforce_client_secret"), // Consumer Secret (encrypted)
  salesforceUsername: text("salesforce_username"),
  salesforcePassword: text("salesforce_password"), // Password + Security Token (encrypted)
  salesforceEnvironment: text("salesforce_environment").default("production"), // 'production' | 'sandbox'
  salesforceInstanceUrl: text("salesforce_instance_url"), // Stored after successful auth

  // LeadSquared AI URL Extraction Config
  lsqExtractionDomain: text("lsq_extraction_domain"), // Domain to restrict extraction to, e.g. "jaroeducation.com"
  lsqExtractionUniversities: text("lsq_extraction_universities"), // Newline-separated list of valid university names
  lsqExtractionProducts: text("lsq_extraction_products"), // Newline-separated list of valid product/course names
  lsqExtractionFallbackUniversity: text("lsq_extraction_fallback_university").default("Any"), // Fallback university when no match
  lsqExtractionFallbackProduct: text("lsq_extraction_fallback_product").default("All Product"), // Fallback product when no match
  
  // Language Selector Configuration
  languageSelectorEnabled: text("language_selector_enabled").notNull().default("true"), // 'true' | 'false' - Show language selector in widget header
  availableLanguages: text("available_languages").notNull().default('["auto","en","hi","hinglish","ta","te","kn","mr","bn","gu","ml","pa","or","as","ur","ne","es","fr","de","pt","it","ja","ko","zh","ar","ru","th","vi","id","ms","tr"]'), // JSON array of all 31 language codes - all selected by default
  
  // Visual Product Search Configuration
  visualSimilarityThreshold: numeric("visual_similarity_threshold", { precision: 3, scale: 0 }).notNull().default("50"), // Minimum similarity % to show product matches (0-100)
  
  // Visual Search Matching Thresholds (configurable in Settings)
  clipSimilarityThreshold: numeric("clip_similarity_threshold", { precision: 3, scale: 0 }).notNull().default("70"), // CLIP visual similarity threshold % (0-100)
  descriptionSimilarityThreshold: numeric("description_similarity_threshold", { precision: 3, scale: 0 }).notNull().default("50"), // Description similarity threshold % (0-100)
  attributeSimilarityThreshold: numeric("attribute_similarity_threshold", { precision: 3, scale: 0 }).notNull().default("60"), // Attribute match threshold % (0-100)
  
  // Match Quality Range Thresholds (configurable in Settings)
  perfectMatchThreshold: numeric("perfect_match_threshold", { precision: 3, scale: 0 }).notNull().default("96"), // Perfect Match minimum % (0-100)
  verySimilarThreshold: numeric("very_similar_threshold", { precision: 3, scale: 0 }).notNull().default("85"), // Very Similar minimum % (0-100)
  somewhatSimilarThreshold: numeric("somewhat_similar_threshold", { precision: 3, scale: 0 }).notNull().default("70"), // Somewhat Similar minimum % (0-100)
  showMatchPercentage: text("show_match_percentage").notNull().default("false"), // 'true' | 'false' - Show percentage instead of labels (Perfect Match, Very Similar)
  
  // Jewelry Showcase Customization
  showcaseLogo: text("showcase_logo"), // Custom brand logo URL for Jewelry Showcase
  showcaseThemeColor: text("showcase_theme_color").notNull().default("#9333ea"), // Primary theme color for Jewelry Showcase
  showcaseThemePreset: text("showcase_theme_preset").notNull().default("noir_luxe"), // 'noir_luxe' | 'champagne_glow' | 'amethyst_aurora' | 'custom'
  
  // Background Removal for Visual Search
  backgroundRemovalEnabled: text("background_removal_enabled").notNull().default("false"), // 'true' | 'false' - Remove background from uploaded images before CLIP embedding for better matching
  
  // Product Page AI Widget Mode
  productPageModeEnabled: text("product_page_mode_enabled").notNull().default("false"), // 'true' | 'false' - Enable AI widget on product pages
  showAiTrivia: text("show_ai_trivia").notNull().default("true"), // 'true' | 'false' - Show AI-generated fun product facts
  showSuggestedQuestions: text("show_suggested_questions").notNull().default("true"), // 'true' | 'false' - Show floating question bubbles
  showReviewSummary: text("show_review_summary").notNull().default("true"), // 'true' | 'false' - Show "Summarize reviews" button
  
  // Product Carousel in Welcome
  productCarouselEnabled: text("product_carousel_enabled").notNull().default("false"), // 'true' | 'false' - Show featured products carousel after welcome message
  featuredProductIds: jsonb("featured_product_ids"), // JSON array of product IDs to feature, or null for auto-select
  productCarouselTitle: text("product_carousel_title").notNull().default("Featured Products"), // Title above the carousel
  
  // Quick Browse Buttons
  quickBrowseEnabled: text("quick_browse_enabled").notNull().default("false"), // 'true' | 'false' - Show quick action buttons below welcome
  quickBrowseButtons: jsonb("quick_browse_buttons"), // JSON array: [{label: string, action: string}] - action is the query to send to AI
  
  // Product Comparison
  productComparisonEnabled: text("product_comparison_enabled").notNull().default("false"), // 'true' | 'false' - Enable compare feature on product cards
  
  // WhatsApp Order Button
  whatsappOrderEnabled: text("whatsapp_order_enabled").notNull().default("false"), // 'true' | 'false' - Show WhatsApp order button on products
  whatsappOrderNumber: text("whatsapp_order_number"), // WhatsApp number with country code (e.g., +919876543210)
  whatsappOrderMessage: text("whatsapp_order_message").notNull().default("Hi! I'm interested in ordering: {product_name} - {product_price}"), // Pre-filled message template
  
  // WhatsApp Widget Launcher — controls which launcher(s) appear on the embedded widget.
  // 'ai' (default) shows only the AI chat bubble; 'whatsapp' shows only a WhatsApp click-to-chat launcher;
  // 'both' shows them stacked (WhatsApp above the AI bubble).
  launcherMode: text("launcher_mode").notNull().default("ai"), // 'ai' | 'whatsapp' | 'both'
  whatsappWidgetNumber: text("whatsapp_widget_number"), // WhatsApp number with country code for click-to-chat (e.g., +919876543210)
  whatsappWidgetLabel: text("whatsapp_widget_label").notNull().default("How can I help you?"), // Text shown on the WhatsApp-only pill launcher
  whatsappWidgetMessage: text("whatsapp_widget_message"), // Optional pre-filled message for the WhatsApp chat
  whatsappWidgetColor: text("whatsapp_widget_color").notNull().default("#25D366"), // WhatsApp launcher background color
  whatsappWidgetPosition: text("whatsapp_widget_position"), // Corner for the WhatsApp launcher: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'. Null/empty = inherit the chat widget's position.
  
  // Add to Cart Button
  addToCartEnabled: text("add_to_cart_enabled").notNull().default("false"), // 'true' | 'false' - Show Add to Cart button on products
  
  // Virtual Try-On
  tryOnEnabled: text("try_on_enabled").notNull().default("false"), // 'true' | 'false' - Show Try On button on products for AI virtual try-on
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const websiteAnalysis = pgTable("website_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  websiteUrl: text("website_url").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'analyzing' | 'completed' | 'failed'
  analyzedContent: text("analyzed_content"), // Structured JSON with extracted business information
  errorMessage: text("error_message"), // Store error if analysis fails
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const analyzedPages = pgTable("analyzed_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  pageUrl: text("page_url").notNull(),
  extractedContent: text("extracted_content"),
  analyzedAt: timestamp("analyzed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Training Documents - PDF uploads for AI knowledge base
export const trainingDocuments = pgTable("training_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileSize: numeric("file_size", { precision: 10, scale: 0 }).notNull(), // File size in bytes
  storageKey: text("storage_key").notNull(), // Path to stored file
  uploadStatus: text("upload_status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  extractedText: text("extracted_text"), // Full text extracted from PDF
  summary: text("summary"), // AI-generated summary
  keyPoints: text("key_points"), // AI-generated key points as JSON array
  errorMessage: text("error_message"), // Error details if processing fails
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  processedAt: timestamp("processed_at"),
  embeddingStatus: text("embedding_status").default("not_started"), // 'not_started' | 'processing' | 'completed' | 'failed'
  embeddedChunkCount: numeric("embedded_chunk_count", { precision: 10, scale: 0 }).default("0"), // Number of chunks embedded
  embeddedAt: timestamp("embedded_at"), // When embedding completed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdx: index("training_documents_business_idx").on(table.businessAccountId),
}));

// Document chunks for RAG (Retrieval-Augmented Generation)
export const documentChunks = pgTable("document_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trainingDocumentId: varchar("training_document_id").notNull().references(() => trainingDocuments.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  chunkText: text("chunk_text").notNull(), // The actual text chunk (500-1000 chars)
  chunkIndex: integer("chunk_index").notNull(), // Order of chunks in the document
  embedding: vector1536("embedding"), // Vector embedding for semantic search using OpenAI (1536 dimensions)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  documentIdx: index("document_chunks_document_idx").on(table.trainingDocumentId),
  businessIdx: index("document_chunks_business_idx").on(table.businessAccountId),
}));

// URL Training - External URLs for knowledge base training (similar to PDF training but for web pages)
export const trainedUrls = pgTable("trained_urls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"), // Page title extracted from URL
  description: text("description"), // User-provided description or extracted meta description
  extractedText: text("extracted_text"), // Full text extracted from the page
  summary: text("summary"), // AI-generated summary
  keyPoints: text("key_points"), // AI-generated key points as JSON array
  status: text("status").notNull().default("pending"), // 'pending' | 'crawling' | 'processing' | 'completed' | 'failed'
  embeddingStatus: text("embedding_status").default("not_started"), // 'not_started' | 'processing' | 'completed' | 'failed'
  embeddedChunkCount: numeric("embedded_chunk_count", { precision: 10, scale: 0 }).default("0"),
  errorMessage: text("error_message"),
  addedBy: varchar("added_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  crawledAt: timestamp("crawled_at"),
  processedAt: timestamp("processed_at"),
  embeddedAt: timestamp("embedded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdx: index("trained_urls_business_idx").on(table.businessAccountId),
  urlIdx: index("trained_urls_url_idx").on(table.url),
}));

// URL content chunks for RAG - chunked content from trained URLs
export const urlContentChunks = pgTable("url_content_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trainedUrlId: varchar("trained_url_id").notNull().references(() => trainedUrls.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  chunkText: text("chunk_text").notNull(), // The actual text chunk (500-1000 chars)
  chunkIndex: integer("chunk_index").notNull(), // Order of chunks in the document
  embedding: vector1536("embedding"), // Vector embedding for semantic search
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  urlIdx: index("url_content_chunks_url_idx").on(table.trainedUrlId),
  businessIdx: index("url_content_chunks_business_idx").on(table.businessAccountId),
}));

// Product Categories - Hierarchical categories for organizing products
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  parentCategoryId: varchar("parent_category_id").references((): any => categories.id, { onDelete: "cascade" }), // Self-referencing for hierarchy
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Product Tags - Flexible labels for products
export const tags = pgTable("tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#3b82f6"), // Optional color for visual organization
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Junction table: Products <-> Categories (many-to-many)
export const productCategories = pgTable("product_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Junction table: Products <-> Tags (many-to-many)
export const productTags = pgTable("product_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Product Relationships - Cross-sell, similar products, bundles, complements
export const productRelationships = pgTable("product_relationships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  sourceProductId: varchar("source_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  targetProductId: varchar("target_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").notNull(), // 'cross_sell' | 'similar' | 'complement' | 'bundle'
  weight: numeric("weight", { precision: 3, scale: 2 }).default("1.00"), // Priority/strength of relationship (0-1)
  notes: text("notes"), // Optional notes about the relationship
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Appointment System Tables

// Weekly schedule template - recurring availability hours
export const scheduleTemplates = pgTable("schedule_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  dayOfWeek: numeric("day_of_week", { precision: 1, scale: 0 }).notNull(), // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: text("start_time").notNull(), // "09:00" (24-hour format)
  endTime: text("end_time").notNull(), // "17:00" (24-hour format)
  slotDurationMinutes: numeric("slot_duration_minutes", { precision: 3, scale: 0 }).notNull().default("30"), // Default 30-minute slots
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Slot overrides - add or block specific time slots
export const slotOverrides = pgTable("slot_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  slotDate: timestamp("slot_date").notNull(), // Specific date for this override
  slotTime: text("slot_time").notNull(), // "14:00" (24-hour format)
  durationMinutes: numeric("duration_minutes", { precision: 3, scale: 0 }).notNull().default("30"),
  isAvailable: text("is_available").notNull().default("true"), // 'true' = add slot, 'false' = block slot
  isAllDay: text("is_all_day").notNull().default("false"), // 'true' = block entire day, 'false' = specific time slot
  reason: text("reason"), // "Lunch break", "Extended hours", "Staff meeting", "Holiday", etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Appointments - booked time slots
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  leadId: varchar("lead_id").references(() => leads.id, { onDelete: "set null" }),
  
  // Patient information
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone").notNull(),
  patientEmail: text("patient_email"),
  
  // Appointment timing
  appointmentDate: timestamp("appointment_date").notNull(),
  appointmentTime: text("appointment_time").notNull(), // "14:00" (24-hour format)
  durationMinutes: numeric("duration_minutes", { precision: 3, scale: 0 }).notNull().default("30"),
  
  // Status and metadata
  status: text("status").notNull().default("confirmed"), // 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'rescheduled'
  notes: text("notes"), // Patient's reason for visit or special requests
  cancellationReason: text("cancellation_reason"),
  reminderSentAt: timestamp("reminder_sent_at"), // When reminder was sent
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Demo Pages - SuperAdmin shareable demo pages with embedded chat widget
export const demoPages = pgTable("demo_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(), // Unique token for public shareable link
  title: text("title"), // Optional custom title for the demo
  description: text("description"), // Optional description
  appearance: text("appearance"), // JSON for optional theme overrides: { accentColor, heroImageUrl, sectionsVisibility }
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false'
  expiresAt: timestamp("expires_at"), // Optional expiry date for the demo page
  lastViewedAt: timestamp("last_viewed_at"), // Track when demo was last accessed
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }), // SuperAdmin who created it
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Public Chat Links - Business users' shareable public chat links
export const publicChatLinks = pgTable("public_chat_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }), // One link per business account
  token: text("token").notNull().unique(), // Unique token for public shareable link
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false' - Enable/disable the link
  password: text("password"), // Optional password for protected access
  lastAccessedAt: timestamp("last_accessed_at"), // Track when link was last used
  accessCount: numeric("access_count", { precision: 10, scale: 0 }).notNull().default("0"), // Number of times accessed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Support Tickets System Tables

// Support Tickets - Main ticket management table
export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  ticketNumber: numeric("ticket_number", { precision: 10, scale: 0 }).notNull(), // Sequential ticket number for easy reference
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }), // Optional link to original conversation
  
  // Customer information
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  
  // Ticket details
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  
  // Status and priority
  status: text("status").notNull().default("open"), // 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
  priority: text("priority").notNull().default("medium"), // 'low' | 'medium' | 'high' | 'urgent'
  category: text("category").notNull().default("general"), // 'technical' | 'billing' | 'feature_request' | 'bug_report' | 'complaint' | 'general'
  
  // AI-powered features
  aiPriority: text("ai_priority"), // AI-suggested priority
  aiCategory: text("ai_category"), // AI-suggested category
  sentimentScore: numeric("sentiment_score", { precision: 3, scale: 2 }), // -1.00 to 1.00 (negative to positive)
  emotionalState: text("emotional_state"), // 'happy' | 'neutral' | 'frustrated' | 'angry'
  churnRisk: text("churn_risk").notNull().default("low"), // 'low' | 'medium' | 'high' | 'critical'
  aiAnalysis: text("ai_analysis"), // JSON with AI insights, keywords, suggested actions
  aiDraftedResponse: text("ai_drafted_response"), // AI-generated suggested response
  
  // Auto-resolution tracking
  autoResolved: text("auto_resolved").notNull().default("false"), // 'true' | 'false' - Whether AI resolved without human intervention
  autoResolvedAt: timestamp("auto_resolved_at"),
  autoResolutionSummary: text("auto_resolution_summary"), // Summary of how AI resolved the issue
  
  // Assignment and workflow
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }), // Optional assignment to team member
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  
  // Customer satisfaction
  customerRating: numeric("customer_rating", { precision: 1, scale: 0 }), // 1-5 star rating
  customerFeedback: text("customer_feedback"), // Optional feedback from customer
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Ticket Messages - Conversation thread for each ticket
export const ticketMessages = pgTable("ticket_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  
  // Sender information
  senderId: varchar("sender_id"), // User ID or customer identifier (can be null for anonymous)
  senderType: text("sender_type").notNull(), // 'customer' | 'business_user' | 'ai' | 'system'
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email"),
  
  // Message content
  message: text("message").notNull(),
  messageType: text("message_type").notNull().default("response"), // 'response' | 'internal_note' | 'status_update' | 'system'
  isInternal: text("is_internal").notNull().default("false"), // 'true' | 'false' - Internal notes not visible to customer
  
  // AI features
  aiDrafted: text("ai_drafted").notNull().default("false"), // 'true' | 'false' - Whether this was AI-generated
  aiConfidence: numeric("ai_confidence", { precision: 3, scale: 2 }), // 0.00 to 1.00 confidence score
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Ticket Attachments - File uploads for tickets
export const ticketAttachments = pgTable("ticket_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => ticketMessages.id, { onDelete: "cascade" }), // Optional link to specific message
  
  // File information
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileSize: numeric("file_size", { precision: 10, scale: 0 }).notNull(), // File size in bytes
  storageKey: text("storage_key").notNull(), // Path to stored file
  mimeType: text("mime_type").notNull(),
  
  // Uploader information
  uploadedBy: varchar("uploaded_by"), // User ID or customer identifier
  uploaderType: text("uploader_type").notNull(), // 'customer' | 'business_user'
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Canned Responses - Template responses for quick replies
export const cannedResponses = pgTable("canned_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Response details
  title: text("title").notNull(), // Short title/identifier
  content: text("content").notNull(), // Response template content
  category: text("category"), // Optional category for organization
  
  // Usage tracking
  useCount: numeric("use_count", { precision: 10, scale: 0 }).notNull().default("0"),
  lastUsedAt: timestamp("last_used_at"),
  
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Ticket Insights - AI-generated insights and recommendations
export const ticketInsights = pgTable("ticket_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Insight details
  insightType: text("insight_type").notNull(), // 'faq_suggestion' | 'trend_alert' | 'churn_warning' | 'product_issue' | 'policy_recommendation'
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"), // 'low' | 'medium' | 'high'
  
  // Supporting data
  relatedTicketIds: text("related_ticket_ids"), // JSON array of ticket IDs
  suggestedAction: text("suggested_action"), // AI-recommended action
  impact: text("impact"), // Estimated business impact
  
  // AI generation tracking
  aiGenerated: text("ai_generated").notNull().default("true"), // 'true' | 'false' - Whether this insight was AI-generated
  
  // Status tracking
  status: text("status").notNull().default("pending"), // 'pending' | 'reviewed' | 'applied' | 'dismissed'
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Conversation Journeys - Structured question flows for guided conversations
export const conversationJourneys = pgTable("conversation_journeys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Journey details
  name: text("name").notNull(), // e.g., "Educational Counsellor", "Lead Qualification"
  description: text("description"), // Optional description of what this journey does
  templateType: text("template_type").notNull().default("custom"), // 'educational_counsellor' | 'lead_qualification' | 'appointment_booking' | 'product_discovery' | 'custom'
  
  // Journey type
  journeyType: text("journey_type").notNull().default("conversational"), // 'conversational' (AI-guided chat) | 'form' (step-by-step UI components)
  
  // Status and behavior
  status: text("status").notNull().default("active"), // 'active' | 'inactive'
  isDefault: text("is_default").notNull().default("false"), // 'true' | 'false' - Whether this journey auto-starts for new conversations
  triggerMode: text("trigger_mode").notNull().default("manual"), // 'manual' | 'auto' | 'conditional'
  triggerKeywords: text("trigger_keywords"), // JSON array of keywords that trigger this journey (e.g., ["book appointment", "schedule meeting"])
  startFromScratch: text("start_from_scratch").notNull().default("false"), // 'true' | 'false' - If true, journey starts immediately (first step is the greeting), no keywords needed
  
  // Journey-specific AI training
  conversationalGuidelines: text("conversational_guidelines"), // Optional instructions for AI tone, acknowledgments, and conversational style specific to this journey
  
  // Usage tracking
  totalStarts: numeric("total_starts", { precision: 10, scale: 0 }).notNull().default("0"),
  totalCompletions: numeric("total_completions", { precision: 10, scale: 0 }).notNull().default("0"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Journey Steps - Individual questions/steps in a conversation journey
export const journeySteps = pgTable("journey_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journeyId: varchar("journey_id").notNull().references(() => conversationJourneys.id, { onDelete: "cascade" }),
  
  // Step details
  stepOrder: numeric("step_order", { precision: 5, scale: 0 }).notNull(), // Order in sequence (0, 1, 2, ...)
  questionText: text("question_text").notNull(), // The question to ask user
  questionType: text("question_type").notNull().default("text"), // 'text' | 'multiple_choice' | 'yes_no' | 'number' | 'email' | 'phone'
  
  // Field configuration
  fieldName: text("field_name"), // Optional - field name for storing response (e.g., "budget", "interest_area")
  crmFieldKey: text("crm_field_key"), // Optional - CRM field key this step's answer maps to (referenced as journey.<key> in LeadSquared field mappings)
  isRequired: text("is_required").notNull().default("false"), // 'true' | 'false' - Whether user must answer before continuing
  multipleChoiceOptions: text("multiple_choice_options"), // JSON array of options for multiple_choice type
  
  // Tool integration
  toolTrigger: text("tool_trigger"), // Optional tool to trigger after this step: 'capture_lead' | 'book_appointment' | 'get_products' | null
  toolParameters: text("tool_parameters"), // JSON object of tool parameters to pass
  
  // Branching logic (conditional routing)
  branchingCondition: text("branching_condition"), // JSON object: { "routes": [{ "matchType": "contains", "matchValue": "MBA", "targetStepId": "uuid", "label": "If MBA" }], "defaultNextStepId": null }
  
  // Exit on answer - stops journey when specific answer is selected
  exitOnValue: text("exit_on_value"), // The answer value that triggers journey exit (e.g., "No")
  exitMessage: text("exit_message"), // Message to show when journey exits early
  
  // Skip to step - jump to specific step when specific answer is selected
  skipOnValue: text("skip_on_value"), // The answer value that triggers step skip (e.g., "No")
  skipToStepIndex: integer("skip_to_step_index"), // The step order to skip to (e.g., 5)
  
  // Conditional step - only shown when explicitly skipped to, not during normal progression
  isConditional: text("is_conditional").notNull().default("false"), // 'true' | 'false'
  
  // Journey Complete step configuration
  completionButtonText: text("completion_button_text"), // Button text for "Continue Exploring" or similar
  
  // Help text and placeholders
  placeholderText: text("placeholder_text"), // Placeholder for input field
  helpText: text("help_text"), // Additional guidance for user
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Journey Responses - User answers to journey questions
export const journeyResponses = pgTable("journey_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => journeySessions.id, { onDelete: "cascade" }), // Direct link to journey session
  journeyId: varchar("journey_id").notNull().references(() => conversationJourneys.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  stepId: varchar("step_id").notNull().references(() => journeySteps.id, { onDelete: "cascade" }),
  
  response: text("response").notNull(), // User's answer to the question
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Journey Sessions - Persistent state for active journey sessions (survives reconnects/restarts)
export const journeySessions = pgTable("journey_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journeyId: varchar("journey_id").notNull().references(() => conversationJourneys.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // User identifier (can be authenticated user or session-based ID)
  
  // Journey state
  currentStepIndex: numeric("current_step_index", { precision: 5, scale: 0 }).notNull().default("0"),
  completed: text("completed").notNull().default("false"), // 'true' | 'false'
  completedAt: timestamp("completed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Visitor Daily Stats - Lightweight daily summary of visitor activity
export const visitorDailyStats = pgTable("visitor_daily_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  openedChatCount: integer("opened_chat_count").notNull().default(0),
  desktopCount: integer("desktop_count").notNull().default(0),
  mobileCount: integer("mobile_count").notNull().default(0),
  tabletCount: integer("tablet_count").notNull().default(0),
  topCountries: jsonb("top_countries").$type<Array<{ country: string; count: number }>>().default([]),
  topCities: jsonb("top_cities").$type<Array<{ city: string; count: number }>>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessDateIdx: uniqueIndex("visitor_daily_stats_business_date_idx").on(table.businessAccountId, table.date),
}));

// AI Suggestions - AI-generated suggestions for improving chatbot based on conversation analysis
export const aiSuggestions = pgTable("ai_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Suggestion details
  type: text("type").notNull(), // 'faq', 'training', 'journey', 'product', 'personality'
  title: text("title").notNull(),
  description: text("description").notNull(),
  suggestedContent: jsonb("suggested_content"), // The actual FAQ/instruction/journey template/etc
  
  // Supporting data
  conversationCount: numeric("conversation_count", { precision: 10, scale: 0 }).default("0"), // How many conversations led to this
  confidence: numeric("confidence", { precision: 5, scale: 2 }).default("0"), // AI confidence 0-100
  priority: text("priority").default("medium"), // 'high', 'medium', 'low'
  
  // Supporting evidence
  exampleQuestions: jsonb("example_questions"), // Array of example questions that led to this suggestion
  conversationIds: jsonb("conversation_ids"), // Array of conversation IDs that support this
  
  // Status
  status: text("status").notNull().default("pending"), // 'pending', 'accepted', 'dismissed'
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: varchar("accepted_by").references(() => users.id, { onDelete: "set null" }),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: varchar("dismissed_by").references(() => users.id, { onDelete: "set null" }),
  dismissReason: text("dismiss_reason"),
  
  // Impact tracking (populated after acceptance)
  impactMetrics: jsonb("impact_metrics"), // { questionsReduced: 10, satisfactionIncrease: 5, etc }
  implementedId: varchar("implemented_id"), // ID of created FAQ/training/etc
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Account Groups - Link multiple business accounts together for unified access
export const accountGroups = pgTable("account_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // Group name (e.g., "My Businesses", "Company Group")
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // The user who owns/created this group
  primaryHasFullAccess: text("primary_has_full_access").notNull().default("false"), // 'true' | 'false' - Primary account holder can access all linked accounts
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Account Group Members - Track which business accounts belong to which group
export const accountGroupMembers = pgTable("account_group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  isPrimary: text("is_primary").notNull().default("false"), // 'true' | 'false' - Is this the primary account for the group
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

// Account Group Admins - Users who can view aggregated data across an account group (CRM-style access)
export const accountGroupAdmins = pgTable("account_group_admins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }),
  canViewConversations: text("can_view_conversations").notNull().default("true"), // 'true' | 'false'
  canViewLeads: text("can_view_leads").notNull().default("true"), // 'true' | 'false'
  canViewAnalytics: text("can_view_analytics").notNull().default("true"), // 'true' | 'false'
  canExportData: text("can_export_data").notNull().default("false"), // 'true' | 'false'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("account_group_admins_user_idx").on(table.userId),
  index("account_group_admins_group_idx").on(table.groupId),
]);

// Account Group Training - Store group-level training configuration for bulk application to member accounts
export const accountGroupTraining = pgTable("account_group_training", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }).unique(),
  customInstructions: text("custom_instructions"), // JSON array of training instructions [{id, text, type, keywords}]
  leadTrainingConfig: jsonb("lead_training_config"), // Lead capture configuration {fields: [...], fallbackTemplate: ...}
  fallbackTemplate: text("fallback_template"), // Custom fallback message template
  lastPublishedAt: timestamp("last_published_at"), // When this was last pushed to member accounts
  lastPublishedBy: varchar("last_published_by").references(() => users.id, { onDelete: "set null" }),
  // LeadSquared integration settings for group-level configuration
  leadsquaredHost: text("leadsquared_host"), // e.g., 'https://api-in21.leadsquared.com'
  leadsquaredAccessKey: text("leadsquared_access_key"),
  leadsquaredSecretKey: text("leadsquared_secret_key"),
  leadsquaredEnabled: text("leadsquared_enabled").default("false"), // 'true' | 'false'
  leadsquaredLastAppliedAt: timestamp("leadsquared_last_applied_at"), // When LSQ settings were last pushed to member accounts
  // Menu Builder settings for group-level configuration
  menuConfig: jsonb("menu_config"), // Menu config: {enabled, welcomeMessage, avatarUrl, persistentCtaEnabled, persistentCtaLabel, persistentCtaAction, persistentCtaValue}
  menuItems: jsonb("menu_items"), // JSON array of menu items: [{id, label, icon, iconColor, description, itemType, actionValue, order, parentId}]
  menuLastAppliedAt: timestamp("menu_last_applied_at"), // When menu settings were last pushed to member accounts
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("account_group_training_group_idx").on(table.groupId),
]);

// Account Group LeadSquared Field Mappings - Store group-level LSQ field mappings for bulk application
export const accountGroupLeadsquaredFieldMappings = pgTable("account_group_leadsquared_field_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }),
  leadsquaredField: text("leadsquared_field").notNull(), // LeadSquared attribute name, e.g., "FirstName", "mx_City"
  sourceType: text("source_type").notNull(), // 'dynamic' | 'custom'
  sourceField: text("source_field"), // For dynamic: 'lead.name', 'session.city', 'business.name', etc.
  customValue: text("custom_value"), // For custom: static value like "AI Chroney"
  fallbackValue: text("fallback_value"), // For dynamic: value to use when dynamic data is empty
  displayName: text("display_name").notNull(), // Friendly name shown in UI, e.g., "Full Name", "City"
  isEnabled: text("is_enabled").notNull().default("true"), // 'true' | 'false'
  sortOrder: integer("sort_order").notNull().default(0), // For ordering in UI
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("account_group_lsq_mappings_group_idx").on(table.groupId),
]);

// Account Group Journeys - Group-level journey templates that can be published to member accounts
export const accountGroupJourneys = pgTable("account_group_journeys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }),
  
  name: text("name").notNull(),
  description: text("description"),
  templateType: text("template_type").notNull().default("custom"),
  
  journeyType: text("journey_type").notNull().default("conversational"),
  
  status: text("status").notNull().default("active"),
  isDefault: text("is_default").notNull().default("false"),
  triggerMode: text("trigger_mode").notNull().default("manual"),
  triggerKeywords: text("trigger_keywords"),
  startFromScratch: text("start_from_scratch").notNull().default("false"),
  
  conversationalGuidelines: text("conversational_guidelines"),
  
  totalStarts: numeric("total_starts", { precision: 10, scale: 0 }).notNull().default("0"),
  totalCompletions: numeric("total_completions", { precision: 10, scale: 0 }).notNull().default("0"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("account_group_journeys_group_idx").on(table.groupId),
]);

// Account Group Journey Steps - Steps for group-level journeys
export const accountGroupJourneySteps = pgTable("account_group_journey_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journeyId: varchar("journey_id").notNull().references(() => accountGroupJourneys.id, { onDelete: "cascade" }),
  
  stepOrder: numeric("step_order", { precision: 5, scale: 0 }).notNull(),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().default("text"),
  
  fieldName: text("field_name"),
  isRequired: text("is_required").notNull().default("false"),
  multipleChoiceOptions: text("multiple_choice_options"),
  
  toolTrigger: text("tool_trigger"),
  toolParameters: text("tool_parameters"),
  
  branchingCondition: text("branching_condition"),
  
  exitOnValue: text("exit_on_value"),
  exitMessage: text("exit_message"),
  
  skipOnValue: text("skip_on_value"),
  skipToStepIndex: integer("skip_to_step_index"),
  
  isConditional: text("is_conditional").notNull().default("false"),
  
  completionButtonText: text("completion_button_text"),
  
  placeholderText: text("placeholder_text"),
  helpText: text("help_text"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Account Group Extra Settings - Group-level settings for response length, chat behavior, and nudges
export const accountGroupExtraSettings = pgTable("account_group_extra_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => accountGroups.id, { onDelete: "cascade" }),

  responseLength: text("response_length").notNull().default("balanced"),

  autoOpenChat: text("auto_open_chat").notNull().default("false"),
  openingSoundEnabled: text("opening_sound_enabled").notNull().default("true"),
  openingSoundStyle: text("opening_sound_style").notNull().default("chime"),

  inactivityNudgeEnabled: text("inactivity_nudge_enabled").notNull().default("true"),
  inactivityNudgeDelay: numeric("inactivity_nudge_delay", { precision: 5, scale: 0 }).notNull().default("45"),
  inactivityNudgeMessage: text("inactivity_nudge_message").notNull().default("Still there? Let me know if you need any help!"),
  smartNudgeEnabled: text("smart_nudge_enabled").notNull().default("false"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("account_group_extra_settings_group_idx").on(table.groupId),
]);

// Model Pricing - Store current OpenAI pricing for cost calculation
export const modelPricing = pgTable("model_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  model: text("model").notNull().unique(), // 'gpt-4o-mini', 'gpt-4o', 'gpt-4o-vision', 'gpt-realtime-mini', etc
  inputCostPer1k: numeric("input_cost_per_1k", { precision: 10, scale: 6 }).notNull(), // Cost per 1000 TEXT input tokens (in USD)
  outputCostPer1k: numeric("output_cost_per_1k", { precision: 10, scale: 6 }).notNull(), // Cost per 1000 TEXT output tokens (in USD)
  // Realtime/audio models bill audio tokens at a very different rate than text
  // (audio is ~17x text on gpt-realtime-mini), and cached input is far cheaper
  // than fresh input. These are nullable: when a model has no audio or cache
  // rate, cost falls back to the text rates above, so text-only models behave
  // exactly as they did before these columns existed.
  cachedInputCostPer1k: numeric("cached_input_cost_per_1k", { precision: 10, scale: 6 }), // Cost per 1000 cached TEXT input tokens
  audioInputCostPer1k: numeric("audio_input_cost_per_1k", { precision: 10, scale: 6 }), // Cost per 1000 AUDIO input tokens
  audioCachedInputCostPer1k: numeric("audio_cached_input_cost_per_1k", { precision: 10, scale: 6 }), // Cost per 1000 cached AUDIO input tokens
  audioOutputCostPer1k: numeric("audio_output_cost_per_1k", { precision: 10, scale: 6 }), // Cost per 1000 AUDIO output tokens
  effectiveDate: timestamp("effective_date").notNull().defaultNow(), // When this pricing became effective
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI Usage Events - Event-level logging of all AI operations
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // 'chat', 'website_analysis', 'document_analysis', 'image_search', 'voice_mode'
  model: text("model").notNull(), // 'gpt-4o-mini', 'gpt-4o', 'gpt-4o-vision', 'gpt-realtime-2.1-mini'
  tokensInput: numeric("tokens_input", { precision: 10, scale: 0 }).notNull().default("0"), // TOTAL input tokens (text + audio, including cached)
  tokensOutput: numeric("tokens_output", { precision: 10, scale: 0 }).notNull().default("0"), // TOTAL output tokens (text + audio)
  // Modality/cache breakdown. These are SUBSETS of the totals above, not
  // additions to them, so existing sums over tokens_input/tokens_output stay
  // correct. Zero for text-only models; populated for realtime voice, where
  // audio tokens cost ~17x text tokens and must be priced separately.
  tokensInputAudio: numeric("tokens_input_audio", { precision: 10, scale: 0 }).notNull().default("0"), // Audio portion of tokens_input
  tokensOutputAudio: numeric("tokens_output_audio", { precision: 10, scale: 0 }).notNull().default("0"), // Audio portion of tokens_output
  tokensInputCached: numeric("tokens_input_cached", { precision: 10, scale: 0 }).notNull().default("0"), // Cached portion of tokens_input (text + audio)
  tokensInputCachedAudio: numeric("tokens_input_cached_audio", { precision: 10, scale: 0 }).notNull().default("0"), // Audio portion of tokens_input_cached
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"), // Calculated cost in USD
  metadata: jsonb("metadata"), // Additional context (conversation_id, feature, etc)
  occurredAt: timestamp("occurred_at").notNull().defaultNow(), // When this usage occurred
});

// AI Usage Daily - Aggregated daily summaries for fast reporting
export const aiUsageDaily = pgTable("ai_usage_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(), // Date for this summary (midnight UTC)
  category: text("category").notNull(), // 'chat', 'website_analysis', 'document_analysis', 'image_search', 'voice_mode'
  tokensInput: numeric("tokens_input", { precision: 15, scale: 0 }).notNull().default("0"), // Total input tokens for this day
  tokensOutput: numeric("tokens_output", { precision: 15, scale: 0 }).notNull().default("0"), // Total output tokens for this day
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"), // Total cost in USD for this day
  eventCount: numeric("event_count", { precision: 10, scale: 0 }).notNull().default("0"), // Number of events aggregated
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Behavioral Discount System Tables

// Intent Scores - Calculated purchase intent scores
export const intentScores = pgTable("intent_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  visitorSessionId: varchar("visitor_session_id").notNull(),
  productId: varchar("product_id").references(() => products.id, { onDelete: "cascade" }), // Null for general site intent
  score: numeric("score", { precision: 5, scale: 2 }).notNull().default("0"), // 0-100 intent score
  signals: jsonb("signals"), // Breakdown of signals: { timeOnPage: 45, scrollDepth: 80, repeatVisits: 2, etc }
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("intent_scores_lookup_idx").on(table.businessAccountId, table.visitorSessionId, table.productId),
  index("intent_scores_threshold_idx").on(table.businessAccountId, table.score),
]);

// Discount Rules - Business configuration for smart discounts
export const discountRules = pgTable("discount_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => products.id, { onDelete: "cascade" }), // Null for site-wide discounts
  intentThreshold: integer("intent_threshold").notNull().default(70), // Trigger when score >= this value (50-100)
  discountPercentage: integer("discount_percentage").notNull(), // 5, 10, 15, etc (5-50)
  discountMessage: text("discount_message").notNull(), // Custom message template with {product} and {discount} placeholders
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440), // Wait time before offering again to same visitor (24 hours default)
  expiryMinutes: integer("expiry_minutes").notNull().default(60), // Discount valid for X minutes
  maxUsesPerVisitor: integer("max_uses_per_visitor").notNull().default(1), // How many times a visitor can get this discount
  isActive: boolean("is_active").notNull().default(true), // Whether this rule is currently enabled
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Discount Offers - Track generated discount offers
export const discountOffers = pgTable("discount_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  visitorSessionId: varchar("visitor_session_id").notNull(),
  discountRuleId: varchar("discount_rule_id").notNull().references(() => discountRules.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => products.id, { onDelete: "set null" }),
  discountCode: text("discount_code").notNull(), // Generated unique code (unique per business)
  discountPercentage: numeric("discount_percentage", { precision: 5, scale: 2 }).notNull(),
  intentScore: numeric("intent_score", { precision: 5, scale: 2 }), // Score at time of offer
  offeredAt: timestamp("offered_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // When the offer expires
  redeemed: boolean("redeemed").notNull().default(false), // Redemption status
  redeemedAt: timestamp("redeemed_at"),
  revenueImpact: numeric("revenue_impact", { precision: 10, scale: 2 }).notNull().default("0"), // Order value if redeemed
}, (table) => [
  uniqueIndex("discount_offers_code_unique").on(table.businessAccountId, table.discountCode),
  index("discount_offers_offered_idx").on(table.businessAccountId, table.offeredAt),
  index("discount_offers_redeemed_idx").on(table.businessAccountId, table.redeemedAt),
]);

// Exit Intent Settings - Configuration for exit intent discount triggers
export const exitIntentSettings = pgTable("exit_intent_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(false),
  requireCartItems: boolean("require_cart_items").notNull().default(true),
  mobileExitEnabled: boolean("mobile_exit_enabled").notNull().default(true),
  discountPercentage: integer("discount_percentage").notNull().default(10),
  discountMessage: text("discount_message").notNull().default("Wait! Before you go, here's a special {discount}% discount just for you!"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  expiryMinutes: integer("expiry_minutes").notNull().default(30),
  maxUsesPerVisitor: integer("max_uses_per_visitor").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Idle Timeout Settings - Configuration for idle timeout discount triggers
export const idleTimeoutSettings = pgTable("idle_timeout_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(false),
  requireCartItems: boolean("require_cart_items").notNull().default(true),
  idleTimeoutSeconds: integer("idle_timeout_seconds").notNull().default(120),
  discountPercentage: integer("discount_percentage").notNull().default(10),
  discountMessage: text("discount_message").notNull().default("Still thinking it over? Here's {discount}% off to help you decide!"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  expiryMinutes: integer("expiry_minutes").notNull().default(30),
  maxUsesPerVisitor: integer("max_uses_per_visitor").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Urgency Offer Settings - Configuration for intent-based urgency discount offers
export const urgencyOfferSettings = pgTable("urgency_offer_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  name: text("name").notNull().default("Default Campaign"),
  priority: integer("priority").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(false),
  
  countdownDurationMinutes: integer("countdown_duration_minutes").notNull().default(10),
  
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: integer("discount_value").notNull().default(10),
  
  headline: text("headline").notNull().default("Limited Time Offer!"),
  description: text("description").notNull().default("We noticed you're interested! Here's a special discount just for you."),
  ctaButtonText: text("cta_button_text").notNull().default("Unlock Offer"),
  dismissButtonText: text("dismiss_button_text").notNull().default("Maybe later"),
  successMessage: text("success_message").notNull().default("Your discount code has been sent to your WhatsApp!"),
  
  phoneInputLabel: text("phone_input_label").notNull().default("Enter your WhatsApp number"),
  phoneInputPlaceholder: text("phone_input_placeholder").notNull().default("+1 234 567 8900"),
  requirePhone: boolean("require_phone").notNull().default(true),
  
  triggerMode: text("trigger_mode").notNull().default("intent"),
  triggerKeywords: text("trigger_keywords").default(""),
  
  intentThreshold: integer("intent_threshold").notNull().default(70),
  minMessagesBeforeTrigger: integer("min_messages_before_trigger").notNull().default(3),
  
  maxOffersPerVisitor: integer("max_offers_per_visitor").notNull().default(1),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
  showReminderAfterDismiss: boolean("show_reminder_after_dismiss").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Urgency Offers - Track individual urgency offers shown to visitors
export const urgencyOffers = pgTable("urgency_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id").references(() => urgencyOfferSettings.id, { onDelete: "set null" }),
  visitorToken: text("visitor_token").notNull(),
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  
  // Timer tracking (for persistence across refreshes)
  countdownStartedAt: timestamp("countdown_started_at").notNull().defaultNow(),
  countdownExpiresAt: timestamp("countdown_expires_at").notNull(),
  
  // Offer details (captured from settings at time of offer)
  discountType: text("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  discountCode: text("discount_code").notNull(), // Generated unique code
  
  // Phone redemption (WhatsApp-first)
  phoneNumber: text("phone_number"), // Captured when user redeems offer
  phoneCountryCode: text("phone_country_code"), // Country code for formatting
  
  // Status tracking
  status: text("status").notNull().default("active"), // 'active' | 'redeemed' | 'expired' | 'dismissed'
  dismissedAt: timestamp("dismissed_at"),
  redeemedAt: timestamp("redeemed_at"),
  expiredAt: timestamp("expired_at"),
  
  // AI intent data at time of trigger
  intentScore: numeric("intent_score", { precision: 5, scale: 2 }),
  triggerMessage: text("trigger_message"), // The message that triggered high intent detection
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("urgency_offers_visitor_idx").on(table.businessAccountId, table.visitorToken),
  index("urgency_offers_phone_idx").on(table.businessAccountId, table.phoneNumber),
  index("urgency_offers_status_idx").on(table.businessAccountId, table.status),
]);

// ERP Integration Tables

// ERP Configurations - Store client ERP connection details
export const erpConfigurations = pgTable("erp_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // ERP connection details
  name: text("name").notNull(), // Display name for this ERP connection
  erpType: text("erp_type").notNull().default("generic"), // 'generic' | 'sap' | 'oracle' | 'microsoft_dynamics' | 'custom'
  baseUrl: text("base_url").notNull(), // ERP API base URL
  
  // Authentication (encrypted)
  authType: text("auth_type").notNull().default("api_key"), // 'api_key' | 'bearer_token' | 'oauth2' | 'basic'
  apiKey: text("api_key"), // Encrypted API key
  accessToken: text("access_token"), // Encrypted access token
  refreshToken: text("refresh_token"), // Encrypted refresh token (for OAuth2)
  tokenExpiresAt: timestamp("token_expires_at"), // When access token expires
  basicAuthUsername: text("basic_auth_username"), // For basic auth
  basicAuthPassword: text("basic_auth_password"), // Encrypted password for basic auth
  
  // API endpoints configuration
  productsEndpoint: text("products_endpoint").default("/products"), // Endpoint for product listing
  productDetailEndpoint: text("product_detail_endpoint").default("/products/{id}"), // Endpoint for single product
  categoriesEndpoint: text("categories_endpoint").default("/categories"), // Endpoint for categories
  deltaSyncEndpoint: text("delta_sync_endpoint"), // Endpoint for delta sync (products updated since timestamp)
  
  // Sync configuration
  syncEnabled: text("sync_enabled").notNull().default("true"), // 'true' | 'false'
  syncFrequencyHours: integer("sync_frequency_hours").notNull().default(12), // How often to sync (hours)
  fullSyncDayOfWeek: integer("full_sync_day_of_week").default(0), // 0=Sunday, 6=Saturday - day for full sync
  batchSize: integer("batch_size").notNull().default(500), // Products per batch during sync
  
  // Field mapping (JSON) - maps ERP fields to our standard fields
  fieldMapping: jsonb("field_mapping"), // { "erp_product_id": "id", "erp_name": "name", "erp_price": "price", ... }
  
  // Caching configuration
  cacheEnabled: text("cache_enabled").notNull().default("true"), // 'true' | 'false'
  cacheTtlMinutes: integer("cache_ttl_minutes").notNull().default(30), // Cache TTL in minutes
  
  // Status
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false'
  lastTestedAt: timestamp("last_tested_at"), // Last connection test
  lastTestStatus: text("last_test_status"), // 'success' | 'failed'
  lastTestError: text("last_test_error"), // Error message from last test
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Product Embeddings - Store image embeddings for visual search (separate from products)
export const productEmbeddings = pgTable("product_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // ERP product reference
  erpProductId: text("erp_product_id").notNull(), // Product ID from client's ERP
  erpConfigurationId: varchar("erp_configuration_id").references(() => erpConfigurations.id, { onDelete: "cascade" }),
  
  // Image information (not stored, just reference)
  imageUrl: text("image_url").notNull(), // Original image URL from ERP
  imageHash: text("image_hash"), // Hash of image for change detection
  
  // Embedding data
  embedding: vector768("embedding"), // Vector embedding for visual similarity search using Jina CLIP (768 dimensions)
  visualDescription: text("visual_description"), // AI-generated visual description
  
  // Cached product metadata (for quick display without ERP call)
  cachedName: text("cached_name"), // Product name at time of sync
  cachedCategory: text("cached_category"), // Product category at time of sync
  cachedPrice: numeric("cached_price", { precision: 10, scale: 2 }), // Product price at time of sync
  cachedThumbnailUrl: text("cached_thumbnail_url"), // Thumbnail URL for quick display
  
  // Sync metadata
  lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
  syncVersion: integer("sync_version").notNull().default(1), // Incremented on each sync
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false' - soft delete
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Index for fast lookup by business + ERP product ID
  uniqueBusinessErpProduct: uniqueIndex("product_embeddings_business_erp_idx").on(table.businessAccountId, table.erpProductId),
  // Note: Vector embedding index should be created with HNSW (not btree) via raw SQL for similarity search
}));

// ERP Sync Logs - Track sync operations
export const erpSyncLogs = pgTable("erp_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  erpConfigurationId: varchar("erp_configuration_id").references(() => erpConfigurations.id, { onDelete: "cascade" }),
  
  // Sync details
  syncType: text("sync_type").notNull(), // 'full' | 'delta' | 'manual'
  status: text("status").notNull().default("running"), // 'running' | 'completed' | 'failed' | 'cancelled'
  
  // Progress tracking
  totalProducts: integer("total_products").default(0), // Total products to process
  processedProducts: integer("processed_products").default(0), // Products processed so far
  newEmbeddings: integer("new_embeddings").default(0), // New embeddings created
  updatedEmbeddings: integer("updated_embeddings").default(0), // Existing embeddings updated
  deletedEmbeddings: integer("deleted_embeddings").default(0), // Embeddings removed (product no longer in ERP)
  failedProducts: integer("failed_products").default(0), // Products that failed to process
  
  // Resumable sync support
  lastProcessedPage: integer("last_processed_page").default(0), // For resuming interrupted syncs
  lastProcessedProductId: text("last_processed_product_id"), // Last product ID processed
  useBatchApi: text("use_batch_api").default("false"), // 'true' | 'false' - Whether to use OpenAI Batch API
  embeddingMethod: text("embedding_method").default("standard"), // 'standard' | 'batch' - Embedding generation method
  
  // Timing
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationSeconds: integer("duration_seconds"),
  
  // Error tracking
  errorMessage: text("error_message"),
  errorDetails: jsonb("error_details"), // Detailed error information
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ERP Product Cache - Cached product data from ERP for fast listing/filtering
export const erpProductCache = pgTable("erp_product_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  erpConfigurationId: varchar("erp_configuration_id").references(() => erpConfigurations.id, { onDelete: "cascade" }),
  
  // ERP product reference
  erpProductId: text("erp_product_id").notNull(),
  
  // Cached product data
  name: text("name").notNull(),
  description: text("description"),
  sku: text("sku"),
  price: numeric("price", { precision: 10, scale: 2 }),
  currency: text("currency").default("INR"),
  category: text("category"),
  subcategory: text("subcategory"),
  images: jsonb("images"), // Array of image URLs
  inStock: text("in_stock").default("true"), // 'true' | 'false'
  weight: text("weight"),
  metal: text("metal"),
  additionalAttributes: jsonb("additional_attributes"), // Any extra fields from ERP
  
  // Cache metadata
  cachedAt: timestamp("cached_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // When cache expires
  isValid: text("is_valid").notNull().default("true"), // 'true' | 'false' - invalidated on ERP update
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint for business + ERP product ID
  uniqueBusinessErpProductCache: uniqueIndex("erp_product_cache_business_erp_idx").on(table.businessAccountId, table.erpProductId),
  // Index for category filtering
  categoryIdx: index("erp_product_cache_category_idx").on(table.businessAccountId, table.category),
  // Index for price filtering
  priceIdx: index("erp_product_cache_price_idx").on(table.businessAccountId, table.price),
}));

// Product Import Jobs - Track bulk product import progress
export const productImportJobs = pgTable("product_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Job status
  status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  
  // Progress tracking
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  
  // Embedding progress
  totalEmbeddings: integer("total_embeddings").notNull().default(0),
  processedEmbeddings: integer("processed_embeddings").notNull().default(0),
  
  // File info
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  
  // Error tracking
  errors: jsonb("errors"), // Array of error messages with row info
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdIdx: index("product_import_jobs_business_idx").on(table.businessAccountId),
  statusIdx: index("product_import_jobs_status_idx").on(table.status),
}));

// OpenAI Batch Jobs - Track OpenAI Batch API jobs for embedding generation
export const openAiBatchJobs = pgTable("openai_batch_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  
  // Link to sync log (for ERP sync) or import job (for Excel import)
  erpSyncLogId: varchar("erp_sync_log_id").references(() => erpSyncLogs.id, { onDelete: "cascade" }),
  productImportJobId: varchar("product_import_job_id").references(() => productImportJobs.id, { onDelete: "cascade" }),
  
  // OpenAI Batch API IDs
  openAiBatchId: text("openai_batch_id"), // The batch ID from OpenAI API
  openAiInputFileId: text("openai_input_file_id"), // Input file ID
  openAiOutputFileId: text("openai_output_file_id"), // Output file ID (after completion)
  
  // Job details
  jobType: text("job_type").notNull().default("embedding"), // 'embedding' | 'visual_description'
  status: text("status").notNull().default("pending"), // 'pending' | 'uploading' | 'submitted' | 'in_progress' | 'completed' | 'failed' | 'expired' | 'cancelled'
  
  // Progress tracking
  totalRequests: integer("total_requests").notNull().default(0),
  completedRequests: integer("completed_requests").notNull().default(0),
  failedRequests: integer("failed_requests").notNull().default(0),
  
  // Batch file data (stored temporarily for creating batch)
  batchInputData: jsonb("batch_input_data"), // Array of product IDs and image URLs for batch processing
  
  // Results
  results: jsonb("results"), // Processed results after batch completion
  
  // Error tracking
  errorMessage: text("error_message"),
  errorDetails: jsonb("error_details"),
  
  // Timing
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"), // OpenAI batch expiration (24 hours)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdIdx: index("openai_batch_jobs_business_idx").on(table.businessAccountId),
  statusIdx: index("openai_batch_jobs_status_idx").on(table.status),
  batchIdIdx: index("openai_batch_jobs_batch_id_idx").on(table.openAiBatchId),
}));

// Insert schemas
export const insertBusinessAccountSchema = createInsertSchema(businessAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  tempPassword: true,
  tempPasswordExpiry: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  usedAt: true,
  createdAt: true,
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertUploadedImageSchema = createInsertSchema(uploadedImages).omit({
  id: true,
  createdAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFaqSchema = createInsertSchema(faqs).omit({
  id: true,
  embedding: true, // Embeddings are added programmatically, not through user input
  createdAt: true,
  updatedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
});

export const insertQuestionBankEntrySchema = createInsertSchema(questionBankEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWidgetSettingsSchema = createInsertSchema(widgetSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWebsiteAnalysisSchema = createInsertSchema(websiteAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastAnalyzedAt: true,
});

export const insertAnalyzedPageSchema = createInsertSchema(analyzedPages).omit({
  id: true,
  createdAt: true,
  analyzedAt: true,
});

export const insertTrainingDocumentSchema = createInsertSchema(trainingDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTagSchema = createInsertSchema(tags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductCategorySchema = createInsertSchema(productCategories).omit({
  id: true,
  createdAt: true,
});

export const insertProductTagSchema = createInsertSchema(productTags).omit({
  id: true,
  createdAt: true,
});

export const insertProductRelationshipSchema = createInsertSchema(productRelationships).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScheduleTemplateSchema = createInsertSchema(scheduleTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSlotOverrideSchema = createInsertSchema(slotOverrides).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reminderSentAt: true,
});

export const insertDemoPageSchema = createInsertSchema(demoPages).omit({
  id: true,
  token: true,
  createdAt: true,
  updatedAt: true,
  lastViewedAt: true,
});

export const insertPublicChatLinkSchema = createInsertSchema(publicChatLinks).omit({
  id: true,
  token: true,
  createdAt: true,
  updatedAt: true,
  lastAccessedAt: true,
  accessCount: true,
});

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  ticketNumber: true,
  createdAt: true,
  updatedAt: true,
  autoResolvedAt: true,
  resolvedAt: true,
  closedAt: true,
});

export const insertTicketMessageSchema = createInsertSchema(ticketMessages).omit({
  id: true,
  createdAt: true,
});

export const insertTicketAttachmentSchema = createInsertSchema(ticketAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertCannedResponseSchema = createInsertSchema(cannedResponses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  useCount: true,
  lastUsedAt: true,
});

export const insertTicketInsightSchema = createInsertSchema(ticketInsights).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
});

export const insertConversationJourneySchema = createInsertSchema(conversationJourneys).omit({
  id: true,
  businessAccountId: true,
  totalStarts: true,
  totalCompletions: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJourneyStepSchema = createInsertSchema(journeySteps).omit({
  id: true,
  journeyId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAccountGroupSchema = createInsertSchema(accountGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAccountGroupMemberSchema = createInsertSchema(accountGroupMembers).omit({
  id: true,
  addedAt: true,
});

export const insertAccountGroupTrainingSchema = createInsertSchema(accountGroupTraining).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAccountGroupLeadsquaredFieldMappingSchema = createInsertSchema(accountGroupLeadsquaredFieldMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAccountGroupJourneySchema = createInsertSchema(accountGroupJourneys).omit({ id: true, groupId: true, totalStarts: true, totalCompletions: true, createdAt: true, updatedAt: true });
export const insertAccountGroupJourneyStepSchema = createInsertSchema(accountGroupJourneySteps).omit({ id: true, journeyId: true, createdAt: true, updatedAt: true });

export const insertModelPricingSchema = createInsertSchema(modelPricing).omit({
  id: true,
  createdAt: true,
});

export const insertAiUsageEventSchema = createInsertSchema(aiUsageEvents).omit({
  id: true,
  occurredAt: true,
});

export const insertAiUsageDailySchema = createInsertSchema(aiUsageDaily).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIntentScoreSchema = createInsertSchema(intentScores).omit({
  id: true,
  createdAt: true,
  lastUpdated: true,
});

export const insertDiscountRuleSchema = createInsertSchema(discountRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDiscountOfferSchema = createInsertSchema(discountOffers).omit({
  id: true,
  offeredAt: true,
});

export const insertExitIntentSettingsSchema = createInsertSchema(exitIntentSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIdleTimeoutSettingsSchema = createInsertSchema(idleTimeoutSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUrgencyOfferSettingsSchema = createInsertSchema(urgencyOfferSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUrgencyOfferSchema = createInsertSchema(urgencyOffers).omit({
  id: true,
  createdAt: true,
});

// System Settings table for storing encrypted global configuration (like R2 credentials)
export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  isEncrypted: text("is_encrypted").notNull().default("true"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Vista Studio Jobs table for tracking background image generation
export const vistaStudioJobs = pgTable("vista_studio_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id),
  status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  templateId: text("template_id").notNull(), // Template type: 'matte-black-mannequin', 'ivory-mannequin', etc.
  prompt: text("prompt").notNull(), // The prompt used for generation
  originalImageUrl: text("original_image_url").notNull(), // URL to the uploaded/cropped image
  generatedImageUrl: text("generated_image_url"), // URL to the generated image (null until completed)
  provider: text("provider").notNull().default("openai"), // 'openai' | 'google' - Which AI provider was used
  errorMessage: text("error_message"), // Error message if failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"), // When job completed (success or failure)
});

export const insertVistaStudioJobSchema = createInsertSchema(vistaStudioJobs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

// Database Restore History - Track when backups were restored
export const restoreHistory = pgTable("restore_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  backupKey: text("backup_key").notNull(),
  backupType: text("backup_type").notNull(), // 'daily' | 'weekly' | 'monthly'
  backupDate: text("backup_date").notNull(), // Date from backup filename
  restoredBy: varchar("restored_by").references(() => users.id, { onDelete: "set null" }),
  restoredByEmail: text("restored_by_email"),
  durationMs: numeric("duration_ms", { precision: 10, scale: 0 }),
  status: text("status").notNull().default("success"), // 'success' | 'failed'
  errorMessage: text("error_message"),
  restoredAt: timestamp("restored_at").notNull().defaultNow(),
});

export const insertRestoreHistorySchema = createInsertSchema(restoreHistory).omit({
  id: true,
  restoredAt: true,
});

// Backup Jobs - Audit log for backup operations (create, restore, cleanup)
export const backupJobs = pgTable("backup_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  correlationId: text("correlation_id").notNull(), // Unique ID for tracking (e.g., backup_1234567890_abc123)
  operation: text("operation").notNull(), // 'create' | 'restore' | 'cleanup'
  status: text("status").notNull().default("pending"), // 'pending' | 'running' | 'completed' | 'failed'
  backupType: text("backup_type"), // 'daily' | 'weekly' | 'monthly' (for create operations)
  backupKey: text("backup_key"), // R2 key of the backup file
  fileSizeBytes: numeric("file_size_bytes", { precision: 20, scale: 0 }), // Size of backup file
  durationMs: numeric("duration_ms", { precision: 10, scale: 0 }), // How long the operation took
  errorMessage: text("error_message"), // User-friendly error message
  errorDetails: text("error_details"), // Technical details (stack trace, stderr) - for debugging
  metadata: jsonb("metadata"), // Additional context (compression ratio, upload speed, etc.)
  triggeredBy: text("triggered_by").notNull().default("system"), // 'system' (scheduled) | 'manual' | user email
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertBackupJobSchema = createInsertSchema(backupJobs).omit({
  id: true,
  startedAt: true,
});

// Guidance Campaigns - Container for grouping proactive guidance rules
export const guidanceCampaigns = pgTable("guidance_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Campaign name, e.g., "Razorpay Rize Onboarding"
  description: text("description"), // Optional description
  isActive: text("is_active").notNull().default("true"), // Whether this campaign is active
  showHeader: text("show_header").notNull().default("false"), // Whether to show the header in the guidance chat widget
  widgetSize: text("widget_size").notNull().default("half"), // Widget size: "full" (full screen height) or "half" (600px)
  voiceModeEnabled: text("voice_mode_enabled").notNull().default("false"), // Whether voice mode is enabled for this campaign
  voiceModePosition: text("voice_mode_position").notNull().default("in-chat"), // Position: "in-chat", "bottom-left", "bottom-right", "top-left", "top-right"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGuidanceCampaignSchema = createInsertSchema(guidanceCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Proactive Guidance Rules - URL-based contextual guidance for embedded chatbot
export const proactiveGuidanceRules = pgTable("proactive_guidance_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id").references(() => guidanceCampaigns.id, { onDelete: "cascade" }), // Optional link to campaign
  name: text("name").notNull(), // Friendly name for the rule, e.g., "Checkout Help"
  urlPattern: text("url_pattern").notNull(), // URL pattern to match, e.g., "/checkout", "/pricing/*"
  message: text("message").notNull(), // The guidance message to display
  conversationStarters: text("conversation_starters"), // JSON array of starter questions for this page
  isActive: text("is_active").notNull().default("true"), // Whether this rule is active
  priority: integer("priority").notNull().default(0), // Higher priority rules take precedence
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProactiveGuidanceRuleSchema = createInsertSchema(proactiveGuidanceRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// LeadSquared Field Mappings - Configurable field mappings for LeadSquared sync per business
export const leadsquaredFieldMappings = pgTable("leadsquared_field_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  leadsquaredField: text("leadsquared_field").notNull(), // LeadSquared attribute name, e.g., "FirstName", "mx_City"
  sourceType: text("source_type").notNull(), // 'dynamic' | 'custom'
  sourceField: text("source_field"), // For dynamic: 'lead.name', 'session.city', 'business.name', etc.
  customValue: text("custom_value"), // For custom: static value like "AI Chroney"
  fallbackValue: text("fallback_value"), // For dynamic: value to use when dynamic data is empty
  valueWhenPresent: text("value_when_present"), // For dynamic: when set, emit this static value instead of the raw source value whenever the dynamic source resolves to a non-empty value (e.g. send "PRChat" whenever a UTM source is present). Null = legacy behavior (emit the raw source value).
  displayName: text("display_name").notNull(), // Friendly name shown in UI, e.g., "Full Name", "City"
  isEnabled: text("is_enabled").notNull().default("true"), // 'true' | 'false'
  sortOrder: integer("sort_order").notNull().default(0), // For ordering in UI
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadsquaredFieldMappingSchema = createInsertSchema(leadsquaredFieldMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const salesforceFieldMappings = pgTable("salesforce_field_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  salesforceField: text("salesforce_field").notNull(), // Salesforce field API name e.g. "LastName", "Email"
  sourceType: text("source_type").notNull(), // 'dynamic' | 'custom'
  sourceField: text("source_field"), // For dynamic: 'lead.name', 'session.city', etc.
  customValue: text("custom_value"), // For custom: static value
  displayName: text("display_name").notNull(),
  isEnabled: text("is_enabled").notNull().default("true"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSalesforceFieldMappingSchema = createInsertSchema(salesforceFieldMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ERP Integration insert schemas
export const insertErpConfigurationSchema = createInsertSchema(erpConfigurations).omit({
  id: true,
  lastTestedAt: true,
  lastTestStatus: true,
  lastTestError: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductEmbeddingSchema = createInsertSchema(productEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertErpSyncLogSchema = createInsertSchema(erpSyncLogs).omit({
  id: true,
  createdAt: true,
});

export const insertErpProductCacheSchema = createInsertSchema(erpProductCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductImportJobSchema = createInsertSchema(productImportJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOpenAiBatchJobSchema = createInsertSchema(openAiBatchJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTrainedUrlSchema = createInsertSchema(trainedUrls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUrlContentChunkSchema = createInsertSchema(urlContentChunks).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertBusinessAccount = z.infer<typeof insertBusinessAccountSchema>;
export type BusinessAccount = typeof businessAccounts.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export type PhoneOtpChallenge = typeof phoneOtpChallenges.$inferSelect;
export type InsertPhoneOtpChallenge = typeof phoneOtpChallenges.$inferInsert;

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export type InsertUploadedImage = z.infer<typeof insertUploadedImageSchema>;
export type UploadedImage = typeof uploadedImages.$inferSelect;

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export type ProductJewelryEmbedding = typeof productJewelryEmbeddings.$inferSelect;

export type InsertFaq = z.infer<typeof insertFaqSchema>;
export type Faq = typeof faqs.$inferSelect;

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export type InsertQuestionBankEntry = z.infer<typeof insertQuestionBankEntrySchema>;
export type QuestionBankEntry = typeof questionBankEntries.$inferSelect;

export type InsertWidgetSettings = z.infer<typeof insertWidgetSettingsSchema>;
export type WidgetSettings = typeof widgetSettings.$inferSelect;

export type InsertWebsiteAnalysis = z.infer<typeof insertWebsiteAnalysisSchema>;
export type WebsiteAnalysis = typeof websiteAnalysis.$inferSelect;

export type InsertAnalyzedPage = z.infer<typeof insertAnalyzedPageSchema>;
export type AnalyzedPage = typeof analyzedPages.$inferSelect;

export type InsertTrainingDocument = z.infer<typeof insertTrainingDocumentSchema>;
export type TrainingDocument = typeof trainingDocuments.$inferSelect;

export type DocumentChunk = typeof documentChunks.$inferSelect;

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tags.$inferSelect;

export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type ProductCategory = typeof productCategories.$inferSelect;

export type InsertProductTag = z.infer<typeof insertProductTagSchema>;
export type ProductTag = typeof productTags.$inferSelect;

export type InsertProductRelationship = z.infer<typeof insertProductRelationshipSchema>;
export type ProductRelationship = typeof productRelationships.$inferSelect;

export type InsertScheduleTemplate = z.infer<typeof insertScheduleTemplateSchema>;
export type ScheduleTemplate = typeof scheduleTemplates.$inferSelect;

export type InsertSlotOverride = z.infer<typeof insertSlotOverrideSchema>;
export type SlotOverride = typeof slotOverrides.$inferSelect;

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

export type InsertDemoPage = z.infer<typeof insertDemoPageSchema>;
export type DemoPage = typeof demoPages.$inferSelect;

export type InsertPublicChatLink = z.infer<typeof insertPublicChatLinkSchema>;
export type PublicChatLink = typeof publicChatLinks.$inferSelect;

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export type InsertTicketMessage = z.infer<typeof insertTicketMessageSchema>;
export type TicketMessage = typeof ticketMessages.$inferSelect;

export type InsertTicketAttachment = z.infer<typeof insertTicketAttachmentSchema>;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;

export type InsertCannedResponse = z.infer<typeof insertCannedResponseSchema>;
export type CannedResponse = typeof cannedResponses.$inferSelect;

export type InsertTicketInsight = z.infer<typeof insertTicketInsightSchema>;
export type TicketInsight = typeof ticketInsights.$inferSelect;

export type InsertConversationJourney = z.infer<typeof insertConversationJourneySchema>;
export type ConversationJourney = typeof conversationJourneys.$inferSelect;

export type InsertJourneyStep = z.infer<typeof insertJourneyStepSchema>;
export type JourneyStep = typeof journeySteps.$inferSelect;

export type InsertAccountGroup = z.infer<typeof insertAccountGroupSchema>;
export type AccountGroup = typeof accountGroups.$inferSelect;

export type InsertAccountGroupMember = z.infer<typeof insertAccountGroupMemberSchema>;
export type AccountGroupMember = typeof accountGroupMembers.$inferSelect;

export type InsertAccountGroupTraining = z.infer<typeof insertAccountGroupTrainingSchema>;
export type AccountGroupTraining = typeof accountGroupTraining.$inferSelect;

export type InsertAccountGroupLeadsquaredFieldMapping = z.infer<typeof insertAccountGroupLeadsquaredFieldMappingSchema>;
export type AccountGroupLeadsquaredFieldMapping = typeof accountGroupLeadsquaredFieldMappings.$inferSelect;

export type InsertModelPricing = z.infer<typeof insertModelPricingSchema>;
export type ModelPricing = typeof modelPricing.$inferSelect;

export type InsertAiUsageEvent = z.infer<typeof insertAiUsageEventSchema>;
export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;

export type InsertAiUsageDaily = z.infer<typeof insertAiUsageDailySchema>;
export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;

export type InsertIntentScore = z.infer<typeof insertIntentScoreSchema>;
export type IntentScore = typeof intentScores.$inferSelect;

export type InsertDiscountRule = z.infer<typeof insertDiscountRuleSchema>;
export type DiscountRule = typeof discountRules.$inferSelect;

export type InsertDiscountOffer = z.infer<typeof insertDiscountOfferSchema>;
export type DiscountOffer = typeof discountOffers.$inferSelect;

export type InsertExitIntentSettings = z.infer<typeof insertExitIntentSettingsSchema>;
export type ExitIntentSettings = typeof exitIntentSettings.$inferSelect;

export type InsertIdleTimeoutSettings = z.infer<typeof insertIdleTimeoutSettingsSchema>;
export type IdleTimeoutSettings = typeof idleTimeoutSettings.$inferSelect;

export type InsertUrgencyOfferSettings = z.infer<typeof insertUrgencyOfferSettingsSchema>;
export type UrgencyOfferSettings = typeof urgencyOfferSettings.$inferSelect;

export type InsertUrgencyOffer = z.infer<typeof insertUrgencyOfferSchema>;
export type UrgencyOffer = typeof urgencyOffers.$inferSelect;

export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type SystemSettings = typeof systemSettings.$inferSelect;

// Vista Studio Job Types
export type InsertVistaStudioJob = z.infer<typeof insertVistaStudioJobSchema>;
export type VistaStudioJob = typeof vistaStudioJobs.$inferSelect;

// ERP Integration Types
export type InsertErpConfiguration = z.infer<typeof insertErpConfigurationSchema>;
export type ErpConfiguration = typeof erpConfigurations.$inferSelect;

export type InsertProductEmbedding = z.infer<typeof insertProductEmbeddingSchema>;
export type ProductEmbedding = typeof productEmbeddings.$inferSelect;

export type InsertErpSyncLog = z.infer<typeof insertErpSyncLogSchema>;
export type ErpSyncLog = typeof erpSyncLogs.$inferSelect;

export type InsertErpProductCache = z.infer<typeof insertErpProductCacheSchema>;
export type ErpProductCache = typeof erpProductCache.$inferSelect;

export type InsertProductImportJob = z.infer<typeof insertProductImportJobSchema>;
export type ProductImportJob = typeof productImportJobs.$inferSelect;

export type InsertOpenAiBatchJob = z.infer<typeof insertOpenAiBatchJobSchema>;
export type OpenAiBatchJob = typeof openAiBatchJobs.$inferSelect;

export type InsertRestoreHistory = z.infer<typeof insertRestoreHistorySchema>;
export type RestoreHistory = typeof restoreHistory.$inferSelect;

export type InsertBackupJob = z.infer<typeof insertBackupJobSchema>;
export type BackupJob = typeof backupJobs.$inferSelect;

// URL Training Types
export type InsertTrainedUrl = z.infer<typeof insertTrainedUrlSchema>;
export type TrainedUrl = typeof trainedUrls.$inferSelect;

export type InsertUrlContentChunk = z.infer<typeof insertUrlContentChunkSchema>;
export type UrlContentChunk = typeof urlContentChunks.$inferSelect;

// Guidance Campaign Types
export type InsertGuidanceCampaign = z.infer<typeof insertGuidanceCampaignSchema>;
export type GuidanceCampaign = typeof guidanceCampaigns.$inferSelect;

// Proactive Guidance Types
export type InsertProactiveGuidanceRule = z.infer<typeof insertProactiveGuidanceRuleSchema>;
export type ProactiveGuidanceRule = typeof proactiveGuidanceRules.$inferSelect;

// LeadSquared Field Mapping Types
export type InsertLeadsquaredFieldMapping = z.infer<typeof insertLeadsquaredFieldMappingSchema>;
export type LeadsquaredFieldMapping = typeof leadsquaredFieldMappings.$inferSelect;

// Salesforce Field Mapping Types
export type InsertSalesforceFieldMapping = z.infer<typeof insertSalesforceFieldMappingSchema>;
export type SalesforceFieldMapping = typeof salesforceFieldMappings.$inferSelect;

// WhatsApp Settings - Store MSG91 credentials and configuration per business
export const whatsappSettings = pgTable("whatsapp_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  whatsappEnabled: text("whatsapp_enabled").notNull().default("true"), // 'true' | 'false' - master toggle for WhatsApp AI Agent
  msg91AuthKey: text("msg91_auth_key"), // Encrypted MSG91 auth key
  whatsappNumber: text("whatsapp_number"), // WhatsApp Business phone number
  webhookSecret: text("webhook_secret"), // Secret for webhook validation
  extractionFields: jsonb("extraction_fields").$type<string[]>().default(["name", "phone", "email"]), // Fields to extract
  customPrompt: text("custom_prompt"), // Optional custom AI extraction prompt
  autoSyncToLeadsquared: text("auto_sync_to_leadsquared").notNull().default("false"), // 'true' | 'false'
  // Lead capture settings
  leadCaptureEnabled: text("lead_capture_enabled").notNull().default("true"), // 'true' | 'false' - enable/disable auto lead capture
  leadGenerationMode: text("lead_generation_mode").notNull().default("first_message"), // 'first_message' | 'flow_only'
  requireName: text("require_name").notNull().default("false"), // 'true' | 'false' - require name to create lead
  requirePhone: text("require_phone").notNull().default("false"), // 'true' | 'false' - require phone to create lead
  requireEmail: text("require_email").notNull().default("false"), // 'true' | 'false' - require email to create lead
  minFieldsRequired: integer("min_fields_required").notNull().default(1), // Minimum number of fields that must be extracted
  // Auto-reply settings
  autoReplyEnabled: text("auto_reply_enabled").notNull().default("false"), // 'true' | 'false' - enable AI auto-reply
  msg91IntegratedNumberId: text("msg91_integrated_number_id"), // MSG91 integrated number ID for sending messages
  newApplicationCooldownDays: integer("new_application_cooldown_days").notNull().default(7),
  phoneNumberLength: integer("phone_number_length").notNull().default(10),
  updateLeadEnabled: text("update_lead_enabled").notNull().default("true"), // 'true' | 'false' - show Add Documents / Update Details options for duplicate phone
  useMasterTraining: text("use_master_training").notNull().default("true"), // 'true' | 'false' - apply custom AI instructions in WhatsApp flow
  useLeadTraining: text("use_lead_training").notNull().default("true"), // 'true' | 'false' - apply lead training config in WhatsApp flow
  whitelistEnabled: text("whitelist_enabled").notNull().default("false"), // 'true' | 'false' - only process messages from whitelisted numbers
  sessionTemplateName: text("session_template_name"), // Approved WhatsApp template name for re-engagement after 24h window expires
  sessionTemplateNamespace: text("session_template_namespace"), // Template namespace (if required by MSG91)
  docConfirmationEnabled: text("doc_confirmation_enabled").notNull().default("false"), // 'true' | 'false' - show extracted fields for user confirmation before proceeding
  docConfirmationMode: text("doc_confirmation_mode").notNull().default("per_document"), // 'per_document' | 'after_all_documents'
  docConfirmationHeader: text("doc_confirmation_header").default("Please review the details extracted from your document:"),
  docConfirmationFooter: text("doc_confirmation_footer").default("Are these details correct?"),
  // Use Case Mode (Phase 1) — root context signal for persona builder + flow exit-intent classifier.
  // Values: 'lead_capture' (internal staff submitting leads on behalf of customers — default for existing accounts),
  //         'direct_sales' (AI sells directly to prospects), 'customer_support' (AI helps existing customers).
  useCaseMode: text("use_case_mode").notNull().default("lead_capture"),
  // AI Setup (declutter) — response mode chooses how inbound messages are handled.
  // Values: 'smart_ai' (AI handles everything, flows bypassed), 'guided_flows' (scripted flows only,
  //         AI replies only on explicit flow handoff), 'both' (flows first, AI handles the rest).
  // null = legacy behavior (flow-first with AI fallback on unhandled) — preserved for existing accounts.
  aiResponseMode: text("ai_response_mode"),
  // Per-source knowledge toggles — control which training data is fed to the AI before it replies on WhatsApp.
  useFaqKnowledge: text("use_faq_knowledge").notNull().default("true"), // 'true' | 'false'
  useDocumentKnowledge: text("use_document_knowledge").notNull().default("true"), // 'true' | 'false'
  useWebsiteKnowledge: text("use_website_knowledge").notNull().default("true"), // 'true' | 'false'
  useProductCatalogKnowledge: text("use_product_catalog_knowledge").notNull().default("true"), // 'true' | 'false'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWhatsappSettingsSchema = createInsertSchema(whatsappSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  lastUserMessageAt: timestamp("last_user_message_at").notNull().defaultNow(),
  sessionActive: boolean("session_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueBusinessPhone: unique().on(table.businessAccountId, table.phoneNumber),
  businessPhoneIdx: index("wa_sessions_business_phone_idx").on(table.businessAccountId, table.phoneNumber),
}));

// WhatsApp Whitelist - Phone numbers allowed to interact with the AI agent
export const whatsappWhitelist = pgTable("whatsapp_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueBusinessPhone: unique().on(table.businessAccountId, table.phoneNumber),
}));

export const insertWhatsappWhitelistSchema = createInsertSchema(whatsappWhitelist).omit({
  id: true,
  createdAt: true,
});

// WhatsApp Leads - Store leads captured from WhatsApp messages
export const whatsappLeads = pgTable("whatsapp_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  whatsappMessageId: text("whatsapp_message_id"), // MSG91 message ID
  senderPhone: text("sender_phone"), // Salesman's phone number
  senderName: text("sender_name"), // Salesman name (if known)
  customerName: text("customer_name"), // Extracted customer name
  customerPhone: text("customer_phone"), // Extracted customer phone
  customerEmail: text("customer_email"), // Extracted customer email
  notes: text("notes"), // Any additional notes
  rawMessage: text("raw_message"), // Original WhatsApp message text
  extractedData: jsonb("extracted_data"), // Full AI extraction result as JSON
  status: text("status").notNull().default("new"), // 'new' | 'processing' | 'completed' | 'rejected' | 'message_only'
  direction: text("direction").notNull().default("incoming"), // 'incoming' | 'outgoing' - message direction
  flowSessionId: varchar("flow_session_id"), // Links message to a WhatsApp flow session for journey grouping
  leadsquaredLeadId: text("leadsquared_lead_id"), // LeadSquared lead ID if synced
  leadsquaredSyncStatus: text("leadsquared_sync_status"), // null | 'pending' | 'synced' | 'failed'
  leadsquaredSyncError: text("leadsquared_sync_error"), // Error message if sync failed
  customCrmSyncStatus: text("custom_crm_sync_status"), // null | 'pending' | 'synced' | 'failed'
  customCrmLeadId: text("custom_crm_lead_id"),
  customCrmSyncError: text("custom_crm_sync_error"),
  customCrmSyncPayload: jsonb("custom_crm_sync_payload"),
  customCrmSyncedAt: timestamp("custom_crm_synced_at"),
  // Verification engine (Task #5 — configurable verification engine POC)
  verificationResults: jsonb("verification_results"), // Last verification run result (see VerificationResult shape)
  verificationRunAt: timestamp("verification_run_at"), // When verification was last run on this lead
  lastMessageAt: timestamp("last_message_at"), // When the most recent message was received (for sorting by activity)
  lastMessage: text("last_message"), // Text of the most recent message
  conversationCount: integer("conversation_count").notNull().default(1), // Number of messages/interactions on this lead
  receivedAt: timestamp("received_at").notNull().defaultNow(), // When message was received
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessReceivedIdx: index("whatsapp_leads_business_received_idx").on(table.businessAccountId, table.receivedAt),
  businessLastMessageIdx: index("whatsapp_leads_business_last_message_idx").on(table.businessAccountId, table.lastMessageAt),
  blankPlaceholderUniqueIdx: uniqueIndex("whatsapp_leads_blank_placeholder_unique_idx")
    .on(table.businessAccountId, table.senderPhone)
    .where(sql`status = 'new' AND customer_name IS NULL AND extracted_data IS NULL`),
}));

export const insertWhatsappLeadSchema = createInsertSchema(whatsappLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// WhatsApp Lead Attachments - Store images and PDFs attached to WhatsApp messages
export const whatsappLeadAttachments = pgTable("whatsapp_lead_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => whatsappLeads.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  fileName: text("file_name"), // Original filename
  fileType: text("file_type"), // 'image' | 'pdf' | 'document'
  mimeType: text("mime_type"), // e.g., 'image/jpeg', 'application/pdf'
  fileSize: integer("file_size"), // File size in bytes
  filePath: text("file_path"), // Local path or S3 URL where file is stored
  mediaId: text("media_id"), // MSG91 media ID
  mediaUrl: text("media_url"), // Original MSG91 media URL
  caption: text("caption"), // Caption attached to media
  documentCategory: text("document_category"), // Identified doc type: 'pan_card', 'aadhaar_card', 'bank_statement', etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  leadIdx: index("whatsapp_lead_attachments_lead_idx").on(table.leadId),
}));

export const insertWhatsappLeadAttachmentSchema = createInsertSchema(whatsappLeadAttachments).omit({
  id: true,
  createdAt: true,
});

// WhatsApp Custom Lead Fields - Configurable fields for lead capture per business
export const whatsappLeadFields = pgTable("whatsapp_lead_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(), // Internal key for the field (e.g., "customer_name", "loan_amount", "course_name")
  fieldLabel: text("field_label").notNull(), // Display label (e.g., "Customer Name", "Loan Amount", "Course Name")
  fieldType: text("field_type").notNull().default("text"), // 'text' | 'number' | 'email' | 'phone' | 'currency'
  isRequired: boolean("is_required").notNull().default(false), // Whether this field is required for lead creation
  isDefault: boolean("is_default").notNull().default(false), // Whether this is a default/system field
  isEnabled: boolean("is_enabled").notNull().default(true), // Whether to extract this field
  displayOrder: integer("display_order").notNull().default(0), // Order in which to display the field
  defaultCrmFieldKey: text("default_crm_field_key"), // Optional default CRM field name for auto-mapping suggestions (e.g., "Name", "Mobile", "CompanyName")
  allowedValues: jsonb("allowed_values").$type<string[]>(), // Optional list of allowed values — AI will pick only from these
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessFieldKeyIdx: index("whatsapp_lead_fields_business_key_idx").on(table.businessAccountId, table.fieldKey),
}));

export const insertWhatsappLeadFieldSchema = createInsertSchema(whatsappLeadFields).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// WhatsApp Lead Field Types
export type InsertWhatsappLeadField = z.infer<typeof insertWhatsappLeadFieldSchema>;
export type WhatsappLeadField = typeof whatsappLeadFields.$inferSelect;

// WhatsApp Settings Types
export type InsertWhatsappSettings = z.infer<typeof insertWhatsappSettingsSchema>;
export type WhatsappSettings = typeof whatsappSettings.$inferSelect;

// WhatsApp Lead Types
export type InsertWhatsappLead = z.infer<typeof insertWhatsappLeadSchema>;
export type WhatsappLead = typeof whatsappLeads.$inferSelect;

// WhatsApp Lead Attachment Types
export type InsertWhatsappLeadAttachment = z.infer<typeof insertWhatsappLeadAttachmentSchema>;
export type WhatsappLeadAttachment = typeof whatsappLeadAttachments.$inferSelect;

// ============================================================================
// WhatsApp Structured Flows - Configurable conversation flows
// ============================================================================

// WhatsApp Flows - Define reusable conversation flows
export const whatsappFlows = pgTable("whatsapp_flows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Flow name (e.g., "Lead Capture Flow")
  description: text("description"), // Optional description
  isActive: text("is_active").notNull().default("false"), // 'true' | 'false' - Only one flow can be active per business
  triggerKeyword: text("trigger_keyword"), // Optional keyword to trigger this flow (e.g., "hi", "start")
  fallbackToAI: text("fallback_to_ai").notNull().default("true"), // 'true' | 'false' - Fallback to AI when user goes off-script
  sessionTimeout: integer("session_timeout").default(30), // Session timeout in minutes (default 30)
  completionMessage: text("completion_message").default("Thank you! Your information has been recorded."),
  repeatMode: text("repeat_mode").notNull().default("once"), // 'once' | 'loop' - Whether users can repeat the flow after completion
  verificationRuleSetId: varchar("verification_rule_set_id"), // Optional FK → verificationRuleSets.id. When set, finalizeSessionCompletion runs verification automatically.
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWhatsappFlowSchema = createInsertSchema(whatsappFlows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// WhatsApp Flow Steps - Individual steps within a flow
export const whatsappFlowSteps = pgTable("whatsapp_flow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flowId: varchar("flow_id").notNull().references(() => whatsappFlows.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(), // Unique key within flow (e.g., "start", "select_store", "capture_lead")
  stepOrder: integer("step_order").notNull().default(0), // Order for display/editing
  type: text("type").notNull().default("text"), // 'text' | 'buttons' | 'list' | 'input' | 'end'
  prompt: text("prompt").notNull(), // Message to send to user
  options: jsonb("options").$type<{
    buttons?: { id: string; title: string }[]; // For button type (max 3)
    dropdownItems?: { id: string; title: string; value: string; followUpPrompt?: string }[]; // For dropdown type (max 10). `title` shown to user, `value` stored in lead field.
    sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[]; // For list type
    buttonText?: string; // For list type - the main button text
    inputValidation?: string; // For input type - regex or validation type
    requiredFields?: string[]; // For text/input type - required fields that must be collected
    selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[]; // All selected fields with required/optional flag
  }>(), // Options for interactive messages
  nextStepMapping: jsonb("next_step_mapping").$type<{
    [optionId: string]: string; // Maps option ID to next step key
  }>(), // Conditional next step based on user selection
  defaultNextStep: text("default_next_step"), // Default next step if no mapping matches
  saveToField: text("save_to_field"), // Field name to save user response (e.g., "store_name", "customer_name")
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWhatsappFlowStepSchema = createInsertSchema(whatsappFlowSteps).omit({
  id: true,
  createdAt: true,
});

// WhatsApp Flow Sessions - Track user progress through a flow
export const whatsappFlowSessions = pgTable("whatsapp_flow_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  flowId: varchar("flow_id").notNull().references(() => whatsappFlows.id, { onDelete: "cascade" }),
  senderPhone: text("sender_phone").notNull(), // User's WhatsApp phone number
  currentStepKey: text("current_step_key").notNull(), // Current step in the flow
  status: text("status").notNull().default("active"), // 'active' | 'completed' | 'expired' | 'abandoned'
  collectedData: jsonb("collected_data").$type<Record<string, any>>().default({}), // Data collected during flow
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // Session expiry time (e.g., 24 hours)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWhatsappFlowSessionSchema = createInsertSchema(whatsappFlowSessions).omit({
  id: true,
  createdAt: true,
});

// WhatsApp Flow Types
export type InsertWhatsappFlow = z.infer<typeof insertWhatsappFlowSchema>;
export type WhatsappFlow = typeof whatsappFlows.$inferSelect;

export type InsertWhatsappFlowStep = z.infer<typeof insertWhatsappFlowStepSchema>;
export type WhatsappFlowStep = typeof whatsappFlowSteps.$inferSelect;

export type InsertWhatsappFlowSession = z.infer<typeof insertWhatsappFlowSessionSchema>;
export type WhatsappFlowSession = typeof whatsappFlowSessions.$inferSelect;

// ============================================================================
// Configurable Verification Engine (Task #5)
// Generic rule-set driven engine for verifying lead documents against
// admin-defined rules. First demo use case: Jain Online student admission.
// ============================================================================

export const verificationRuleSets = pgTable("verification_rule_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g. "Student Admission — Jain Online"
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isSystemSeed: boolean("is_system_seed").notNull().default(false), // Seeded by platform; can be cloned but not deleted
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessIdx: index("verification_rule_sets_business_idx").on(table.businessAccountId),
  businessNameUnique: uniqueIndex("verification_rule_sets_business_name_unique").on(table.businessAccountId, table.name),
}));

export const verificationRules = pgTable("verification_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleSetId: varchar("rule_set_id").notNull().references(() => verificationRuleSets.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(), // 'cross_field' | 'threshold' | 'chronology' | 'presence'
  name: text("name").notNull(), // Human label, e.g. "Name must match across docs"
  config: jsonb("config").notNull(), // Rule-type-specific JSON config (see executors)
  severity: text("severity").notNull().default("warning"), // 'info' | 'warning' | 'blocker'
  messageTemplate: text("message_template").notNull(), // Supports {field}, {values}, {docs} substitution
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  ruleSetIdx: index("verification_rules_rule_set_idx").on(table.ruleSetId),
}));

export const insertVerificationRuleSetSchema = createInsertSchema(verificationRuleSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVerificationRuleSchema = createInsertSchema(verificationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVerificationRuleSet = z.infer<typeof insertVerificationRuleSetSchema>;
export type VerificationRuleSet = typeof verificationRuleSets.$inferSelect;
export type InsertVerificationRule = z.infer<typeof insertVerificationRuleSchema>;
export type VerificationRule = typeof verificationRules.$inferSelect;

// =====================================================================
// WhatsApp Marketing Campaigns (gated by businessAccounts.whatsappMarketingEnabled)
// =====================================================================

// Reusable contact groups (CSV-imported audiences)
export const contactGroups = pgTable("contact_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  contactCount: integer("contact_count").notNull().default(0), // Cached count for fast listing
  // Default country code for this group (digits only, e.g. "91", "1", "44").
  // null = "Mixed" — every phone in the group must already include its own
  // country code. At campaign send time, 10-digit phones in groups with a
  // default code get the code prepended before being shipped to MSG91.
  defaultCountryCode: text("default_country_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertContactGroupSchema = createInsertSchema(contactGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Individual contacts inside a contact group
export const contactGroupContacts = pgTable("contact_group_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => contactGroups.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(), // Normalized phone digits only
  name: text("name").default(""),
  attributes: jsonb("attributes").$type<Record<string, string>>().default({}), // Extra CSV columns (city, etc.) usable as template params
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  groupIdx: index("contact_group_contacts_group_idx").on(table.groupId),
  bizGroupIdx: index("contact_group_contacts_biz_group_idx").on(table.businessAccountId, table.groupId),
}));

export const insertContactGroupContactSchema = createInsertSchema(contactGroupContacts).omit({
  id: true,
  createdAt: true,
});

// Approved WhatsApp templates (synced from MSG91 or created in-app)
export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // MSG91 template name (e.g. "promo_offer")
  language: text("language").notNull().default("en"),
  category: text("category").notNull().default("MARKETING"), // 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  bodyText: text("body_text").notNull().default(""), // Body with {{1}}, {{2}} placeholders
  headerType: text("header_type").default("none"), // 'none' | 'text' | 'image' | 'document' | 'video'
  headerText: text("header_text").default(""),
  headerMediaUrl: text("header_media_url").default(""),
  footerText: text("footer_text").default(""),
  buttons: jsonb("buttons").$type<{ type: string; text: string; url?: string; phone?: string }[]>().default([]),
  paramCount: integer("param_count").notNull().default(0), // Number of {{N}} body params
  status: text("status").notNull().default("draft"), // 'draft' | 'pending' | 'approved' | 'rejected'
  msg91TemplateId: text("msg91_template_id"), // External MSG91 template id once submitted
  namespace: text("namespace"), // WABA template namespace (required by MSG91 send payload)
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Reply classification config — defined PER CAMPAIGN, not hardcoded.
 *
 * This is what makes the campaign engine industry-agnostic. A debt-collection
 * campaign defines PTP / Can't Pay / Callback; an event campaign defines
 * Confirmed / Declined / Tentative. The AI classifier, the outcomes dashboard
 * and the CSV export all read this config at runtime, so supporting a new
 * vertical requires campaign config only — never a code change.
 */
export interface ClassificationCaptureField {
  fieldKey: string;                       // machine key, e.g. "ptp_date"
  fieldLabel: string;                     // human label, e.g. "Promised Payment Date"
  fieldType: "text" | "date" | "boolean"; // drives extraction hint + dashboard formatting
}
export interface ReplyClassification {
  key: string;          // stable machine key stored on the recipient row, e.g. "PTP"
  label: string;        // display label, e.g. "Promise to Pay"
  description: string;  // shown to the LLM classifier to disambiguate categories
  captureFields?: ClassificationCaptureField[]; // extra structured fields to extract
}

// Marketing campaign — a planned send to one or more groups
export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  templateId: varchar("template_id").notNull().references(() => whatsappTemplates.id, { onDelete: "restrict" }),
  templateParams: jsonb("template_params").$type<string[]>().default([]), // Static param values OR placeholders like "{{name}}" mapping to contact attributes
  groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]), // Target contact groups
  status: text("status").notNull().default("draft"), // 'draft' | 'scheduled' | 'sending' | 'completed' | 'cancelled' | 'failed'
  scheduledAt: timestamp("scheduled_at"), // When to send (null = send now once started)
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  repliedCount: integer("replied_count").notNull().default(0),
  optedOutCount: integer("opted_out_count").notNull().default(0),
  // Campaign-specific AI negotiation config
  aiEnabled: text("ai_enabled").notNull().default("true"), // 'true' | 'false'
  aiAgentName: text("ai_agent_name").default("Sales Agent"),
  aiSystemPrompt: text("ai_system_prompt").default(""), // Custom negotiation persona/instructions
  aiUseFaqs: text("ai_use_faqs").notNull().default("true"),
  aiUseDocs: text("ai_use_docs").notNull().default("true"),
  aiUseProducts: text("ai_use_products").notNull().default("true"),
  aiKnowledgeDocIds: jsonb("ai_knowledge_doc_ids").$type<string[]>().default([]), // Optional: scope to specific training docs
  // Reply classification — campaign-defined outcome categories. Empty array =
  // broadcast-only campaign, classification step is skipped entirely.
  replyClassifications: jsonb("reply_classifications").$type<ReplyClassification[]>().default([]),
  // Cost controls
  aiDailyTokenBudget: integer("ai_daily_token_budget").notNull().default(50000), // Per-day token cap for this campaign's AI replies
  aiMaxRepliesPerRecipient: integer("ai_max_replies_per_recipient").notNull().default(20), // Hard cap on AI turns per contact
  aiTokensUsedToday: integer("ai_tokens_used_today").notNull().default(0),
  aiUsageDate: text("ai_usage_date"), // YYYY-MM-DD bucket for daily reset
  // Liveness
  heartbeatAt: timestamp("heartbeat_at"), // Bumped each send-loop tick; powers stuck-campaign detection
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMarketingCampaignSchema = createInsertSchema(marketingCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  repliedCount: true,
  optedOutCount: true,
});

// Per-recipient row for a campaign (one per phone)
export const marketingCampaignRecipients = pgTable("marketing_campaign_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  groupId: varchar("group_id").references(() => contactGroups.id, { onDelete: "set null" }),
  phone: text("phone").notNull(), // Normalized phone
  name: text("name").default(""),
  attributes: jsonb("attributes").$type<Record<string, string>>().default({}),
  status: text("status").notNull().default("pending"), // 'pending' | 'claimed' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'expired' | 'opted_out' | 'replied'
  // Status lifecycle (industry-standard, mirrors Twilio / Infobip / Meta Cloud API):
  //   pending  → claimed → queued → sent → delivered → read → replied
  //                                     ↘ failed
  //                       (queued)  → expired (no provider confirmation within TTL)
  // 'queued'  = MSG91 returned 2xx and gave us a UUID; provider has accepted but Meta has NOT confirmed yet
  // 'sent'    = Meta confirmed acceptance via async delivery webhook (reportType ~ "sent"/"submitted")
  // 'expired' = Stuck in 'queued' beyond TTL (24h) — provider never sent a status update; treated as failure
  msg91MessageId: text("msg91_message_id"),
  errorMessage: text("error_message"),
  // Raw provider (MSG91) response payload from the send call. Stored so we
  // can debug "did this actually send?" questions without depending on log
  // file rotation. Populated on both success and documented-error responses.
  providerResponse: jsonb("provider_response"),
  // Canonical international phone (digits only, no +) actually shipped to
  // MSG91 — the result of applying the contact group's default country code
  // to `phone`. Persisted so inbound webhooks (which always carry the full
  // international sender number) can match the right recipient even when
  // `phone` itself is the local 10-digit form pasted into the contact group.
  sendPhone: text("send_phone"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  firstReplyAt: timestamp("first_reply_at"),
  replyCount: integer("reply_count").notNull().default(0),
  aiReplyCount: integer("ai_reply_count").notNull().default(0), // # AI replies sent to this recipient
  claimedAt: timestamp("claimed_at"), // When a worker claimed this row for sending; powers stale-claim recovery
  // ── Outcome tracking ──────────────────────────────────────────────────────
  // Populated by the AI classifier after each inbound reply. `primaryClassification`
  // holds a `key` from the owning campaign's replyClassifications list; `dispositionData`
  // holds that classification's captureFields (e.g. { ptp_date: "2026-09-05" }).
  // callbackRequired is promoted to a first-class column because "this person needs
  // a human" is universal across every vertical and drives an operational queue.
  primaryClassification: text("primary_classification"),
  dispositionData: jsonb("disposition_data").$type<Record<string, string>>().default({}),
  callbackRequired: boolean("callback_required").notNull().default(false),
  callbackReason: text("callback_reason"),
  customerFeedback: text("customer_feedback"), // verbatim customer statement, captured regardless of classification
  classifiedAt: timestamp("classified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  campaignIdx: index("mkt_recipients_campaign_idx").on(table.campaignId),
  bizPhoneIdx: index("mkt_recipients_biz_phone_idx").on(table.businessAccountId, table.phone),
  bizSentAtIdx: index("mkt_recipients_biz_sent_at_idx").on(table.businessAccountId, table.sentAt),
  campaignStatusIdx: index("mkt_recipients_campaign_status_idx").on(table.campaignId, table.status),
  msg91MsgIdx: index("mkt_recipients_msg91_msg_idx").on(table.businessAccountId, table.msg91MessageId),
  bizSendPhoneIdx: index("mkt_recipients_biz_send_phone_idx").on(table.businessAccountId, table.sendPhone),
}));

export const insertMarketingCampaignRecipientSchema = createInsertSchema(marketingCampaignRecipients).omit({
  id: true,
  createdAt: true,
});

// AI conversation transcript — every inbound + AI outbound for a campaign recipient
export const marketingCampaignMessages = pgTable("marketing_campaign_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  recipientId: varchar("recipient_id").notNull().references(() => marketingCampaignRecipients.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // 'outbound_template' | 'outbound_ai' | 'inbound'
  body: text("body").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  recipientCreatedIdx: index("mkt_messages_recipient_created_idx").on(table.recipientId, table.createdAt),
  campaignCreatedIdx: index("mkt_messages_campaign_created_idx").on(table.campaignId, table.createdAt),
}));

// Persistent webhook idempotency store — replaces in-memory dedup so it works across pods/restarts
export const webhookEvents = pgTable("webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // 'msg91' | other providers in future
  providerId: text("provider_id").notNull(), // Provider's unique message/event id (uuid, requestId, etc.)
  kind: text("kind").default("inbound"), // 'inbound' | 'delivery' | 'read' | 'failed' | 'sender_dedup'
  receivedAt: timestamp("received_at").notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("webhook_events_biz_source_pid_uniq").on(table.businessAccountId, table.source, table.providerId),
  receivedIdx: index("webhook_events_received_idx").on(table.receivedAt),
}));

export const insertMarketingCampaignMessageSchema = createInsertSchema(marketingCampaignMessages).omit({
  id: true,
  createdAt: true,
});

// STOP keyword opt-out registry (per business)
export const whatsappOptOuts = pgTable("whatsapp_opt_outs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(), // Normalized digits-only phone
  reason: text("reason").default("user_stop"), // 'user_stop' | 'manual' | 'bounce'
  campaignId: varchar("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }), // Campaign that triggered the opt-out (if any)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWhatsappOptOutSchema = createInsertSchema(whatsappOptOuts).omit({
  id: true,
  createdAt: true,
});

// Marketing types
export type InsertContactGroup = z.infer<typeof insertContactGroupSchema>;
export type ContactGroup = typeof contactGroups.$inferSelect;
export type InsertContactGroupContact = z.infer<typeof insertContactGroupContactSchema>;
export type ContactGroupContact = typeof contactGroupContacts.$inferSelect;
export type InsertWhatsappTemplate = z.infer<typeof insertWhatsappTemplateSchema>;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;
export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export type InsertMarketingCampaignRecipient = z.infer<typeof insertMarketingCampaignRecipientSchema>;
export type MarketingCampaignRecipient = typeof marketingCampaignRecipients.$inferSelect;
export type InsertMarketingCampaignMessage = z.infer<typeof insertMarketingCampaignMessageSchema>;
export type MarketingCampaignMessage = typeof marketingCampaignMessages.$inferSelect;
export type InsertWhatsappOptOut = z.infer<typeof insertWhatsappOptOutSchema>;
export type WhatsappOptOut = typeof whatsappOptOuts.$inferSelect;

// Chat Menu Configuration - Welcome screen settings
export const chatMenuConfigs = pgTable("chat_menu_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  enabled: text("enabled").notNull().default("false"), // 'true' | 'false' - Enable menu mode (vs direct chat)
  welcomeMessage: text("welcome_message").default("Hi! How can I help you today?"),
  avatarUrl: text("avatar_url"), // Optional custom avatar for menu screen
  quickChips: jsonb("quick_chips").$type<{ label: string; emoji?: string; action: string; actionValue?: string }[]>().default([]), // Quick action chips at top
  footerText: text("footer_text"), // Optional footer text (e.g., "Are you an existing customer? Login")
  footerLinkText: text("footer_link_text"), // Link text in footer
  footerLinkUrl: text("footer_link_url"), // Link URL in footer
  persistentCtaEnabled: text("persistent_cta_enabled").notNull().default("false"), // Show persistent CTA button
  persistentCtaLabel: text("persistent_cta_label").default("Talk to Counsellor"),
  persistentCtaIcon: text("persistent_cta_icon").default("phone"), // Icon name
  persistentCtaAction: text("persistent_cta_action").default("chat"), // 'chat' | 'url' | 'phone' | 'lead_form'
  persistentCtaValue: text("persistent_cta_value"), // URL or phone number
  persistentCtaStyle: text("persistent_cta_style").default("chatbox"), // 'chatbox' | 'plain'
  chatInsteadStyle: text("chat_instead_style").default("plain"), // 'chatbox' | 'plain'
  leadFormFields: text("lead_form_fields").default("name,phone"), // Comma-separated field names for lead form: 'name', 'phone', 'email'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertChatMenuConfigSchema = createInsertSchema(chatMenuConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Chat Menu Items - Hierarchical menu structure
export const chatMenuItems = pgTable("chat_menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id"), // Parent menu item ID for hierarchy (null for root items)
  title: text("title").notNull(),
  subtitle: text("subtitle"), // Description shown below title
  icon: text("icon").default("folder"), // Lucide icon name
  iconBgColor: text("icon_bg_color").default("#E0E7FF"), // Icon background color
  iconColor: text("icon_color").default("#4F46E5"), // Icon color
  sortOrder: integer("sort_order").notNull().default(0),
  itemType: text("item_type").notNull().default("navigate"), // 'navigate' | 'chat' | 'url' | 'phone' | 'form' | 'detail'
  actionValue: text("action_value"), // URL, phone, journey ID, or submenu ID based on itemType
  leadFormFields: text("lead_form_fields"), // JSON config for lead form fields when itemType is 'lead_form'
  isActive: text("is_active").notNull().default("true"), // 'true' | 'false'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertChatMenuItemSchema = createInsertSchema(chatMenuItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Chat Menu Item Details - Rich content for detail views
export const chatMenuItemDetails = pgTable("chat_menu_item_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuItemId: varchar("menu_item_id").notNull().references(() => chatMenuItems.id, { onDelete: "cascade" }),
  tabs: jsonb("tabs").$type<{ id: string; label: string; content: string }[]>().default([]), // Tabbed content
  tags: jsonb("tags").$type<{ label: string; color?: string }[]>().default([]), // Tags like "3 Years", "Popular"
  headerLinks: jsonb("header_links").$type<{ icon?: string; label: string; url: string }[]>().default([]), // Links like "Download Brochure"
  actionButtons: jsonb("action_buttons").$type<{ label: string; icon?: string; action: string; actionValue?: string; variant?: string }[]>().default([]), // CTA buttons
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertChatMenuItemDetailSchema = createInsertSchema(chatMenuItemDetails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVisitorDailyStatsSchema = createInsertSchema(visitorDailyStats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Chat Menu Types
export type InsertChatMenuConfig = z.infer<typeof insertChatMenuConfigSchema>;
export type ChatMenuConfig = typeof chatMenuConfigs.$inferSelect;

export type InsertChatMenuItem = z.infer<typeof insertChatMenuItemSchema>;
export type ChatMenuItem = typeof chatMenuItems.$inferSelect;

export type InsertChatMenuItemDetail = z.infer<typeof insertChatMenuItemDetailSchema>;
export type ChatMenuItemDetail = typeof chatMenuItemDetails.$inferSelect;

export type InsertVisitorDailyStats = z.infer<typeof insertVisitorDailyStatsSchema>;
export type VisitorDailyStats = typeof visitorDailyStats.$inferSelect;

export type InsertAccountGroupJourney = z.infer<typeof insertAccountGroupJourneySchema>;
export type AccountGroupJourney = typeof accountGroupJourneys.$inferSelect;
export type InsertAccountGroupJourneyStep = z.infer<typeof insertAccountGroupJourneyStepSchema>;
export type AccountGroupJourneyStep = typeof accountGroupJourneySteps.$inferSelect;

export type AccountGroupExtraSettings = typeof accountGroupExtraSettings.$inferSelect;

// Instagram Settings table (per business account)
export const instagramSettings = pgTable("instagram_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  instagramEnabled: text("instagram_enabled").notNull().default("true"), // 'true' | 'false' - master toggle for Instagram AI Agent
  igAccountId: text("ig_account_id"), // Instagram Professional Account ID (IG_ID)
  igAccessToken: text("ig_access_token"), // Encrypted Instagram User Access Token (long-lived)
  appSecret: text("app_secret"), // Encrypted Meta App Secret for webhook signature validation
  webhookVerifyToken: text("webhook_verify_token"), // Token for Meta webhook verification challenge
  autoReplyEnabled: text("auto_reply_enabled").notNull().default("false"), // 'true' | 'false' - enable AI auto-reply to Instagram DMs
  leadCaptureEnabled: text("lead_capture_enabled").notNull().default("true"), // 'true' | 'false' - enable/disable auto lead capture from flows
  commentAutoReplyEnabled: text("comment_auto_reply_enabled").notNull().default("false"), // 'true' | 'false' - enable AI auto-reply to Instagram comments
  commentReplyMode: text("comment_reply_mode").notNull().default("all"), // 'all' | 'keyword_only' - reply to all or only keyword-triggered comments
  commentTriggerKeywords: jsonb("comment_trigger_keywords"), // Array of trigger keywords: ["price", "link", "info"]
  commentReplyDelay: numeric("comment_reply_delay", { precision: 4, scale: 0 }).notNull().default("5"), // Seconds to wait before replying
  commentMaxRepliesPerPost: numeric("comment_max_replies_per_post", { precision: 4, scale: 0 }).notNull().default("50"), // Max auto-replies per post
  commentIgnoreOwnReplies: text("comment_ignore_own_replies").notNull().default("true"), // 'true' | 'false' - skip own account comments
  commentAutoDmEnabled: text("comment_auto_dm_enabled").notNull().default("false"), // 'true' | 'false' - auto-DM commenters
  commentDmMode: text("comment_dm_mode").notNull().default("all"), // 'all' | 'keyword_only'
  commentDmTriggerKeywords: jsonb("comment_dm_trigger_keywords"), // Keywords that trigger auto-DM
  commentDmTemplate: text("comment_dm_template"), // Custom instructions for AI DM content
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInstagramSettingsSchema = createInsertSchema(instagramSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Instagram Messages table (stores DM history)
export const instagramMessages = pgTable("instagram_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(), // Instagram-scoped ID of the user
  senderUsername: text("sender_username"), // Instagram username (if available from profile API)
  messageText: text("message_text"), // Text content of the message
  direction: text("direction").notNull().default("incoming"), // 'incoming' | 'outgoing'
  igMessageId: text("ig_message_id"), // Meta's message ID for deduplication
  messageType: text("message_type").notNull().default("text"), // 'text' | 'image' | 'story_mention' | 'story_reply'
  mediaUrl: text("media_url"), // URL for media attachments
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_ig_messages_business_sender").on(table.businessAccountId, table.senderId),
  index("idx_ig_messages_ig_msg_id").on(table.igMessageId),
]);

export const insertInstagramMessageSchema = createInsertSchema(instagramMessages).omit({
  id: true,
  createdAt: true,
});

// Instagram Comments table (stores comment auto-reply history)
export const instagramComments = pgTable("instagram_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  postId: text("post_id"), // Instagram media ID
  commentId: text("comment_id"), // Instagram comment ID (for deduplication)
  commentText: text("comment_text"), // The comment content
  commenterUsername: text("commenter_username"), // Who commented
  commenterId: text("commenter_id"), // Instagram user ID of commenter
  replyText: text("reply_text"), // AI-generated reply
  replyCommentId: text("reply_comment_id"), // The reply's Instagram comment ID
  status: text("status").notNull().default("pending"), // 'pending' | 'replied' | 'skipped' | 'failed'
  dmStatus: text("dm_status"), // 'sent' | 'failed' | null (no DM attempted)
  dmText: text("dm_text"), // AI-generated DM text that was sent
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_ig_comments_business").on(table.businessAccountId),
  index("idx_ig_comments_comment_id").on(table.commentId),
  index("idx_ig_comments_post_id").on(table.businessAccountId, table.postId),
]);

export const insertInstagramCommentSchema = createInsertSchema(instagramComments).omit({
  id: true,
  createdAt: true,
});

export type InsertInstagramSettings = z.infer<typeof insertInstagramSettingsSchema>;
export type InstagramSettings = typeof instagramSettings.$inferSelect;
export type InsertInstagramMessage = z.infer<typeof insertInstagramMessageSchema>;
export type InstagramMessage = typeof instagramMessages.$inferSelect;
export type InsertInstagramComment = z.infer<typeof insertInstagramCommentSchema>;
export type InstagramComment = typeof instagramComments.$inferSelect;

// ============================================================================
// Instagram Conversation Flows - Configurable conversation flows for Instagram DMs
// ============================================================================

export const instagramFlows = pgTable("instagram_flows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: text("is_active").notNull().default("false"),
  triggerKeyword: text("trigger_keyword"),
  fallbackToAI: text("fallback_to_ai").notNull().default("true"),
  sessionTimeout: integer("session_timeout").default(30),
  completionMessage: text("completion_message").default("Thank you! Your information has been recorded."),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInstagramFlowSchema = createInsertSchema(instagramFlows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const instagramFlowSteps = pgTable("instagram_flow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flowId: varchar("flow_id").notNull().references(() => instagramFlows.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  stepOrder: integer("step_order").notNull().default(0),
  type: text("type").notNull().default("text"),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<{
    buttons?: { id: string; title: string }[];
    inputValidation?: string;
    requiredFields?: string[];
    selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[];
  }>(),
  nextStepMapping: jsonb("next_step_mapping").$type<{
    [optionId: string]: string;
  }>(),
  defaultNextStep: text("default_next_step"),
  saveToField: text("save_to_field"),
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInstagramFlowStepSchema = createInsertSchema(instagramFlowSteps).omit({
  id: true,
  createdAt: true,
});

export const instagramFlowSessions = pgTable("instagram_flow_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  flowId: varchar("flow_id").notNull().references(() => instagramFlows.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  currentStepKey: text("current_step_key").notNull(),
  status: text("status").notNull().default("active"),
  collectedData: jsonb("collected_data").$type<Record<string, any>>().default({}),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInstagramFlowSessionSchema = createInsertSchema(instagramFlowSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertInstagramFlow = z.infer<typeof insertInstagramFlowSchema>;
export type InstagramFlow = typeof instagramFlows.$inferSelect;

export type InsertInstagramFlowStep = z.infer<typeof insertInstagramFlowStepSchema>;
export type InstagramFlowStep = typeof instagramFlowSteps.$inferSelect;

export type InsertInstagramFlowSession = z.infer<typeof insertInstagramFlowSessionSchema>;
export type InstagramFlowSession = typeof instagramFlowSessions.$inferSelect;

// ============================================================================
// Instagram Leads - Lead capture from Instagram DM flows
// ============================================================================

export const instagramLeads = pgTable("instagram_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderUsername: text("sender_username"),
  flowSessionId: varchar("flow_session_id"),
  extractedData: jsonb("extracted_data").$type<Record<string, any>>().default({}),
  status: text("status").notNull().default("new"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessReceivedIdx: index("instagram_leads_business_received_idx").on(table.businessAccountId, table.receivedAt),
}));

export const insertInstagramLeadSchema = createInsertSchema(instagramLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const instagramLeadFields = pgTable("instagram_lead_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  isRequired: boolean("is_required").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessFieldKeyIdx: index("instagram_lead_fields_business_key_idx").on(table.businessAccountId, table.fieldKey),
}));

export const insertInstagramLeadFieldSchema = createInsertSchema(instagramLeadFields).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInstagramLead = z.infer<typeof insertInstagramLeadSchema>;
export type InstagramLead = typeof instagramLeads.$inferSelect;

export type InsertInstagramLeadField = z.infer<typeof insertInstagramLeadFieldSchema>;
export type InstagramLeadField = typeof instagramLeadFields.$inferSelect;

// ============================================================================
// Master AI Settings (singleton table for superadmin-level AI provider config)
// ============================================================================

export const leadsquaredUrlExtractionCache = pgTable("leadsquared_url_extraction_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(),
  businessAccountId: varchar("business_account_id").notNull(),
  university: text("university"),
  product: text("product"),
  extractedAt: timestamp("extracted_at").notNull().defaultNow(),
}, (table) => ({
  urlBusinessUnique: unique("url_business_unique").on(table.url, table.businessAccountId),
}));

export type LeadsquaredUrlExtractionCache = typeof leadsquaredUrlExtractionCache.$inferSelect;

export const leadsquaredUrlRules = pgTable("leadsquared_url_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull(),
  urlPattern: text("url_pattern").notNull(),
  university: text("university"),
  product: text("product"),
  isEnabled: text("is_enabled").notNull().default("true"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  urlPatternBusinessUnique: unique("url_pattern_business_unique").on(table.urlPattern, table.businessAccountId),
}));

export type LeadsquaredUrlRule = typeof leadsquaredUrlRules.$inferSelect;

export const masterAiSettings = pgTable("master_ai_settings", {
  id: integer("id").primaryKey().default(1),
  primaryProvider: text("primary_provider").notNull().default("openai"),
  primaryApiKey: text("primary_api_key"),
  primaryModel: text("primary_model").notNull().default("gpt-4o-mini"),
  fallbackProvider: text("fallback_provider").notNull().default("gemini"),
  fallbackApiKey: text("fallback_api_key"),
  fallbackModel: text("fallback_model").notNull().default("gemini-1.5-flash"),
  masterEnabled: boolean("master_enabled").notNull().default(false),
  fallbackEnabled: boolean("fallback_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MasterAiSettings = typeof masterAiSettings.$inferSelect;
export type InsertMasterAiSettings = typeof masterAiSettings.$inferInsert;

// ============================================================================
// Facebook AI Agent - Settings, Messages, Comments, Flows, Leads
// ============================================================================

export const facebookSettings = pgTable("facebook_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().unique().references(() => businessAccounts.id, { onDelete: "cascade" }),
  facebookEnabled: text("facebook_enabled").notNull().default("true"),
  pageId: text("page_id"),
  pageAccessToken: text("page_access_token"),
  appSecret: text("app_secret"),
  webhookVerifyToken: text("webhook_verify_token"),
  autoReplyEnabled: text("auto_reply_enabled").notNull().default("false"),
  leadCaptureEnabled: text("lead_capture_enabled").notNull().default("true"),
  commentAutoReplyEnabled: text("comment_auto_reply_enabled").notNull().default("false"),
  commentReplyMode: text("comment_reply_mode").notNull().default("all"),
  commentTriggerKeywords: jsonb("comment_trigger_keywords"),
  commentReplyDelay: numeric("comment_reply_delay", { precision: 4, scale: 0 }).notNull().default("5"),
  commentMaxRepliesPerPost: numeric("comment_max_replies_per_post", { precision: 4, scale: 0 }).notNull().default("50"),
  commentIgnoreOwnReplies: text("comment_ignore_own_replies").notNull().default("true"),
  commentAutoDmEnabled: text("comment_auto_dm_enabled").notNull().default("false"),
  commentDmMode: text("comment_dm_mode").notNull().default("all"),
  commentDmTriggerKeywords: jsonb("comment_dm_trigger_keywords"),
  commentDmTemplate: text("comment_dm_template"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFacebookSettingsSchema = createInsertSchema(facebookSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const facebookMessages = pgTable("facebook_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name"),
  messageText: text("message_text"),
  direction: text("direction").notNull().default("incoming"),
  fbMessageId: text("fb_message_id"),
  messageType: text("message_type").notNull().default("text"),
  mediaUrl: text("media_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_fb_messages_business_sender").on(table.businessAccountId, table.senderId),
  index("idx_fb_messages_fb_msg_id").on(table.fbMessageId),
]);

export const insertFacebookMessageSchema = createInsertSchema(facebookMessages).omit({
  id: true,
  createdAt: true,
});

export const facebookComments = pgTable("facebook_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  postId: text("post_id"),
  commentId: text("comment_id"),
  commentText: text("comment_text"),
  commenterName: text("commenter_name"),
  commenterId: text("commenter_id"),
  replyText: text("reply_text"),
  replyCommentId: text("reply_comment_id"),
  status: text("status").notNull().default("pending"),
  dmStatus: text("dm_status"),
  dmText: text("dm_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_fb_comments_business").on(table.businessAccountId),
  index("idx_fb_comments_comment_id").on(table.commentId),
  index("idx_fb_comments_post_id").on(table.businessAccountId, table.postId),
]);

export const insertFacebookCommentSchema = createInsertSchema(facebookComments).omit({
  id: true,
  createdAt: true,
});

export const facebookFlows = pgTable("facebook_flows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: text("is_active").notNull().default("false"),
  triggerKeyword: text("trigger_keyword"),
  fallbackToAI: text("fallback_to_ai").notNull().default("true"),
  sessionTimeout: integer("session_timeout").default(30),
  completionMessage: text("completion_message").default("Thank you! Your information has been recorded."),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFacebookFlowSchema = createInsertSchema(facebookFlows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const facebookFlowSteps = pgTable("facebook_flow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flowId: varchar("flow_id").notNull().references(() => facebookFlows.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  stepOrder: integer("step_order").notNull().default(0),
  type: text("type").notNull().default("text"),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<{
    buttons?: { id: string; title: string }[];
    inputValidation?: string;
    requiredFields?: string[];
    selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[];
  }>(),
  nextStepMapping: jsonb("next_step_mapping").$type<{
    [optionId: string]: string;
  }>(),
  defaultNextStep: text("default_next_step"),
  saveToField: text("save_to_field"),
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFacebookFlowStepSchema = createInsertSchema(facebookFlowSteps).omit({
  id: true,
  createdAt: true,
});

export const facebookFlowSessions = pgTable("facebook_flow_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  flowId: varchar("flow_id").notNull().references(() => facebookFlows.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  currentStepKey: text("current_step_key").notNull(),
  status: text("status").notNull().default("active"),
  collectedData: jsonb("collected_data").$type<Record<string, any>>().default({}),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFacebookFlowSessionSchema = createInsertSchema(facebookFlowSessions).omit({
  id: true,
  createdAt: true,
});

export const facebookLeads = pgTable("facebook_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name"),
  flowSessionId: varchar("flow_session_id"),
  extractedData: jsonb("extracted_data").$type<Record<string, any>>().default({}),
  status: text("status").notNull().default("new"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessReceivedIdx: index("facebook_leads_business_received_idx").on(table.businessAccountId, table.receivedAt),
}));

export const insertFacebookLeadSchema = createInsertSchema(facebookLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const facebookLeadFields = pgTable("facebook_lead_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  isRequired: boolean("is_required").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  businessFieldKeyIdx: index("facebook_lead_fields_business_key_idx").on(table.businessAccountId, table.fieldKey),
}));

export const insertFacebookLeadFieldSchema = createInsertSchema(facebookLeadFields).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFacebookSettings = z.infer<typeof insertFacebookSettingsSchema>;
export type FacebookSettings = typeof facebookSettings.$inferSelect;
export type InsertFacebookMessage = z.infer<typeof insertFacebookMessageSchema>;
export type FacebookMessage = typeof facebookMessages.$inferSelect;
export type InsertFacebookComment = z.infer<typeof insertFacebookCommentSchema>;
export type FacebookComment = typeof facebookComments.$inferSelect;
export type InsertFacebookFlow = z.infer<typeof insertFacebookFlowSchema>;
export type FacebookFlow = typeof facebookFlows.$inferSelect;
export type InsertFacebookFlowStep = z.infer<typeof insertFacebookFlowStepSchema>;
export type FacebookFlowStep = typeof facebookFlowSteps.$inferSelect;
export type InsertFacebookFlowSession = z.infer<typeof insertFacebookFlowSessionSchema>;
export type FacebookFlowSession = typeof facebookFlowSessions.$inferSelect;
export type InsertFacebookLead = z.infer<typeof insertFacebookLeadSchema>;
export type FacebookLead = typeof facebookLeads.$inferSelect;
export type InsertFacebookLeadField = z.infer<typeof insertFacebookLeadFieldSchema>;
export type FacebookLeadField = typeof facebookLeadFields.$inferSelect;

// Custom CRM Settings - Configurable CRM integration for any in-house CRM API
export const customCrmSettings = pgTable("custom_crm_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }).unique(),
  enabled: boolean("enabled").notNull().default(false),
  name: text("name").notNull().default("Custom CRM"),
  apiBaseUrl: text("api_base_url"),
  apiEndpoint: text("api_endpoint"),
  httpMethod: text("http_method").notNull().default("POST"),
  contentType: text("content_type").notNull().default("form-data"),
  authType: text("auth_type").notNull().default("none"),
  authKey: text("auth_key"),
  authHeaderName: text("auth_header_name"),
  autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(false),
  callbackUrl: text("callback_url"),
  relayUrl: text("relay_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomCrmSettingsSchema = createInsertSchema(customCrmSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomCrmSettings = z.infer<typeof insertCustomCrmSettingsSchema>;
export type CustomCrmSettings = typeof customCrmSettings.$inferSelect;

// Custom CRM Field Mappings - Map CRM fields to WhatsApp lead data
export const customCrmFieldMappings = pgTable("custom_crm_field_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  crmField: text("crm_field").notNull(),
  sourceType: text("source_type").notNull(),
  sourceField: text("source_field"),
  customValue: text("custom_value"),
  displayName: text("display_name").notNull(),
  isEnabled: text("is_enabled").notNull().default("true"),
  sortOrder: integer("sort_order").notNull().default(0),
  isAutoManaged: boolean("is_auto_managed").notNull().default(false), // True when created by auto-sync from lead fields; user-edited mappings set this to false
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomCrmFieldMappingSchema = createInsertSchema(customCrmFieldMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomCrmFieldMapping = z.infer<typeof insertCustomCrmFieldMappingSchema>;
export type CustomCrmFieldMapping = typeof customCrmFieldMappings.$inferSelect;

export const crmStoreCredentials = pgTable("crm_store_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  dealerName: text("dealer_name").notNull(),
  storeName: text("store_name").notNull(),
  city: text("city"),
  storeId: integer("store_id"),
  sid: text("sid").notNull(),
  secret: text("secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrmStoreCredentialSchema = createInsertSchema(crmStoreCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCrmStoreCredential = z.infer<typeof insertCrmStoreCredentialSchema>;
export type CrmStoreCredential = typeof crmStoreCredentials.$inferSelect;

// ==========================================
// Per-business messaging (SMS/OTP) credentials
// ==========================================
// Holds MSG91 credentials + OTP SMS template body per business. When a row
// exists for a business, the OTP service uses these credentials in place of
// the platform-level MSG91_* env vars. The auth key is encrypted at rest
// (AES-256-GCM via encryptionService); sender_id / template_id / template
// body are non-secret. Expand-only: every column is nullable so adding a
// row never breaks existing widgets that rely on env-var defaults.
export const messagingCredentials = pgTable("messaging_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default('msg91'),
  msg91AuthKeyEncrypted: text("msg91_auth_key_encrypted"),
  msg91SenderId: text("msg91_sender_id"),
  msg91TemplateId: text("msg91_template_id"),
  otpTemplateBody: text("otp_template_body"),
  // Task #3: WhatsApp OTP delivery (alternative to SMS).
  // whatsappOtpTemplateName = name of an approved authentication-category
  // template in Meta Business Manager (one-time-password component). Nullable.
  // otpChannelPreference: 'sms' | 'whatsapp' | 'both'. Default 'sms' for
  // backward compatibility — existing businesses continue using MSG91 SMS.
  whatsappOtpTemplateName: text("whatsapp_otp_template_name"),
  otpChannelPreference: text("otp_channel_preference").default('sms'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_messaging_credentials_business").on(table.businessAccountId, table.provider),
]);

export const insertMessagingCredentialSchema = createInsertSchema(messagingCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMessagingCredential = z.infer<typeof insertMessagingCredentialSchema>;
export type MessagingCredential = typeof messagingCredentials.$inferSelect;

// ==========================================
// Cross-Platform Customer Identity Graph
// ==========================================

export const customerProfiles = pgTable("customer_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  normalizedPhone: varchar("normalized_phone"),
  normalizedEmail: varchar("normalized_email"),
  displayName: varchar("display_name"),
  city: varchar("city"),
  firstSeenPlatform: varchar("first_seen_platform").notNull(),
  lastActivePlatform: varchar("last_active_platform").notNull(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_cp_business_phone").on(table.businessAccountId, table.normalizedPhone),
  index("idx_cp_business_email").on(table.businessAccountId, table.normalizedEmail),
  uniqueIndex("idx_cp_unique_phone").on(table.businessAccountId, table.normalizedPhone).where(sql`normalized_phone IS NOT NULL`),
  uniqueIndex("idx_cp_unique_email").on(table.businessAccountId, table.normalizedEmail).where(sql`normalized_email IS NOT NULL`),
]);

export const insertCustomerProfileSchema = createInsertSchema(customerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomerProfile = z.infer<typeof insertCustomerProfileSchema>;
export type CustomerProfile = typeof customerProfiles.$inferSelect;

export const customerIdentities = pgTable("customer_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  platform: varchar("platform").notNull(),
  platformUserId: varchar("platform_user_id").notNull(),
  verified: boolean("verified").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_ci_unique_platform_user").on(table.businessAccountId, table.platform, table.platformUserId),
  index("idx_ci_profile").on(table.profileId),
]);

export const insertCustomerIdentitySchema = createInsertSchema(customerIdentities).omit({
  id: true,
  createdAt: true,
});

export type InsertCustomerIdentity = z.infer<typeof insertCustomerIdentitySchema>;
export type CustomerIdentity = typeof customerIdentities.$inferSelect;

export const customerMemorySnapshots = pgTable("customer_memory_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").notNull().references(() => customerProfiles.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  platform: varchar("platform").notNull(),
  summary: text("summary").notNull(),
  profileFacts: jsonb("profile_facts").$type<Record<string, any>>(),
  openIntents: text("open_intents"),
  journeyStage: varchar("journey_stage"),
  lastMessageAt: timestamp("last_message_at"),
  turnsSinceRefresh: integer("turns_since_refresh").notNull().default(0),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_cms_unique_profile_platform").on(table.profileId, table.platform),
  index("idx_cms_business").on(table.businessAccountId),
]);

export const insertCustomerMemorySnapshotSchema = createInsertSchema(customerMemorySnapshots).omit({
  id: true,
  updatedAt: true,
});

export type InsertCustomerMemorySnapshot = z.infer<typeof insertCustomerMemorySnapshotSchema>;
export type CustomerMemorySnapshot = typeof customerMemorySnapshots.$inferSelect;

export const customerMergeAudit = pgTable("customer_merge_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  survivorProfileId: varchar("survivor_profile_id").notNull(),
  mergedProfileId: varchar("merged_profile_id").notNull(),
  mergeReason: varchar("merge_reason"),
  mergedData: jsonb("merged_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_cma_business").on(table.businessAccountId),
  index("idx_cma_survivor").on(table.survivorProfileId),
]);

export const smartReplies = pgTable("smart_replies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  channel: varchar("channel").notNull(),
  keywords: text("keywords").notNull(),
  responseText: text("response_text").notNull(),
  responseUrl: text("response_url"),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_sr_business_channel").on(table.businessAccountId, table.channel),
]);

export const insertSmartReplySchema = createInsertSchema(smartReplies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const conversationAnalysisCache = pgTable("conversation_analysis_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: text("business_account_id").notNull(),
  conversationCount: integer("conversation_count").notNull(),
  analysisResult: text("analysis_result").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_cac_business_account").on(table.businessAccountId),
]);

export const conversationCategorySettings = pgTable("conversation_category_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  categories: jsonb("categories").$type<{ name: string; subcategories: string[] }[]>().notNull().default([]),
  allowOtherCategory: boolean("allow_other_category").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_ccs_business_account").on(table.businessAccountId),
]);

export const documentTypes = pgTable("document_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  isSystemDefault: boolean("is_system_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  promptTemplate: text("prompt_template"),
  extractionFields: jsonb("extraction_fields").$type<{ key: string; label: string; required: boolean; formatRegex?: string; formatDescription?: string }[]>().notNull().default([]),
  validationRules: jsonb("validation_rules").$type<{ duplicateCheck?: boolean; duplicateField?: string }>(),
  leadFieldMappings: jsonb("lead_field_mappings").$type<{ extractionFieldKey: string; leadFieldKey: string }[]>().notNull().default([]),
  confirmationRequired: text("confirmation_required"), // null = inherit global, 'always' = always confirm, 'never' = never confirm
  scanModel: text("scan_model"), // null = default 'gpt-4o-mini', or 'gpt-4o-mini' | 'gpt-4o' — primary OpenAI vision model used to scan/extract this document type
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_doc_types_business_key").on(table.businessAccountId, table.key),
]);

export const insertDocumentTypeSchema = createInsertSchema(documentTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const documentTypePromptHistory = pgTable("document_type_prompt_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentTypeId: varchar("document_type_id").notNull().references(() => documentTypes.id, { onDelete: "cascade" }),
  promptTemplate: text("prompt_template"),
  extractionFields: jsonb("extraction_fields").$type<{ key: string; label: string; required: boolean; formatRegex?: string; formatDescription?: string }[]>().notNull().default([]),
  validationRules: jsonb("validation_rules").$type<{ duplicateCheck?: boolean; duplicateField?: string }>(),
  version: integer("version").notNull(),
  changedBy: varchar("changed_by"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const k12Subjects = pgTable("k12_subjects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  language: text("language").notNull().default("en"),
  grade: text("grade"),
  board: text("board"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const k12Chapters = pgTable("k12_chapters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subjectId: varchar("subject_id").notNull().references(() => k12Subjects.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const k12Topics = pgTable("k12_topics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chapterId: varchar("chapter_id").notNull().references(() => k12Chapters.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  videoUrl: text("video_url"),
  videoTranscript: text("video_transcript"),
  mediaDuration: integer("media_duration"),
  revisionNotesHtml: text("revision_notes_html"),
  revisionNotesImageUrl: text("revision_notes_image_url"),
  externalRefId: text("external_ref_id"),
  tags: jsonb("tags").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const k12Questions = pgTable("k12_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  topicId: varchar("topic_id").notNull().references(() => k12Topics.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  questionHtml: text("question_html").notNull(),
  questionType: text("question_type").notNull().default("objective"),
  options: jsonb("options").$type<{ text: string; isCorrect: boolean }[]>().notNull().default([]),
  solutionHtml: text("solution_html"),
  difficulty: integer("difficulty").default(5),
  marks: integer("marks").default(1),
  externalRefId: text("external_ref_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const k12TopicNotes = pgTable("k12_topic_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  topicId: varchar("topic_id").notNull().references(() => k12Topics.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Revision Notes"),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const k12TopicVideos = pgTable("k12_topic_videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  topicId: varchar("topic_id").notNull().references(() => k12Topics.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Video"),
  videoUrl: text("video_url").notNull(),
  transcript: text("transcript"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type K12Subject = typeof k12Subjects.$inferSelect;
export type K12Chapter = typeof k12Chapters.$inferSelect;
export type K12Topic = typeof k12Topics.$inferSelect;
export type K12Question = typeof k12Questions.$inferSelect;
export type K12TopicNote = typeof k12TopicNotes.$inferSelect;
export type K12TopicVideo = typeof k12TopicVideos.$inferSelect;

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  requirements: text("requirements"),
  location: text("location"),
  salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
  salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
  currency: text("currency").default("INR"),
  jobType: text("job_type").notNull().default("full-time"),
  experienceLevel: text("experience_level"),
  department: text("department"),
  skills: jsonb("skills").$type<string[]>().default([]),
  textEmbedding: vector1536("text_embedding"),
  externalRefId: text("external_ref_id"),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const jobApplicants = pgTable("job_applicants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  resumeUrl: text("resume_url"),
  resumeText: text("resume_text"),
  skills: jsonb("skills").$type<string[]>().default([]),
  experienceSummary: text("experience_summary"),
  source: text("source").notNull().default("manual"),
  conversationId: varchar("conversation_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const jobApplications = pgTable("job_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  applicantId: varchar("applicant_id").notNull().references(() => jobApplicants.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("new"),
  matchScore: numeric("match_score", { precision: 5, scale: 2 }),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobs);
export const insertJobApplicantSchema = createInsertSchema(jobApplicants);
export const insertJobApplicationSchema = createInsertSchema(jobApplications);

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;
export type JobApplicant = typeof jobApplicants.$inferSelect;
export type InsertJobApplicant = typeof jobApplicants.$inferInsert;
export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;

// Demo Orders table — self-contained order data for demo/presentation purposes
export const demoOrders = pgTable("demo_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull(), // e.g., #LB1023
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  productName: text("product_name").notNull(),
  productDescription: text("product_description"),
  productImageUrl: text("product_image_url"),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("confirmed"), // confirmed | processing | shipped | out_for_delivery | delivered | return_requested | cancelled
  courier: text("courier"), // e.g., Delhivery, DTDC, BlueDart
  trackingNumber: text("tracking_number"),
  estimatedDelivery: date("estimated_delivery"),
  orderDate: date("order_date"),
  items: jsonb("items").$type<Array<{ name: string; quantity: number; price: number }>>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDemoOrderSchema = createInsertSchema(demoOrders).omit({ id: true, createdAt: true, updatedAt: true });
export type DemoOrder = typeof demoOrders.$inferSelect;
export type InsertDemoOrder = z.infer<typeof insertDemoOrderSchema>;

// ============================================================================
// TopScholar curriculum chatbot (client-hosted RAG), scoped to the TopScholar
// business account. These are OUR tables; they may live in the local DB (stand-in)
// or be bootstrapped into the client's content DB later via config (connection string).
// Expand-only: all new columns are nullable or defaulted.
// ============================================================================

// Admin-uploaded mapping: cp_id -> human-readable board / medium / grade (display-only).
// The cp_id is the hard partition key; board/medium/grade are reverse-derived for display.
export const topscholarCpMappings = pgTable("topscholar_cp_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  cpId: text("cp_id").notNull(),
  board: text("board"),
  medium: text("medium"),
  grade: text("grade"),
  subject: text("subject"), // CMS-provided subject name (expand-only; nullable for legacy rows)
  subjectId: text("subject_id"), // CMS-provided subject id (expand-only; nullable for legacy rows)
  label: text("label"), // optional precomputed display label, e.g. "9 · CBSE · Mathematics"
  cpName: text("cp_name"), // human name from the Content Bundle API (e.g. "6th CBSE Mathematics")
  planId: text("plan_id"), // the Plan ID whose content-bundle resolved to this cp_id (for re-sync traceability)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  cpUnique: uniqueIndex("topscholar_cp_mappings_account_cp_idx").on(table.businessAccountId, table.cpId),
}));

// Saved master list of Plan IDs that drive ingestion via the Content Bundle API.
// A scheduled worker (and the "Sync now" action) fetch these plans, split each by cp_id,
// embed and store the content. lastCpId/lastCpName/status are filled in after each run.
export const topscholarPlanIds = pgTable("topscholar_plan_ids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  enabled: text("enabled").notNull().default("true"), // 'true' | 'false' - include in scheduled / sync-now runs
  lastStatus: text("last_status").notNull().default("idle"), // 'idle' | 'syncing' | 'completed' | 'failed'
  lastError: text("last_error"),
  lastCpId: text("last_cp_id"), // cp_id this plan resolved to on the last run
  lastCpName: text("last_cp_name"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  planUnique: uniqueIndex("topscholar_plan_ids_account_plan_idx").on(table.businessAccountId, table.planId),
}));

// Plan -> cp_id resolution snapshot. The Content Bundle API returns MULTIPLE cp_ids
// under one Plan ID; this records that one-to-many relationship together with a
// content-count snapshot (notes/transcripts/questions/pdfs) so the admin can list
// every cp_id under a plan with its counts and label without re-fetching. The
// "Resolve" action refreshes these rows; this supersedes the singular
// lastCpId/lastCpName fields on topscholarPlanIds (kept, logically deprecated).
export const topscholarPlanCpResolutions = pgTable("topscholar_plan_cp_resolutions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  cpId: text("cp_id").notNull(),
  cpName: text("cp_name"),
  board: text("board"),
  medium: text("medium"),
  grade: text("grade"),
  subject: text("subject"), // CMS-provided subject name (expand-only; nullable for legacy rows)
  subjectId: text("subject_id"), // CMS-provided subject id (expand-only; nullable for legacy rows)
  label: text("label"), // precomputed display label, e.g. "9 · CBSE · Mathematics"
  noteCount: integer("note_count").notNull().default(0),
  transcriptCount: integer("transcript_count").notNull().default(0),
  questionCount: integer("question_count").notNull().default(0),
  pdfCount: integer("pdf_count").notNull().default(0),
  lastResolvedAt: timestamp("last_resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  planCpUnique: uniqueIndex("topscholar_plan_cp_resolutions_account_plan_cp_idx").on(table.businessAccountId, table.planId, table.cpId),
  planIdx: index("topscholar_plan_cp_resolutions_account_plan_idx").on(table.businessAccountId, table.planId),
}));

// Embedded curriculum content chunks. Vector search is always filtered by (businessAccountId, cpId).
export const topscholarContentChunks = pgTable("topscholar_content_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull(),
  cpId: text("cp_id").notNull(),
  contentType: text("content_type").notNull(), // 'note' | 'transcript' | 'ebook_page' | 'question'
  subject: text("subject"),
  subjectId: text("subject_id"), // CMS-provided subject id (expand-only; nullable for legacy rows)
  chapter: text("chapter"),
  title: text("title"),
  contentHtml: text("content_html"), // original HTML+MathML for notes / rich rendering
  contentText: text("content_text").notNull(), // plain text used for embedding + display
  sourceRef: text("source_ref"), // e.g. cms object id / page id / question id
  mediaUrl: text("media_url"), // associated image (S3 JPEG) or video URL
  embedding: vector1536("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  contentHash: text("content_hash"), // hash of source content to skip re-embedding unchanged chunks
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  accountCpIdx: index("topscholar_chunks_account_cp_idx").on(table.businessAccountId, table.cpId),
  accountCpTypeIdx: index("topscholar_chunks_account_cp_type_idx").on(table.businessAccountId, table.cpId, table.contentType),
}));

// Per cp_id ingestion/sync state for admin visibility and idempotent re-runs.
export const topscholarContentSync = pgTable("topscholar_content_sync", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  cpId: text("cp_id").notNull(),
  status: text("status").notNull().default("idle"), // 'idle' | 'syncing' | 'completed' | 'failed' | 'cancelled'
  chunkCount: integer("chunk_count").notNull().default(0),
  noteCount: integer("note_count").notNull().default(0),
  transcriptCount: integer("transcript_count").notNull().default(0),
  ebookPageCount: integer("ebook_page_count").notNull().default(0),
  questionCount: integer("question_count").notNull().default(0),
  mediaCount: integer("media_count").notNull().default(0),
  syncMode: text("sync_mode").notNull().default("full"), // 'sample' | 'full' - sample uses regular API (instant), full uses OpenAI Batch API (50% cheaper, async)
  storeType: text("store_type").notNull().default("pgvector"), // 'pgvector' | 'mongodb' - where embeddings were written for this run
  processedCount: integer("processed_count").notNull().default(0), // chunks embedded+stored so far (for live progress)
  totalCount: integer("total_count").notNull().default(0), // total chunks targeted this run
  embedJobId: varchar("embed_job_id"), // active topscholarEmbedJobs.id while a full (batch) sync is in flight; NULL when idle/completed
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  syncUnique: uniqueIndex("topscholar_content_sync_account_cp_idx").on(table.businessAccountId, table.cpId),
}));

// Async embedding jobs for FULL sync via the OpenAI Batch API. A full sync of one
// cp_id creates exactly one job. The job may map to MULTIPLE OpenAI batches when a
// cp_id has more chunks than a single batch allows (>~45k); each batch's lifecycle
// is tracked inside the `batches` JSON array. A background poller advances jobs from
// submitted -> completed, surviving server restarts.
export const topscholarEmbedJobs = pgTable("topscholar_embed_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  cpId: text("cp_id").notNull(),
  status: text("status").notNull().default("preparing"), // 'preparing' | 'submitted' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  storeType: text("store_type").notNull().default("pgvector"), // 'pgvector' | 'mongodb' - destination once embeddings return
  syncMode: text("sync_mode").notNull().default("full"),
  totalCount: integer("total_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  // [{ batchId, inputFileId, outputFileId, status, count }]
  batches: jsonb("batches").$type<Array<{ batchId: string; inputFileId: string; outputFileId: string | null; status: string; count: number }>>().notNull().default([]),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  jobAccountCpIdx: index("topscholar_embed_jobs_account_cp_idx").on(table.businessAccountId, table.cpId),
  jobStatusIdx: index("topscholar_embed_jobs_status_idx").on(table.status),
}));

// Staged chunk records awaiting embeddings from an in-flight Batch API job. Holds
// the full chunk payload (minus the embedding) so that when the batch completes —
// possibly hours later, possibly after a restart — we can join custom_id -> embedding
// and write the final documents to the destination store. Cleared once the job lands.
export const topscholarEmbedStaging = pgTable("topscholar_embed_staging", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => topscholarEmbedJobs.id, { onDelete: "cascade" }),
  customId: text("custom_id").notNull(), // matches the JSONL custom_id, format `${jobId}__${index}`
  businessAccountId: varchar("business_account_id").notNull(),
  cpId: text("cp_id").notNull(),
  contentType: text("content_type").notNull(),
  subject: text("subject"),
  subjectId: text("subject_id"),
  chapter: text("chapter"),
  title: text("title"),
  contentHtml: text("content_html"),
  contentText: text("content_text").notNull(),
  sourceRef: text("source_ref"),
  mediaUrl: text("media_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  contentHash: text("content_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  stagingJobIdx: index("topscholar_embed_staging_job_idx").on(table.jobId),
  stagingCustomIdx: index("topscholar_embed_staging_custom_idx").on(table.jobId, table.customId),
}));

// A durable, admin-triggered Plan-level full-sync run. The worker resolves the
// current CP IDs for a plan before creating the child work records below, so the
// UI can show stable progress and safely resume after a process restart.
export const topscholarPlanRuns = pgTable("topscholar_plan_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  requestedCpId: text("requested_cp_id"), // null = complete Plan; set = targeted CP maintenance run
  mode: text("mode").notNull().default("full"),
  status: text("status").notNull().default("queued"), // 'queued' | 'resolving' | 'running' | 'completed' | 'failed' | 'cancelled'
  totalCpIds: integer("total_cp_ids").notNull().default(0),
  completedCpIds: integer("completed_cp_ids").notNull().default(0),
  failedCpIds: integer("failed_cp_ids").notNull().default(0),
  activeCpId: text("active_cp_id"),
  error: text("error"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  accountPlanUpdatedIdx: index("topscholar_plan_runs_account_plan_updated_idx").on(table.businessAccountId, table.planId, table.updatedAt),
  accountStatusIdx: index("topscholar_plan_runs_account_status_idx").on(table.businessAccountId, table.status),
  activePlanUnique: uniqueIndex("topscholar_plan_runs_active_plan_unique")
    .on(table.businessAccountId, table.planId)
    .where(sql`${table.requestedCpId} IS NULL AND ${table.status} IN ('queued', 'resolving', 'running')`),
  activeCpUnique: uniqueIndex("topscholar_plan_runs_active_cp_unique")
    .on(table.businessAccountId, table.planId, table.requestedCpId)
    .where(sql`${table.requestedCpId} IS NOT NULL AND ${table.status} IN ('queued', 'resolving', 'running')`),
}));

// One durable work item per resolved CP ID inside a Plan run. Raw curriculum
// content deliberately never lives here: the worker fetches it only when it is
// ready to process the CP ID, preserving the client-data isolation guarantee.
export const topscholarPlanRunItems = pgTable("topscholar_plan_run_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => topscholarPlanRuns.id, { onDelete: "cascade" }),
  businessAccountId: varchar("business_account_id").notNull().references(() => businessAccounts.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  cpId: text("cp_id").notNull(),
  status: text("status").notNull().default("queued"), // 'queued' | 'running' | 'submitted' | 'completed' | 'failed' | 'cancelled'
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  runCpUnique: uniqueIndex("topscholar_plan_run_items_run_cp_idx").on(table.runId, table.cpId),
  runStatusIdx: index("topscholar_plan_run_items_run_status_idx").on(table.runId, table.status),
  accountCpIdx: index("topscholar_plan_run_items_account_cp_idx").on(table.businessAccountId, table.cpId),
}));

// One short-lived worker lease per account. It ensures a horizontally scaled
// app cannot process two direct client-database CP IDs for the same tenant at
// once, while allowing unrelated accounts to make progress independently.
export const topscholarPlanSyncLeases = pgTable("topscholar_plan_sync_leases", {
  businessAccountId: varchar("business_account_id").primaryKey().references(() => businessAccounts.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTopscholarPlanIdSchema = createInsertSchema(topscholarPlanIds).omit({ id: true, createdAt: true, updatedAt: true });
export type TopscholarPlanId = typeof topscholarPlanIds.$inferSelect;
export type InsertTopscholarPlanId = typeof topscholarPlanIds.$inferInsert;

export const insertTopscholarPlanCpResolutionSchema = createInsertSchema(topscholarPlanCpResolutions).omit({ id: true, createdAt: true, updatedAt: true });
export type TopscholarPlanCpResolution = typeof topscholarPlanCpResolutions.$inferSelect;
export type InsertTopscholarPlanCpResolution = typeof topscholarPlanCpResolutions.$inferInsert;

export const insertTopscholarCpMappingSchema = createInsertSchema(topscholarCpMappings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTopscholarContentChunkSchema = createInsertSchema(topscholarContentChunks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTopscholarContentSyncSchema = createInsertSchema(topscholarContentSync).omit({ id: true, createdAt: true, updatedAt: true });

export type TopscholarCpMapping = typeof topscholarCpMappings.$inferSelect;
export type InsertTopscholarCpMapping = typeof topscholarCpMappings.$inferInsert;
export type TopscholarContentChunk = typeof topscholarContentChunks.$inferSelect;
export type InsertTopscholarContentChunk = typeof topscholarContentChunks.$inferInsert;
export type TopscholarContentSync = typeof topscholarContentSync.$inferSelect;
export type InsertTopscholarContentSync = typeof topscholarContentSync.$inferInsert;
export type TopscholarEmbedJob = typeof topscholarEmbedJobs.$inferSelect;
export type InsertTopscholarEmbedJob = typeof topscholarEmbedJobs.$inferInsert;
export type TopscholarEmbedStaging = typeof topscholarEmbedStaging.$inferSelect;
export type InsertTopscholarEmbedStaging = typeof topscholarEmbedStaging.$inferInsert;
export type TopscholarPlanRun = typeof topscholarPlanRuns.$inferSelect;
export type InsertTopscholarPlanRun = typeof topscholarPlanRuns.$inferInsert;
export type TopscholarPlanRunItem = typeof topscholarPlanRunItems.$inferSelect;
export type InsertTopscholarPlanRunItem = typeof topscholarPlanRunItems.$inferInsert;
