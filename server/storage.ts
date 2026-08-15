// Reference: javascript_database blueprint - updated for chat application
import { 
  users, 
  conversations, 
  messages,
  uploadedImages,
  products,
  faqs,
  leads,
  businessAccounts,
  widgetSettings,
  passwordResetTokens,
  phoneOtpChallenges,
  type PhoneOtpChallenge,
  type InsertPhoneOtpChallenge,
  websiteAnalysis,
  analyzedPages,
  trainingDocuments,
  categories,
  tags,
  productCategories,
  productTags,
  productRelationships,
  scheduleTemplates,
  slotOverrides,
  appointments,
  demoPages,
  publicChatLinks,
  supportTickets,
  ticketMessages,
  ticketAttachments,
  cannedResponses,
  ticketInsights,
  questionBankEntries,
  conversationJourneys,
  journeySteps,
  journeyResponses,
  journeySessions,
  accountGroups,
  accountGroupMembers,
  accountGroupTraining,
  accountGroupLeadsquaredFieldMappings,
  aiUsageEvents,
  discountRules,
  discountOffers,
  intentScores,
  exitIntentSettings,
  idleTimeoutSettings,
  chatMenuConfigs,
  chatMenuItems,
  visitorDailyStats,
  masterAiSettings,
  type MasterAiSettings,
  type User, 
  type InsertUser,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type UploadedImage,
  type InsertUploadedImage,
  type Product,
  type InsertProduct,
  type Faq,
  type InsertFaq,
  type Lead,
  type InsertLead,
  type BusinessAccount,
  type InsertBusinessAccount,
  type WidgetSettings,
  type InsertWidgetSettings,
  type PasswordResetToken,
  type InsertPasswordResetToken,
  type WebsiteAnalysis,
  type InsertWebsiteAnalysis,
  type AnalyzedPage,
  type InsertAnalyzedPage,
  type TrainingDocument,
  type InsertTrainingDocument,
  type Category,
  type InsertCategory,
  type Tag,
  type InsertTag,
  type ProductCategory,
  type InsertProductCategory,
  type ProductTag,
  type InsertProductTag,
  type ProductRelationship,
  type InsertProductRelationship,
  type ScheduleTemplate,
  type InsertScheduleTemplate,
  type SlotOverride,
  type InsertSlotOverride,
  type Appointment,
  type InsertAppointment,
  type DemoPage,
  type InsertDemoPage,
  type PublicChatLink,
  type InsertPublicChatLink,
  type SupportTicket,
  type InsertSupportTicket,
  type TicketMessage,
  type InsertTicketMessage,
  type TicketAttachment,
  type InsertTicketAttachment,
  type CannedResponse,
  type InsertCannedResponse,
  type TicketInsight,
  type InsertTicketInsight,
  type QuestionBankEntry,
  type InsertQuestionBankEntry,
  type ConversationJourney,
  type InsertConversationJourney,
  type JourneyStep,
  type InsertJourneyStep,
  type JourneyResponse,
  type JourneySession,
  type AccountGroup,
  type InsertAccountGroup,
  type AccountGroupMember,
  type InsertAccountGroupMember,
  type AccountGroupTraining,
  type InsertAccountGroupTraining,
  type AccountGroupLeadsquaredFieldMapping,
  type InsertAccountGroupLeadsquaredFieldMapping,
  accountGroupJourneys,
  accountGroupJourneySteps,
  type AccountGroupJourney,
  type InsertAccountGroupJourney,
  type AccountGroupJourneyStep,
  type InsertAccountGroupJourneyStep,
  accountGroupExtraSettings,
  type AccountGroupExtraSettings,
  type DiscountRule,
  type InsertDiscountRule,
  type ExitIntentSettings,
  type InsertExitIntentSettings,
  type IdleTimeoutSettings,
  type InsertIdleTimeoutSettings,
  productImportJobs,
  type ProductImportJob,
  type InsertProductImportJob,
  restoreHistory,
  type RestoreHistory,
  type InsertRestoreHistory,
  backupJobs,
  type BackupJob,
  type InsertBackupJob,
  guidanceCampaigns,
  type GuidanceCampaign,
  type InsertGuidanceCampaign,
  proactiveGuidanceRules,
  type ProactiveGuidanceRule,
  type InsertProactiveGuidanceRule,
  leadsquaredFieldMappings,
  type LeadsquaredFieldMapping,
  type InsertLeadsquaredFieldMapping,
  salesforceFieldMappings,
  type SalesforceFieldMapping,
  type InsertSalesforceFieldMapping,
  instagramComments,
  type InstagramComment,
  type InsertInstagramComment,
  facebookComments,
  facebookLeads,
  facebookFlows,
  facebookFlowSteps,
  facebookFlowSessions,
  facebookLeadFields,
  jobs,
  jobApplicants,
  jobApplications,
  type Job,
  type InsertJob,
  type JobApplicant,
  type InsertJobApplicant,
  type JobApplication,
  type InsertJobApplication,
  type FacebookComment,
  type InsertFacebookComment,
  type FacebookLead,
  type InsertFacebookLead,
  type FacebookFlow,
  type InsertFacebookFlow,
  type FacebookFlowStep,
  type InsertFacebookFlowStep,
  type FacebookFlowSession,
  type InsertFacebookFlowSession,
  type FacebookLeadField,
  type InsertFacebookLeadField
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, count, inArray, sql, and, or, gte, lte, ilike, isNull } from "drizzle-orm";
import { isTopscholarAccount } from "./services/topscholar/config";
import { closeDoubt } from "./services/topscholar/doubtSyncService";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByBusinessAccountId(businessAccountId: string): Promise<User | undefined>;
  getUserByUsernameAndRole(username: string, role: string): Promise<User | undefined>;
  getSuperadmins(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  createUserWithTempPassword(user: InsertUser & { tempPassword: string; tempPasswordExpiry: Date; mustChangePassword: string }): Promise<User>;
  updateUserLastLogin(id: string): Promise<void>;
  updateUserPassword(id: string, passwordHash: string): Promise<void>;
  updateUser(id: string, updates: Partial<{ businessAccountId: string }>): Promise<User>;
  resetUserPassword(id: string, passwordHash: string, tempPassword: string, tempPasswordExpiry: Date): Promise<User>;
  clearTempPassword(id: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getUsersByBusinessAccount(businessAccountId: string): Promise<User[]>;

  // Business Account methods
  createBusinessAccount(account: InsertBusinessAccount): Promise<BusinessAccount>;
  getBusinessAccount(id: string): Promise<BusinessAccount | undefined>;
  getAllBusinessAccounts(limit?: number, offset?: number): Promise<BusinessAccount[]>;
  getBusinessAccountsCount(): Promise<number>;
  getBusinessAccountsWithPageviewStatus(businessAccountIds: string[]): Promise<Map<string, boolean>>;
  updateBusinessAccount(id: string, updates: Partial<{ name: string; website: string; productTier: string }>): Promise<BusinessAccount>;
  updateBusinessAccountDescription(id: string, description: string): Promise<BusinessAccount>;
  updateBusinessAccountStatus(id: string, status: string): Promise<BusinessAccount>;
  updateBusinessAccountFeatures(id: string, features: Partial<{ shopifyEnabled: string; appointmentsEnabled: string; voiceModeEnabled: string; visualSearchEnabled: string }>): Promise<BusinessAccount>;
  updateBusinessAccountAutonomousSettings(id: string, settings: Partial<{ autoResolutionEnabled: string; autoResolutionConfidence: string; escalationSensitivity: string; humanOnlyCategories: string }>): Promise<BusinessAccount>;
  updateBusinessAccountOpenAIKey(id: string, apiKey: string | null): Promise<BusinessAccount>;
  updateBusinessAccountElevenLabsKey(id: string, apiKey: string | null): Promise<BusinessAccount>;
  updateBusinessAccountJinaKey(id: string, apiKey: string | null): Promise<BusinessAccount>;
  updateBusinessAccountVisualSearchModel(id: string, settings: Partial<{ visualSearchModel: string; googleVisionWarehouseCorpusId: string | null; googleVisionWarehouseIndexId: string | null; googleVisionWarehouseEndpointId: string | null; googleVisionWarehouseCredentials: string | null; googleVisionWarehouseProjectNumber: string | null }>): Promise<BusinessAccount>;
  deleteBusinessAccountWithAllData(id: string): Promise<void>;
  getBusinessAnalytics(businessAccountId?: string, dateFrom?: Date, dateTo?: Date): Promise<any[]>;
  
  // Phone OTP challenge methods (opt-in widget mobile verification)
  createOtpChallenge(data: InsertPhoneOtpChallenge): Promise<PhoneOtpChallenge>;
  countOtpChallengesByPhoneSince(businessAccountId: string, phoneE164: string, since: Date): Promise<number>;
  countOtpChallengesByBusinessSince(businessAccountId: string, since: Date): Promise<number>;
  getOldestOtpChallengeByPhoneSince(businessAccountId: string, phoneE164: string, since: Date): Promise<PhoneOtpChallenge | undefined>;
  recordOtpChallengeSent(id: string, providerMessageId: string): Promise<void>;
  recordOtpChallengeFailure(id: string, failureReason: string): Promise<void>;
  invalidateOtpChallenge(id: string, reason: string): Promise<void>;
  getLatestOtpChallengeByConversation(businessAccountId: string, conversationId: string): Promise<PhoneOtpChallenge | undefined>;
  hasVerifiedOtpForConversationPhone(businessAccountId: string, conversationId: string, phoneE164: string): Promise<boolean>;
  getLatestOtpChallengeByPhone(businessAccountId: string, phoneE164: string): Promise<PhoneOtpChallenge | undefined>;
  updateOtpChallengeForResend(id: string, updates: { codeHash: string; lastSentAt: Date; expiresAt: Date; resendCount: number; attempts: number; deliveryChannel?: string | null; providerMessageId?: string | null }): Promise<PhoneOtpChallenge>;
  updateOtpChallengeAttempts(id: string, attempts: number, lockedUntil: Date | null): Promise<PhoneOtpChallenge>;
  markOtpChallengeVerified(id: string): Promise<PhoneOtpChallenge>;

  // Conversation methods
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  // Task #18: OTP-gated counting helpers
  clearConversationAwaitingVerification(id: string, businessAccountId: string): Promise<void>;
  isConversationAwaitingVerification(conversationId: string, businessAccountId: string): Promise<boolean>;
  // CAPTCHA mid-chat gate: lock a conversation pending CAPTCHA only when not
  // already verified; read a conversation's captcha verification status.
  markConversationAwaitingCaptchaIfUnverified(id: string, businessAccountId: string): Promise<void>;
  getConversationCaptchaStatus(id: string, businessAccountId: string): Promise<string | null>;
  markConversionFiredIfNeeded(id: string, businessAccountId: string): Promise<boolean>;
  listStaleAwaitingVerificationConversations(olderThan: Date, limit?: number): Promise<{ id: string; businessAccountId: string | null }[]>;
  hardDeletePendingVerificationConversation(id: string): Promise<{ conversation: number; leads: number; otpChallenges: number }>;
  getConversation(id: string, businessAccountId: string): Promise<Conversation | undefined>;
  getConversationById(id: string): Promise<Conversation | undefined>;
  getAllConversations(businessAccountId: string, filters?: { fromDate?: string; toDate?: string; search?: string }, limit?: number, offset?: number): Promise<{ conversations: Conversation[]; total: number }>;
  getConversationsByBusinessAccount(businessAccountId: string, startDate?: string, endDate?: string): Promise<Conversation[]>;
  getRecentWidgetConversations(businessAccountId: string, visitorToken: string, limit?: number, studentId?: string | null): Promise<Array<{id: string; title: string | null; updatedAt: Date; messageCount: number}>>;
  findReusableConversation(businessAccountId: string, visitorToken: string, withinMinutes?: number, studentId?: string | null, subject?: string | null, byCreatedAt?: boolean, topscholarCpId?: string | null, topscholarDoubtId?: string | null): Promise<Conversation | undefined>;
  closeConversation(id: string, options?: { mirrorDoubtClose?: boolean }): Promise<void>;
  listExpiredOpenDoubtConversations(createdBefore: Date, limit: number): Promise<string[]>;
  getLatestConversationByDoubtId(businessAccountId: string, doubtId: string): Promise<Conversation | undefined>;
  deleteConversation(id: string, businessAccountId: string): Promise<void>;
  deleteConversationIfEmpty(id: string, businessAccountId: string): Promise<boolean>;
  updateConversationTimestamp(id: string): Promise<void>;
  updateConversationTitle(id: string, businessAccountId: string, title: string): Promise<Conversation>;
  updateConversationSummary(id: string, summary: string, topicKeywords: string): Promise<void>;
  // Task #8: idle/close summary sweep candidates.
  listConversationsNeedingIdleSummary(idleBefore: Date, minMessages?: number, limit?: number, activeSince?: Date): Promise<{ id: string; businessAccountId: string | null }[]>;
  
  // Message methods
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessageMetadata(messageId: string, metadataPatch: Record<string, any>): Promise<void>;
  getMessagesByConversation(conversationId: string, businessAccountId: string): Promise<Message[]>;
  getMessagesByConversationIds(conversationIds: string[]): Promise<Message[]>;
  getMessageCountsForConversations(conversationIds: string[]): Promise<Record<string, number>>;
  deleteMessage(id: string, businessAccountId: string): Promise<void>;

  // Product methods
  createProduct(product: InsertProduct): Promise<Product>;
  getProduct(id: string, businessAccountId: string): Promise<Product | undefined>;
  getAllProducts(businessAccountId: string): Promise<Product[]>;
  updateProduct(id: string, businessAccountId: string, product: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: string, businessAccountId: string): Promise<void>;

  // FAQ methods
  createFaq(faq: InsertFaq): Promise<Faq>;
  getFaq(id: string, businessAccountId: string): Promise<Faq | undefined>;
  getAllFaqs(businessAccountId: string): Promise<Faq[]>;
  getFaqsPaginated(businessAccountId: string, limit: number, offset: number): Promise<{ faqs: Faq[]; total: number; hasMore: boolean }>;
  updateFaq(id: string, businessAccountId: string, faq: Partial<InsertFaq>): Promise<Faq>;
  deleteFaq(id: string, businessAccountId: string): Promise<void>;

  // Lead methods
  createLead(lead: InsertLead): Promise<Lead>;
  getLead(id: string, businessAccountId: string): Promise<Lead | undefined>;
  getLeadByConversation(conversationId: string, businessAccountId: string): Promise<Lead | undefined>;
  getAllLeads(businessAccountId: string): Promise<Lead[]>;
  getUnsyncedLeads(businessAccountId: string, fromDate: Date, toDate: Date): Promise<Lead[]>;
  getLeadsPaginated(businessAccountId: string, filters?: { fromDate?: string; toDate?: string; search?: string }, limit?: number, offset?: number): Promise<{ leads: Lead[]; total: number }>;
  updateLead(id: string, businessAccountId: string, lead: Partial<InsertLead>): Promise<Lead>;
  deleteLead(id: string, businessAccountId: string): Promise<void>;

  // Question Bank methods
  createQuestionBankEntry(entry: InsertQuestionBankEntry): Promise<QuestionBankEntry>;
  getQuestionBankEntry(id: string, businessAccountId: string): Promise<QuestionBankEntry | undefined>;
  getAllQuestionBankEntries(businessAccountId: string, filters?: { status?: string; category?: string; search?: string }, limit?: number, offset?: number): Promise<{ entries: QuestionBankEntry[]; total: number }>;
  updateQuestionBankEntry(id: string, businessAccountId: string, entry: Partial<InsertQuestionBankEntry>): Promise<QuestionBankEntry>;
  deleteQuestionBankEntry(id: string, businessAccountId: string): Promise<void>;
  getQuestionBankStats(businessAccountId: string): Promise<{ total: number; new: number; reviewing: number; resolved: number; byCategory: Record<string, number> }>;

  // Widget Settings methods
  getWidgetSettings(businessAccountId: string): Promise<WidgetSettings | undefined>;
  upsertWidgetSettings(businessAccountId: string, settings: Partial<InsertWidgetSettings>): Promise<WidgetSettings>;

  // Password Reset Token methods
  createPasswordResetToken(token: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenAsUsed(token: string): Promise<void>;
  deleteExpiredPasswordResetTokens(): Promise<void>;

  // Website Analysis methods
  getWebsiteAnalysis(businessAccountId: string): Promise<WebsiteAnalysis | undefined>;
  upsertWebsiteAnalysis(businessAccountId: string, analysis: Partial<InsertWebsiteAnalysis>): Promise<WebsiteAnalysis>;
  updateWebsiteAnalysisStatus(businessAccountId: string, status: string, errorMessage?: string): Promise<void>;
  deleteWebsiteAnalysis(businessAccountId: string): Promise<void>;

  // Analyzed Pages methods
  createAnalyzedPage(analyzedPage: InsertAnalyzedPage): Promise<AnalyzedPage>;
  getAnalyzedPages(businessAccountId: string): Promise<AnalyzedPage[]>;
  deleteAnalyzedPage(id: string, businessAccountId: string): Promise<void>;
  deleteAnalyzedPages(businessAccountId: string): Promise<void>;

  // Training Documents methods
  createTrainingDocument(document: InsertTrainingDocument): Promise<TrainingDocument>;
  getTrainingDocument(id: string, businessAccountId: string): Promise<TrainingDocument | undefined>;
  getTrainingDocuments(businessAccountId: string): Promise<TrainingDocument[]>;
  updateTrainingDocumentStatus(id: string, status: string, errorMessage?: string): Promise<void>;
  updateTrainingDocumentContent(id: string, extractedText: string, summary: string, keyPoints: string): Promise<void>;
  deleteTrainingDocument(id: string, businessAccountId: string): Promise<void>;

  // Category methods
  createCategory(category: InsertCategory): Promise<Category>;
  getCategory(id: string, businessAccountId: string): Promise<Category | undefined>;
  getAllCategories(businessAccountId: string): Promise<Category[]>;
  updateCategory(id: string, businessAccountId: string, category: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: string, businessAccountId: string): Promise<void>;

  // Tag methods
  createTag(tag: InsertTag): Promise<Tag>;
  getTag(id: string, businessAccountId: string): Promise<Tag | undefined>;
  getAllTags(businessAccountId: string): Promise<Tag[]>;
  updateTag(id: string, businessAccountId: string, tag: Partial<InsertTag>): Promise<Tag>;
  deleteTag(id: string, businessAccountId: string): Promise<void>;

  // Product-Category assignment methods
  assignProductToCategory(productId: string, categoryId: string): Promise<ProductCategory>;
  getProductCategories(productId: string): Promise<Category[]>;
  getCategoryProducts(categoryId: string, businessAccountId: string): Promise<Product[]>;
  removeProductFromCategory(productId: string, categoryId: string): Promise<void>;

  // Product-Tag assignment methods
  assignProductToTag(productId: string, tagId: string): Promise<ProductTag>;
  getProductTags(productId: string): Promise<Tag[]>;
  getTagProducts(tagId: string, businessAccountId: string): Promise<Product[]>;
  removeProductFromTag(productId: string, tagId: string): Promise<void>;

  // Product Relationship methods
  createProductRelationship(relationship: InsertProductRelationship): Promise<ProductRelationship>;
  getProductRelationship(id: string, businessAccountId: string): Promise<ProductRelationship | undefined>;
  getProductRelationships(productId: string, businessAccountId: string, relationshipType?: string): Promise<ProductRelationship[]>;
  updateProductRelationship(id: string, businessAccountId: string, relationship: Partial<InsertProductRelationship>): Promise<ProductRelationship>;
  deleteProductRelationship(id: string, businessAccountId: string): Promise<void>;
  
  // Get related products with details
  getRelatedProducts(productId: string, businessAccountId: string): Promise<{
    crossSell: Product[];
    similar: Product[];
    complement: Product[];
    bundle: Product[];
  }>;

  // Appointment System methods
  // Schedule Template methods
  createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate>;
  getScheduleTemplates(businessAccountId: string): Promise<ScheduleTemplate[]>;
  updateScheduleTemplate(id: string, businessAccountId: string, template: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate>;
  deleteScheduleTemplate(id: string, businessAccountId: string): Promise<void>;

  // Slot Override methods
  createSlotOverride(override: InsertSlotOverride): Promise<SlotOverride>;
  getSlotOverridesForRange(businessAccountId: string, startDate: Date, endDate: Date): Promise<SlotOverride[]>;
  updateSlotOverride(id: string, businessAccountId: string, override: Partial<InsertSlotOverride>): Promise<SlotOverride>;
  deleteSlotOverride(id: string, businessAccountId: string): Promise<void>;

  // Appointment methods
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  getAppointmentsForRange(businessAccountId: string, startDate: Date, endDate: Date): Promise<Appointment[]>;
  getAppointmentsByStatus(businessAccountId: string, status: string): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | null>;
  getAppointmentsByConversationId(conversationId: string): Promise<Appointment[]>;
  updateAppointment(id: string, updates: Partial<Appointment>): Promise<Appointment>;
  updateAppointmentStatus(id: string, businessAccountId: string, status: string, cancellationReason?: string): Promise<Appointment>;
  getAllAppointments(businessAccountId: string): Promise<Appointment[]>;

  // Demo Page methods
  createDemoPage(demoPage: InsertDemoPage & { token: string }): Promise<DemoPage>;
  getDemoPage(id: string): Promise<DemoPage | undefined>;
  getDemoPageByToken(token: string): Promise<DemoPage | undefined>;
  getAllDemoPages(): Promise<DemoPage[]>;
  updateDemoPage(id: string, updates: Partial<{ title: string; description: string; appearance: string; isActive: string; expiresAt: Date | null; businessAccountId: string }>): Promise<DemoPage>;
  updateDemoPageLastViewed(token: string): Promise<void>;
  regenerateDemoPageToken(id: string, newToken: string): Promise<DemoPage>;
  deleteDemoPage(id: string): Promise<void>;

  // Public Chat Link methods
  getOrCreatePublicChatLink(businessAccountId: string): Promise<PublicChatLink>;
  getPublicChatLinkByToken(token: string): Promise<PublicChatLink | undefined>;
  togglePublicChatLinkStatus(businessAccountId: string): Promise<PublicChatLink>;
  regeneratePublicChatLinkToken(businessAccountId: string, newToken: string): Promise<PublicChatLink>;
  updatePublicChatLinkAccess(token: string): Promise<void>;

  // Support Ticket methods
  createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket>;
  getSupportTicket(id: string, businessAccountId: string): Promise<SupportTicket | undefined>;
  getAllSupportTickets(businessAccountId: string, filters?: { status?: string; priority?: string; category?: string }): Promise<SupportTicket[]>;
  updateSupportTicket(id: string, businessAccountId: string, updates: Partial<InsertSupportTicket>): Promise<SupportTicket>;
  updateTicketStatus(id: string, businessAccountId: string, status: string): Promise<SupportTicket>;
  updateTicketPriority(id: string, businessAccountId: string, priority: string): Promise<SupportTicket>;
  updateTicketAIAnalysis(id: string, aiAnalysis: string, aiPriority?: string, aiCategory?: string, sentimentScore?: number, emotionalState?: string, churnRisk?: string): Promise<SupportTicket>;
  resolveTicket(id: string, businessAccountId: string, isAutoResolved: boolean, resolutionSummary?: string): Promise<SupportTicket>;
  closeTicket(id: string, businessAccountId: string): Promise<SupportTicket>;
  reopenTicket(id: string, businessAccountId: string): Promise<SupportTicket>;
  updateTicketRating(id: string, rating: number, feedback?: string): Promise<SupportTicket>;
  getTicketStats(businessAccountId: string): Promise<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    autoResolved: number;
    avgResolutionTime: number;
  }>;
  
  // Ticket Message methods
  createTicketMessage(message: InsertTicketMessage): Promise<TicketMessage>;
  getTicketMessages(ticketId: string, businessAccountId: string): Promise<TicketMessage[]>;
  updateTicketMessage(id: string, businessAccountId: string, updates: Partial<InsertTicketMessage>): Promise<TicketMessage>;
  
  // Ticket Attachment methods
  createTicketAttachment(attachment: InsertTicketAttachment): Promise<TicketAttachment>;
  getTicketAttachments(ticketId: string, businessAccountId: string): Promise<TicketAttachment[]>;
  deleteTicketAttachment(id: string, businessAccountId: string): Promise<void>;
  
  // Canned Response methods
  createCannedResponse(response: InsertCannedResponse): Promise<CannedResponse>;
  getCannedResponse(id: string, businessAccountId: string): Promise<CannedResponse | undefined>;
  getAllCannedResponses(businessAccountId: string): Promise<CannedResponse[]>;
  updateCannedResponse(id: string, businessAccountId: string, updates: Partial<InsertCannedResponse>): Promise<CannedResponse>;
  deleteCannedResponse(id: string, businessAccountId: string): Promise<void>;
  incrementCannedResponseUsage(id: string): Promise<void>;
  
  // Ticket Insight methods
  createTicketInsight(insight: InsertTicketInsight): Promise<TicketInsight>;
  getTicketInsight(id: string, businessAccountId: string): Promise<TicketInsight | undefined>;
  getAllTicketInsights(businessAccountId: string, filters?: { status?: string; insightType?: string }): Promise<TicketInsight[]>;
  updateTicketInsight(id: string, businessAccountId: string, updates: Partial<InsertTicketInsight>): Promise<TicketInsight>;
  markInsightAsReviewed(id: string, businessAccountId: string, reviewedBy: string, status: string): Promise<TicketInsight>;
  deleteTicketInsight(id: string, businessAccountId: string): Promise<void>;

  // Conversation Journey methods
  createJourney(journey: InsertConversationJourney): Promise<ConversationJourney>;
  getJourney(id: string, businessAccountId: string): Promise<ConversationJourney | undefined>;
  getAllJourneys(businessAccountId: string): Promise<ConversationJourney[]>;
  updateJourney(id: string, businessAccountId: string, updates: Partial<InsertConversationJourney>): Promise<ConversationJourney>;
  deleteJourney(id: string, businessAccountId: string): Promise<void>;
  
  // Journey Step methods
  createJourneyStep(step: InsertJourneyStep): Promise<JourneyStep>;
  getJourneySteps(journeyId: string): Promise<JourneyStep[]>;
  updateJourneyStep(id: string, journeyId: string, updates: Partial<InsertJourneyStep>): Promise<JourneyStep>;
  deleteJourneyStep(id: string, journeyId: string): Promise<void>;
  reorderJourneySteps(journeyId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void>;
  
  // Journey Session methods (persistent state for reconnect resilience)
  createJourneySession(session: {
    journeyId: string;
    conversationId: string;
    businessAccountId: string;
    userId: string;
    currentStepIndex?: number;
  }): Promise<JourneySession>;
  getJourneySession(conversationId: string, userId: string): Promise<JourneySession | undefined>;
  getActiveJourneySessionByUser(userId: string, businessAccountId: string): Promise<JourneySession | undefined>;
  updateJourneySession(id: string, updates: {
    currentStepIndex?: number;
    completed?: string;
    completedAt?: Date;
  }): Promise<JourneySession>;
  deleteJourneySession(conversationId: string, userId: string): Promise<void>;
  
  // Visitor Daily Stats methods (lightweight daily aggregates)
  incrementDailyStats(businessAccountId: string, data: { deviceType?: string; country?: string; city?: string; chatOpened?: boolean }): Promise<void>;
  getDailyStats(businessAccountId: string, filters?: { fromDate?: string; toDate?: string }): Promise<{
    openedChatCount: number;
    deviceBreakdown: { desktop: number; mobile: number; tablet: number };
    topCountries: { country: string; count: number }[];
    topCities: { city: string; count: number }[];
  }>;

  // Account Group methods (linking multiple business accounts)
  createAccountGroup(group: InsertAccountGroup): Promise<AccountGroup>;
  getAccountGroup(id: string): Promise<AccountGroup | undefined>;
  getAccountGroupsByOwner(ownerUserId: string): Promise<AccountGroup[]>;
  updateAccountGroup(id: string, updates: Partial<{ name: string }>): Promise<AccountGroup>;
  deleteAccountGroup(id: string): Promise<void>;
  
  // Account Group Member methods
  addAccountToGroup(member: InsertAccountGroupMember): Promise<AccountGroupMember>;
  removeAccountFromGroup(groupId: string, businessAccountId: string): Promise<void>;
  getGroupMembers(groupId: string): Promise<(AccountGroupMember & { businessAccount: BusinessAccount })[]>;
  getLinkedAccounts(businessAccountId: string): Promise<(AccountGroupMember & { businessAccount: BusinessAccount })[]>;
  setPrimaryAccount(groupId: string, businessAccountId: string): Promise<void>;
  isAccountLinked(businessAccountId: string): Promise<boolean>;
  getAccountGroupForBusiness(businessAccountId: string): Promise<AccountGroup | undefined>;
  getGroupAggregatedInsights(accountIds: string[], dateFrom?: Date, dateTo?: Date): Promise<{
    totals: {
      leads: number;
      conversations: number;
      visitors: number;
      products: number;
      faqs: number;
    };
    accountBreakdown: {
      businessAccountId: string;
      businessName: string;
      leads: number;
      conversations: number;
      visitors: number;
      products: number;
      faqs: number;
    }[];
  }>;
  
  // Group Training methods
  getAccountGroupTraining(groupId: string): Promise<AccountGroupTraining | undefined>;
  upsertAccountGroupTraining(groupId: string, data: Partial<InsertAccountGroupTraining>): Promise<AccountGroupTraining>;
  publishGroupTrainingToMembers(groupId: string, publishedBy: string, module?: 'instructions' | 'leadTraining' | 'leadsquared' | 'menuBuilder'): Promise<{ success: boolean; affectedCount: number }>;

  // Group Journey methods
  createGroupJourney(journey: InsertAccountGroupJourney & { groupId: string }): Promise<AccountGroupJourney>;
  getGroupJourney(id: string, groupId: string): Promise<AccountGroupJourney | undefined>;
  getAllGroupJourneys(groupId: string): Promise<AccountGroupJourney[]>;
  updateGroupJourney(id: string, groupId: string, updates: Partial<InsertAccountGroupJourney>): Promise<AccountGroupJourney>;
  deleteGroupJourney(id: string, groupId: string): Promise<void>;

  // Group Journey Step methods
  createGroupJourneyStep(step: InsertAccountGroupJourneyStep & { journeyId: string }): Promise<AccountGroupJourneyStep>;
  getGroupJourneySteps(journeyId: string): Promise<AccountGroupJourneyStep[]>;
  updateGroupJourneyStep(id: string, journeyId: string, updates: Partial<InsertAccountGroupJourneyStep>): Promise<AccountGroupJourneyStep>;
  deleteGroupJourneyStep(id: string, journeyId: string): Promise<void>;
  reorderGroupJourneySteps(journeyId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void>;

  // Publish group journeys to member accounts
  publishGroupJourneysToMembers(groupId: string): Promise<{ success: boolean; affectedCount: number }>;

  // Group Extra Settings
  getGroupExtraSettings(groupId: string): Promise<AccountGroupExtraSettings | undefined>;
  upsertGroupExtraSettings(groupId: string, settings: Partial<AccountGroupExtraSettings>): Promise<AccountGroupExtraSettings>;
  publishGroupExtraSettingsToMembers(groupId: string): Promise<{ success: boolean; affectedCount: number }>;
  
  // Group Admin CRM methods
  getConversationsForAccounts(accountIds: string[], limit: number, offset: number, filters?: {
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    accountId?: string;
  }): Promise<{
    conversations: (Conversation & { businessAccountName: string; messageCount: number })[];
    total: number;
  }>;
  getLeadsForAccounts(accountIds: string[], limit: number, offset: number, filters?: {
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    accountId?: string;
  }): Promise<{
    leads: (Lead & { businessAccountName: string })[];
    total: number;
  }>;
  
  // Discount Rules methods (Smart Behavioral Discounts)
  createDiscountRule(rule: InsertDiscountRule): Promise<DiscountRule>;
  getDiscountRule(id: string, businessAccountId: string): Promise<DiscountRule | undefined>;
  getDiscountRules(businessAccountId: string): Promise<DiscountRule[]>;
  getDiscountRulesForProduct(businessAccountId: string, productId: string): Promise<DiscountRule[]>;
  getActiveDiscountRules(businessAccountId: string): Promise<DiscountRule[]>;
  updateDiscountRule(id: string, businessAccountId: string, updates: Partial<InsertDiscountRule>): Promise<DiscountRule>;
  deleteDiscountRule(id: string, businessAccountId: string): Promise<void>;
  getDiscountOffersByDateRange(businessAccountId: string, startDate: Date, endDate: Date): Promise<any[]>;
  
  // Exit Intent Settings methods
  getExitIntentSettings(businessAccountId: string): Promise<ExitIntentSettings | undefined>;
  upsertExitIntentSettings(businessAccountId: string, settings: Partial<InsertExitIntentSettings>): Promise<ExitIntentSettings>;
  
  // Idle Timeout Settings methods
  getIdleTimeoutSettings(businessAccountId: string): Promise<IdleTimeoutSettings | undefined>;
  upsertIdleTimeoutSettings(businessAccountId: string, settings: Partial<InsertIdleTimeoutSettings>): Promise<IdleTimeoutSettings>;
  
  // Product Import Jobs methods
  createProductImportJob(job: InsertProductImportJob): Promise<ProductImportJob>;
  getProductImportJob(id: string, businessAccountId: string): Promise<ProductImportJob | undefined>;
  getProductImportJobs(businessAccountId: string): Promise<ProductImportJob[]>;
  updateProductImportJob(id: string, updates: Partial<ProductImportJob>): Promise<ProductImportJob>;
  deleteProductImportJob(id: string, businessAccountId: string): Promise<void>;

  // Facebook Comment methods
  storeFacebookComment(data: InsertFacebookComment): Promise<FacebookComment>;
  findFacebookCommentByFbId(businessAccountId: string, commentId: string): Promise<FacebookComment | null>;
  getFacebookComments(businessAccountId: string, filters?: { status?: string; limit?: number; offset?: number }): Promise<{ comments: FacebookComment[]; total: number }>;
  updateFacebookCommentStatus(id: string, status: string, replyText?: string, replyCommentId?: string): Promise<FacebookComment>;
  getFacebookCommentStats(businessAccountId: string): Promise<{ total: number; pending: number; replied: number; skipped: number; failed: number }>;

  // Facebook Lead methods
  storeFacebookLead(data: InsertFacebookLead): Promise<FacebookLead>;
  getFacebookLeads(businessAccountId: string, filters?: { status?: string; limit?: number; offset?: number }): Promise<{ leads: FacebookLead[]; total: number }>;
  deleteFacebookLead(id: string, businessAccountId: string): Promise<void>;

  // Facebook Flow methods
  createFacebookFlow(flow: InsertFacebookFlow): Promise<FacebookFlow>;
  getFacebookFlow(id: string, businessAccountId: string): Promise<FacebookFlow | undefined>;
  getFacebookFlows(businessAccountId: string): Promise<FacebookFlow[]>;
  updateFacebookFlow(id: string, businessAccountId: string, updates: Partial<InsertFacebookFlow>): Promise<FacebookFlow>;
  deleteFacebookFlow(id: string, businessAccountId: string): Promise<void>;

  // Facebook Flow Step methods
  createFacebookFlowStep(step: InsertFacebookFlowStep): Promise<FacebookFlowStep>;
  getFacebookFlowSteps(flowId: string): Promise<FacebookFlowStep[]>;
  updateFacebookFlowStep(id: string, flowId: string, updates: Partial<InsertFacebookFlowStep>): Promise<FacebookFlowStep>;
  deleteFacebookFlowStep(id: string, flowId: string): Promise<void>;
  reorderFacebookFlowSteps(flowId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void>;

  // Facebook Flow Session methods
  createFacebookFlowSession(session: InsertFacebookFlowSession): Promise<FacebookFlowSession>;
  getFacebookFlowSession(id: string): Promise<FacebookFlowSession | undefined>;
  getActiveFacebookFlowSession(businessAccountId: string, senderId: string): Promise<FacebookFlowSession | undefined>;
  updateFacebookFlowSession(id: string, updates: Partial<InsertFacebookFlowSession>): Promise<FacebookFlowSession>;
  deleteFacebookFlowSession(id: string): Promise<void>;

  // Facebook Lead Field methods
  getFacebookLeadFields(businessAccountId: string): Promise<FacebookLeadField[]>;
  upsertFacebookLeadField(data: InsertFacebookLeadField): Promise<FacebookLeadField>;
  deleteFacebookLeadField(id: string, businessAccountId: string): Promise<void>;

  getJobs(businessAccountId: string, filters?: { status?: string; search?: string }): Promise<Job[]>;
  getJob(id: string, businessAccountId: string): Promise<Job | undefined>;
  getJobByExternalRefId(externalRefId: string, businessAccountId: string): Promise<Job | undefined>;
  createJob(data: InsertJob): Promise<Job>;
  updateJob(id: string, businessAccountId: string, updates: Partial<InsertJob>): Promise<Job | undefined>;
  deleteJob(id: string, businessAccountId: string): Promise<void>;
  getApplicants(businessAccountId: string, search?: string): Promise<JobApplicant[]>;
  getApplicant(id: string, businessAccountId: string): Promise<JobApplicant | undefined>;
  createApplicant(data: InsertJobApplicant): Promise<JobApplicant>;
  updateApplicant(id: string, businessAccountId: string, updates: Partial<InsertJobApplicant>): Promise<JobApplicant | undefined>;
  deleteApplicant(id: string, businessAccountId: string): Promise<void>;
  getApplications(businessAccountId: string, filters?: { jobId?: string; applicantId?: string; status?: string }): Promise<(JobApplication & { jobTitle: string; applicantName: string; applicantEmail: string | null })[]>;
  getApplication(id: string, businessAccountId: string): Promise<(JobApplication & { jobTitle: string; applicantName: string; applicantEmail: string | null }) | undefined>;
  createApplication(data: InsertJobApplication): Promise<JobApplication>;
  updateApplication(id: string, businessAccountId: string, updates: Partial<InsertJobApplication>): Promise<JobApplication | undefined>;
  deleteApplication(id: string, businessAccountId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByBusinessAccountId(businessAccountId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.businessAccountId, businessAccountId));
    return user || undefined;
  }

  async getUserByUsernameAndRole(username: string, role: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(eq(users.username, username), eq(users.role, role))
    );
    return user || undefined;
  }

  async getSuperadmins(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, 'super_admin'));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async createUserWithTempPassword(insertUser: InsertUser & { tempPassword: string; tempPasswordExpiry: Date; mustChangePassword: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        passwordHash,
        tempPassword: null,
        tempPasswordExpiry: null,
        mustChangePassword: "false"
      })
      .where(eq(users.id, id));
  }

  async updateUser(id: string, updates: Partial<{ businessAccountId: string }>): Promise<User> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async resetUserPassword(id: string, passwordHash: string, tempPassword: string, tempPasswordExpiry: Date): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        passwordHash,
        tempPassword,
        tempPasswordExpiry,
        mustChangePassword: "true"
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async clearTempPassword(id: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        tempPassword: null,
        tempPasswordExpiry: null,
        mustChangePassword: "false"
      })
      .where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));
  }

  async getUsersByBusinessAccount(businessAccountId: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(eq(users.businessAccountId, businessAccountId));
  }

  // Business Account methods
  async createBusinessAccount(insertAccount: InsertBusinessAccount): Promise<BusinessAccount> {
    const [account] = await db
      .insert(businessAccounts)
      .values(insertAccount)
      .returning();
    return account;
  }

  async getBusinessAccount(id: string): Promise<BusinessAccount | undefined> {
    const [account] = await db
      .select()
      .from(businessAccounts)
      .where(eq(businessAccounts.id, id));
    return account || undefined;
  }

  async getAllBusinessAccounts(limit?: number, offset?: number): Promise<BusinessAccount[]> {
    // Build query with proper pagination support
    if (limit !== undefined && offset !== undefined) {
      return await db
        .select()
        .from(businessAccounts)
        .orderBy(desc(businessAccounts.createdAt))
        .limit(limit)
        .offset(offset);
    } else if (limit !== undefined) {
      return await db
        .select()
        .from(businessAccounts)
        .orderBy(desc(businessAccounts.createdAt))
        .limit(limit);
    } else if (offset !== undefined) {
      return await db
        .select()
        .from(businessAccounts)
        .orderBy(desc(businessAccounts.createdAt))
        .offset(offset);
    }
    
    return await db
      .select()
      .from(businessAccounts)
      .orderBy(desc(businessAccounts.createdAt));
  }

  async getBusinessAccountsCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(businessAccounts);
    return result?.count || 0;
  }

  async getBusinessAccountsWithPageviewStatus(businessAccountIds: string[]): Promise<Map<string, boolean>> {
    if (businessAccountIds.length === 0) {
      return new Map();
    }
    
    const results = await db
      .selectDistinct({ businessAccountId: visitorDailyStats.businessAccountId })
      .from(visitorDailyStats)
      .where(inArray(visitorDailyStats.businessAccountId, businessAccountIds));
    
    const liveAccounts = new Set(results.map(r => r.businessAccountId));
    const statusMap = new Map<string, boolean>();
    
    for (const id of businessAccountIds) {
      statusMap.set(id, liveAccounts.has(id));
    }
    
    return statusMap;
  }

  async updateBusinessAccount(id: string, updates: Partial<{ name: string; website: string; productTier: string }>): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    return account;
  }

  async updateBusinessAccountDescription(id: string, description: string): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ description, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    return account;
  }

  async updateBusinessAccountStatus(id: string, status: string): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ status, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    return account;
  }

  async updateBusinessAccountFeatures(id: string, features: Partial<{ shopifyEnabled: string; appointmentsEnabled: string; voiceModeEnabled: string; visualSearchEnabled: string }>): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ ...features, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountOpenAIKey(id: string, apiKey: string | null): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ openaiApiKey: apiKey, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountElevenLabsKey(id: string, apiKey: string | null): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ elevenlabsApiKey: apiKey, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountJinaKey(id: string, apiKey: string | null): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ jinaApiKey: apiKey, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountAutonomousSettings(id: string, settings: Partial<{ autoResolutionEnabled: string; autoResolutionConfidence: string; escalationSensitivity: string; humanOnlyCategories: string }>): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountAiProcessing(id: string, enabled: boolean): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ aiProductProcessingEnabled: enabled ? "true" : "false", updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async updateBusinessAccountVisualSearchModel(id: string, settings: Partial<{ visualSearchModel: string; googleVisionWarehouseCorpusId: string | null; googleVisionWarehouseIndexId: string | null; googleVisionWarehouseEndpointId: string | null; googleVisionWarehouseCredentials: string | null; googleVisionWarehouseProjectNumber: string | null }>): Promise<BusinessAccount> {
    const [account] = await db
      .update(businessAccounts)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(businessAccounts.id, id))
      .returning();
    
    if (!account) {
      throw new Error("Business account not found");
    }
    
    return account;
  }

  async getBusinessAnalytics(businessAccountId?: string, dateFrom?: Date, dateTo?: Date): Promise<any[]> {
    // Get business accounts - either specific one or all
    let accountsQuery = db
      .select()
      .from(businessAccounts);
    
    if (businessAccountId) {
      accountsQuery = accountsQuery.where(eq(businessAccounts.id, businessAccountId)) as any;
    }
    
    const accounts = await accountsQuery.orderBy(desc(businessAccounts.createdAt));

    // Get analytics for each business account
    const analyticsPromises = accounts.map(async (account) => {
      // Get user count and most recent login
      const accountUsers = await db
        .select({
          count: count(),
          maxLastLogin: sql<Date | null>`MAX(${users.lastLoginAt})`,
        })
        .from(users)
        .where(eq(users.businessAccountId, account.id));

      // Get individual users for the account
      const businessUsers = await db
        .select({
          id: users.id,
          username: users.username,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.businessAccountId, account.id))
        .orderBy(desc(users.lastLoginAt));

      // Build date filter conditions for leads
      const leadConditions = [eq(leads.businessAccountId, account.id)];
      if (dateFrom) {
        leadConditions.push(gte(leads.createdAt, dateFrom));
      }
      if (dateTo) {
        leadConditions.push(lte(leads.createdAt, dateTo));
      }

      // Get lead count with date filter
      const leadCount = await db
        .select({ count: count() })
        .from(leads)
        .where(and(...leadConditions));

      // Build date filter conditions for conversations
      const conversationConditions = [eq(conversations.businessAccountId, account.id)];
      if (dateFrom) {
        conversationConditions.push(gte(conversations.createdAt, dateFrom));
      }
      if (dateTo) {
        conversationConditions.push(lte(conversations.createdAt, dateTo));
      }

      // Get unique conversation count (phone dedup for form convs, visitorToken for others)
      const [allConvRows, formLeadRows] = await Promise.all([
        db.select({ id: conversations.id, visitorToken: conversations.visitorToken })
          .from(conversations).where(and(...conversationConditions)),
        db.select({ conversationId: leads.conversationId, phone: leads.phone })
          .from(leads)
          .where(and(eq(leads.businessAccountId, account.id), sql`${leads.topicsOfInterest}::text LIKE '%Via Form%'`, sql`${leads.phone} IS NOT NULL AND ${leads.phone} != ''`)),
      ]);
      const acctFormPhoneMap = new Map<string, string>();
      for (const l of formLeadRows) {
        if (l.conversationId && l.phone) {
          const normalized = l.phone.replace(/\D/g, '').slice(-10);
          if (normalized.length >= 7 && !acctFormPhoneMap.has(l.conversationId)) {
            acctFormPhoneMap.set(l.conversationId, 'form_' + normalized);
          }
        }
      }
      const conversationCount = [{ count: new Set(allConvRows.map(c => acctFormPhoneMap.get(c.id) || c.visitorToken || c.id)).size }];

      // Get product count (not date-filtered - products are inventory)
      const productCount = await db
        .select({ count: count() })
        .from(products)
        .where(eq(products.businessAccountId, account.id));

      // Get FAQ count (not date-filtered - FAQs are content)
      const faqCount = await db
        .select({ count: count() })
        .from(faqs)
        .where(eq(faqs.businessAccountId, account.id));

      return {
        id: account.id,
        name: account.name,
        website: account.website,
        status: account.status,
        createdAt: account.createdAt,
        userCount: accountUsers[0]?.count || 0,
        lastLogin: accountUsers[0]?.maxLastLogin || null,
        users: businessUsers,
        leadCount: leadCount[0]?.count || 0,
        conversationCount: conversationCount[0]?.count || 0,
        productCount: productCount[0]?.count || 0,
        faqCount: faqCount[0]?.count || 0,
      };
    });

    return await Promise.all(analyticsPromises);
  }

  async deleteBusinessAccountWithAllData(id: string): Promise<void> {
    // Delete all data associated with this business account in the correct order
    // (respecting foreign key constraints)
    // Note: We fetch IDs first then delete to avoid subquery issues with Neon serverless
    
    // 1. Delete journey-related data first (has dependencies)
    const businessJourneySessions = await db.select({ id: journeySessions.id }).from(journeySessions)
      .where(eq(journeySessions.businessAccountId, id));
    if (businessJourneySessions.length > 0) {
      await db.delete(journeyResponses).where(
        inArray(journeyResponses.journeySessionId, businessJourneySessions.map(s => s.id))
      );
    }
    await db.delete(journeySessions).where(eq(journeySessions.businessAccountId, id));
    
    const businessJourneys = await db.select({ id: conversationJourneys.id }).from(conversationJourneys)
      .where(eq(conversationJourneys.businessAccountId, id));
    if (businessJourneys.length > 0) {
      await db.delete(journeySteps).where(
        inArray(journeySteps.journeyId, businessJourneys.map(j => j.id))
      );
    }
    await db.delete(conversationJourneys).where(eq(conversationJourneys.businessAccountId, id));
    
    // 2. Delete ticket-related data
    await db.delete(ticketInsights).where(eq(ticketInsights.businessAccountId, id));
    const businessTickets = await db.select({ id: supportTickets.id }).from(supportTickets)
      .where(eq(supportTickets.businessAccountId, id));
    if (businessTickets.length > 0) {
      await db.delete(ticketAttachments).where(
        inArray(ticketAttachments.ticketId, businessTickets.map(t => t.id))
      );
      await db.delete(ticketMessages).where(
        inArray(ticketMessages.ticketId, businessTickets.map(t => t.id))
      );
    }
    await db.delete(supportTickets).where(eq(supportTickets.businessAccountId, id));
    await db.delete(cannedResponses).where(eq(cannedResponses.businessAccountId, id));
    
    // 4. Delete appointment-related data
    await db.delete(appointments).where(eq(appointments.businessAccountId, id));
    await db.delete(slotOverrides).where(eq(slotOverrides.businessAccountId, id));
    await db.delete(scheduleTemplates).where(eq(scheduleTemplates.businessAccountId, id));
    
    // 5. Delete product-related data
    await db.delete(productRelationships).where(eq(productRelationships.businessAccountId, id));
    const businessProducts = await db.select({ id: products.id }).from(products)
      .where(eq(products.businessAccountId, id));
    if (businessProducts.length > 0) {
      await db.delete(productTags).where(
        inArray(productTags.productId, businessProducts.map(p => p.id))
      );
      await db.delete(productCategories).where(
        inArray(productCategories.productId, businessProducts.map(p => p.id))
      );
    }
    await db.delete(products).where(eq(products.businessAccountId, id));
    await db.delete(tags).where(eq(tags.businessAccountId, id));
    await db.delete(categories).where(eq(categories.businessAccountId, id));
    
    // 6. Delete messages first (references conversations)
    const businessConversations = await db.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.businessAccountId, id));
    if (businessConversations.length > 0) {
      await db.delete(messages).where(
        inArray(messages.conversationId, businessConversations.map(c => c.id))
      );
    }
    
    // 7. Delete conversations
    await db.delete(conversations).where(eq(conversations.businessAccountId, id));
    
    // 8. Delete leads
    await db.delete(leads).where(eq(leads.businessAccountId, id));
    
    // 9. Delete FAQs
    await db.delete(faqs).where(eq(faqs.businessAccountId, id));
    
    // 10. Delete question bank entries
    await db.delete(questionBankEntries).where(eq(questionBankEntries.businessAccountId, id));
    
    // 11. Delete training documents
    await db.delete(trainingDocuments).where(eq(trainingDocuments.businessAccountId, id));
    
    // 12. Delete website analysis data
    await db.delete(analyzedPages).where(eq(analyzedPages.businessAccountId, id));
    await db.delete(websiteAnalysis).where(eq(websiteAnalysis.businessAccountId, id));
    
    // 13. Delete demo pages
    await db.delete(demoPages).where(eq(demoPages.businessAccountId, id));
    
    // 14. Delete public chat links
    await db.delete(publicChatLinks).where(eq(publicChatLinks.businessAccountId, id));
    
    // 15. Delete widget settings
    await db.delete(widgetSettings).where(eq(widgetSettings.businessAccountId, id));
    
    // 16. Delete account group memberships (but not the groups themselves if shared)
    await db.delete(accountGroupMembers).where(eq(accountGroupMembers.businessAccountId, id));
    
    // 17. Delete password reset tokens for users of this business
    const businessUsers = await db.select({ id: users.id }).from(users)
      .where(eq(users.businessAccountId, id));
    if (businessUsers.length > 0) {
      await db.delete(passwordResetTokens).where(
        inArray(passwordResetTokens.userId, businessUsers.map(u => u.id))
      );
    }
    
    // 18. Delete users associated with this business
    await db.delete(users).where(eq(users.businessAccountId, id));
    
    // 19. Finally, delete the business account itself
    await db.delete(businessAccounts).where(eq(businessAccounts.id, id));
  }

  async getBusinessAccountOpenAIKey(id: string): Promise<string | null> {
    const masterSettings = await this.getMasterAiSettings();
    if (masterSettings?.masterEnabled && masterSettings.primaryApiKey) {
      return masterSettings.primaryApiKey;
    }
    const [account] = await db
      .select({ openaiApiKey: businessAccounts.openaiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, id));
    return account?.openaiApiKey || null;
  }


  // Conversation methods
  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    const [conversation] = await db
      .insert(conversations)
      .values(insertConversation)
      .returning();
    return conversation;
  }

  // Task #18: Clear the awaitingVerification flag after successful OTP verify so
  // the conversation re-enters analytics counts and is no longer eligible for
  // the sweep. Scoped to (id, businessAccountId) for safety.
  async clearConversationAwaitingVerification(id: string, businessAccountId: string): Promise<void> {
    await db
      .update(conversations)
      .set({ awaitingVerification: false })
      .where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)));
  }

  // CAPTCHA gate: stamp the conversation's captcha verification outcome
  // ('verified' | 'unverified') and, on success, clear awaitingVerification so
  // the chat unlocks. On failure we keep awaitingVerification=true so the chat
  // stays locked and the visitor can retry. Scoped to (id, businessAccountId).
  async setConversationCaptchaResult(
    id: string,
    businessAccountId: string,
    opts: { captchaStatus: 'verified' | 'unverified'; clearAwaiting: boolean },
  ): Promise<void> {
    const updates: Partial<typeof conversations.$inferInsert> = { captchaStatus: opts.captchaStatus };
    if (opts.clearAwaiting) updates.awaitingVerification = false;
    await db
      .update(conversations)
      .set(updates)
      .where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)));
  }

  // CAPTCHA mid-chat gate: flag a conversation as awaiting verification so the
  // streaming refusal path locks the chat and the widget renders the reCAPTCHA
  // checkbox — but ONLY when the conversation is not already captcha-verified.
  // This guards against re-locking a visitor who verified earlier and later
  // mentions their number again. Scoped to (id, businessAccountId).
  async markConversationAwaitingCaptchaIfUnverified(id: string, businessAccountId: string): Promise<void> {
    await db.execute(sql`
      UPDATE conversations
         SET awaiting_verification = true
       WHERE id = ${id}
         AND business_account_id = ${businessAccountId}
         AND COALESCE(captcha_status, '') <> 'verified'
    `);
  }

  // CAPTCHA mid-chat gate: read a conversation's captcha verification status
  // ('verified' | 'unverified' | null). Used by the CRM-suppression check so an
  // unverified captcha lead isn't synced unless the admin opted in.
  async getConversationCaptchaStatus(id: string, businessAccountId: string): Promise<string | null> {
    const [row] = await db
      .select({ captchaStatus: conversations.captchaStatus })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)));
    return row?.captchaStatus ?? null;
  }

  // Conversion tracking one-time dedupe: atomically flip conversion_fired from
  // false→true and report whether THIS call won the race. Returns true exactly
  // once per conversation (the first caller); every subsequent call returns
  // false. Used by both the SSE lead-captured signal and the OTP/CAPTCHA verify
  // endpoints so the hidden conversion iframe fires once, never twice. Scoped to
  // (id, businessAccountId).
  async markConversionFiredIfNeeded(id: string, businessAccountId: string): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE conversations
         SET conversion_fired = true
       WHERE id = ${id}
         AND business_account_id = ${businessAccountId}
         AND conversion_fired = false
      RETURNING id
    `);
    return (result.rows?.length ?? 0) > 0;
  }

  // Task #18: Read the awaitingVerification flag for a conversation. Used by the
  // server-side smart-nudge endpoint to short-circuit nudges while the visitor
  // is on the OTP step (defense in depth for older cached widget bundles).
  async isConversationAwaitingVerification(conversationId: string, businessAccountId: string): Promise<boolean> {
    const [row] = await db
      .select({ awaitingVerification: conversations.awaitingVerification })
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.businessAccountId, businessAccountId),
      ));
    return !!row?.awaitingVerification;
  }

  // Task #18: Find stale awaiting_verification conversations older than the
  // given horizon (relative to updatedAt). The sweep worker hard-deletes them.
  async listStaleAwaitingVerificationConversations(olderThan: Date, limit = 200): Promise<{ id: string; businessAccountId: string | null }[]> {
    const rows = await db
      .select({ id: conversations.id, businessAccountId: conversations.businessAccountId })
      .from(conversations)
      .where(and(
        eq(conversations.awaitingVerification, true),
        lte(conversations.updatedAt, olderThan),
      ))
      .limit(limit);
    return rows;
  }

  // Task #18: Hard-delete a pending-verification conversation along with its
  // partial lead(s) and any OTP challenge rows scoped to it. Wrapped in a
  // transaction so analytics never observe a partial state. Messages are
  // removed via the existing ON DELETE CASCADE on messages.conversation_id.
  async hardDeletePendingVerificationConversation(id: string): Promise<{ conversation: number; leads: number; otpChallenges: number }> {
    return await db.transaction(async (tx) => {
      // Race-safe re-check: lock the conversation row FOR UPDATE so a concurrent
      // OTP-verify (which calls clearConversationAwaitingVerification) must wait
      // until this txn commits. Under READ COMMITTED, without the lock the verify
      // could clear the flag between our re-check and the delete and we would
      // still cascade-delete a freshly-verified conversation.
      const locked = await tx.execute(sql`
        SELECT awaiting_verification FROM conversations WHERE id = ${id} FOR UPDATE
      `);
      const row = locked.rows?.[0] as { awaiting_verification: boolean } | undefined;
      if (!row || !row.awaiting_verification) {
        return { conversation: 0, leads: 0, otpChallenges: 0 };
      }
      // Delete dependents BEFORE the parent because leads.conversation_id is
      // ON DELETE SET NULL — deleting the conversation first would null the FK
      // and orphan the partial lead. Messages cascade automatically via FK.
      const leadDel = await tx.delete(leads).where(eq(leads.conversationId, id)).returning({ id: leads.id });
      const otpDel = await tx.delete(phoneOtpChallenges).where(eq(phoneOtpChallenges.conversationId, id)).returning({ id: phoneOtpChallenges.id });
      const convDel = await tx
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.awaitingVerification, true)))
        .returning({ id: conversations.id });
      return { conversation: convDel.length, leads: leadDel.length, otpChallenges: otpDel.length };
    });
  }

  async getConversation(id: string, businessAccountId: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)));
    return conversation || undefined;
  }

  async getConversationById(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return conversation || undefined;
  }

  async getAllConversations(
    businessAccountId: string,
    filters?: { fromDate?: string; toDate?: string; search?: string },
    limit?: number,
    offset?: number
  ): Promise<{ conversations: Conversation[]; total: number }> {
    const conditions = [
      eq(conversations.businessAccountId, businessAccountId),
      // Exclude internal test conversations (business users testing their own chatbot)
      // Use OR with isNull to handle legacy conversations that don't have this field set
      or(eq(conversations.isInternalTest, 'false'), isNull(conversations.isInternalTest)),
      // Task #18: never surface OTP-pending conversations in analytics — the
      // background sweep hard-deletes them if verification never succeeds.
      eq(conversations.awaitingVerification, false),
    ];
    
    // Add date filters if provided
    if (filters?.fromDate) {
      conditions.push(gte(conversations.createdAt, new Date(filters.fromDate)));
    }
    
    if (filters?.toDate) {
      conditions.push(lte(conversations.createdAt, new Date(filters.toDate)));
    }
    
    // Add search filter if provided
    if (filters?.search && filters.search.trim()) {
      conditions.push(ilike(conversations.title, `%${filters.search}%`));
    }
    
    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(conversations)
      .where(and(...conditions));
    
    // Get paginated conversations
    let query = db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.updatedAt));
    
    if (limit !== undefined) {
      query = query.limit(limit) as any;
    }
    
    if (offset !== undefined) {
      query = query.offset(offset) as any;
    }
    
    const conversationsList = await query;
    
    return {
      conversations: conversationsList,
      total: count || 0
    };
  }

  async getConversationsByBusinessAccount(
    businessAccountId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Conversation[]> {
    const conditions = [
      eq(conversations.businessAccountId, businessAccountId),
      // Task #18: analytics callers must never see OTP-pending conversations
      // (background sweep hard-deletes them if verification never succeeds).
      eq(conversations.awaitingVerification, false),
    ];
    
    if (startDate) {
      conditions.push(gte(conversations.createdAt, new Date(startDate)));
    }
    
    if (endDate) {
      conditions.push(lte(conversations.createdAt, new Date(endDate)));
    }

    return await db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.createdAt));
  }

  async getRecentWidgetConversations(
    businessAccountId: string,
    visitorToken: string,
    limitCount: number = 20,
    // When a studentId is supplied the list is scoped to that student ALONE,
    // ignoring the visitor token, so the same student sees their threads from any
    // browser/device (cross-device history). This is safe for secure mode (the
    // studentId came from a verified signed token) and is the point of the
    // grade-scoped plain identity. Undefined => per-browser visitor-token behavior
    // (all other tenants / non-education widgets).
    studentId?: string | null,
  ): Promise<Array<{id: string; title: string | null; updatedAt: Date; messageCount: number}>> {
    const recentConversations = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt
      })
      .from(conversations)
      .where(and(
        eq(conversations.businessAccountId, businessAccountId),
        // Task #18: don't surface OTP-pending conversations in the visitor's
        // recent-history list — they're either about to be verified (and will
        // appear shortly) or about to be hard-deleted by the sweep.
        eq(conversations.awaitingVerification, false),
        // Student-first when known (cross-device); otherwise per-browser visitor.
        ...(studentId
          ? [eq(conversations.studentId, studentId)]
          : [eq(conversations.visitorToken, visitorToken)]),
      ))
      .orderBy(desc(conversations.updatedAt))
      .limit(limitCount);

    if (recentConversations.length === 0) {
      return [];
    }

    // Get message counts for these conversations
    const conversationIds = recentConversations.map(c => c.id);
    const messageCounts = await this.getMessageCountsForConversations(conversationIds);

    return recentConversations.map(conv => ({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: messageCounts[conv.id] || 0
    }));
  }

  async findReusableConversation(
    businessAccountId: string,
    visitorToken: string,
    withinMinutes: number = 30,
    // TopScholar secure mode (Task #17): when a studentId is supplied, only a
    // conversation belonging to that same student is reused. This prevents a
    // different student on a shared device (same visitor token) from inheriting
    // the previous student's thread. Undefined => visitor-token-only (other tenants).
    studentId?: string | null,
    // TopScholar subject-scoped sessions (Task #14): when a non-empty subject is
    // supplied, only a conversation bound to that same subject is reused. This is
    // what makes a subject switch start a fresh thread while chapter switches (not
    // part of the key) keep the existing one. Undefined/empty => subject-agnostic
    // (every non-curriculum tenant is unchanged).
    subject?: string | null,
    // When true, the reuse window is measured from conversation CREATION
    // (created_at) rather than last activity (updated_at). TopScholar sessions have
    // a hard 24h-from-creation lifetime; all other reuse stays last-activity based.
    byCreatedAt: boolean = false,
    // TopScholar subject-scoped sessions (Task #14): the session identity is the
    // conversation's content scope (`topscholar_cp_id`, which encodes board+medium+
    // grade) PLUS the subject. Binding reuse to the cp_id as well as the subject
    // prevents two different scopes that share the same subject label (e.g. "Math"
    // in two different grades) from resuming each other's thread. Undefined/empty =>
    // cp-agnostic (every non-curriculum tenant is unchanged).
    topscholarCpId?: string | null,
    // TopScholar doubt-sync: when a doubtId is supplied, the session identity is the
    // doubt itself — reuse is bound ONLY to that doubt (the client platform opens a
    // fresh doubt per AI session). This takes precedence over subject/cp_id keying.
    // Undefined/empty => doubt-agnostic (every non-doubt tenant/session is unchanged).
    topscholarDoubtId?: string | null,
  ): Promise<Conversation | undefined> {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);
    const subjectFilter = subject != null && String(subject).trim() !== '';
    const subjectValue = subjectFilter ? String(subject).trim() : '';
    const cpIdFilter = topscholarCpId != null && String(topscholarCpId).trim() !== '';
    const cpIdValue = cpIdFilter ? String(topscholarCpId).trim() : '';
    const doubtFilter = topscholarDoubtId != null && String(topscholarDoubtId).trim() !== '';
    const doubtValue = doubtFilter ? String(topscholarDoubtId).trim() : '';
    const results = await db.execute(sql`
      SELECT id, business_account_id, title, visitor_city, visitor_token,
             is_internal_test, category, subcategory, category_confidence,
             relevance, summary, topic_keywords, created_at, updated_at, closed_at,
             student_id, subject
      FROM conversations
      WHERE business_account_id = ${businessAccountId}
        AND visitor_token = ${visitorToken}
        AND ${byCreatedAt ? sql`created_at` : sql`updated_at`} >= ${cutoff}
        AND closed_at IS NULL
        -- Task #18: never reuse an OTP-pending conversation; a new visit must
        -- start a fresh conversation so the prior pending one ages out and is
        -- swept, and we don't accidentally bypass the verify gate.
        AND awaiting_verification = false
        -- Task #17: in secure mode, bind reuse to the signed-token student.
        ${studentId ? sql`AND student_id = ${studentId}` : sql``}
        -- TopScholar doubt-sync: when a doubtId is present it is the sole session
        -- key (each AI session maps 1:1 to a client-platform doubt). Subject/cp_id
        -- keying below is intentionally skipped so it never fragments a doubt thread.
        ${doubtFilter ? sql`AND topscholar_doubt_id = ${doubtValue}` : sql``}
        -- Task #14: in subject-scoped (TopScholar) mode, bind reuse to the subject
        -- AND the content scope (cp_id) so different scopes sharing a subject label
        -- (e.g. "Math" across two grades) never resume each other's thread. Skipped
        -- when a doubtId drives the session (above).
        ${!doubtFilter && subjectFilter ? sql`AND subject = ${subjectValue}` : sql``}
        ${!doubtFilter && cpIdFilter ? sql`AND topscholar_cp_id = ${cpIdValue}` : sql``}
      ORDER BY ${byCreatedAt ? sql`created_at` : sql`updated_at`} DESC
      LIMIT 1
    `);
    if (!results.rows || results.rows.length === 0) return undefined;
    const row = results.rows[0] as any;
    return {
      id: row.id,
      businessAccountId: row.business_account_id,
      title: row.title,
      visitorCity: row.visitor_city,
      visitorToken: row.visitor_token,
      isInternalTest: row.is_internal_test,
      category: row.category,
      subcategory: row.subcategory,
      categoryConfidence: row.category_confidence,
      relevance: row.relevance,
      summary: row.summary,
      topicKeywords: row.topic_keywords,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      userId: row.user_id || null,
      resolvedAt: row.resolved_at || null,
      assignedTo: row.assigned_to || null,
      autoResolved: row.auto_resolved || 'false',
      autoResolvedAt: row.auto_resolved_at || null,
      autoResolutionSummary: row.auto_resolution_summary || null,
      customerRating: row.customer_rating || null,
      customerFeedback: row.customer_feedback || null,
      awaitingVerification: row.awaiting_verification ?? false,
      topscholarCpId: row.topscholar_cp_id || null,
      studentId: row.student_id || null,
      studentName: row.student_name || null,
      subject: row.subject ?? null,
    } as Conversation;
  }

  /**
   * Stamp a conversation closed.
   *
   * `options.mirrorDoubtClose` (default true) controls whether the bound
   * TopScholar doubt is also mirrored to the client platform as 'closed'. Pass
   * false when the caller has ALREADY mirrored a more specific terminal status
   * — notably the doubt-resolve handler, which sends 'resolved'. Letting the
   * generic mirror run after it would immediately overwrite that with 'closed'
   * and the doubt would show up in the client's History tab as merely closed
   * rather than resolved.
   */
  async closeConversation(id: string, options?: { mirrorDoubtClose?: boolean }): Promise<void> {
    const mirrorDoubtClose = options?.mirrorDoubtClose !== false;
    // TopScholar doubt-sync: capture the bound doubt (if any) BEFORE stamping the
    // close so we can mirror the close to the client platform. Only the single
    // TopScholar tenant ever sets topscholar_doubt_id, so this is a cheap no-op for
    // every other account (the JOIN + guard fail fast). Lookup failures never block
    // the close itself.
    let doubtClose: { baseUrl: string; doubtId: string } | null = null;
    if (mirrorDoubtClose) {
      try {
        const res = await db.execute(sql`
          SELECT c.topscholar_doubt_id AS doubt_id,
                 c.business_account_id AS biz,
                 b.topscholar_doubt_sync_base_url AS base_url
            FROM conversations c
            JOIN business_accounts b ON b.id = c.business_account_id
           WHERE c.id = ${id}
             AND c.closed_at IS NULL
             AND c.topscholar_doubt_id IS NOT NULL
        `);
        const row = (res.rows ?? [])[0] as any;
        if (row?.doubt_id && row?.base_url && isTopscholarAccount(String(row.biz))) {
          doubtClose = { baseUrl: String(row.base_url), doubtId: String(row.doubt_id) };
        }
      } catch (err) {
        console.warn('[Storage] closeConversation doubt-sync lookup failed (non-fatal):', err);
      }
    }

    await db.execute(sql`UPDATE conversations SET closed_at = NOW() WHERE id = ${id}`);

    if (doubtClose) {
      // Fire-and-forget: closing the client-platform doubt must never block or fail
      // the local close. 'closed' = session ended (vs. 'resolved' student confirmed).
      void closeDoubt(doubtClose.baseUrl, doubtClose.doubtId, 'closed').catch((err) => {
        console.warn('[Storage] TopScholar doubt close mirror failed (non-fatal):', err?.message || err);
      });
    }
  }

  // TopScholar doubt-sync: list still-open doubt-scoped conversations whose 24h
  // session lifetime has elapsed (created before the cutoff). These can no longer
  // be resumed, so the background sweep closes them to release the client-platform
  // doubt. Returns bare conversation IDs; the caller routes each through
  // closeConversation so the doubt-close mirror fires uniformly.
  async listExpiredOpenDoubtConversations(createdBefore: Date, limit: number): Promise<string[]> {
    const res = await db.execute(sql`
      SELECT id
        FROM conversations
       WHERE topscholar_doubt_id IS NOT NULL
         AND closed_at IS NULL
         AND created_at < ${createdBefore}
       ORDER BY created_at ASC
       LIMIT ${limit}
    `);
    return (res.rows ?? []).map((r: any) => String(r.id));
  }

  /**
   * The most recent conversation bound to a TopScholar doubt, open or closed.
   *
   * Unlike `findReusableConversation` this deliberately does NOT filter on
   * `closed_at IS NULL` — its purpose is to recognise a session that has already
   * ended so the widget can re-lock, which is precisely the case a reuse lookup
   * has to skip. Keyed on the doubt (each doubt maps 1:1 to one session) rather
   * than on browser storage, so the lock survives a cleared cache or a different
   * device.
   */
  async getLatestConversationByDoubtId(businessAccountId: string, doubtId: string): Promise<Conversation | undefined> {
    if (!businessAccountId || !doubtId) return undefined;
    const [row] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.businessAccountId, businessAccountId),
        eq(conversations.topscholarDoubtId, doubtId),
      ))
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    return row as Conversation | undefined;
  }

  async deleteConversation(id: string, businessAccountId: string): Promise<void> {
    await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)));
  }

  async deleteConversationIfEmpty(id: string, businessAccountId: string): Promise<boolean> {
    const result = await db.execute(
      sql`DELETE FROM conversations WHERE id = ${id} AND business_account_id = ${businessAccountId} AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = ${id})`
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateConversationTimestamp(id: string): Promise<void> {
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, id));
  }

  async updateConversationTitle(id: string, businessAccountId: string, title: string): Promise<Conversation> {
    const [conversation] = await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.businessAccountId, businessAccountId)))
      .returning();
    return conversation;
  }

  async updateConversationSummary(id: string, summary: string, topicKeywords: string): Promise<void> {
    await db
      .update(conversations)
      // Task #8: stamp summarizedAt so the idle/close sweep can tell whether a
      // conversation's summary is fresh (>= updatedAt) or stale (< updatedAt).
      .set({ summary, topicKeywords, summarizedAt: new Date() })
      .where(eq(conversations.id, id));
  }

  // Task #8: candidates for the idle/close summary sweep. Returns conversations
  // that are either idle (no activity since `idleBefore`) or explicitly closed,
  // whose summary is missing or stale (summarizedAt NULL or older than the last
  // activity), that have at least `minMessages` messages, and that are neither
  // internal-test nor awaiting OTP verification. Ordered oldest-activity-first
  // so a bounded batch always drains the most-overdue conversations.
  //
  // `activeSince` is a REQUIRED-in-spirit lower bound on the last activity: the
  // sweep only ever targets recently-active conversations. This is what keeps the
  // feature from mass-backfilling the entire historical table (tens of thousands
  // of long-dead conversations that were never summarized) the moment it ships —
  // that would be a large surprise one-time AI spend, the opposite of the cost
  // goal. Conversations that genuinely end going forward are recently-active, and
  // a returning visitor bumps updatedAt back into the window, so nothing real is
  // missed.
  async listConversationsNeedingIdleSummary(
    idleBefore: Date,
    minMessages = 3,
    limit = 100,
    activeSince?: Date,
  ): Promise<{ id: string; businessAccountId: string | null }[]> {
    const rows = await db
      .select({ id: conversations.id, businessAccountId: conversations.businessAccountId })
      .from(conversations)
      .where(and(
        eq(conversations.awaitingVerification, false),
        eq(conversations.isInternalTest, 'false'),
        // Recency lower bound — excludes the ancient backlog. A conversation
        // counts as recent if it was active OR explicitly closed within the
        // window (closeConversation stamps closedAt, not updatedAt, so a recently
        // closed chat with an older updatedAt must still qualify).
        ...(activeSince
          ? [or(gte(conversations.updatedAt, activeSince), gte(conversations.closedAt, activeSince))]
          : []),
        // Idle OR explicitly closed.
        or(
          lte(conversations.updatedAt, idleBefore),
          sql`${conversations.closedAt} IS NOT NULL`,
        ),
        // Summary missing or stale relative to the latest activity.
        or(
          isNull(conversations.summary),
          isNull(conversations.summarizedAt),
          sql`${conversations.summarizedAt} < ${conversations.updatedAt}`,
        ),
        // Minimum-substance bar: skip trivial 1–2 message bounces entirely so
        // they never reach the model.
        sql`(SELECT COUNT(*) FROM ${messages} WHERE ${messages.conversationId} = ${conversations.id}) >= ${minMessages}`,
      ))
      .orderBy(asc(conversations.updatedAt))
      .limit(limit);
    return rows;
  }

  // Message methods
  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async updateMessageMetadata(messageId: string, metadataPatch: Record<string, any>): Promise<void> {
    const [existing] = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!existing) return;
    let current: Record<string, any> = {};
    if (existing.metadata) {
      try { current = JSON.parse(existing.metadata); } catch { current = {}; }
    }
    const merged = { ...current, ...metadataPatch };
    await db
      .update(messages)
      .set({ metadata: JSON.stringify(merged) })
      .where(eq(messages.id, messageId));
  }

  async getMessagesByConversation(conversationId: string, businessAccountId: string): Promise<Message[]> {
    // Verify conversation belongs to business account first
    const conversation = await this.getConversation(conversationId, businessAccountId);
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    return await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async getMessagesByConversationIds(conversationIds: string[]): Promise<Message[]> {
    if (conversationIds.length === 0) {
      return [];
    }

    return await db
      .select()
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(messages.createdAt);
  }

  async getMessageCountsForConversations(conversationIds: string[]): Promise<Record<string, number>> {
    if (conversationIds.length === 0) {
      return {};
    }

    const results = await db
      .select({
        conversationId: messages.conversationId,
        count: count()
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .groupBy(messages.conversationId);

    const countsMap: Record<string, number> = {};
    results.forEach(row => {
      countsMap[row.conversationId] = Number(row.count);
    });

    // Fill in zeros for conversations with no messages
    conversationIds.forEach(id => {
      if (!(id in countsMap)) {
        countsMap[id] = 0;
      }
    });

    return countsMap;
  }

  async deleteMessage(id: string, businessAccountId: string): Promise<void> {
    // First get the message to find its conversation
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id));
    
    if (!message) {
      throw new Error('Message not found');
    }

    // Verify the conversation belongs to the business account
    const conversation = await this.getConversation(message.conversationId, businessAccountId);
    if (!conversation) {
      throw new Error('Message not found or access denied');
    }

    // Now safe to delete
    await db.delete(messages).where(eq(messages.id, id));
  }

  // Uploaded Images methods
  async createUploadedImage(insertImage: InsertUploadedImage): Promise<UploadedImage> {
    const [image] = await db
      .insert(uploadedImages)
      .values(insertImage)
      .returning();
    return image;
  }

  async getUploadedImages(businessAccountId: string): Promise<UploadedImage[]> {
    return await db
      .select()
      .from(uploadedImages)
      .where(eq(uploadedImages.businessAccountId, businessAccountId))
      .orderBy(desc(uploadedImages.createdAt));
  }

  async getUploadedImage(id: string, businessAccountId: string): Promise<UploadedImage | undefined> {
    const [image] = await db
      .select()
      .from(uploadedImages)
      .where(and(eq(uploadedImages.id, id), eq(uploadedImages.businessAccountId, businessAccountId)));
    return image || undefined;
  }

  async deleteUploadedImage(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(uploadedImages)
      .where(and(eq(uploadedImages.id, id), eq(uploadedImages.businessAccountId, businessAccountId)));
  }

  async updateUploadedImageMatchedProducts(imageUrl: string, businessAccountId: string, matchedProducts: any[]): Promise<void> {
    await db
      .update(uploadedImages)
      .set({ matchedProducts: JSON.stringify(matchedProducts) })
      .where(and(eq(uploadedImages.imageUrl, imageUrl), eq(uploadedImages.businessAccountId, businessAccountId)));
  }

  async updateUploadedImageProcessedUrl(imageUrl: string, businessAccountId: string, processedImageUrl: string): Promise<void> {
    await db
      .update(uploadedImages)
      .set({ processedImageUrl })
      .where(and(eq(uploadedImages.imageUrl, imageUrl), eq(uploadedImages.businessAccountId, businessAccountId)));
  }

  async addProcessedImageToUpload(imageUrl: string, businessAccountId: string, label: string, dataUrl: string): Promise<void> {
    const existing = await this.getUploadedImageByUrl(imageUrl, businessAccountId);
    if (!existing) return;
    
    let processedImages: Array<{label: string, dataUrl: string}> = [];
    if (existing.processedImages) {
      try {
        processedImages = JSON.parse(existing.processedImages);
      } catch (e) {
        processedImages = [];
      }
    }
    
    processedImages.push({ label, dataUrl });
    
    await db
      .update(uploadedImages)
      .set({ processedImages: JSON.stringify(processedImages) })
      .where(and(eq(uploadedImages.imageUrl, imageUrl), eq(uploadedImages.businessAccountId, businessAccountId)));
  }

  async clearProcessedImages(imageUrl: string, businessAccountId: string): Promise<void> {
    await db
      .update(uploadedImages)
      .set({ processedImages: null })
      .where(and(eq(uploadedImages.imageUrl, imageUrl), eq(uploadedImages.businessAccountId, businessAccountId)));
  }

  async getUploadedImageByUrl(imageUrl: string, businessAccountId: string): Promise<UploadedImage | undefined> {
    const [image] = await db
      .select()
      .from(uploadedImages)
      .where(and(eq(uploadedImages.imageUrl, imageUrl), eq(uploadedImages.businessAccountId, businessAccountId)));
    return image || undefined;
  }

  // Product methods
  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db
      .insert(products)
      .values(insertProduct)
      .returning();
    
    // Generate text embedding in background (don't await - fire and forget)
    if (insertProduct.businessAccountId) {
      import('./services/productTextEmbeddingService').then(({ productTextEmbeddingService }) => {
        productTextEmbeddingService.generateEmbeddingForProduct(product.id, insertProduct.businessAccountId)
          .catch(err => console.error(`[Product Embedding] Background generation failed for ${product.id}:`, err.message));
      }).catch(err => console.error('[Product Embedding] Failed to import service:', err.message));
    }
    
    return product;
  }

  async getProduct(id: string, businessAccountId: string): Promise<Product | undefined> {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.businessAccountId, businessAccountId)));
    return product || undefined;
  }

  async getAllProducts(businessAccountId: string): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(eq(products.businessAccountId, businessAccountId))
      .orderBy(desc(products.createdAt));
  }

  async updateProduct(id: string, businessAccountId: string, productData: Partial<InsertProduct>): Promise<Product> {
    const [product] = await db
      .update(products)
      .set({ ...productData, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.businessAccountId, businessAccountId)))
      .returning();
    
    // Regenerate text embedding if name or description changed
    if (productData.name !== undefined || productData.description !== undefined) {
      import('./services/productTextEmbeddingService').then(({ productTextEmbeddingService }) => {
        productTextEmbeddingService.generateEmbeddingForProduct(id, businessAccountId)
          .catch(err => console.error(`[Product Embedding] Background regeneration failed for ${id}:`, err.message));
      }).catch(err => console.error('[Product Embedding] Failed to import service:', err.message));
    }
    
    return product;
  }

  async deleteProduct(id: string, businessAccountId: string): Promise<void> {
    await db.delete(products).where(and(eq(products.id, id), eq(products.businessAccountId, businessAccountId)));
  }

  // FAQ methods
  async createFaq(insertFaq: InsertFaq): Promise<Faq> {
    const [faq] = await db
      .insert(faqs)
      .values(insertFaq)
      .returning();
    
    // Embed FAQ asynchronously (don't block the response)
    this.embedFaqAsync(faq.id, faq.question, faq.answer, faq.businessAccountId);
    
    return faq;
  }
  
  private async embedFaqAsync(faqId: string, question: string, answer: string, businessAccountId: string): Promise<void> {
    try {
      const { faqEmbeddingService } = await import('./services/faqEmbeddingService');
      await faqEmbeddingService.embedFAQ(faqId, question, answer, businessAccountId);
    } catch (error) {
      console.error('[Storage] Failed to embed FAQ:', error);
    }
  }

  async getFaq(id: string, businessAccountId: string): Promise<Faq | undefined> {
    const [faq] = await db
      .select()
      .from(faqs)
      .where(and(eq(faqs.id, id), eq(faqs.businessAccountId, businessAccountId)));
    return faq || undefined;
  }

  // Get all PUBLISHED FAQs only (excludes draft_faqs table) - filtered by businessAccountId
  async getAllFaqs(businessAccountId: string): Promise<Faq[]> {
    return await db
      .select()
      .from(faqs) // Only queries 'faqs' table (published), NOT 'draft_faqs'
      .where(eq(faqs.businessAccountId, businessAccountId))
      .orderBy(desc(faqs.createdAt));
  }

  async getFaqsPaginated(businessAccountId: string, limit: number, offset: number, search?: string): Promise<{ faqs: Faq[]; total: number; hasMore: boolean }> {
    const conditions = [eq(faqs.businessAccountId, businessAccountId)];
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(or(ilike(faqs.question, term), ilike(faqs.answer, term))!);
    }
    const condition = and(...conditions);
    const [items, totalResult] = await Promise.all([
      db.select().from(faqs).where(condition).orderBy(desc(faqs.createdAt)).limit(limit).offset(offset),
      db.select({ count: count() }).from(faqs).where(condition),
    ]);
    const total = totalResult[0]?.count ?? 0;
    return { faqs: items, total, hasMore: offset + items.length < total };
  }

  async updateFaq(id: string, businessAccountId: string, faqData: Partial<InsertFaq>): Promise<Faq> {
    const [faq] = await db
      .update(faqs)
      .set({ ...faqData, updatedAt: new Date() })
      .where(and(eq(faqs.id, id), eq(faqs.businessAccountId, businessAccountId)))
      .returning();
    
    // Re-embed FAQ if question or answer changed
    if (faqData.question || faqData.answer) {
      this.embedFaqAsync(faq.id, faq.question, faq.answer, faq.businessAccountId);
    }
    
    return faq;
  }

  async deleteFaq(id: string, businessAccountId: string): Promise<void> {
    await db.delete(faqs).where(and(eq(faqs.id, id), eq(faqs.businessAccountId, businessAccountId)));
  }

  // Lead methods
  async createLead(insertLead: InsertLead): Promise<Lead> {
    const [lead] = await db
      .insert(leads)
      .values(insertLead)
      .returning();
    return lead;
  }

  async getLead(id: string, businessAccountId: string): Promise<Lead | undefined> {
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.businessAccountId, businessAccountId)));
    return lead || undefined;
  }

  async getLeadByConversation(conversationId: string, businessAccountId: string): Promise<Lead | undefined> {
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.conversationId, conversationId), eq(leads.businessAccountId, businessAccountId)));
    return lead || undefined;
  }

  async getAllLeads(businessAccountId: string): Promise<Lead[]> {
    return await db
      .select()
      .from(leads)
      .where(eq(leads.businessAccountId, businessAccountId))
      .orderBy(desc(leads.createdAt));
  }

  async getUnsyncedLeads(businessAccountId: string, fromDate: Date, toDate: Date): Promise<Lead[]> {
    return await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.businessAccountId, businessAccountId),
          gte(leads.createdAt, fromDate),
          lte(leads.createdAt, toDate),
          or(
            isNull(leads.leadsquaredSyncStatus),
            // 'disqualified' is a terminal state — the lead form answer did not
            // match the configured qualifying values, so it must never be picked
            // up by bulk/manual sync either.
            sql`${leads.leadsquaredSyncStatus} NOT IN ('synced', 'disqualified')`
          )
        )
      )
      .orderBy(desc(leads.createdAt));
  }

  async getLeadsPaginated(
    businessAccountId: string,
    filters?: { fromDate?: string; toDate?: string; search?: string },
    limit?: number,
    offset?: number
  ): Promise<{ leads: Lead[]; total: number }> {
    const conditions = [eq(leads.businessAccountId, businessAccountId)];
    
    // Add date filters if provided
    if (filters?.fromDate) {
      conditions.push(gte(leads.createdAt, new Date(filters.fromDate)));
    }
    
    if (filters?.toDate) {
      conditions.push(lte(leads.createdAt, new Date(filters.toDate)));
    }
    
    // Add search filter if provided (search in name, email, phone, message)
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(leads.name, searchTerm),
          ilike(leads.email, searchTerm),
          ilike(leads.phone, searchTerm),
          ilike(leads.message, searchTerm)
        )!
      );
    }
    
    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(leads)
      .where(and(...conditions));
    
    // Get paginated leads
    let query = db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));
    
    if (limit !== undefined) {
      query = query.limit(limit) as any;
    }
    
    if (offset !== undefined) {
      query = query.offset(offset) as any;
    }
    
    const leadsList = await query;
    
    return {
      leads: leadsList,
      total: count || 0
    };
  }

  async updateLead(id: string, businessAccountId: string, leadData: Partial<InsertLead>): Promise<Lead> {
    const [lead] = await db
      .update(leads)
      .set({ ...leadData, createdAt: undefined as any, updatedAt: new Date() }) // Prevent createdAt from being updated, set updatedAt
      .where(and(eq(leads.id, id), eq(leads.businessAccountId, businessAccountId)))
      .returning();
    return lead;
  }

  async deleteLead(id: string, businessAccountId: string): Promise<void> {
    await db.delete(leads).where(and(eq(leads.id, id), eq(leads.businessAccountId, businessAccountId)));
  }

  // Question Bank methods
  async createQuestionBankEntry(insertEntry: InsertQuestionBankEntry): Promise<QuestionBankEntry> {
    const [entry] = await db
      .insert(questionBankEntries)
      .values(insertEntry)
      .returning();
    return entry;
  }

  async getQuestionBankEntry(id: string, businessAccountId: string): Promise<QuestionBankEntry | undefined> {
    const [entry] = await db
      .select()
      .from(questionBankEntries)
      .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.businessAccountId, businessAccountId)));
    return entry || undefined;
  }

  async getAllQuestionBankEntries(
    businessAccountId: string,
    filters?: { status?: string; category?: string; search?: string },
    limit?: number,
    offset?: number
  ): Promise<{ entries: QuestionBankEntry[]; total: number }> {
    const conditions = [eq(questionBankEntries.businessAccountId, businessAccountId)];
    
    if (filters?.status) {
      conditions.push(eq(questionBankEntries.status, filters.status));
    }
    
    if (filters?.category) {
      conditions.push(eq(questionBankEntries.category, filters.category));
    }
    
    if (filters?.search) {
      conditions.push(
        or(
          sql`${questionBankEntries.question} ILIKE ${`%${filters.search}%`}`,
          sql`${questionBankEntries.aiResponse} ILIKE ${`%${filters.search}%`}`
        )!
      );
    }
    
    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(questionBankEntries)
      .where(and(...conditions));
    
    // Get paginated entries
    let query = db
      .select()
      .from(questionBankEntries)
      .where(and(...conditions))
      .orderBy(desc(questionBankEntries.createdAt));
    
    if (limit !== undefined) {
      query = query.limit(limit) as any;
    }
    
    if (offset !== undefined) {
      query = query.offset(offset) as any;
    }
    
    const entries = await query;
    
    return {
      entries,
      total: count || 0
    };
  }

  async updateQuestionBankEntry(
    id: string,
    businessAccountId: string,
    updates: Partial<InsertQuestionBankEntry>
  ): Promise<QuestionBankEntry> {
    const [entry] = await db
      .update(questionBankEntries)
      .set({ ...updates, updatedAt: sql`NOW()` })
      .where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.businessAccountId, businessAccountId)))
      .returning();
    return entry;
  }

  async deleteQuestionBankEntry(id: string, businessAccountId: string): Promise<void> {
    await db.delete(questionBankEntries).where(and(eq(questionBankEntries.id, id), eq(questionBankEntries.businessAccountId, businessAccountId)));
  }

  async getQuestionBankStats(businessAccountId: string): Promise<{
    total: number;
    new: number;
    reviewing: number;
    resolved: number;
    byCategory: Record<string, number>;
  }> {
    const entries = await db
      .select()
      .from(questionBankEntries)
      .where(eq(questionBankEntries.businessAccountId, businessAccountId));
    
    const stats = {
      total: entries.length,
      new: entries.filter(e => e.status === 'new').length,
      reviewing: entries.filter(e => e.status === 'reviewing').length,
      resolved: entries.filter(e => e.status === 'resolved').length,
      byCategory: {} as Record<string, number>
    };
    
    entries.forEach(entry => {
      if (entry.category) {
        stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
      }
    });
    
    return stats;
  }

  // Widget Settings methods
  async getWidgetSettings(businessAccountId: string): Promise<WidgetSettings | undefined> {
    const [settings] = await db
      .select()
      .from(widgetSettings)
      .where(eq(widgetSettings.businessAccountId, businessAccountId));
    return settings || undefined;
  }

  async upsertWidgetSettings(businessAccountId: string, settingsData: Partial<InsertWidgetSettings>): Promise<WidgetSettings> {
    // Try to get existing settings
    const existing = await this.getWidgetSettings(businessAccountId);
    
    if (existing) {
      // Update existing
      const [updated] = await db
        .update(widgetSettings)
        .set({ ...settingsData, updatedAt: new Date() })
        .where(eq(widgetSettings.businessAccountId, businessAccountId))
        .returning();
      return updated;
    } else {
      // Create new with defaults - spread all settingsData to preserve custom fields like leadTrainingConfig
      const [created] = await db
        .insert(widgetSettings)
        .values({
          businessAccountId,
          chatColor: settingsData.chatColor || "#9333ea",
          welcomeMessageType: settingsData.welcomeMessageType || "custom",
          welcomeMessage: settingsData.welcomeMessage || "Hi! How can I help you today?",
          currency: settingsData.currency || "INR",
          ...settingsData, // Spread all other fields including leadTrainingConfig
        })
        .returning();
      return created;
    }
  }

  // Shopify Integration methods
  async updateShopifyCredentials(businessAccountId: string, shopifyStoreUrl: string | null, shopifyAccessToken: string | null): Promise<WidgetSettings> {
    return await this.upsertWidgetSettings(businessAccountId, {
      shopifyStoreUrl,
      shopifyAccessToken,
    });
  }

  async updateShopifyOAuthCredentials(
    businessAccountId: string, 
    clientId: string | null, 
    clientSecret: string | null,
    storeUrl?: string | null
  ): Promise<WidgetSettings> {
    const updateData: Partial<WidgetSettings> = {
      shopifyClientId: clientId,
      shopifyClientSecret: clientSecret,
    };
    if (storeUrl !== undefined) {
      updateData.shopifyStoreUrl = storeUrl;
    }
    return await this.upsertWidgetSettings(businessAccountId, updateData);
  }

  async getShopifyCredentials(businessAccountId: string): Promise<{ 
    storeUrl: string | null; 
    accessToken: string | null;
    clientId: string | null;
    clientSecret: string | null;
  }> {
    const settings = await this.getWidgetSettings(businessAccountId);
    return {
      storeUrl: settings?.shopifyStoreUrl || null,
      accessToken: settings?.shopifyAccessToken || null,
      clientId: settings?.shopifyClientId || null,
      clientSecret: settings?.shopifyClientSecret || null,
    };
  }

  async setShopifyOAuthState(businessAccountId: string, state: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    await this.upsertWidgetSettings(businessAccountId, {
      shopifyOAuthState: state,
      shopifyOAuthStateExpiry: expiresAt,
    } as any);
  }

  async getAndClearShopifyOAuthState(businessAccountId: string): Promise<{ state: string | null; isValid: boolean }> {
    const settings = await this.getWidgetSettings(businessAccountId);
    const state = settings?.shopifyOAuthState || null;
    const expiry = (settings as any)?.shopifyOAuthStateExpiry;
    
    // Check if state exists and hasn't expired
    const isValid = !!state && !!expiry && new Date(expiry) > new Date();
    
    // Clear the state (one-time use)
    if (state) {
      await this.upsertWidgetSettings(businessAccountId, {
        shopifyOAuthState: null,
        shopifyOAuthStateExpiry: null,
      } as any);
    }
    
    return { state, isValid };
  }

  // Password Reset Token methods
  async createPasswordResetToken(token: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const [created] = await db
      .insert(passwordResetTokens)
      .values(token)
      .returning();
    return created;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [result] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    return result;
  }

  async markPasswordResetTokenAsUsed(token: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
  }

  async deleteExpiredPasswordResetTokens(): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(sql`${passwordResetTokens.expiresAt} < NOW()`);
  }

  // Phone OTP challenge methods
  async createOtpChallenge(data: InsertPhoneOtpChallenge): Promise<PhoneOtpChallenge> {
    const [created] = await db.insert(phoneOtpChallenges).values(data).returning();
    return created;
  }

  async countOtpChallengesByBusinessSince(businessAccountId: string, since: Date): Promise<number> {
    const rows = await db
      .select({ id: phoneOtpChallenges.id })
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        sql`${phoneOtpChallenges.createdAt} >= ${since}`,
      ));
    return rows.length;
  }

  async countOtpChallengesByPhoneSince(businessAccountId: string, phoneE164: string, since: Date): Promise<number> {
    const rows = await db
      .select({ id: phoneOtpChallenges.id })
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        eq(phoneOtpChallenges.phoneE164, phoneE164),
        sql`${phoneOtpChallenges.createdAt} >= ${since}`,
      ));
    return rows.length;
  }

  async getOldestOtpChallengeByPhoneSince(businessAccountId: string, phoneE164: string, since: Date): Promise<PhoneOtpChallenge | undefined> {
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        eq(phoneOtpChallenges.phoneE164, phoneE164),
        sql`${phoneOtpChallenges.createdAt} >= ${since}`,
      ))
      .orderBy(phoneOtpChallenges.createdAt)
      .limit(1);
    return row;
  }

  async recordOtpChallengeSent(id: string, providerMessageId: string): Promise<void> {
    await db
      .update(phoneOtpChallenges)
      .set({ providerMessageId, updatedAt: new Date() })
      .where(eq(phoneOtpChallenges.id, id));
  }

  async recordOtpChallengeFailure(id: string, failureReason: string): Promise<void> {
    await db
      .update(phoneOtpChallenges)
      .set({ failureReason, updatedAt: new Date() })
      .where(eq(phoneOtpChallenges.id, id));
  }

  async getLatestOtpChallengeByConversation(businessAccountId: string, conversationId: string): Promise<PhoneOtpChallenge | undefined> {
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        eq(phoneOtpChallenges.conversationId, conversationId),
      ))
      .orderBy(desc(phoneOtpChallenges.createdAt))
      .limit(1);
    return row;
  }

  async hasVerifiedOtpForConversationPhone(businessAccountId: string, conversationId: string, phoneE164: string): Promise<boolean> {
    const [row] = await db
      .select({ id: phoneOtpChallenges.id })
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        eq(phoneOtpChallenges.conversationId, conversationId),
        eq(phoneOtpChallenges.phoneE164, phoneE164),
        sql`${phoneOtpChallenges.verifiedAt} IS NOT NULL`,
      ))
      .limit(1);
    return !!row;
  }

  async getLatestOtpChallengeByPhone(businessAccountId: string, phoneE164: string): Promise<PhoneOtpChallenge | undefined> {
    const [row] = await db
      .select()
      .from(phoneOtpChallenges)
      .where(and(
        eq(phoneOtpChallenges.businessAccountId, businessAccountId),
        eq(phoneOtpChallenges.phoneE164, phoneE164),
      ))
      .orderBy(desc(phoneOtpChallenges.createdAt))
      .limit(1);
    return row;
  }

  async updateOtpChallengeForResend(
    id: string,
    updates: { codeHash: string; lastSentAt: Date; expiresAt: Date; resendCount: number; attempts: number; deliveryChannel?: string | null; providerMessageId?: string | null }
  ): Promise<PhoneOtpChallenge> {
    const [updated] = await db
      .update(phoneOtpChallenges)
      .set({ ...updates, failureReason: null, updatedAt: new Date() })
      .where(eq(phoneOtpChallenges.id, id))
      .returning();
    return updated;
  }

  async updateOtpChallengeAttempts(
    id: string,
    attempts: number,
    lockedUntil: Date | null,
    failureReason?: string | null,
  ): Promise<PhoneOtpChallenge> {
    const set: any = { attempts, lockedUntil, updatedAt: new Date() };
    if (failureReason !== undefined) set.failureReason = failureReason;
    const [updated] = await db
      .update(phoneOtpChallenges)
      .set(set)
      .where(eq(phoneOtpChallenges.id, id))
      .returning();
    return updated;
  }

  async markOtpChallengeVerified(id: string): Promise<PhoneOtpChallenge> {
    const [updated] = await db
      .update(phoneOtpChallenges)
      .set({ verifiedAt: new Date(), failureReason: null, updatedAt: new Date() })
      .where(eq(phoneOtpChallenges.id, id))
      .returning();
    return updated;
  }

  async invalidateOtpChallenge(id: string, reason: string): Promise<void> {
    await db
      .update(phoneOtpChallenges)
      .set({ invalidatedAt: new Date(), failureReason: reason, updatedAt: new Date() })
      .where(eq(phoneOtpChallenges.id, id));
  }

  // Website Analysis methods
  async getWebsiteAnalysis(businessAccountId: string): Promise<WebsiteAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(websiteAnalysis)
      .where(eq(websiteAnalysis.businessAccountId, businessAccountId));
    return analysis || undefined;
  }

  async upsertWebsiteAnalysis(businessAccountId: string, analysisData: Partial<InsertWebsiteAnalysis>): Promise<WebsiteAnalysis> {
    const existing = await this.getWebsiteAnalysis(businessAccountId);
    
    if (existing) {
      const [updated] = await db
        .update(websiteAnalysis)
        .set({ ...analysisData, updatedAt: new Date() })
        .where(eq(websiteAnalysis.businessAccountId, businessAccountId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(websiteAnalysis)
        .values({
          businessAccountId,
          websiteUrl: analysisData.websiteUrl || "",
          status: analysisData.status || "pending",
          ...analysisData,
        })
        .returning();
      return created;
    }
  }

  async updateWebsiteAnalysisStatus(businessAccountId: string, status: string, errorMessage?: string): Promise<void> {
    await db
      .update(websiteAnalysis)
      .set({ 
        status, 
        errorMessage: errorMessage || null,
        lastAnalyzedAt: status === 'completed' ? new Date() : null,
        updatedAt: new Date() 
      })
      .where(eq(websiteAnalysis.businessAccountId, businessAccountId));
  }

  async deleteWebsiteAnalysis(businessAccountId: string): Promise<void> {
    await db
      .delete(websiteAnalysis)
      .where(eq(websiteAnalysis.businessAccountId, businessAccountId));
  }

  // Analyzed Pages methods
  async createAnalyzedPage(analyzedPage: InsertAnalyzedPage): Promise<AnalyzedPage> {
    const [created] = await db
      .insert(analyzedPages)
      .values(analyzedPage)
      .returning();
    return created;
  }

  async getAnalyzedPages(businessAccountId: string): Promise<AnalyzedPage[]> {
    const pages = await db
      .select()
      .from(analyzedPages)
      .where(eq(analyzedPages.businessAccountId, businessAccountId))
      .orderBy(desc(analyzedPages.analyzedAt));
    return pages;
  }

  async deleteAnalyzedPage(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(analyzedPages)
      .where(
        and(
          eq(analyzedPages.id, id),
          eq(analyzedPages.businessAccountId, businessAccountId)
        )
      );
  }

  async deleteAnalyzedPages(businessAccountId: string): Promise<void> {
    await db
      .delete(analyzedPages)
      .where(eq(analyzedPages.businessAccountId, businessAccountId));
  }

  // Training Documents methods
  async createTrainingDocument(document: InsertTrainingDocument): Promise<TrainingDocument> {
    const [created] = await db
      .insert(trainingDocuments)
      .values(document)
      .returning();
    return created;
  }

  async getTrainingDocument(id: string, businessAccountId: string): Promise<TrainingDocument | undefined> {
    const [document] = await db
      .select()
      .from(trainingDocuments)
      .where(
        and(
          eq(trainingDocuments.id, id),
          eq(trainingDocuments.businessAccountId, businessAccountId)
        )
      );
    return document || undefined;
  }

  async getTrainingDocuments(businessAccountId: string): Promise<TrainingDocument[]> {
    const documents = await db
      .select()
      .from(trainingDocuments)
      .where(eq(trainingDocuments.businessAccountId, businessAccountId))
      .orderBy(desc(trainingDocuments.createdAt));
    return documents;
  }

  async updateTrainingDocumentStatus(id: string, status: string, errorMessage?: string): Promise<void> {
    await db
      .update(trainingDocuments)
      .set({
        uploadStatus: status,
        errorMessage: errorMessage || null,
        updatedAt: new Date()
      })
      .where(eq(trainingDocuments.id, id));
  }

  async updateTrainingDocumentContent(id: string, extractedText: string, summary: string, keyPoints: string): Promise<void> {
    await db
      .update(trainingDocuments)
      .set({
        extractedText,
        summary,
        keyPoints,
        uploadStatus: 'completed',
        processedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(trainingDocuments.id, id));
  }

  async deleteTrainingDocument(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(trainingDocuments)
      .where(
        and(
          eq(trainingDocuments.id, id),
          eq(trainingDocuments.businessAccountId, businessAccountId)
        )
      );
  }

  // Category methods
  async createCategory(category: InsertCategory): Promise<Category> {
    const [created] = await db
      .insert(categories)
      .values(category)
      .returning();
    return created;
  }

  async getCategory(id: string, businessAccountId: string): Promise<Category | undefined> {
    const [category] = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, id),
          eq(categories.businessAccountId, businessAccountId)
        )
      );
    return category || undefined;
  }

  async getAllCategories(businessAccountId: string): Promise<Category[]> {
    return await db
      .select()
      .from(categories)
      .where(eq(categories.businessAccountId, businessAccountId))
      .orderBy(categories.name);
  }

  async updateCategory(id: string, businessAccountId: string, category: Partial<InsertCategory>): Promise<Category> {
    const [updated] = await db
      .update(categories)
      .set({ ...category, updatedAt: new Date() })
      .where(
        and(
          eq(categories.id, id),
          eq(categories.businessAccountId, businessAccountId)
        )
      )
      .returning();
    return updated;
  }

  async deleteCategory(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(categories)
      .where(
        and(
          eq(categories.id, id),
          eq(categories.businessAccountId, businessAccountId)
        )
      );
  }

  // Tag methods
  async createTag(tag: InsertTag): Promise<Tag> {
    const [created] = await db
      .insert(tags)
      .values(tag)
      .returning();
    return created;
  }

  async getTag(id: string, businessAccountId: string): Promise<Tag | undefined> {
    const [tag] = await db
      .select()
      .from(tags)
      .where(
        and(
          eq(tags.id, id),
          eq(tags.businessAccountId, businessAccountId)
        )
      );
    return tag || undefined;
  }

  async getAllTags(businessAccountId: string): Promise<Tag[]> {
    return await db
      .select()
      .from(tags)
      .where(eq(tags.businessAccountId, businessAccountId))
      .orderBy(tags.name);
  }

  async updateTag(id: string, businessAccountId: string, tag: Partial<InsertTag>): Promise<Tag> {
    const [updated] = await db
      .update(tags)
      .set({ ...tag, updatedAt: new Date() })
      .where(
        and(
          eq(tags.id, id),
          eq(tags.businessAccountId, businessAccountId)
        )
      )
      .returning();
    return updated;
  }

  async deleteTag(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(tags)
      .where(
        and(
          eq(tags.id, id),
          eq(tags.businessAccountId, businessAccountId)
        )
      );
  }

  // Product-Category assignment methods
  async assignProductToCategory(productId: string, categoryId: string): Promise<ProductCategory> {
    const [assignment] = await db
      .insert(productCategories)
      .values({ productId, categoryId })
      .returning();
    return assignment;
  }

  async getProductCategories(productId: string): Promise<Category[]> {
    const result = await db
      .select({
        id: categories.id,
        businessAccountId: categories.businessAccountId,
        name: categories.name,
        description: categories.description,
        parentCategoryId: categories.parentCategoryId,
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
      })
      .from(productCategories)
      .innerJoin(categories, eq(productCategories.categoryId, categories.id))
      .where(eq(productCategories.productId, productId));
    return result;
  }

  async getCategoryProducts(categoryId: string, businessAccountId: string): Promise<Product[]> {
    const result = await db
      .select({
        id: products.id,
        businessAccountId: products.businessAccountId,
        name: products.name,
        description: products.description,
        price: products.price,
        imageUrl: products.imageUrl,
        source: products.source,
        shopifyProductId: products.shopifyProductId,
        shopifyLastSyncedAt: products.shopifyLastSyncedAt,
        isEditable: products.isEditable,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
      })
      .from(productCategories)
      .innerJoin(products, eq(productCategories.productId, products.id))
      .where(
        and(
          eq(productCategories.categoryId, categoryId),
          eq(products.businessAccountId, businessAccountId)
        )
      );
    return result;
  }

  async removeProductFromCategory(productId: string, categoryId: string): Promise<void> {
    await db
      .delete(productCategories)
      .where(
        and(
          eq(productCategories.productId, productId),
          eq(productCategories.categoryId, categoryId)
        )
      );
  }

  // Product-Tag assignment methods
  async assignProductToTag(productId: string, tagId: string): Promise<ProductTag> {
    const [assignment] = await db
      .insert(productTags)
      .values({ productId, tagId })
      .returning();
    return assignment;
  }

  async getProductTags(productId: string): Promise<Tag[]> {
    const result = await db
      .select({
        id: tags.id,
        businessAccountId: tags.businessAccountId,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
        updatedAt: tags.updatedAt,
      })
      .from(productTags)
      .innerJoin(tags, eq(productTags.tagId, tags.id))
      .where(eq(productTags.productId, productId));
    return result;
  }

  async getTagProducts(tagId: string, businessAccountId: string): Promise<Product[]> {
    const result = await db
      .select({
        id: products.id,
        businessAccountId: products.businessAccountId,
        name: products.name,
        description: products.description,
        price: products.price,
        imageUrl: products.imageUrl,
        source: products.source,
        shopifyProductId: products.shopifyProductId,
        shopifyLastSyncedAt: products.shopifyLastSyncedAt,
        isEditable: products.isEditable,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
      })
      .from(productTags)
      .innerJoin(products, eq(productTags.productId, products.id))
      .where(
        and(
          eq(productTags.tagId, tagId),
          eq(products.businessAccountId, businessAccountId)
        )
      );
    return result;
  }

  async removeProductFromTag(productId: string, tagId: string): Promise<void> {
    await db
      .delete(productTags)
      .where(
        and(
          eq(productTags.productId, productId),
          eq(productTags.tagId, tagId)
        )
      );
  }

  // Product Relationship methods
  async createProductRelationship(relationship: InsertProductRelationship): Promise<ProductRelationship> {
    const [created] = await db
      .insert(productRelationships)
      .values(relationship)
      .returning();
    return created;
  }

  async getProductRelationship(id: string, businessAccountId: string): Promise<ProductRelationship | undefined> {
    const [relationship] = await db
      .select()
      .from(productRelationships)
      .where(
        and(
          eq(productRelationships.id, id),
          eq(productRelationships.businessAccountId, businessAccountId)
        )
      );
    return relationship || undefined;
  }

  async getProductRelationships(productId: string, businessAccountId: string, relationshipType?: string): Promise<ProductRelationship[]> {
    const conditions = [
      eq(productRelationships.sourceProductId, productId),
      eq(productRelationships.businessAccountId, businessAccountId)
    ];
    
    if (relationshipType) {
      conditions.push(eq(productRelationships.relationshipType, relationshipType));
    }

    return await db
      .select()
      .from(productRelationships)
      .where(and(...conditions))
      .orderBy(desc(productRelationships.weight));
  }

  async updateProductRelationship(id: string, businessAccountId: string, relationship: Partial<InsertProductRelationship>): Promise<ProductRelationship> {
    const [updated] = await db
      .update(productRelationships)
      .set({ ...relationship, updatedAt: new Date() })
      .where(
        and(
          eq(productRelationships.id, id),
          eq(productRelationships.businessAccountId, businessAccountId)
        )
      )
      .returning();
    return updated;
  }

  async deleteProductRelationship(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(productRelationships)
      .where(
        and(
          eq(productRelationships.id, id),
          eq(productRelationships.businessAccountId, businessAccountId)
        )
      );
  }

  // Get related products with details
  async getRelatedProducts(productId: string, businessAccountId: string): Promise<{
    crossSell: Product[];
    similar: Product[];
    complement: Product[];
    bundle: Product[];
  }> {
    // Get all relationships for this product
    const relationships = await this.getProductRelationships(productId, businessAccountId);
    
    // Group target product IDs by relationship type
    const crossSellIds: string[] = [];
    const similarIds: string[] = [];
    const complementIds: string[] = [];
    const bundleIds: string[] = [];

    for (const rel of relationships) {
      switch (rel.relationshipType) {
        case 'cross_sell':
          crossSellIds.push(rel.targetProductId);
          break;
        case 'similar':
          similarIds.push(rel.targetProductId);
          break;
        case 'complement':
          complementIds.push(rel.targetProductId);
          break;
        case 'bundle':
          bundleIds.push(rel.targetProductId);
          break;
      }
    }

    // Fetch actual product details for each type
    const [crossSell, similar, complement, bundle] = await Promise.all([
      crossSellIds.length > 0 
        ? db.select().from(products).where(
            and(
              inArray(products.id, crossSellIds),
              eq(products.businessAccountId, businessAccountId)
            )
          )
        : [],
      similarIds.length > 0
        ? db.select().from(products).where(
            and(
              inArray(products.id, similarIds),
              eq(products.businessAccountId, businessAccountId)
            )
          )
        : [],
      complementIds.length > 0
        ? db.select().from(products).where(
            and(
              inArray(products.id, complementIds),
              eq(products.businessAccountId, businessAccountId)
            )
          )
        : [],
      bundleIds.length > 0
        ? db.select().from(products).where(
            and(
              inArray(products.id, bundleIds),
              eq(products.businessAccountId, businessAccountId)
            )
          )
        : []
    ]);

    return {
      crossSell,
      similar,
      complement,
      bundle
    };
  }

  // Shopify Auto-Sync methods
  async getAccountsNeedingShopifySync(): Promise<{ id: string; name: string; shopifySyncFrequency: string | null }[]> {
    const now = new Date();

    const accounts = await db
      .select({
        id: businessAccounts.id,
        name: businessAccounts.name,
        shopifySyncFrequency: businessAccounts.shopifySyncFrequency,
        shopifyLastSyncedAt: businessAccounts.shopifyLastSyncedAt,
        shopifyAutoSyncEnabled: businessAccounts.shopifyAutoSyncEnabled,
        shopifySyncStatus: businessAccounts.shopifySyncStatus,
      })
      .from(businessAccounts)
      .where(
        and(
          eq(businessAccounts.shopifyAutoSyncEnabled, "true"),
          or(
            eq(businessAccounts.shopifySyncStatus, "idle"),
            eq(businessAccounts.shopifySyncStatus, "completed"),
            eq(businessAccounts.shopifySyncStatus, "failed")
          )
        )
      );

    const accountsNeedingSync = accounts.filter((account) => {
      if (!account.shopifyLastSyncedAt) {
        return true;
      }

      const frequencyHours = parseInt(account.shopifySyncFrequency || "24", 10);
      const lastSyncTime = new Date(account.shopifyLastSyncedAt).getTime();
      const hoursSinceLastSync = (now.getTime() - lastSyncTime) / (1000 * 60 * 60);

      return hoursSinceLastSync >= frequencyHours;
    });

    return accountsNeedingSync.map((a) => ({
      id: a.id,
      name: a.name,
      shopifySyncFrequency: a.shopifySyncFrequency,
    }));
  }

  async updateShopifySyncStatus(businessAccountId: string, status: string): Promise<void> {
    await db
      .update(businessAccounts)
      .set({ shopifySyncStatus: status })
      .where(eq(businessAccounts.id, businessAccountId));
  }

  async updateShopifyLastSyncedAt(businessAccountId: string): Promise<void> {
    await db
      .update(businessAccounts)
      .set({ shopifyLastSyncedAt: new Date() })
      .where(eq(businessAccounts.id, businessAccountId));
  }

  async updateShopifyAutoSync(
    businessAccountId: string,
    enabled: boolean,
    frequency: number
  ): Promise<void> {
    await db
      .update(businessAccounts)
      .set({
        shopifyAutoSyncEnabled: enabled ? "true" : "false",
        shopifySyncFrequency: frequency.toString(),
      })
      .where(eq(businessAccounts.id, businessAccountId));
  }

  async getShopifyAutoSyncSettings(businessAccountId: string): Promise<{
    enabled: boolean;
    frequency: number;
    lastSyncedAt: Date | null;
    syncStatus: string | null;
  }> {
    const [account] = await db
      .select({
        shopifyAutoSyncEnabled: businessAccounts.shopifyAutoSyncEnabled,
        shopifySyncFrequency: businessAccounts.shopifySyncFrequency,
        shopifyLastSyncedAt: businessAccounts.shopifyLastSyncedAt,
        shopifySyncStatus: businessAccounts.shopifySyncStatus,
      })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));

    if (!account) {
      return {
        enabled: false,
        frequency: 24,
        lastSyncedAt: null,
        syncStatus: "idle",
      };
    }

    return {
      enabled: account.shopifyAutoSyncEnabled === "true",
      frequency: parseInt(account.shopifySyncFrequency || "24", 10),
      lastSyncedAt: account.shopifyLastSyncedAt,
      syncStatus: account.shopifySyncStatus,
    };
  }

  // Appointment System methods
  async createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate> {
    const [created] = await db.insert(scheduleTemplates).values(template).returning();
    return created;
  }

  async getScheduleTemplates(businessAccountId: string): Promise<ScheduleTemplate[]> {
    return await db
      .select()
      .from(scheduleTemplates)
      .where(eq(scheduleTemplates.businessAccountId, businessAccountId));
  }

  async updateScheduleTemplate(
    id: string,
    businessAccountId: string,
    template: Partial<InsertScheduleTemplate>
  ): Promise<ScheduleTemplate> {
    const [updated] = await db
      .update(scheduleTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(and(eq(scheduleTemplates.id, id), eq(scheduleTemplates.businessAccountId, businessAccountId)))
      .returning();
    return updated;
  }

  async deleteScheduleTemplate(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(scheduleTemplates)
      .where(and(eq(scheduleTemplates.id, id), eq(scheduleTemplates.businessAccountId, businessAccountId)));
  }

  async createSlotOverride(override: InsertSlotOverride): Promise<SlotOverride> {
    const [created] = await db.insert(slotOverrides).values(override).returning();
    return created;
  }

  async getSlotOverridesForRange(
    businessAccountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<SlotOverride[]> {
    return await db
      .select()
      .from(slotOverrides)
      .where(
        and(
          eq(slotOverrides.businessAccountId, businessAccountId),
          gte(slotOverrides.slotDate, startDate),
          lte(slotOverrides.slotDate, endDate)
        )
      );
  }

  async updateSlotOverride(
    id: string,
    businessAccountId: string,
    override: Partial<InsertSlotOverride>
  ): Promise<SlotOverride> {
    const [updated] = await db
      .update(slotOverrides)
      .set({ ...override, updatedAt: new Date() })
      .where(and(eq(slotOverrides.id, id), eq(slotOverrides.businessAccountId, businessAccountId)))
      .returning();
    return updated;
  }

  async deleteSlotOverride(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(slotOverrides)
      .where(and(eq(slotOverrides.id, id), eq(slotOverrides.businessAccountId, businessAccountId)));
  }

  async createAppointment(appointment: InsertAppointment): Promise<Appointment> {
    const [created] = await db.insert(appointments).values(appointment).returning();
    return created;
  }

  async getAppointmentsForRange(
    businessAccountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.businessAccountId, businessAccountId),
          gte(appointments.appointmentDate, startDate),
          lte(appointments.appointmentDate, endDate)
        )
      );
  }

  async getAppointmentsByStatus(businessAccountId: string, status: string): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessAccountId, businessAccountId), eq(appointments.status, status)));
  }

  async getAppointment(id: string): Promise<Appointment | null> {
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id));
    return appointment || null;
  }

  async getAppointmentsByConversationId(conversationId: string): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(eq(appointments.conversationId, conversationId));
  }

  async updateAppointment(id: string, updates: Partial<Appointment>): Promise<Appointment> {
    const [updated] = await db
      .update(appointments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appointments.id, id))
      .returning();
    return updated;
  }

  async updateAppointmentStatus(
    id: string,
    businessAccountId: string,
    status: string,
    cancellationReason?: string
  ): Promise<Appointment> {
    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (cancellationReason) {
      updateData.cancellationReason = cancellationReason;
    }

    const [updated] = await db
      .update(appointments)
      .set(updateData)
      .where(and(eq(appointments.id, id), eq(appointments.businessAccountId, businessAccountId)))
      .returning();
    return updated;
  }

  async getAllAppointments(businessAccountId: string): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessAccountId, businessAccountId))
      .orderBy(asc(appointments.appointmentDate), asc(appointments.appointmentTime));
  }

  // Demo Page methods
  async createDemoPage(demoPage: InsertDemoPage & { token: string }): Promise<DemoPage> {
    const [created] = await db
      .insert(demoPages)
      .values(demoPage)
      .returning();
    return created;
  }

  async getDemoPage(id: string): Promise<DemoPage | undefined> {
    const [page] = await db
      .select()
      .from(demoPages)
      .where(eq(demoPages.id, id));
    return page || undefined;
  }

  async getDemoPageByToken(token: string): Promise<DemoPage | undefined> {
    const [page] = await db
      .select()
      .from(demoPages)
      .where(eq(demoPages.token, token));
    return page || undefined;
  }

  async getAllDemoPages(): Promise<DemoPage[]> {
    return await db
      .select()
      .from(demoPages)
      .orderBy(desc(demoPages.createdAt));
  }

  async updateDemoPage(id: string, updates: Partial<{ title: string; description: string; appearance: string; isActive: string; expiresAt: Date | null; businessAccountId: string }>): Promise<DemoPage> {
    const [updated] = await db
      .update(demoPages)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(demoPages.id, id))
      .returning();
    return updated;
  }

  async updateDemoPageLastViewed(token: string): Promise<void> {
    await db
      .update(demoPages)
      .set({ lastViewedAt: new Date() })
      .where(eq(demoPages.token, token));
  }

  async regenerateDemoPageToken(id: string, newToken: string): Promise<DemoPage> {
    const [updated] = await db
      .update(demoPages)
      .set({ token: newToken, updatedAt: new Date() })
      .where(eq(demoPages.id, id))
      .returning();
    return updated;
  }

  async deleteDemoPage(id: string): Promise<void> {
    await db
      .delete(demoPages)
      .where(eq(demoPages.id, id));
  }

  // Public Chat Link methods
  async getOrCreatePublicChatLink(businessAccountId: string): Promise<PublicChatLink> {
    // Try to get existing link
    const [existing] = await db
      .select()
      .from(publicChatLinks)
      .where(eq(publicChatLinks.businessAccountId, businessAccountId));

    if (existing) {
      return existing;
    }

    // Create new link with random token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const [created] = await db
      .insert(publicChatLinks)
      .values({
        businessAccountId,
        token,
        isActive: "true",
      })
      .returning();
    return created;
  }

  async getPublicChatLinkByToken(token: string): Promise<PublicChatLink | undefined> {
    const [link] = await db
      .select()
      .from(publicChatLinks)
      .where(eq(publicChatLinks.token, token));
    return link;
  }

  async togglePublicChatLinkStatus(businessAccountId: string): Promise<PublicChatLink> {
    // Get current status
    const [current] = await db
      .select()
      .from(publicChatLinks)
      .where(eq(publicChatLinks.businessAccountId, businessAccountId));

    if (!current) {
      throw new Error("Public chat link not found");
    }

    // Toggle status
    const newStatus = current.isActive === "true" ? "false" : "true";
    const [updated] = await db
      .update(publicChatLinks)
      .set({ 
        isActive: newStatus,
        updatedAt: new Date()
      })
      .where(eq(publicChatLinks.businessAccountId, businessAccountId))
      .returning();
    return updated;
  }

  async regeneratePublicChatLinkToken(businessAccountId: string, newToken: string): Promise<PublicChatLink> {
    const [updated] = await db
      .update(publicChatLinks)
      .set({ 
        token: newToken,
        updatedAt: new Date()
      })
      .where(eq(publicChatLinks.businessAccountId, businessAccountId))
      .returning();
    return updated;
  }

  async updatePublicChatLinkAccess(token: string): Promise<void> {
    await db
      .update(publicChatLinks)
      .set({ 
        lastAccessedAt: new Date(),
        accessCount: sql`${publicChatLinks.accessCount} + 1`
      })
      .where(eq(publicChatLinks.token, token));
  }

  async updatePublicChatLinkPassword(businessAccountId: string, password: string | null): Promise<PublicChatLink> {
    const [updated] = await db
      .update(publicChatLinks)
      .set({ 
        password: password,
        updatedAt: new Date()
      })
      .where(eq(publicChatLinks.businessAccountId, businessAccountId))
      .returning();
    
    if (!updated) {
      throw new Error("Public chat link not found");
    }
    
    return updated;
  }

  // Support Ticket methods
  async createSupportTicket(insertTicket: InsertSupportTicket): Promise<SupportTicket> {
    // Generate sequential ticket number for this business account
    const [maxTicket] = await db
      .select({ maxNumber: sql<number>`COALESCE(MAX(${supportTickets.ticketNumber}), 0)` })
      .from(supportTickets)
      .where(eq(supportTickets.businessAccountId, insertTicket.businessAccountId));
    
    const ticketNumber = ((maxTicket?.maxNumber || 0) + 1).toString();
    
    const [ticket] = await db
      .insert(supportTickets)
      .values({ ...insertTicket, ticketNumber })
      .returning();
    return ticket;
  }

  async getSupportTicket(id: string, businessAccountId: string): Promise<SupportTicket | undefined> {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ));
    return ticket;
  }

  async getAllSupportTickets(
    businessAccountId: string,
    filters?: { status?: string; priority?: string; category?: string }
  ): Promise<SupportTicket[]> {
    const conditions = [eq(supportTickets.businessAccountId, businessAccountId)];
    
    if (filters?.status) {
      conditions.push(eq(supportTickets.status, filters.status));
    }
    if (filters?.priority) {
      conditions.push(eq(supportTickets.priority, filters.priority));
    }
    if (filters?.category) {
      conditions.push(eq(supportTickets.category, filters.category));
    }

    const tickets = await db
      .select()
      .from(supportTickets)
      .where(and(...conditions))
      .orderBy(desc(supportTickets.createdAt));
    
    return tickets;
  }

  async updateSupportTicket(
    id: string,
    businessAccountId: string,
    updates: Partial<InsertSupportTicket>
  ): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({ 
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async updateTicketStatus(id: string, businessAccountId: string, status: string): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({ 
        status,
        updatedAt: new Date()
      })
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async updateTicketPriority(id: string, businessAccountId: string, priority: string): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({ 
        priority,
        updatedAt: new Date()
      })
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async updateTicketAIAnalysis(
    id: string,
    aiAnalysis: string,
    aiPriority?: string,
    aiCategory?: string,
    sentimentScore?: number,
    emotionalState?: string,
    churnRisk?: string
  ): Promise<SupportTicket> {
    const updates: any = { 
      aiAnalysis,
      updatedAt: new Date()
    };
    
    if (aiPriority) updates.aiPriority = aiPriority;
    if (aiCategory) updates.aiCategory = aiCategory;
    if (sentimentScore !== undefined) updates.sentimentScore = sentimentScore.toString();
    if (emotionalState) updates.emotionalState = emotionalState;
    if (churnRisk) updates.churnRisk = churnRisk;

    const [updated] = await db
      .update(supportTickets)
      .set(updates)
      .where(eq(supportTickets.id, id))
      .returning();
    
    return updated;
  }

  async updateTicketAutoResolution(
    id: string,
    proposedSolution: string,
    confidence: number
  ): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({
        aiDraftedResponse: proposedSolution,
        autoResolutionSummary: `AI auto-resolved with ${Math.round(confidence * 100)}% confidence`,
        updatedAt: new Date()
      })
      .where(eq(supportTickets.id, id))
      .returning();
    
    return updated;
  }

  async resolveTicket(
    id: string,
    businessAccountId: string,
    isAutoResolved: boolean = false,
    resolutionSummary?: string
  ): Promise<SupportTicket> {
    const updates: any = {
      status: 'resolved',
      resolvedAt: new Date(),
      updatedAt: new Date()
    };

    if (isAutoResolved) {
      updates.autoResolved = 'true';
      updates.autoResolvedAt = new Date();
      if (resolutionSummary) {
        updates.autoResolutionSummary = resolutionSummary;
      }
    }

    const [updated] = await db
      .update(supportTickets)
      .set(updates)
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async closeTicket(id: string, businessAccountId: string): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async reopenTicket(id: string, businessAccountId: string): Promise<SupportTicket> {
    const [updated] = await db
      .update(supportTickets)
      .set({
        status: 'open',
        resolvedAt: null,
        closedAt: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(supportTickets.id, id),
        eq(supportTickets.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async updateTicketRating(id: string, rating: number, feedback?: string): Promise<SupportTicket> {
    const updates: any = {
      customerRating: rating.toString(),
      updatedAt: new Date()
    };
    
    if (feedback) {
      updates.customerFeedback = feedback;
    }

    const [updated] = await db
      .update(supportTickets)
      .set(updates)
      .where(eq(supportTickets.id, id))
      .returning();
    
    return updated;
  }

  async getTicketStats(businessAccountId: string): Promise<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    autoResolved: number;
    avgResolutionTime: number;
  }> {
    const tickets = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.businessAccountId, businessAccountId));

    const stats = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => t.status === 'in_progress').length,
      resolved: tickets.filter(t => t.status === 'resolved').length,
      closed: tickets.filter(t => t.status === 'closed').length,
      autoResolved: tickets.filter(t => t.autoResolved === 'true').length,
      avgResolutionTime: 0
    };

    // Calculate average resolution time in hours
    const resolvedTickets = tickets.filter(t => t.resolvedAt);
    if (resolvedTickets.length > 0) {
      const totalTime = resolvedTickets.reduce((sum, ticket) => {
        const created = new Date(ticket.createdAt).getTime();
        const resolved = new Date(ticket.resolvedAt!).getTime();
        return sum + (resolved - created);
      }, 0);
      stats.avgResolutionTime = Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60)); // Convert to hours
    }

    return stats;
  }

  // Ticket Message methods
  async createTicketMessage(insertMessage: InsertTicketMessage): Promise<TicketMessage> {
    const [message] = await db
      .insert(ticketMessages)
      .values(insertMessage)
      .returning();
    
    // Update ticket's updatedAt timestamp
    await db
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.id, insertMessage.ticketId));
    
    return message;
  }

  async getTicketMessages(ticketId: string, businessAccountId: string): Promise<TicketMessage[]> {
    // Verify ticket belongs to business
    const ticket = await this.getSupportTicket(ticketId, businessAccountId);
    if (!ticket) {
      return [];
    }

    const messages = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(ticketMessages.createdAt);
    
    return messages;
  }

  async updateTicketMessage(
    id: string,
    businessAccountId: string,
    updates: Partial<InsertTicketMessage>
  ): Promise<TicketMessage> {
    const [updated] = await db
      .update(ticketMessages)
      .set(updates)
      .where(eq(ticketMessages.id, id))
      .returning();
    
    return updated;
  }

  // Ticket Attachment methods
  async createTicketAttachment(insertAttachment: InsertTicketAttachment): Promise<TicketAttachment> {
    const [attachment] = await db
      .insert(ticketAttachments)
      .values(insertAttachment)
      .returning();
    
    return attachment;
  }

  async getTicketAttachments(ticketId: string, businessAccountId: string): Promise<TicketAttachment[]> {
    // Verify ticket belongs to business
    const ticket = await this.getSupportTicket(ticketId, businessAccountId);
    if (!ticket) {
      return [];
    }

    const attachments = await db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, ticketId))
      .orderBy(ticketAttachments.createdAt);
    
    return attachments;
  }

  async deleteTicketAttachment(id: string, businessAccountId: string): Promise<void> {
    // Get attachment to verify it belongs to this business's ticket
    const [attachment] = await db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.id, id));
    
    if (attachment) {
      // Verify ticket belongs to business
      const ticket = await this.getSupportTicket(attachment.ticketId, businessAccountId);
      if (ticket) {
        await db
          .delete(ticketAttachments)
          .where(eq(ticketAttachments.id, id));
      }
    }
  }

  // Canned Response methods
  async createCannedResponse(insertResponse: InsertCannedResponse): Promise<CannedResponse> {
    const [response] = await db
      .insert(cannedResponses)
      .values(insertResponse)
      .returning();
    
    return response;
  }

  async getCannedResponse(id: string, businessAccountId: string): Promise<CannedResponse | undefined> {
    const [response] = await db
      .select()
      .from(cannedResponses)
      .where(and(
        eq(cannedResponses.id, id),
        eq(cannedResponses.businessAccountId, businessAccountId)
      ));
    
    return response;
  }

  async getAllCannedResponses(businessAccountId: string): Promise<CannedResponse[]> {
    const responses = await db
      .select()
      .from(cannedResponses)
      .where(eq(cannedResponses.businessAccountId, businessAccountId))
      .orderBy(desc(cannedResponses.useCount), cannedResponses.title);
    
    return responses;
  }

  async updateCannedResponse(
    id: string,
    businessAccountId: string,
    updates: Partial<InsertCannedResponse>
  ): Promise<CannedResponse> {
    const [updated] = await db
      .update(cannedResponses)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(cannedResponses.id, id),
        eq(cannedResponses.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async deleteCannedResponse(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(cannedResponses)
      .where(and(
        eq(cannedResponses.id, id),
        eq(cannedResponses.businessAccountId, businessAccountId)
      ));
  }

  async incrementCannedResponseUsage(id: string): Promise<void> {
    await db
      .update(cannedResponses)
      .set({
        useCount: sql`${cannedResponses.useCount} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(cannedResponses.id, id));
  }

  // Ticket Insight methods
  async createTicketInsight(insertInsight: InsertTicketInsight): Promise<TicketInsight> {
    const [insight] = await db
      .insert(ticketInsights)
      .values(insertInsight)
      .returning();
    
    return insight;
  }

  async getTicketInsight(id: string, businessAccountId: string): Promise<TicketInsight | undefined> {
    const [insight] = await db
      .select()
      .from(ticketInsights)
      .where(and(
        eq(ticketInsights.id, id),
        eq(ticketInsights.businessAccountId, businessAccountId)
      ));
    
    return insight;
  }

  async getAllTicketInsights(
    businessAccountId: string,
    filters?: { status?: string; insightType?: string }
  ): Promise<TicketInsight[]> {
    const conditions = [eq(ticketInsights.businessAccountId, businessAccountId)];
    
    if (filters?.status) {
      conditions.push(eq(ticketInsights.status, filters.status));
    }
    if (filters?.insightType) {
      conditions.push(eq(ticketInsights.insightType, filters.insightType));
    }

    const insights = await db
      .select()
      .from(ticketInsights)
      .where(and(...conditions))
      .orderBy(desc(ticketInsights.createdAt));
    
    return insights;
  }

  async updateTicketInsight(
    id: string,
    businessAccountId: string,
    updates: Partial<InsertTicketInsight>
  ): Promise<TicketInsight> {
    const [updated] = await db
      .update(ticketInsights)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(ticketInsights.id, id),
        eq(ticketInsights.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async markInsightAsReviewed(
    id: string,
    businessAccountId: string,
    reviewedBy: string,
    status: string
  ): Promise<TicketInsight> {
    const [updated] = await db
      .update(ticketInsights)
      .set({
        status,
        reviewedBy,
        reviewedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(ticketInsights.id, id),
        eq(ticketInsights.businessAccountId, businessAccountId)
      ))
      .returning();
    
    return updated;
  }

  async deleteTicketInsight(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(ticketInsights)
      .where(and(
        eq(ticketInsights.id, id),
        eq(ticketInsights.businessAccountId, businessAccountId)
      ));
  }

  // Conversation Journey methods
  async createJourney(journey: InsertConversationJourney): Promise<ConversationJourney> {
    const [newJourney] = await db.insert(conversationJourneys).values(journey).returning();
    return newJourney;
  }

  async getJourney(id: string, businessAccountId: string): Promise<ConversationJourney | undefined> {
    const [journey] = await db
      .select()
      .from(conversationJourneys)
      .where(and(
        eq(conversationJourneys.id, id),
        eq(conversationJourneys.businessAccountId, businessAccountId)
      ))
      .limit(1);
    return journey;
  }

  async getAllJourneys(businessAccountId: string): Promise<ConversationJourney[]> {
    return await db
      .select()
      .from(conversationJourneys)
      .where(eq(conversationJourneys.businessAccountId, businessAccountId))
      .orderBy(desc(conversationJourneys.createdAt));
  }

  async updateJourney(id: string, businessAccountId: string, updates: Partial<InsertConversationJourney>): Promise<ConversationJourney> {
    const [updated] = await db
      .update(conversationJourneys)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(conversationJourneys.id, id),
        eq(conversationJourneys.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteJourney(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(conversationJourneys)
      .where(and(
        eq(conversationJourneys.id, id),
        eq(conversationJourneys.businessAccountId, businessAccountId)
      ));
  }

  // Journey Step methods
  async createJourneyStep(step: InsertJourneyStep): Promise<JourneyStep> {
    const [newStep] = await db.insert(journeySteps).values(step).returning();
    return newStep;
  }

  async getJourneySteps(journeyId: string): Promise<JourneyStep[]> {
    return await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId))
      .orderBy(journeySteps.stepOrder);
  }

  async updateJourneyStep(id: string, journeyId: string, updates: Partial<InsertJourneyStep>): Promise<JourneyStep> {
    const [updated] = await db
      .update(journeySteps)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(journeySteps.id, id),
        eq(journeySteps.journeyId, journeyId)
      ))
      .returning();
    return updated;
  }

  async deleteJourneyStep(id: string, journeyId: string): Promise<void> {
    await db
      .delete(journeySteps)
      .where(and(
        eq(journeySteps.id, id),
        eq(journeySteps.journeyId, journeyId)
      ));
  }

  async reorderJourneySteps(journeyId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void> {
    // Update each step's order in a transaction-like batch
    for (const { id, stepOrder } of stepOrders) {
      await db
        .update(journeySteps)
        .set({ stepOrder, updatedAt: new Date() })
        .where(and(
          eq(journeySteps.id, id),
          eq(journeySteps.journeyId, journeyId)
        ));
    }
  }

  // Group Journey methods
  async createGroupJourney(journey: InsertAccountGroupJourney & { groupId: string }): Promise<AccountGroupJourney> {
    const [newJourney] = await db.insert(accountGroupJourneys).values(journey).returning();
    return newJourney;
  }

  async getGroupJourney(id: string, groupId: string): Promise<AccountGroupJourney | undefined> {
    const [journey] = await db
      .select()
      .from(accountGroupJourneys)
      .where(and(
        eq(accountGroupJourneys.id, id),
        eq(accountGroupJourneys.groupId, groupId)
      ))
      .limit(1);
    return journey;
  }

  async getAllGroupJourneys(groupId: string): Promise<AccountGroupJourney[]> {
    return await db
      .select()
      .from(accountGroupJourneys)
      .where(eq(accountGroupJourneys.groupId, groupId))
      .orderBy(desc(accountGroupJourneys.createdAt));
  }

  async updateGroupJourney(id: string, groupId: string, updates: Partial<InsertAccountGroupJourney>): Promise<AccountGroupJourney> {
    const [updated] = await db
      .update(accountGroupJourneys)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(accountGroupJourneys.id, id),
        eq(accountGroupJourneys.groupId, groupId)
      ))
      .returning();
    return updated;
  }

  async deleteGroupJourney(id: string, groupId: string): Promise<void> {
    await db
      .delete(accountGroupJourneys)
      .where(and(
        eq(accountGroupJourneys.id, id),
        eq(accountGroupJourneys.groupId, groupId)
      ));
  }

  // Group Journey Step methods
  async createGroupJourneyStep(step: InsertAccountGroupJourneyStep & { journeyId: string }): Promise<AccountGroupJourneyStep> {
    const [newStep] = await db.insert(accountGroupJourneySteps).values(step).returning();
    return newStep;
  }

  async getGroupJourneySteps(journeyId: string): Promise<AccountGroupJourneyStep[]> {
    return await db
      .select()
      .from(accountGroupJourneySteps)
      .where(eq(accountGroupJourneySteps.journeyId, journeyId))
      .orderBy(accountGroupJourneySteps.stepOrder);
  }

  async updateGroupJourneyStep(id: string, journeyId: string, updates: Partial<InsertAccountGroupJourneyStep>): Promise<AccountGroupJourneyStep> {
    const [updated] = await db
      .update(accountGroupJourneySteps)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(accountGroupJourneySteps.id, id),
        eq(accountGroupJourneySteps.journeyId, journeyId)
      ))
      .returning();
    return updated;
  }

  async deleteGroupJourneyStep(id: string, journeyId: string): Promise<void> {
    await db
      .delete(accountGroupJourneySteps)
      .where(and(
        eq(accountGroupJourneySteps.id, id),
        eq(accountGroupJourneySteps.journeyId, journeyId)
      ));
  }

  async reorderGroupJourneySteps(journeyId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void> {
    for (const { id, stepOrder } of stepOrders) {
      await db
        .update(accountGroupJourneySteps)
        .set({ stepOrder, updatedAt: new Date() })
        .where(and(
          eq(accountGroupJourneySteps.id, id),
          eq(accountGroupJourneySteps.journeyId, journeyId)
        ));
    }
  }

  async publishGroupJourneysToMembers(groupId: string): Promise<{ success: boolean; affectedCount: number }> {
    const groupJourneys = await this.getAllGroupJourneys(groupId);
    const members = await this.getGroupMembers(groupId);

    if (members.length === 0) {
      return { success: false, affectedCount: 0 };
    }

    let affectedCount = 0;

    for (const member of members) {
      const businessAccountId = member.businessAccountId;

      await db
        .delete(conversationJourneys)
        .where(eq(conversationJourneys.businessAccountId, businessAccountId));

      for (const groupJourney of groupJourneys) {
        const [newJourney] = await db.insert(conversationJourneys).values({
          businessAccountId,
          name: groupJourney.name,
          description: groupJourney.description,
          templateType: groupJourney.templateType,
          journeyType: groupJourney.journeyType,
          status: groupJourney.status,
          isDefault: groupJourney.isDefault,
          triggerMode: groupJourney.triggerMode,
          triggerKeywords: groupJourney.triggerKeywords,
          startFromScratch: groupJourney.startFromScratch,
          conversationalGuidelines: groupJourney.conversationalGuidelines,
        }).returning();

        const groupSteps = await this.getGroupJourneySteps(groupJourney.id);
        for (const step of groupSteps) {
          await db.insert(journeySteps).values({
            journeyId: newJourney.id,
            stepOrder: step.stepOrder,
            questionText: step.questionText,
            questionType: step.questionType,
            fieldName: step.fieldName,
            isRequired: step.isRequired,
            multipleChoiceOptions: step.multipleChoiceOptions,
            toolTrigger: step.toolTrigger,
            toolParameters: step.toolParameters,
            branchingCondition: step.branchingCondition,
            exitOnValue: step.exitOnValue,
            exitMessage: step.exitMessage,
            skipOnValue: step.skipOnValue,
            skipToStepIndex: step.skipToStepIndex,
            isConditional: step.isConditional,
            completionButtonText: step.completionButtonText,
            placeholderText: step.placeholderText,
            helpText: step.helpText,
          });
        }
      }

      affectedCount++;
    }

    return { success: true, affectedCount };
  }

  async getGroupExtraSettings(groupId: string): Promise<AccountGroupExtraSettings | undefined> {
    const [settings] = await db
      .select()
      .from(accountGroupExtraSettings)
      .where(eq(accountGroupExtraSettings.groupId, groupId))
      .limit(1);
    return settings;
  }

  async upsertGroupExtraSettings(groupId: string, settings: Partial<AccountGroupExtraSettings>): Promise<AccountGroupExtraSettings> {
    const existing = await this.getGroupExtraSettings(groupId);
    if (existing) {
      const [updated] = await db
        .update(accountGroupExtraSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(accountGroupExtraSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(accountGroupExtraSettings)
        .values({ ...settings, groupId })
        .returning();
      return created;
    }
  }

  async publishGroupExtraSettingsToMembers(groupId: string): Promise<{ success: boolean; affectedCount: number }> {
    const extraSettings = await this.getGroupExtraSettings(groupId);
    if (!extraSettings) {
      return { success: false, affectedCount: 0 };
    }

    const members = await this.getGroupMembers(groupId);
    if (members.length === 0) {
      return { success: false, affectedCount: 0 };
    }

    let affectedCount = 0;
    for (const member of members) {
      try {
        const updateData: Partial<InsertWidgetSettings> = {
          responseLength: extraSettings.responseLength,
          autoOpenChat: extraSettings.autoOpenChat,
          openingSoundEnabled: extraSettings.openingSoundEnabled,
          openingSoundStyle: extraSettings.openingSoundStyle,
          inactivityNudgeEnabled: extraSettings.inactivityNudgeEnabled,
          inactivityNudgeDelay: extraSettings.inactivityNudgeDelay,
          inactivityNudgeMessage: extraSettings.inactivityNudgeMessage,
          smartNudgeEnabled: extraSettings.smartNudgeEnabled,
        };
        await this.upsertWidgetSettings(member.businessAccountId, updateData);
        affectedCount++;
      } catch (error) {
        console.error(`[Group Extra] Failed to publish to account ${member.businessAccountId}:`, error);
      }
    }

    return { success: true, affectedCount };
  }

  // Journey Session methods for persistent state
  async createJourneySession(session: {
    journeyId: string;
    conversationId: string;
    businessAccountId: string;
    userId: string;
    currentStepIndex?: number;
  }): Promise<JourneySession> {
    const [newSession] = await db
      .insert(journeySessions)
      .values({
        ...session,
        currentStepIndex: session.currentStepIndex?.toString() || '0',
        completed: 'false',
      })
      .returning();
    return newSession;
  }

  async getJourneySession(conversationId: string, userId: string): Promise<JourneySession | undefined> {
    const [session] = await db
      .select()
      .from(journeySessions)
      .where(and(
        eq(journeySessions.conversationId, conversationId),
        eq(journeySessions.userId, userId),
        eq(journeySessions.completed, 'false')
      ))
      .limit(1);
    return session || undefined;
  }
  
  async getJourneySessionByConversationId(conversationId: string): Promise<JourneySession | undefined> {
    const [session] = await db
      .select()
      .from(journeySessions)
      .where(and(
        eq(journeySessions.conversationId, conversationId),
        eq(journeySessions.completed, 'false')
      ))
      .limit(1);
    return session || undefined;
  }

  async getActiveJourneySessionByUser(userId: string, businessAccountId: string): Promise<JourneySession | undefined> {
    const [session] = await db
      .select()
      .from(journeySessions)
      .where(and(
        eq(journeySessions.userId, userId),
        eq(journeySessions.businessAccountId, businessAccountId),
        eq(journeySessions.completed, 'false')
      ))
      .orderBy(desc(journeySessions.createdAt))
      .limit(1);
    return session || undefined;
  }

  async updateJourneySession(id: string, updates: {
    currentStepIndex?: number;
    completed?: string;
    completedAt?: Date;
  }): Promise<JourneySession> {
    const [updated] = await db
      .update(journeySessions)
      .set({
        ...(updates.currentStepIndex !== undefined && { currentStepIndex: updates.currentStepIndex.toString() }),
        ...(updates.completed && { completed: updates.completed }),
        ...(updates.completedAt && { completedAt: updates.completedAt }),
        updatedAt: new Date(),
      })
      .where(eq(journeySessions.id, id))
      .returning();
    return updated;
  }

  async deleteJourneySession(conversationId: string, userId: string): Promise<void> {
    await db
      .delete(journeySessions)
      .where(and(
        eq(journeySessions.conversationId, conversationId),
        eq(journeySessions.userId, userId)
      ));
  }

  // Visitor Daily Stats methods
  async incrementDailyStats(businessAccountId: string, data: { deviceType?: string; country?: string; city?: string; chatOpened?: boolean }): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    const desktopInc = data.deviceType === 'desktop' ? 1 : 0;
    const mobileInc = data.deviceType === 'mobile' ? 1 : 0;
    const tabletInc = data.deviceType === 'tablet' ? 1 : 0;
    const chatInc = data.chatOpened ? 1 : 0;

    const hasCountry = !!data.country;
    const hasCity = !!data.city;
    const countryVal = data.country || '';
    const cityVal = data.city || '';
    const countryJson = hasCountry ? JSON.stringify([{ country: countryVal, count: 1 }]) : '[]';
    const cityJson = hasCity ? JSON.stringify([{ city: cityVal, count: 1 }]) : '[]';

    await db.execute(sql`
      INSERT INTO visitor_daily_stats (id, business_account_id, date, opened_chat_count, desktop_count, mobile_count, tablet_count, top_countries, top_cities, created_at, updated_at)
      VALUES (gen_random_uuid(), ${businessAccountId}, ${today}, ${chatInc}, ${desktopInc}, ${mobileInc}, ${tabletInc}, ${countryJson}::jsonb, ${cityJson}::jsonb, NOW(), NOW())
      ON CONFLICT (business_account_id, date) DO UPDATE SET
        opened_chat_count = visitor_daily_stats.opened_chat_count + ${chatInc},
        desktop_count = visitor_daily_stats.desktop_count + ${desktopInc},
        mobile_count = visitor_daily_stats.mobile_count + ${mobileInc},
        tablet_count = visitor_daily_stats.tablet_count + ${tabletInc},
        top_countries = CASE
          WHEN ${hasCountry} THEN (
            SELECT jsonb_agg(jsonb_build_object('country', entry->>'country', 'count', (entry->>'count')::int))
            FROM (
              SELECT key AS "country_key", jsonb_build_object('country', key, 'count', SUM(val)) AS entry
              FROM (
                SELECT e->>'country' AS key, (e->>'count')::int AS val
                FROM jsonb_array_elements(visitor_daily_stats.top_countries) AS e
                UNION ALL
                SELECT ${countryVal}::text, 1
              ) merged
              GROUP BY key
            ) grouped
          )
          ELSE visitor_daily_stats.top_countries
        END,
        top_cities = CASE
          WHEN ${hasCity} THEN (
            SELECT jsonb_agg(jsonb_build_object('city', entry->>'city', 'count', (entry->>'count')::int))
            FROM (
              SELECT key AS "city_key", jsonb_build_object('city', key, 'count', SUM(val)) AS entry
              FROM (
                SELECT e->>'city' AS key, (e->>'count')::int AS val
                FROM jsonb_array_elements(visitor_daily_stats.top_cities) AS e
                UNION ALL
                SELECT ${cityVal}::text, 1
              ) merged
              GROUP BY key
            ) grouped
          )
          ELSE visitor_daily_stats.top_cities
        END,
        updated_at = NOW()
    `);
  }

  async getDailyStats(businessAccountId: string, filters?: { fromDate?: string; toDate?: string }): Promise<{
    openedChatCount: number;
    deviceBreakdown: { desktop: number; mobile: number; tablet: number };
    topCountries: { country: string; count: number }[];
    topCities: { city: string; count: number }[];
  }> {
    const conditions = [eq(visitorDailyStats.businessAccountId, businessAccountId)];
    
    if (filters?.fromDate) {
      conditions.push(gte(visitorDailyStats.date, filters.fromDate.split('T')[0]));
    }
    if (filters?.toDate) {
      conditions.push(lte(visitorDailyStats.date, filters.toDate.split('T')[0]));
    }
    
    const rows = await db
      .select()
      .from(visitorDailyStats)
      .where(and(...conditions));
    
    let openedChatCount = 0;
    let desktop = 0;
    let mobile = 0;
    let tablet = 0;
    const countryMap: Record<string, number> = {};
    const cityMap: Record<string, number> = {};
    
    for (const row of rows) {
      openedChatCount += row.openedChatCount ?? 0;
      desktop += row.desktopCount ?? 0;
      mobile += row.mobileCount ?? 0;
      tablet += row.tabletCount ?? 0;
      
      if (Array.isArray(row.topCountries)) {
        for (const entry of row.topCountries) {
          if (entry.country) {
            countryMap[entry.country] = (countryMap[entry.country] || 0) + (entry.count || 0);
          }
        }
      }
      
      if (Array.isArray(row.topCities)) {
        for (const entry of row.topCities) {
          if (entry.city) {
            cityMap[entry.city] = (cityMap[entry.city] || 0) + (entry.count || 0);
          }
        }
      }
    }
    
    const topCountries = Object.entries(countryMap)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    const topCities = Object.entries(cityMap)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      openedChatCount,
      deviceBreakdown: { desktop, mobile, tablet },
      topCountries,
      topCities,
    };
  }

  // Account Group methods
  async createAccountGroup(group: InsertAccountGroup): Promise<AccountGroup> {
    const [newGroup] = await db.insert(accountGroups).values(group).returning();
    return newGroup;
  }
  
  async getAccountGroup(id: string): Promise<AccountGroup | undefined> {
    const [group] = await db.select().from(accountGroups).where(eq(accountGroups.id, id));
    return group || undefined;
  }
  
  async getAccountGroupsByOwner(ownerUserId: string): Promise<AccountGroup[]> {
    return await db.select().from(accountGroups).where(eq(accountGroups.ownerUserId, ownerUserId));
  }
  
  async updateAccountGroup(id: string, updates: Partial<{ name: string }>): Promise<AccountGroup> {
    const [group] = await db
      .update(accountGroups)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(accountGroups.id, id))
      .returning();
    return group;
  }
  
  async deleteAccountGroup(id: string): Promise<void> {
    await db.delete(accountGroups).where(eq(accountGroups.id, id));
  }
  
  // Account Group Member methods
  async addAccountToGroup(member: InsertAccountGroupMember): Promise<AccountGroupMember> {
    const [newMember] = await db.insert(accountGroupMembers).values(member).returning();
    return newMember;
  }
  
  async removeAccountFromGroup(groupId: string, businessAccountId: string): Promise<void> {
    await db.delete(accountGroupMembers).where(
      and(
        eq(accountGroupMembers.groupId, groupId),
        eq(accountGroupMembers.businessAccountId, businessAccountId)
      )
    );
  }
  
  async getGroupMembers(groupId: string): Promise<(AccountGroupMember & { businessAccount: BusinessAccount })[]> {
    const members = await db
      .select()
      .from(accountGroupMembers)
      .innerJoin(businessAccounts, eq(accountGroupMembers.businessAccountId, businessAccounts.id))
      .where(eq(accountGroupMembers.groupId, groupId))
      .orderBy(desc(accountGroupMembers.isPrimary));
    
    return members.map(m => ({
      ...m.account_group_members,
      businessAccount: m.business_accounts
    }));
  }
  
  async getLinkedAccounts(businessAccountId: string): Promise<(AccountGroupMember & { businessAccount: BusinessAccount })[]> {
    // First find the group this account belongs to
    const [membership] = await db
      .select()
      .from(accountGroupMembers)
      .where(eq(accountGroupMembers.businessAccountId, businessAccountId));
    
    if (!membership) return [];
    
    // Then get all members of that group
    return await this.getGroupMembers(membership.groupId);
  }
  
  async setPrimaryAccount(groupId: string, businessAccountId: string): Promise<void> {
    // First, unset all primaries in the group
    await db
      .update(accountGroupMembers)
      .set({ isPrimary: 'false' })
      .where(eq(accountGroupMembers.groupId, groupId));
    
    // Then set the new primary
    await db
      .update(accountGroupMembers)
      .set({ isPrimary: 'true' })
      .where(
        and(
          eq(accountGroupMembers.groupId, groupId),
          eq(accountGroupMembers.businessAccountId, businessAccountId)
        )
      );
  }
  
  async isAccountLinked(businessAccountId: string): Promise<boolean> {
    const [membership] = await db
      .select()
      .from(accountGroupMembers)
      .where(eq(accountGroupMembers.businessAccountId, businessAccountId));
    
    return !!membership;
  }
  
  async getAccountGroupForBusiness(businessAccountId: string): Promise<AccountGroup | undefined> {
    const [membership] = await db
      .select()
      .from(accountGroupMembers)
      .innerJoin(accountGroups, eq(accountGroupMembers.groupId, accountGroups.id))
      .where(eq(accountGroupMembers.businessAccountId, businessAccountId));
    
    return membership?.account_groups || undefined;
  }
  
  // Group Training methods
  async getAccountGroupTraining(groupId: string): Promise<AccountGroupTraining | undefined> {
    const [training] = await db
      .select()
      .from(accountGroupTraining)
      .where(eq(accountGroupTraining.groupId, groupId));
    return training || undefined;
  }
  
  async upsertAccountGroupTraining(groupId: string, data: Partial<InsertAccountGroupTraining>): Promise<AccountGroupTraining> {
    // Check if training exists for this group
    const existing = await this.getAccountGroupTraining(groupId);
    
    if (existing) {
      // Update existing
      const [updated] = await db
        .update(accountGroupTraining)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(accountGroupTraining.groupId, groupId))
        .returning();
      return updated;
    } else {
      // Create new
      const [created] = await db
        .insert(accountGroupTraining)
        .values({ groupId, ...data })
        .returning();
      return created;
    }
  }
  
  async publishGroupTrainingToMembers(groupId: string, publishedBy: string, module?: 'instructions' | 'leadTraining' | 'leadsquared' | 'menuBuilder'): Promise<{ success: boolean; affectedCount: number }> {
    const groupTraining = await this.getAccountGroupTraining(groupId);
    if (!groupTraining) {
      return { success: false, affectedCount: 0 };
    }
    
    const members = await this.getGroupMembers(groupId);
    if (members.length === 0) {
      return { success: false, affectedCount: 0 };
    }
    
    let affectedCount = 0;
    const publishAll = !module;
    
    const groupLsqMappings = (publishAll || module === 'leadsquared')
      ? await this.getGroupLeadsquaredFieldMappings(groupId)
      : [];
    
    for (const member of members) {
      try {
        const updateData: Partial<InsertWidgetSettings> = {};
        
        if (publishAll || module === 'instructions') {
          if (groupTraining.customInstructions !== undefined) {
            updateData.customInstructions = groupTraining.customInstructions;
          }
          if (groupTraining.fallbackTemplate !== undefined) {
            updateData.fallbackTemplate = groupTraining.fallbackTemplate;
          }
        }
        
        if (publishAll || module === 'leadTraining') {
          if (groupTraining.leadTrainingConfig !== undefined) {
            updateData.leadTrainingConfig = groupTraining.leadTrainingConfig;
          }
        }
        
        if (publishAll || module === 'leadsquared') {
          updateData.leadsquaredEnabled = groupTraining.leadsquaredEnabled ?? "false";
          updateData.leadsquaredRegion = "other";
          updateData.leadsquaredCustomHost = groupTraining.leadsquaredHost ?? null;
          updateData.leadsquaredAccessKey = groupTraining.leadsquaredAccessKey ?? null;
          updateData.leadsquaredSecretKey = groupTraining.leadsquaredSecretKey ?? null;
        }
        
        if (Object.keys(updateData).length > 0) {
          await this.upsertWidgetSettings(member.businessAccountId, updateData);
          affectedCount++;
        }

        if (publishAll || module === 'leadsquared') {
          await db.delete(leadsquaredFieldMappings)
            .where(eq(leadsquaredFieldMappings.businessAccountId, member.businessAccountId));
          for (const mapping of groupLsqMappings) {
            await db.insert(leadsquaredFieldMappings).values({
              businessAccountId: member.businessAccountId,
              leadsquaredField: mapping.leadsquaredField,
              sourceType: mapping.sourceType,
              sourceField: mapping.sourceField,
              customValue: mapping.customValue,
              displayName: mapping.displayName,
              isEnabled: mapping.isEnabled,
              sortOrder: mapping.sortOrder,
            });
          }
        }
        
        if (publishAll || module === 'menuBuilder') {
          if (groupTraining.menuConfig !== undefined || groupTraining.menuItems !== undefined) {
            await this.publishGroupMenuToMember(member.businessAccountId, groupTraining.menuConfig, groupTraining.menuItems);
            if (!Object.keys(updateData).length) affectedCount++;
          }
        }
      } catch (error) {
        console.error(`[Group Training] Failed to update account ${member.businessAccountId}:`, error);
      }
    }
    
    const updateSet: any = { lastPublishedAt: new Date(), lastPublishedBy: publishedBy, updatedAt: new Date() };
    if (publishAll || module === 'menuBuilder') {
      if (groupTraining.menuConfig !== undefined || groupTraining.menuItems !== undefined) {
        updateSet.menuLastAppliedAt = new Date();
      }
    }
    if (publishAll || module === 'leadsquared') {
      updateSet.leadsquaredLastAppliedAt = new Date();
    }
    
    await db
      .update(accountGroupTraining)
      .set(updateSet)
      .where(eq(accountGroupTraining.groupId, groupId));
    
    return { success: true, affectedCount };
  }
  
  async publishGroupMenuToMember(businessAccountId: string, menuConfig: any, menuItems: any): Promise<void> {
    // Update or create the menu config for this account
    if (menuConfig) {
      const [existing] = await db
        .select()
        .from(chatMenuConfigs)
        .where(eq(chatMenuConfigs.businessAccountId, businessAccountId))
        .limit(1);
        
      const configData = {
        enabled: menuConfig.enabled ?? "false",
        welcomeMessage: menuConfig.welcomeMessage ?? null,
        avatarUrl: menuConfig.avatarUrl ?? null,
        quickChips: menuConfig.quickChips ?? null,
        footerText: menuConfig.footerText ?? null,
        footerLinkText: menuConfig.footerLinkText ?? null,
        footerLinkUrl: menuConfig.footerLinkUrl ?? null,
        persistentCtaEnabled: menuConfig.persistentCtaEnabled ?? "false",
        persistentCtaLabel: menuConfig.persistentCtaLabel ?? null,
        persistentCtaIcon: menuConfig.persistentCtaIcon ?? null,
        persistentCtaAction: menuConfig.persistentCtaAction ?? null,
        persistentCtaValue: menuConfig.persistentCtaValue ?? null,
        leadFormFields: menuConfig.leadFormFields ?? null,
      };
        
      if (existing) {
        await db
          .update(chatMenuConfigs)
          .set(configData)
          .where(eq(chatMenuConfigs.id, existing.id));
      } else {
        await db.insert(chatMenuConfigs).values({
          businessAccountId,
          ...configData,
        });
      }
    }
    
    // Delete existing menu items and insert new ones if provided
    if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
      // Delete all existing menu items for this account
      await db
        .delete(chatMenuItems)
        .where(eq(chatMenuItems.businessAccountId, businessAccountId));
        
      // Create a mapping from old IDs to new IDs to preserve hierarchy
      const idMapping: Record<string, string> = {};
      
      // First pass: Insert all items and build ID mapping
      for (const item of menuItems) {
        const [inserted] = await db.insert(chatMenuItems).values({
          businessAccountId,
          parentId: null, // Will be updated in second pass
          title: item.title || item.label || 'Untitled',
          subtitle: item.subtitle || item.description || null,
          icon: item.icon || null,
          iconColor: item.iconColor || null,
          iconBgColor: item.iconBgColor || null,
          itemType: item.itemType || 'navigate',
          actionValue: item.actionValue || null,
          leadFormFields: item.leadFormFields || null,
          sortOrder: item.sortOrder ?? item.order ?? 0,
          isActive: item.isActive || 'true',
        }).returning();
        
        if (item.id && inserted.id) {
          idMapping[item.id] = inserted.id;
        }
      }
      
      // Second pass: Update parentId references using the mapping
      for (const item of menuItems) {
        if (item.parentId) {
          const newItemId = idMapping[item.id];
          const newParentId = idMapping[item.parentId];
          if (newItemId && newParentId) {
            await db
              .update(chatMenuItems)
              .set({ parentId: newParentId })
              .where(eq(chatMenuItems.id, newItemId));
          }
        }
      }
    }
    
    console.log(`[Group Menu] Published menu settings to account ${businessAccountId}`);
  }

  async getChatMenuItems(businessAccountId: string) {
    return await db
      .select()
      .from(chatMenuItems)
      .where(eq(chatMenuItems.businessAccountId, businessAccountId));
  }

  // Group LeadSquared Field Mappings methods
  async getGroupLeadsquaredFieldMappings(groupId: string): Promise<AccountGroupLeadsquaredFieldMapping[]> {
    return await db
      .select()
      .from(accountGroupLeadsquaredFieldMappings)
      .where(eq(accountGroupLeadsquaredFieldMappings.groupId, groupId))
      .orderBy(accountGroupLeadsquaredFieldMappings.sortOrder);
  }

  async createGroupLeadsquaredFieldMapping(groupId: string, data: Omit<InsertAccountGroupLeadsquaredFieldMapping, 'groupId'>): Promise<AccountGroupLeadsquaredFieldMapping> {
    const [mapping] = await db
      .insert(accountGroupLeadsquaredFieldMappings)
      .values({ ...data, groupId })
      .returning();
    return mapping;
  }

  async updateGroupLeadsquaredFieldMapping(id: string, data: Partial<InsertAccountGroupLeadsquaredFieldMapping>): Promise<AccountGroupLeadsquaredFieldMapping | undefined> {
    const [mapping] = await db
      .update(accountGroupLeadsquaredFieldMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(accountGroupLeadsquaredFieldMappings.id, id))
      .returning();
    return mapping;
  }

  async deleteGroupLeadsquaredFieldMapping(id: string): Promise<boolean> {
    const result = await db
      .delete(accountGroupLeadsquaredFieldMappings)
      .where(eq(accountGroupLeadsquaredFieldMappings.id, id));
    return true;
  }

  async deleteAllGroupLeadsquaredFieldMappings(groupId: string): Promise<boolean> {
    await db
      .delete(accountGroupLeadsquaredFieldMappings)
      .where(eq(accountGroupLeadsquaredFieldMappings.groupId, groupId));
    return true;
  }

  async applyGroupLeadsquaredSettingsToMembers(groupId: string): Promise<{ success: boolean; affectedCount: number }> {
    // Get group training with LSQ settings
    const groupTraining = await this.getAccountGroupTraining(groupId);
    if (!groupTraining) {
      return { success: false, affectedCount: 0 };
    }

    // Get group LSQ field mappings
    const groupMappings = await this.getGroupLeadsquaredFieldMappings(groupId);

    // Get all member accounts in the group
    const members = await this.getGroupMembers(groupId);
    if (members.length === 0) {
      return { success: false, affectedCount: 0 };
    }

    let affectedCount = 0;

    for (const member of members) {
      try {
        // Update member account's LSQ settings in widget_settings (source of truth for sync flows)
        if (groupTraining.leadsquaredHost || groupTraining.leadsquaredAccessKey || groupTraining.leadsquaredSecretKey) {
          const lsqUpdate: any = {
            leadsquaredEnabled: groupTraining.leadsquaredEnabled ?? "false",
            leadsquaredRegion: "other",
            leadsquaredCustomHost: groupTraining.leadsquaredHost ?? null,
            leadsquaredAccessKey: groupTraining.leadsquaredAccessKey ?? null,
            leadsquaredSecretKey: groupTraining.leadsquaredSecretKey ?? null,
          };
          await this.upsertWidgetSettings(member.businessAccountId, lsqUpdate);
        }

        // Delete existing field mappings for this account
        await db
          .delete(leadsquaredFieldMappings)
          .where(eq(leadsquaredFieldMappings.businessAccountId, member.businessAccountId));

        // Insert new field mappings from group
        if (groupMappings.length > 0) {
          for (const mapping of groupMappings) {
            await db
              .insert(leadsquaredFieldMappings)
              .values({
                businessAccountId: member.businessAccountId,
                leadsquaredField: mapping.leadsquaredField,
                sourceType: mapping.sourceType,
                sourceField: mapping.sourceField,
                customValue: mapping.customValue,
                fallbackValue: mapping.fallbackValue,
                displayName: mapping.displayName,
                isEnabled: mapping.isEnabled,
                sortOrder: mapping.sortOrder
              });
          }
        }

        affectedCount++;
      } catch (error) {
        console.error(`[Group LSQ] Failed to update account ${member.businessAccountId}:`, error);
      }
    }

    // Update the group training with LSQ applied timestamp
    await db
      .update(accountGroupTraining)
      .set({ leadsquaredLastAppliedAt: new Date(), updatedAt: new Date() })
      .where(eq(accountGroupTraining.groupId, groupId));

    return { success: true, affectedCount };
  }

  async seedDefaultGroupLeadsquaredFieldMappings(groupId: string): Promise<void> {
    // Check if mappings already exist
    const existing = await this.getGroupLeadsquaredFieldMappings(groupId);
    if (existing.length > 0) return;

    // Default mappings (same as business account defaults)
    const defaults = [
      { leadsquaredField: 'FirstName', sourceType: 'dynamic' as const, sourceField: 'lead.name', displayName: 'Full Name', sortOrder: 1 },
      { leadsquaredField: 'EmailAddress', sourceType: 'dynamic' as const, sourceField: 'lead.email', displayName: 'Email', sortOrder: 2 },
      { leadsquaredField: 'Phone', sourceType: 'dynamic' as const, sourceField: 'lead.phone', displayName: 'Phone', sortOrder: 3 },
      { leadsquaredField: 'mx_City', sourceType: 'dynamic' as const, sourceField: 'session.city', displayName: 'City (Visitor Location)', sortOrder: 4 },
      { leadsquaredField: 'mx_CreatedAt', sourceType: 'dynamic' as const, sourceField: 'lead.createdAt', displayName: 'Created At', sortOrder: 5 },
      { leadsquaredField: 'Mx_Business_Account', sourceType: 'dynamic' as const, sourceField: 'business.name', displayName: 'Business Account Name', sortOrder: 6 },
      { leadsquaredField: 'Mx_Website_Campaign', sourceType: 'dynamic' as const, sourceField: 'lead.sourceUrl', displayName: 'Page URL (Where Lead Was Captured)', sortOrder: 7 },
      { leadsquaredField: 'mx_Source_Campaign', sourceType: 'dynamic' as const, sourceField: 'session.utmCampaign', fallbackValue: 'Website', displayName: 'Source Campaign (utm_campaign from URL)', sortOrder: 8 },
      { sourceType: 'custom' as const, leadsquaredField: 'Source', customValue: 'AI Chroney', displayName: 'Source', sortOrder: 9 },
      { sourceType: 'custom' as const, leadsquaredField: 'mx_Secondary_Lead_Source', customValue: 'AI Chroney', displayName: 'Secondary Lead Source', sortOrder: 10 },
    ];

    for (const mapping of defaults) {
      await this.createGroupLeadsquaredFieldMapping(groupId, mapping);
    }
  }

  async getGroupAggregatedInsights(accountIds: string[], dateFrom?: Date, dateTo?: Date): Promise<{
    totals: {
      leads: number;
      conversations: number;
      visitors: number;
      products: number;
      faqs: number;
    };
    accountBreakdown: {
      businessAccountId: string;
      businessName: string;
      leads: number;
      conversations: number;
      visitors: number;
      products: number;
      faqs: number;
    }[];
  }> {
    const accountBreakdown: {
      businessAccountId: string;
      businessName: string;
      leads: number;
      conversations: number;
      visitors: number;
      products: number;
      faqs: number;
    }[] = [];
    
    let totalLeads = 0;
    let totalConversations = 0;
    let totalVisitors = 0;
    let totalProducts = 0;
    let totalFaqs = 0;
    
    // Get metrics for each account
    for (const accountId of accountIds) {
      // Get business account name
      const [account] = await db
        .select({ name: businessAccounts.name })
        .from(businessAccounts)
        .where(eq(businessAccounts.id, accountId));
      
      if (!account) continue;
      
      // Build date filter conditions for leads
      const leadConditions = [eq(leads.businessAccountId, accountId)];
      if (dateFrom) {
        leadConditions.push(gte(leads.createdAt, dateFrom));
      }
      if (dateTo) {
        leadConditions.push(lte(leads.createdAt, dateTo));
      }
      
      // Get unique lead count (by email, or phone if no email)
      const [leadResult] = await db
        .select({ 
          count: sql<number>`COUNT(DISTINCT CASE 
            WHEN ${leads.email} IS NOT NULL AND ${leads.email} != '' THEN ${leads.email}
            WHEN ${leads.phone} IS NOT NULL AND ${leads.phone} != '' THEN ${leads.phone}
            ELSE ${leads.id}::text
          END)::integer` 
        })
        .from(leads)
        .where(and(...leadConditions));
      
      // Build date filter conditions for conversations
      const conversationConditions = [eq(conversations.businessAccountId, accountId)];
      if (dateFrom) {
        conversationConditions.push(gte(conversations.createdAt, dateFrom));
      }
      if (dateTo) {
        conversationConditions.push(lte(conversations.createdAt, dateTo));
      }
      
      // Get unique conversation count (phone dedup for form convs, visitorToken for others)
      const [grpAllConvRows, grpFormLeadRows] = await Promise.all([
        db.select({ id: conversations.id, visitorToken: conversations.visitorToken })
          .from(conversations).where(and(...conversationConditions)),
        db.select({ conversationId: leads.conversationId, phone: leads.phone })
          .from(leads)
          .where(and(eq(leads.businessAccountId, accountId), sql`${leads.topicsOfInterest}::text LIKE '%Via Form%'`, sql`${leads.phone} IS NOT NULL AND ${leads.phone} != ''`)),
      ]);
      const grpFormPhoneMap = new Map<string, string>();
      for (const l of grpFormLeadRows) {
        if (l.conversationId && l.phone) {
          const normalized = l.phone.replace(/\D/g, '').slice(-10);
          if (normalized.length >= 7 && !grpFormPhoneMap.has(l.conversationId)) {
            grpFormPhoneMap.set(l.conversationId, 'form_' + normalized);
          }
        }
      }
      const conversationResult = { count: new Set(grpAllConvRows.map(c => grpFormPhoneMap.get(c.id) || c.visitorToken || c.id)).size };
      
      const dailyStatsConditions = [eq(visitorDailyStats.businessAccountId, accountId)];
      if (dateFrom) {
        dailyStatsConditions.push(gte(visitorDailyStats.date, dateFrom.toISOString().split('T')[0]));
      }
      if (dateTo) {
        dailyStatsConditions.push(lte(visitorDailyStats.date, dateTo.toISOString().split('T')[0]));
      }
      
      const dailyRows = await db
        .select()
        .from(visitorDailyStats)
        .where(and(...dailyStatsConditions));
      
      let visitorCount = dailyRows.reduce((sum, row) => sum + (row.openedChatCount ?? 0), 0);
      
      // Get product count (not date filtered - total products)
      const [productResult] = await db
        .select({ count: count() })
        .from(products)
        .where(eq(products.businessAccountId, accountId));
      
      // Get FAQ count (not date filtered - total FAQs)
      const [faqResult] = await db
        .select({ count: count() })
        .from(faqs)
        .where(eq(faqs.businessAccountId, accountId));
      
      const accountMetrics = {
        businessAccountId: accountId,
        businessName: account.name,
        leads: leadResult?.count || 0,
        conversations: conversationResult?.count || 0,
        visitors: visitorCount,
        products: productResult?.count || 0,
        faqs: faqResult?.count || 0,
      };
      
      accountBreakdown.push(accountMetrics);
      
      totalLeads += accountMetrics.leads;
      totalConversations += accountMetrics.conversations;
      totalVisitors += accountMetrics.visitors;
      totalProducts += accountMetrics.products;
      totalFaqs += accountMetrics.faqs;
    }
    
    return {
      totals: {
        leads: totalLeads,
        conversations: totalConversations,
        visitors: totalVisitors,
        products: totalProducts,
        faqs: totalFaqs,
      },
      accountBreakdown,
    };
  }

  async getConversationsForAccounts(accountIds: string[], limit: number, offset: number, filters?: {
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    accountId?: string;
  }): Promise<{
    conversations: (Conversation & { businessAccountName: string })[];
    total: number;
  }> {
    if (accountIds.length === 0) {
      return { conversations: [], total: 0 };
    }
    
    // Build filter conditions
    const conditions: any[] = [];
    
    // Filter by specific account if provided, otherwise use all account IDs
    if (filters?.accountId && accountIds.includes(filters.accountId)) {
      conditions.push(eq(conversations.businessAccountId, filters.accountId));
    } else {
      conditions.push(inArray(conversations.businessAccountId, accountIds));
    }
    
    // Date filters
    if (filters?.fromDate) {
      conditions.push(gte(conversations.createdAt, filters.fromDate));
    }
    if (filters?.toDate) {
      const toDate = new Date(filters.toDate);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(conversations.createdAt, toDate));
    }
    
    // Search filter - search by userId
    if (filters?.search) {
      conditions.push(ilike(conversations.userId, `%${filters.search}%`));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(conversations)
      .where(whereClause);
    
    const total = countResult?.count || 0;
    
    // Get conversations with business account names and message counts
    const query = db
      .select({
        conversation: conversations,
        businessAccountName: businessAccounts.name,
        messageCount: sql<number>`(SELECT COUNT(*) FROM messages WHERE messages.conversation_id = ${conversations.id})::int`,
      })
      .from(conversations)
      .innerJoin(businessAccounts, eq(conversations.businessAccountId, businessAccounts.id))
      .where(whereClause)
      .orderBy(desc(conversations.createdAt));
    
    // Apply pagination only if limit > 0 (for export, we pass limit=0 to get all)
    const results = limit > 0 
      ? await query.limit(limit).offset(offset)
      : await query;
    
    return {
      conversations: results.map(r => ({
        ...r.conversation,
        businessAccountName: r.businessAccountName,
        messageCount: r.messageCount || 0,
      })),
      total,
    };
  }

  async getLeadsForAccounts(accountIds: string[], limit: number, offset: number, filters?: {
    search?: string;
    fromDate?: Date;
    toDate?: Date;
    accountId?: string;
    includeUniqueLeads?: boolean;
  }): Promise<{
    leads: (Lead & { businessAccountName: string })[];
    total: number;
    uniqueLeads?: number;
  }> {
    if (accountIds.length === 0) {
      return { leads: [], total: 0, uniqueLeads: filters?.includeUniqueLeads ? 0 : undefined };
    }
    
    // Build filter conditions
    const conditions: any[] = [];
    
    // Filter by specific account if provided, otherwise use all account IDs
    if (filters?.accountId && accountIds.includes(filters.accountId)) {
      conditions.push(eq(leads.businessAccountId, filters.accountId));
    } else {
      conditions.push(inArray(leads.businessAccountId, accountIds));
    }
    
    // Date filters
    if (filters?.fromDate) {
      conditions.push(gte(leads.createdAt, filters.fromDate));
    }
    if (filters?.toDate) {
      const toDate = new Date(filters.toDate);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(leads.createdAt, toDate));
    }
    
    // Search filter - search by name, email, or phone
    if (filters?.search) {
      conditions.push(
        or(
          ilike(leads.name, `%${filters.search}%`),
          ilike(leads.email, `%${filters.search}%`),
          ilike(leads.phone, `%${filters.search}%`)
        )
      );
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    // Get total count; optionally also get unique-leads count using the same method as Group Analytics:
    // deduplicate per-account by email → phone → id, then sum across accounts.
    const shouldCountUnique = filters?.includeUniqueLeads === true;
    const countQueries: Promise<any>[] = [
      db.select({ count: count() }).from(leads).where(whereClause).then(r => r[0]),
    ];
    if (shouldCountUnique) {
      const whereSQL = whereClause ? sql`WHERE ${whereClause}` : sql``;
      countQueries.push(
        db.execute<{ uniqueCount: number | string }>(sql`
          SELECT CAST(COALESCE(SUM(acct_unique), 0) AS INTEGER) AS "uniqueCount"
          FROM (
            SELECT business_account_id,
              COUNT(DISTINCT COALESCE(
                CASE WHEN TRIM(email) IS NOT NULL AND TRIM(email) <> '' THEN LOWER(TRIM(email)) ELSE NULL END,
                CASE WHEN TRIM(phone) IS NOT NULL AND TRIM(phone) <> '' THEN TRIM(phone) ELSE NULL END,
                id::text
              )) AS acct_unique
            FROM leads
            ${whereSQL}
            GROUP BY business_account_id
          ) AS per_account
        `).then((r) => ({ uniqueCount: Number(r.rows[0]?.uniqueCount ?? 0) }))
      );
    }
    const [countResult, uniqueLeadsResult] = await Promise.all(countQueries);
    
    const total = countResult?.count || 0;
    const uniqueLeads = shouldCountUnique ? (uniqueLeadsResult?.uniqueCount ?? 0) : undefined;
    
    // Get leads with business account names
    const query = db
      .select({
        lead: leads,
        businessAccountName: businessAccounts.name,
      })
      .from(leads)
      .innerJoin(businessAccounts, eq(leads.businessAccountId, businessAccounts.id))
      .where(whereClause)
      .orderBy(desc(leads.createdAt));
    
    // Apply pagination only if limit > 0 (for export, we pass limit=0 to get all)
    const results = limit > 0 
      ? await query.limit(limit).offset(offset)
      : await query;
    
    return {
      leads: results.map(r => ({
        ...r.lead,
        businessAccountName: r.businessAccountName,
      })),
      total,
      uniqueLeads,
    };
  }

  async getAICostAnalytics(businessAccountId?: string, from?: string, to?: string) {
    try {
      // Build base query
      let conditions: any[] = [];

      if (businessAccountId) {
        conditions.push(eq(aiUsageEvents.businessAccountId, businessAccountId));
      }

      if (from) {
        conditions.push(gte(aiUsageEvents.occurredAt, new Date(from)));
      }

      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999); // End of day
        conditions.push(lte(aiUsageEvents.occurredAt, toDate));
      }

      // Fetch all events matching criteria
      const events = await db
        .select()
        .from(aiUsageEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(aiUsageEvents.occurredAt));

      // Aggregate by business account and category
      const aggregations: Record<string, any> = {};

      events.forEach(event => {
        const accountId = event.businessAccountId;
        const category = event.category;

        if (!aggregations[accountId]) {
          aggregations[accountId] = {
            businessAccountId: accountId,
            totalCost: 0,
            totalTokensInput: 0,
            totalTokensOutput: 0,
            byCategory: {},
            eventCount: 0,
          };
        }

        if (!aggregations[accountId].byCategory[category]) {
          aggregations[accountId].byCategory[category] = {
            cost: 0,
            tokensInput: 0,
            tokensOutput: 0,
            eventCount: 0,
          };
        }

        const cost = parseFloat(event.costUsd);
        const tokensIn = parseInt(event.tokensInput);
        const tokensOut = parseInt(event.tokensOutput);

        aggregations[accountId].totalCost += cost;
        aggregations[accountId].totalTokensInput += tokensIn;
        aggregations[accountId].totalTokensOutput += tokensOut;
        aggregations[accountId].eventCount += 1;

        aggregations[accountId].byCategory[category].cost += cost;
        aggregations[accountId].byCategory[category].tokensInput += tokensIn;
        aggregations[accountId].byCategory[category].tokensOutput += tokensOut;
        aggregations[accountId].byCategory[category].eventCount += 1;
      });

      // Convert to array
      const results = Object.values(aggregations).map((agg: any) => ({
        ...agg,
        totalCost: agg.totalCost.toFixed(6),
        byCategory: Object.entries(agg.byCategory).map(([category, data]: [string, any]) => ({
          category,
          cost: data.cost.toFixed(6),
          tokensInput: data.tokensInput,
          tokensOutput: data.tokensOutput,
          eventCount: data.eventCount,
        })),
      }));

      // If single business account requested, return just that one (or zero-cost object if no data)
      if (businessAccountId) {
        if (results.length > 0) {
          return results[0];
        } else {
          // Fetch business account details to include metadata
          const businessAccount = await this.getBusinessAccount(businessAccountId);
          // Return zero-cost object for business with no events
          return {
            businessAccountId: businessAccountId,
            businessName: businessAccount?.name || "Unknown Business",
            totalCost: "0.000000",
            totalTokensInput: 0,
            totalTokensOutput: 0,
            eventCount: 0,
            byCategory: [],
          };
        }
      }

      // Otherwise return all businesses
      return results;
    } catch (error) {
      console.error('[Storage] Error getting AI cost analytics:', error);
      throw error;
    }
  }

  // Discount Rules methods
  async createDiscountRule(rule: InsertDiscountRule): Promise<DiscountRule> {
    const [newRule] = await db
      .insert(discountRules)
      .values(rule)
      .returning();
    return newRule;
  }

  async getDiscountRule(id: string, businessAccountId: string): Promise<DiscountRule | undefined> {
    const [rule] = await db
      .select()
      .from(discountRules)
      .where(and(
        eq(discountRules.id, id),
        eq(discountRules.businessAccountId, businessAccountId)
      ));
    return rule || undefined;
  }

  async getDiscountRules(businessAccountId: string): Promise<DiscountRule[]> {
    return await db
      .select()
      .from(discountRules)
      .where(eq(discountRules.businessAccountId, businessAccountId))
      .orderBy(desc(discountRules.createdAt));
  }

  async getDiscountRulesForProduct(businessAccountId: string, productId: string): Promise<DiscountRule[]> {
    return await db
      .select()
      .from(discountRules)
      .where(and(
        eq(discountRules.businessAccountId, businessAccountId),
        eq(discountRules.productId, productId),
        eq(discountRules.enabled, "true")
      ))
      .orderBy(desc(discountRules.intentThreshold));
  }

  async getActiveDiscountRules(businessAccountId: string): Promise<DiscountRule[]> {
    return await db
      .select()
      .from(discountRules)
      .where(and(
        eq(discountRules.businessAccountId, businessAccountId),
        eq(discountRules.enabled, "true")
      ))
      .orderBy(desc(discountRules.intentThreshold));
  }

  async updateDiscountRule(id: string, businessAccountId: string, updates: Partial<InsertDiscountRule>): Promise<DiscountRule> {
    const [updated] = await db
      .update(discountRules)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(discountRules.id, id),
        eq(discountRules.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteDiscountRule(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(discountRules)
      .where(and(
        eq(discountRules.id, id),
        eq(discountRules.businessAccountId, businessAccountId)
      ));
  }

  async getDiscountOffersByDateRange(businessAccountId: string, startDate: Date, endDate: Date): Promise<any[]> {
    const results = await db
      .select({
        id: discountOffers.id,
        businessAccountId: discountOffers.businessAccountId,
        productId: discountOffers.productId,
        productName: products.name,
        discountCode: discountOffers.discountCode,
        discountPercentage: discountOffers.discountPercentage,
        intentScore: discountOffers.intentScore,
        offeredAt: discountOffers.offeredAt,
        expiresAt: discountOffers.expiresAt,
        redeemed: discountOffers.redeemed,
        redeemedAt: discountOffers.redeemedAt,
        revenueImpact: discountOffers.revenueImpact,
      })
      .from(discountOffers)
      .leftJoin(products, eq(discountOffers.productId, products.id))
      .where(and(
        eq(discountOffers.businessAccountId, businessAccountId),
        gte(discountOffers.offeredAt, startDate),
        sql`${discountOffers.offeredAt} <= ${endDate}`
      ))
      .orderBy(desc(discountOffers.offeredAt));
    
    return results;
  }

  // Exit Intent Settings methods
  async getExitIntentSettings(businessAccountId: string): Promise<ExitIntentSettings | undefined> {
    const [settings] = await db
      .select()
      .from(exitIntentSettings)
      .where(eq(exitIntentSettings.businessAccountId, businessAccountId));
    return settings || undefined;
  }

  async upsertExitIntentSettings(businessAccountId: string, settings: Partial<InsertExitIntentSettings>): Promise<ExitIntentSettings> {
    const existing = await this.getExitIntentSettings(businessAccountId);
    
    if (existing) {
      const [updated] = await db
        .update(exitIntentSettings)
        .set({
          ...settings,
          updatedAt: new Date()
        })
        .where(eq(exitIntentSettings.businessAccountId, businessAccountId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(exitIntentSettings)
        .values({
          ...settings,
          businessAccountId
        })
        .returning();
      return created;
    }
  }

  // Idle Timeout Settings methods
  async getIdleTimeoutSettings(businessAccountId: string): Promise<IdleTimeoutSettings | undefined> {
    const [settings] = await db
      .select()
      .from(idleTimeoutSettings)
      .where(eq(idleTimeoutSettings.businessAccountId, businessAccountId));
    return settings || undefined;
  }

  async upsertIdleTimeoutSettings(businessAccountId: string, settings: Partial<InsertIdleTimeoutSettings>): Promise<IdleTimeoutSettings> {
    const existing = await this.getIdleTimeoutSettings(businessAccountId);
    
    if (existing) {
      const [updated] = await db
        .update(idleTimeoutSettings)
        .set({
          ...settings,
          updatedAt: new Date()
        })
        .where(eq(idleTimeoutSettings.businessAccountId, businessAccountId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(idleTimeoutSettings)
        .values({
          ...settings,
          businessAccountId
        })
        .returning();
      return created;
    }
  }

  // Product Import Jobs methods
  async createProductImportJob(job: InsertProductImportJob): Promise<ProductImportJob> {
    const [created] = await db
      .insert(productImportJobs)
      .values(job)
      .returning();
    return created;
  }

  async getProductImportJob(id: string, businessAccountId: string): Promise<ProductImportJob | undefined> {
    const [job] = await db
      .select()
      .from(productImportJobs)
      .where(and(
        eq(productImportJobs.id, id),
        eq(productImportJobs.businessAccountId, businessAccountId)
      ));
    return job || undefined;
  }

  async getProductImportJobs(businessAccountId: string): Promise<ProductImportJob[]> {
    return await db
      .select()
      .from(productImportJobs)
      .where(eq(productImportJobs.businessAccountId, businessAccountId))
      .orderBy(desc(productImportJobs.createdAt));
  }

  async updateProductImportJob(id: string, updates: Partial<ProductImportJob>): Promise<ProductImportJob> {
    const [updated] = await db
      .update(productImportJobs)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(productImportJobs.id, id))
      .returning();
    return updated;
  }

  async deleteProductImportJob(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(productImportJobs)
      .where(and(
        eq(productImportJobs.id, id),
        eq(productImportJobs.businessAccountId, businessAccountId)
      ));
  }

  // Restore History methods
  async createRestoreHistory(data: InsertRestoreHistory): Promise<RestoreHistory> {
    const [created] = await db
      .insert(restoreHistory)
      .values(data)
      .returning();
    return created;
  }

  async getRestoreHistory(limit: number = 10): Promise<RestoreHistory[]> {
    return await db
      .select()
      .from(restoreHistory)
      .orderBy(desc(restoreHistory.restoredAt))
      .limit(limit);
  }

  // Backup Jobs methods (audit logging for backup operations)
  async createBackupJob(data: InsertBackupJob): Promise<BackupJob> {
    const [created] = await db
      .insert(backupJobs)
      .values(data)
      .returning();
    return created;
  }

  async updateBackupJob(correlationId: string, updates: Partial<InsertBackupJob>): Promise<BackupJob | undefined> {
    const [updated] = await db
      .update(backupJobs)
      .set({ ...updates, completedAt: updates.status === 'completed' || updates.status === 'failed' ? new Date() : undefined })
      .where(eq(backupJobs.correlationId, correlationId))
      .returning();
    return updated;
  }

  async getBackupJobs(limit: number = 20): Promise<BackupJob[]> {
    return await db
      .select()
      .from(backupJobs)
      .orderBy(desc(backupJobs.startedAt))
      .limit(limit);
  }

  async getBackupJobByCorrelationId(correlationId: string): Promise<BackupJob | undefined> {
    const [job] = await db
      .select()
      .from(backupJobs)
      .where(eq(backupJobs.correlationId, correlationId));
    return job;
  }

  async getRecentFailedBackupJobs(limit: number = 5): Promise<BackupJob[]> {
    return await db
      .select()
      .from(backupJobs)
      .where(eq(backupJobs.status, 'failed'))
      .orderBy(desc(backupJobs.startedAt))
      .limit(limit);
  }

  async deleteBackupJob(jobId: string): Promise<boolean> {
    const result = await db
      .delete(backupJobs)
      .where(eq(backupJobs.id, jobId));
    return (result.rowCount ?? 0) > 0;
  }

  // Proactive Guidance Rules methods
  async getProactiveGuidanceRules(businessAccountId: string): Promise<ProactiveGuidanceRule[]> {
    return await db
      .select()
      .from(proactiveGuidanceRules)
      .where(eq(proactiveGuidanceRules.businessAccountId, businessAccountId))
      .orderBy(desc(proactiveGuidanceRules.priority), desc(proactiveGuidanceRules.createdAt));
  }

  async getProactiveGuidanceRule(id: string, businessAccountId: string): Promise<ProactiveGuidanceRule | undefined> {
    const [rule] = await db
      .select()
      .from(proactiveGuidanceRules)
      .where(and(
        eq(proactiveGuidanceRules.id, id),
        eq(proactiveGuidanceRules.businessAccountId, businessAccountId)
      ));
    return rule || undefined;
  }

  async createProactiveGuidanceRule(rule: InsertProactiveGuidanceRule): Promise<ProactiveGuidanceRule> {
    const [created] = await db
      .insert(proactiveGuidanceRules)
      .values(rule)
      .returning();
    return created;
  }

  async updateProactiveGuidanceRule(id: string, businessAccountId: string, updates: Partial<InsertProactiveGuidanceRule>): Promise<ProactiveGuidanceRule> {
    const [updated] = await db
      .update(proactiveGuidanceRules)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(proactiveGuidanceRules.id, id),
        eq(proactiveGuidanceRules.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteProactiveGuidanceRule(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(proactiveGuidanceRules)
      .where(and(
        eq(proactiveGuidanceRules.id, id),
        eq(proactiveGuidanceRules.businessAccountId, businessAccountId)
      ));
  }

  async getActiveProactiveGuidanceRules(businessAccountId: string): Promise<ProactiveGuidanceRule[]> {
    return await db
      .select()
      .from(proactiveGuidanceRules)
      .where(and(
        eq(proactiveGuidanceRules.businessAccountId, businessAccountId),
        eq(proactiveGuidanceRules.isActive, "true")
      ))
      .orderBy(desc(proactiveGuidanceRules.priority), desc(proactiveGuidanceRules.createdAt));
  }

  async getProactiveGuidanceRulesByCampaign(campaignId: string, businessAccountId: string): Promise<ProactiveGuidanceRule[]> {
    return await db
      .select()
      .from(proactiveGuidanceRules)
      .where(and(
        eq(proactiveGuidanceRules.campaignId, campaignId),
        eq(proactiveGuidanceRules.businessAccountId, businessAccountId)
      ))
      .orderBy(desc(proactiveGuidanceRules.priority), desc(proactiveGuidanceRules.createdAt));
  }

  // Guidance Campaign methods
  async getGuidanceCampaigns(businessAccountId: string): Promise<GuidanceCampaign[]> {
    return await db
      .select()
      .from(guidanceCampaigns)
      .where(eq(guidanceCampaigns.businessAccountId, businessAccountId))
      .orderBy(desc(guidanceCampaigns.createdAt));
  }

  async getGuidanceCampaign(id: string, businessAccountId: string): Promise<GuidanceCampaign | undefined> {
    const [campaign] = await db
      .select()
      .from(guidanceCampaigns)
      .where(and(
        eq(guidanceCampaigns.id, id),
        eq(guidanceCampaigns.businessAccountId, businessAccountId)
      ));
    return campaign || undefined;
  }

  async createGuidanceCampaign(campaign: InsertGuidanceCampaign): Promise<GuidanceCampaign> {
    const [created] = await db
      .insert(guidanceCampaigns)
      .values(campaign)
      .returning();
    return created;
  }

  async updateGuidanceCampaign(id: string, businessAccountId: string, updates: Partial<InsertGuidanceCampaign>): Promise<GuidanceCampaign> {
    const [updated] = await db
      .update(guidanceCampaigns)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(
        eq(guidanceCampaigns.id, id),
        eq(guidanceCampaigns.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteGuidanceCampaign(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(guidanceCampaigns)
      .where(and(
        eq(guidanceCampaigns.id, id),
        eq(guidanceCampaigns.businessAccountId, businessAccountId)
      ));
  }

  async getGuidanceCampaignRuleCount(campaignId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(proactiveGuidanceRules)
      .where(eq(proactiveGuidanceRules.campaignId, campaignId));
    return result?.count || 0;
  }

  // LeadSquared Field Mappings
  async getLeadsquaredFieldMappings(businessAccountId: string): Promise<LeadsquaredFieldMapping[]> {
    return await db
      .select()
      .from(leadsquaredFieldMappings)
      .where(eq(leadsquaredFieldMappings.businessAccountId, businessAccountId))
      .orderBy(asc(leadsquaredFieldMappings.sortOrder), asc(leadsquaredFieldMappings.createdAt));
  }

  async getLeadsquaredFieldMapping(id: string, businessAccountId: string): Promise<LeadsquaredFieldMapping | undefined> {
    const [mapping] = await db
      .select()
      .from(leadsquaredFieldMappings)
      .where(and(
        eq(leadsquaredFieldMappings.id, id),
        eq(leadsquaredFieldMappings.businessAccountId, businessAccountId)
      ));
    return mapping;
  }

  async createLeadsquaredFieldMapping(mapping: InsertLeadsquaredFieldMapping): Promise<LeadsquaredFieldMapping> {
    const [created] = await db
      .insert(leadsquaredFieldMappings)
      .values(mapping)
      .returning();
    return created;
  }

  async updateLeadsquaredFieldMapping(id: string, businessAccountId: string, updates: Partial<InsertLeadsquaredFieldMapping>): Promise<LeadsquaredFieldMapping | undefined> {
    const [updated] = await db
      .update(leadsquaredFieldMappings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(leadsquaredFieldMappings.id, id),
        eq(leadsquaredFieldMappings.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteLeadsquaredFieldMapping(id: string, businessAccountId: string): Promise<boolean> {
    const result = await db
      .delete(leadsquaredFieldMappings)
      .where(and(
        eq(leadsquaredFieldMappings.id, id),
        eq(leadsquaredFieldMappings.businessAccountId, businessAccountId)
      ));
    return true;
  }

  async seedDefaultLeadsquaredFieldMappings(businessAccountId: string): Promise<void> {
    // Check if mappings already exist
    const existing = await this.getLeadsquaredFieldMappings(businessAccountId);
    if (existing.length > 0) return;

    // Default mappings
    const defaults: InsertLeadsquaredFieldMapping[] = [
      { businessAccountId, leadsquaredField: 'FirstName', sourceType: 'dynamic', sourceField: 'lead.name', displayName: 'Full Name', sortOrder: 1 },
      { businessAccountId, leadsquaredField: 'EmailAddress', sourceType: 'dynamic', sourceField: 'lead.email', displayName: 'Email', sortOrder: 2 },
      { businessAccountId, leadsquaredField: 'Phone', sourceType: 'dynamic', sourceField: 'lead.phone', displayName: 'Phone', sortOrder: 3 },
      { businessAccountId, leadsquaredField: 'mx_City', sourceType: 'dynamic', sourceField: 'session.city', displayName: 'City (Visitor Location)', sortOrder: 4 },
      { businessAccountId, leadsquaredField: 'mx_CreatedAt', sourceType: 'dynamic', sourceField: 'lead.createdAt', displayName: 'Created At', sortOrder: 5 },
      { businessAccountId, leadsquaredField: 'Mx_Business_Account', sourceType: 'dynamic', sourceField: 'business.name', displayName: 'Business Account Name', sortOrder: 6 },
      { businessAccountId, leadsquaredField: 'Mx_Website_Campaign', sourceType: 'dynamic', sourceField: 'lead.sourceUrl', displayName: 'Page URL (Where Lead Was Captured)', sortOrder: 7 },
      { businessAccountId, leadsquaredField: 'mx_Source_Campaign', sourceType: 'dynamic', sourceField: 'session.utmCampaign', fallbackValue: 'Website', displayName: 'Source Campaign (utm_campaign from URL)', sortOrder: 8 },
      { businessAccountId, leadsquaredField: 'Source', sourceType: 'custom', customValue: 'AI Chroney', displayName: 'Source', sortOrder: 9 },
      { businessAccountId, leadsquaredField: 'mx_Secondary_Lead_Source', sourceType: 'custom', customValue: 'AI Chroney', displayName: 'Secondary Lead Source', sortOrder: 10 },
    ];

    for (const mapping of defaults) {
      await this.createLeadsquaredFieldMapping(mapping);
    }
  }

  async getSalesforceFieldMappings(businessAccountId: string): Promise<SalesforceFieldMapping[]> {
    return await db
      .select()
      .from(salesforceFieldMappings)
      .where(eq(salesforceFieldMappings.businessAccountId, businessAccountId))
      .orderBy(asc(salesforceFieldMappings.sortOrder), asc(salesforceFieldMappings.createdAt));
  }

  async getSalesforceFieldMapping(id: string, businessAccountId: string): Promise<SalesforceFieldMapping | undefined> {
    const [mapping] = await db
      .select()
      .from(salesforceFieldMappings)
      .where(and(
        eq(salesforceFieldMappings.id, id),
        eq(salesforceFieldMappings.businessAccountId, businessAccountId)
      ));
    return mapping;
  }

  async createSalesforceFieldMapping(mapping: InsertSalesforceFieldMapping): Promise<SalesforceFieldMapping> {
    const [created] = await db
      .insert(salesforceFieldMappings)
      .values(mapping)
      .returning();
    return created;
  }

  async updateSalesforceFieldMapping(id: string, businessAccountId: string, updates: Partial<InsertSalesforceFieldMapping>): Promise<SalesforceFieldMapping | undefined> {
    const [updated] = await db
      .update(salesforceFieldMappings)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(salesforceFieldMappings.id, id),
        eq(salesforceFieldMappings.businessAccountId, businessAccountId)
      ))
      .returning();
    return updated;
  }

  async deleteSalesforceFieldMapping(id: string, businessAccountId: string): Promise<boolean> {
    await db
      .delete(salesforceFieldMappings)
      .where(and(
        eq(salesforceFieldMappings.id, id),
        eq(salesforceFieldMappings.businessAccountId, businessAccountId)
      ));
    return true;
  }

  async seedDefaultSalesforceFieldMappings(businessAccountId: string): Promise<void> {
    const existing = await this.getSalesforceFieldMappings(businessAccountId);
    if (existing.length > 0) return;
    const { DEFAULT_SALESFORCE_FIELD_MAPPINGS } = await import('./services/salesforceService');
    for (const mapping of DEFAULT_SALESFORCE_FIELD_MAPPINGS) {
      await this.createSalesforceFieldMapping({
        businessAccountId,
        salesforceField: mapping.salesforceField,
        sourceType: mapping.sourceType,
        sourceField: mapping.sourceField || null,
        customValue: mapping.customValue || null,
        displayName: mapping.displayName,
        isEnabled: 'true',
        sortOrder: mapping.sortOrder,
      });
    }
  }

  async getMasterAiSettings(): Promise<MasterAiSettings | null> {
    const { encrypt, decrypt } = await import('./services/encryptionService');
    const [row] = await db.select().from(masterAiSettings).where(eq(masterAiSettings.id, 1));
    if (!row) return null;
    return {
      ...row,
      primaryApiKey: row.primaryApiKey ? (() => { try { return decrypt(row.primaryApiKey!); } catch { console.error('[MasterAI] Failed to decrypt primaryApiKey'); return null; } })() : null,
      fallbackApiKey: row.fallbackApiKey ? (() => { try { return decrypt(row.fallbackApiKey!); } catch { console.error('[MasterAI] Failed to decrypt fallbackApiKey'); return null; } })() : null,
    };
  }

  async upsertMasterAiSettings(data: {
    primaryProvider?: string;
    primaryApiKey?: string | null;
    primaryModel?: string;
    fallbackProvider?: string;
    fallbackApiKey?: string | null;
    fallbackModel?: string;
    masterEnabled?: boolean;
    fallbackEnabled?: boolean;
  }): Promise<MasterAiSettings> {
    const { encrypt } = await import('./services/encryptionService');
    const updateData: Record<string, any> = {
      ...data,
      updatedAt: new Date(),
    };
    if (data.primaryApiKey !== undefined && data.primaryApiKey !== null && data.primaryApiKey !== '') {
      updateData.primaryApiKey = encrypt(data.primaryApiKey);
    } else if (data.primaryApiKey === null || data.primaryApiKey === '') {
      updateData.primaryApiKey = null;
    } else {
      delete updateData.primaryApiKey;
    }
    if (data.fallbackApiKey !== undefined && data.fallbackApiKey !== null && data.fallbackApiKey !== '') {
      updateData.fallbackApiKey = encrypt(data.fallbackApiKey);
    } else if (data.fallbackApiKey === null || data.fallbackApiKey === '') {
      updateData.fallbackApiKey = null;
    } else {
      delete updateData.fallbackApiKey;
    }
    const [row] = await db
      .insert(masterAiSettings)
      .values({ id: 1, ...updateData })
      .onConflictDoUpdate({ target: masterAiSettings.id, set: updateData })
      .returning();
    return row;
  }
  // LeadSquared URL Extraction Cache
  async getUrlExtraction(url: string, businessAccountId: string): Promise<{ university: string | null; product: string | null } | null> {
    const { leadsquaredUrlExtractionCache } = await import('../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await db
      .select()
      .from(leadsquaredUrlExtractionCache)
      .where(and(
        eq(leadsquaredUrlExtractionCache.url, url),
        eq(leadsquaredUrlExtractionCache.businessAccountId, businessAccountId)
      ))
      .limit(1);
    if (!row) return null;
    return { university: row.university, product: row.product };
  }

  async saveUrlExtraction(url: string, businessAccountId: string, university: string, product: string): Promise<void> {
    const { leadsquaredUrlExtractionCache } = await import('../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    await db
      .insert(leadsquaredUrlExtractionCache)
      .values({ url, businessAccountId, university, product })
      .onConflictDoUpdate({
        target: [leadsquaredUrlExtractionCache.url, leadsquaredUrlExtractionCache.businessAccountId],
        set: { university, product, extractedAt: new Date() }
      });
  }

  async getUrlRules(businessAccountId: string) {
    const { leadsquaredUrlRules } = await import('../shared/schema');
    const { eq } = await import('drizzle-orm');
    return db
      .select()
      .from(leadsquaredUrlRules)
      .where(eq(leadsquaredUrlRules.businessAccountId, businessAccountId))
      .orderBy(leadsquaredUrlRules.createdAt);
  }

  async createUrlRule(data: { businessAccountId: string; urlPattern: string; university?: string; product?: string }) {
    const { leadsquaredUrlRules } = await import('../shared/schema');
    const [rule] = await db
      .insert(leadsquaredUrlRules)
      .values({
        businessAccountId: data.businessAccountId,
        urlPattern: data.urlPattern,
        university: data.university || null,
        product: data.product || null,
      })
      .returning();
    return rule;
  }

  async updateUrlRule(id: string, businessAccountId: string, data: { urlPattern?: string; university?: string; product?: string; isEnabled?: string }) {
    const { leadsquaredUrlRules } = await import('../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    const updateData: Record<string, any> = {};
    if (data.urlPattern !== undefined) updateData.urlPattern = data.urlPattern;
    if (data.university !== undefined) updateData.university = data.university || null;
    if (data.product !== undefined) updateData.product = data.product || null;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
    const [rule] = await db
      .update(leadsquaredUrlRules)
      .set(updateData)
      .where(and(eq(leadsquaredUrlRules.id, id), eq(leadsquaredUrlRules.businessAccountId, businessAccountId)))
      .returning();
    return rule;
  }

  async deleteUrlRule(id: string, businessAccountId: string) {
    const { leadsquaredUrlRules } = await import('../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    await db
      .delete(leadsquaredUrlRules)
      .where(and(eq(leadsquaredUrlRules.id, id), eq(leadsquaredUrlRules.businessAccountId, businessAccountId)));
  }

  async getUrlRuleByUrl(url: string, businessAccountId: string) {
    const { leadsquaredUrlRules } = await import('../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    const rules = await db
      .select()
      .from(leadsquaredUrlRules)
      .where(and(
        eq(leadsquaredUrlRules.businessAccountId, businessAccountId),
        eq(leadsquaredUrlRules.isEnabled, 'true')
      ));
    const normalizedUrl = url.toLowerCase().replace(/\/$/, '');
    for (const rule of rules) {
      const normalizedPattern = rule.urlPattern.toLowerCase().replace(/\/$/, '');
      if (normalizedUrl === normalizedPattern || normalizedUrl.includes(normalizedPattern)) {
        return { university: rule.university, product: rule.product };
      }
    }
    return null;
  }

  async storeInstagramComment(data: InsertInstagramComment): Promise<InstagramComment> {
    const [comment] = await db
      .insert(instagramComments)
      .values(data)
      .returning();
    return comment;
  }

  async findInstagramCommentByIgId(businessAccountId: string, commentId: string): Promise<InstagramComment | null> {
    const [comment] = await db
      .select()
      .from(instagramComments)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.commentId, commentId)
        )
      )
      .limit(1);
    return comment || null;
  }

  async getInstagramComments(
    businessAccountId: string,
    filters?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ comments: InstagramComment[]; total: number }> {
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const conditions: any[] = [eq(instagramComments.businessAccountId, businessAccountId)];
    if (filters?.status) {
      conditions.push(eq(instagramComments.status, filters.status));
    }

    const whereClause = and(...conditions);

    const [totalResult] = await db
      .select({ count: count() })
      .from(instagramComments)
      .where(whereClause);

    const comments = await db
      .select()
      .from(instagramComments)
      .where(whereClause)
      .orderBy(desc(instagramComments.createdAt))
      .limit(limit)
      .offset(offset);

    return { comments, total: totalResult?.count || 0 };
  }

  async updateInstagramCommentStatus(
    id: string,
    status: string,
    replyText?: string,
    replyCommentId?: string
  ): Promise<InstagramComment> {
    const updateData: any = { status };
    if (replyText !== undefined) updateData.replyText = replyText;
    if (replyCommentId !== undefined) updateData.replyCommentId = replyCommentId;

    const [comment] = await db
      .update(instagramComments)
      .set(updateData)
      .where(eq(instagramComments.id, id))
      .returning();
    return comment;
  }

  async getInstagramCommentStats(businessAccountId: string): Promise<{ total: number; pending: number; replied: number; skipped: number; failed: number }> {
    const result = await db
      .select({
        status: instagramComments.status,
        count: count(),
      })
      .from(instagramComments)
      .where(eq(instagramComments.businessAccountId, businessAccountId))
      .groupBy(instagramComments.status);

    const stats = { total: 0, pending: 0, replied: 0, skipped: 0, failed: 0 };
    for (const row of result) {
      const c = Number(row.count);
      stats.total += c;
      if (row.status === "pending") stats.pending = c;
      else if (row.status === "replied") stats.replied = c;
      else if (row.status === "skipped") stats.skipped = c;
      else if (row.status === "failed") stats.failed = c;
    }
    return stats;
  }

  async storeFacebookComment(data: InsertFacebookComment): Promise<FacebookComment> {
    const [comment] = await db
      .insert(facebookComments)
      .values(data)
      .returning();
    return comment;
  }

  async findFacebookCommentByFbId(businessAccountId: string, commentId: string): Promise<FacebookComment | null> {
    const [comment] = await db
      .select()
      .from(facebookComments)
      .where(
        and(
          eq(facebookComments.businessAccountId, businessAccountId),
          eq(facebookComments.commentId, commentId)
        )
      )
      .limit(1);
    return comment || null;
  }

  async getFacebookComments(
    businessAccountId: string,
    filters?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ comments: FacebookComment[]; total: number }> {
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const conditions: any[] = [eq(facebookComments.businessAccountId, businessAccountId)];
    if (filters?.status) {
      conditions.push(eq(facebookComments.status, filters.status));
    }

    const whereClause = and(...conditions);

    const [totalResult] = await db
      .select({ count: count() })
      .from(facebookComments)
      .where(whereClause);

    const comments = await db
      .select()
      .from(facebookComments)
      .where(whereClause)
      .orderBy(desc(facebookComments.createdAt))
      .limit(limit)
      .offset(offset);

    return { comments, total: totalResult?.count || 0 };
  }

  async updateFacebookCommentStatus(
    id: string,
    status: string,
    replyText?: string,
    replyCommentId?: string
  ): Promise<FacebookComment> {
    const updateData: any = { status };
    if (replyText !== undefined) updateData.replyText = replyText;
    if (replyCommentId !== undefined) updateData.replyCommentId = replyCommentId;

    const [comment] = await db
      .update(facebookComments)
      .set(updateData)
      .where(eq(facebookComments.id, id))
      .returning();
    return comment;
  }

  async getFacebookCommentStats(businessAccountId: string): Promise<{ total: number; pending: number; replied: number; skipped: number; failed: number }> {
    const result = await db
      .select({
        status: facebookComments.status,
        count: count(),
      })
      .from(facebookComments)
      .where(eq(facebookComments.businessAccountId, businessAccountId))
      .groupBy(facebookComments.status);

    const stats = { total: 0, pending: 0, replied: 0, skipped: 0, failed: 0 };
    for (const row of result) {
      const c = Number(row.count);
      stats.total += c;
      if (row.status === "pending") stats.pending = c;
      else if (row.status === "replied") stats.replied = c;
      else if (row.status === "skipped") stats.skipped = c;
      else if (row.status === "failed") stats.failed = c;
    }
    return stats;
  }

  async storeFacebookLead(data: InsertFacebookLead): Promise<FacebookLead> {
    const [lead] = await db
      .insert(facebookLeads)
      .values(data)
      .returning();
    return lead;
  }

  async getFacebookLeads(
    businessAccountId: string,
    filters?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ leads: FacebookLead[]; total: number }> {
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const conditions: any[] = [eq(facebookLeads.businessAccountId, businessAccountId)];
    if (filters?.status) {
      conditions.push(eq(facebookLeads.status, filters.status));
    }

    const whereClause = and(...conditions);

    const [totalResult] = await db
      .select({ count: count() })
      .from(facebookLeads)
      .where(whereClause);

    const leads = await db
      .select()
      .from(facebookLeads)
      .where(whereClause)
      .orderBy(desc(facebookLeads.receivedAt))
      .limit(limit)
      .offset(offset);

    return { leads, total: totalResult?.count || 0 };
  }

  async deleteFacebookLead(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(facebookLeads)
      .where(
        and(
          eq(facebookLeads.id, id),
          eq(facebookLeads.businessAccountId, businessAccountId)
        )
      );
  }

  async createFacebookFlow(flow: InsertFacebookFlow): Promise<FacebookFlow> {
    const [created] = await db
      .insert(facebookFlows)
      .values(flow)
      .returning();
    return created;
  }

  async getFacebookFlow(id: string, businessAccountId: string): Promise<FacebookFlow | undefined> {
    const [flow] = await db
      .select()
      .from(facebookFlows)
      .where(
        and(
          eq(facebookFlows.id, id),
          eq(facebookFlows.businessAccountId, businessAccountId)
        )
      );
    return flow || undefined;
  }

  async getFacebookFlows(businessAccountId: string): Promise<FacebookFlow[]> {
    return db
      .select()
      .from(facebookFlows)
      .where(eq(facebookFlows.businessAccountId, businessAccountId))
      .orderBy(desc(facebookFlows.createdAt));
  }

  async updateFacebookFlow(id: string, businessAccountId: string, updates: Partial<InsertFacebookFlow>): Promise<FacebookFlow> {
    const [flow] = await db
      .update(facebookFlows)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(facebookFlows.id, id),
          eq(facebookFlows.businessAccountId, businessAccountId)
        )
      )
      .returning();
    return flow;
  }

  async deleteFacebookFlow(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(facebookFlows)
      .where(
        and(
          eq(facebookFlows.id, id),
          eq(facebookFlows.businessAccountId, businessAccountId)
        )
      );
  }

  async createFacebookFlowStep(step: InsertFacebookFlowStep): Promise<FacebookFlowStep> {
    const [created] = await db
      .insert(facebookFlowSteps)
      .values(step)
      .returning();
    return created;
  }

  async getFacebookFlowSteps(flowId: string): Promise<FacebookFlowStep[]> {
    return db
      .select()
      .from(facebookFlowSteps)
      .where(eq(facebookFlowSteps.flowId, flowId))
      .orderBy(asc(facebookFlowSteps.stepOrder));
  }

  async updateFacebookFlowStep(id: string, flowId: string, updates: Partial<InsertFacebookFlowStep>): Promise<FacebookFlowStep> {
    const [step] = await db
      .update(facebookFlowSteps)
      .set(updates)
      .where(
        and(
          eq(facebookFlowSteps.id, id),
          eq(facebookFlowSteps.flowId, flowId)
        )
      )
      .returning();
    return step;
  }

  async deleteFacebookFlowStep(id: string, flowId: string): Promise<void> {
    await db
      .delete(facebookFlowSteps)
      .where(
        and(
          eq(facebookFlowSteps.id, id),
          eq(facebookFlowSteps.flowId, flowId)
        )
      );
  }

  async reorderFacebookFlowSteps(flowId: string, stepOrders: { id: string; stepOrder: number }[]): Promise<void> {
    for (const { id, stepOrder } of stepOrders) {
      await db
        .update(facebookFlowSteps)
        .set({ stepOrder })
        .where(
          and(
            eq(facebookFlowSteps.id, id),
            eq(facebookFlowSteps.flowId, flowId)
          )
        );
    }
  }

  async createFacebookFlowSession(session: InsertFacebookFlowSession): Promise<FacebookFlowSession> {
    const [created] = await db
      .insert(facebookFlowSessions)
      .values(session)
      .returning();
    return created;
  }

  async getFacebookFlowSession(id: string): Promise<FacebookFlowSession | undefined> {
    const [session] = await db
      .select()
      .from(facebookFlowSessions)
      .where(eq(facebookFlowSessions.id, id));
    return session || undefined;
  }

  async getActiveFacebookFlowSession(businessAccountId: string, senderId: string): Promise<FacebookFlowSession | undefined> {
    const [session] = await db
      .select()
      .from(facebookFlowSessions)
      .where(
        and(
          eq(facebookFlowSessions.businessAccountId, businessAccountId),
          eq(facebookFlowSessions.senderId, senderId),
          eq(facebookFlowSessions.status, "active")
        )
      )
      .orderBy(desc(facebookFlowSessions.createdAt))
      .limit(1);
    return session || undefined;
  }

  async updateFacebookFlowSession(id: string, updates: Partial<InsertFacebookFlowSession>): Promise<FacebookFlowSession> {
    const [session] = await db
      .update(facebookFlowSessions)
      .set({ ...updates, lastMessageAt: new Date() })
      .where(eq(facebookFlowSessions.id, id))
      .returning();
    return session;
  }

  async deleteFacebookFlowSession(id: string): Promise<void> {
    await db
      .delete(facebookFlowSessions)
      .where(eq(facebookFlowSessions.id, id));
  }

  async getFacebookLeadFields(businessAccountId: string): Promise<FacebookLeadField[]> {
    return db
      .select()
      .from(facebookLeadFields)
      .where(eq(facebookLeadFields.businessAccountId, businessAccountId))
      .orderBy(asc(facebookLeadFields.displayOrder));
  }

  async upsertFacebookLeadField(data: InsertFacebookLeadField): Promise<FacebookLeadField> {
    const [field] = await db
      .insert(facebookLeadFields)
      .values(data)
      .onConflictDoUpdate({
        target: [facebookLeadFields.id],
        set: { ...data, updatedAt: new Date() }
      })
      .returning();
    return field;
  }

  async deleteFacebookLeadField(id: string, businessAccountId: string): Promise<void> {
    await db
      .delete(facebookLeadFields)
      .where(
        and(
          eq(facebookLeadFields.id, id),
          eq(facebookLeadFields.businessAccountId, businessAccountId)
        )
      );
  }

  async getJobs(businessAccountId: string, filters?: { status?: string; search?: string }): Promise<Job[]> {
    let results = await db.select().from(jobs).where(eq(jobs.businessAccountId, businessAccountId)).orderBy(desc(jobs.createdAt));
    if (filters?.status) results = results.filter(j => j.status === filters.status);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      results = results.filter(j => j.title.toLowerCase().includes(s) || (j.department && j.department.toLowerCase().includes(s)) || (j.location && j.location.toLowerCase().includes(s)));
    }
    return results;
  }

  async getJob(id: string, businessAccountId: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.businessAccountId, businessAccountId)));
    return job || undefined;
  }

  async getJobByExternalRefId(externalRefId: string, businessAccountId: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(and(eq(jobs.externalRefId, externalRefId), eq(jobs.businessAccountId, businessAccountId)));
    return job || undefined;
  }

  async createJob(data: InsertJob): Promise<Job> {
    const embeddingText = [data.title, data.description, data.requirements].filter(Boolean).join(" ");
    if (embeddingText.trim()) {
      try {
        const { embeddingService } = await import("./services/embeddingService");
        data.textEmbedding = await embeddingService.generateEmbedding(embeddingText, data.businessAccountId);
      } catch (err: any) {
        console.error("[JobPortal] Failed to generate embedding on create:", err.message);
      }
    }
    const [job] = await db.insert(jobs).values(data).returning();
    return job;
  }

  async updateJob(id: string, businessAccountId: string, updates: Partial<InsertJob>): Promise<Job | undefined> {
    if (updates.title !== undefined || updates.description !== undefined || updates.requirements !== undefined) {
      const existing = await this.getJob(id, businessAccountId);
      if (existing) {
        const title = updates.title ?? existing.title;
        const description = updates.description ?? existing.description;
        const requirements = updates.requirements ?? existing.requirements;
        const embeddingText = [title, description, requirements].filter(Boolean).join(" ");
        if (embeddingText.trim()) {
          try {
            const { embeddingService } = await import("./services/embeddingService");
            updates.textEmbedding = await embeddingService.generateEmbedding(embeddingText, businessAccountId);
          } catch (err: any) {
            console.error("[JobPortal] Failed to generate embedding on update:", err.message);
          }
        }
      }
    }
    const [job] = await db.update(jobs).set({ ...updates, updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.businessAccountId, businessAccountId))).returning();
    return job || undefined;
  }

  async deleteJob(id: string, businessAccountId: string): Promise<void> {
    await db.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.businessAccountId, businessAccountId)));
  }

  async getApplicants(businessAccountId: string, search?: string): Promise<JobApplicant[]> {
    let results = await db.select().from(jobApplicants).where(eq(jobApplicants.businessAccountId, businessAccountId)).orderBy(desc(jobApplicants.createdAt));
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(a => a.name.toLowerCase().includes(s) || (a.email && a.email.toLowerCase().includes(s)) || (a.phone && a.phone.includes(s)));
    }
    return results;
  }

  async getApplicant(id: string, businessAccountId: string): Promise<JobApplicant | undefined> {
    const [applicant] = await db.select().from(jobApplicants).where(and(eq(jobApplicants.id, id), eq(jobApplicants.businessAccountId, businessAccountId)));
    return applicant || undefined;
  }

  async createApplicant(data: InsertJobApplicant): Promise<JobApplicant> {
    const [applicant] = await db.insert(jobApplicants).values(data).returning();
    return applicant;
  }

  async updateApplicant(id: string, businessAccountId: string, updates: Partial<InsertJobApplicant>): Promise<JobApplicant | undefined> {
    const [applicant] = await db.update(jobApplicants).set(updates).where(and(eq(jobApplicants.id, id), eq(jobApplicants.businessAccountId, businessAccountId))).returning();
    return applicant || undefined;
  }

  async deleteApplicant(id: string, businessAccountId: string): Promise<void> {
    await db.delete(jobApplicants).where(and(eq(jobApplicants.id, id), eq(jobApplicants.businessAccountId, businessAccountId)));
  }

  async getApplications(businessAccountId: string, filters?: { jobId?: string; applicantId?: string; status?: string }): Promise<(JobApplication & { jobTitle: string; applicantName: string; applicantEmail: string | null })[]> {
    let conditions = [eq(jobApplications.businessAccountId, businessAccountId)];
    if (filters?.jobId) conditions.push(eq(jobApplications.jobId, filters.jobId));
    if (filters?.applicantId) conditions.push(eq(jobApplications.applicantId, filters.applicantId));
    if (filters?.status) conditions.push(eq(jobApplications.status, filters.status));

    const results = await db.select({
      application: jobApplications,
      jobTitle: jobs.title,
      applicantName: jobApplicants.name,
      applicantEmail: jobApplicants.email,
    }).from(jobApplications)
      .innerJoin(jobs, eq(jobApplications.jobId, jobs.id))
      .innerJoin(jobApplicants, eq(jobApplications.applicantId, jobApplicants.id))
      .where(and(...conditions))
      .orderBy(desc(jobApplications.appliedAt));

    return results.map(r => ({ ...r.application, jobTitle: r.jobTitle, applicantName: r.applicantName, applicantEmail: r.applicantEmail }));
  }

  async getApplication(id: string, businessAccountId: string): Promise<(JobApplication & { jobTitle: string; applicantName: string; applicantEmail: string | null }) | undefined> {
    const results = await db.select({
      application: jobApplications,
      jobTitle: jobs.title,
      applicantName: jobApplicants.name,
      applicantEmail: jobApplicants.email,
    }).from(jobApplications)
      .innerJoin(jobs, eq(jobApplications.jobId, jobs.id))
      .innerJoin(jobApplicants, eq(jobApplications.applicantId, jobApplicants.id))
      .where(and(eq(jobApplications.id, id), eq(jobApplications.businessAccountId, businessAccountId)));

    if (results.length === 0) return undefined;
    const r = results[0];
    return { ...r.application, jobTitle: r.jobTitle, applicantName: r.applicantName, applicantEmail: r.applicantEmail };
  }

  async createApplication(data: InsertJobApplication): Promise<JobApplication> {
    const [application] = await db.insert(jobApplications).values(data).returning();
    return application;
  }

  async updateApplication(id: string, businessAccountId: string, updates: Partial<InsertJobApplication>): Promise<JobApplication | undefined> {
    const [application] = await db.update(jobApplications).set({ ...updates, updatedAt: new Date() }).where(and(eq(jobApplications.id, id), eq(jobApplications.businessAccountId, businessAccountId))).returning();
    return application || undefined;
  }

  async deleteApplication(id: string, businessAccountId: string): Promise<void> {
    await db.delete(jobApplications).where(and(eq(jobApplications.id, id), eq(jobApplications.businessAccountId, businessAccountId)));
  }
}

export const storage = new DatabaseStorage();
