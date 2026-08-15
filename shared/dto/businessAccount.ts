import type { BusinessAccount } from "../schema";

// Product tier type
export type ProductTier = 'chroney' | 'jewelry_showcase' | 'jewelry_showcase_chroney';

// System mode type - controls visible features for business users
export type SystemMode = 'full' | 'essential';

// BusinessAccountDto with normalized boolean feature flags for API/client
export type BusinessAccountDto = Omit<BusinessAccount, "shopifyEnabled" | "appointmentsEnabled" | "voiceModeEnabled" | "visualSearchEnabled" | "jewelryShowcaseEnabled" | "supportTicketsEnabled" | "whatsappEnabled" | "instagramEnabled" | "facebookEnabled" | "chroneyEnabled" | "k12EducationEnabled" | "k12ImageUploadEnabled" | "k12ContentOnlyMode" | "k12VerbatimContentMode" | "jobPortalEnabled" | "demoOrdersEnabled" | "whatsappMarketingEnabled" | "systemMode"> & {
  shopifyEnabled: boolean;
  appointmentsEnabled: boolean;
  voiceModeEnabled: boolean;
  visualSearchEnabled: boolean;
  jewelryShowcaseEnabled: boolean;
  supportTicketsEnabled: boolean;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  facebookEnabled: boolean;
  chroneyEnabled: boolean;
  k12EducationEnabled: boolean;
  k12ImageUploadEnabled: boolean;
  k12ContentOnlyMode: boolean;
  k12VerbatimContentMode: boolean;
  jobPortalEnabled: boolean;
  demoOrdersEnabled: boolean;
  whatsappMarketingEnabled: boolean;
  productTier: ProductTier;
  systemMode: SystemMode;
  isLive?: boolean;
};

// Convert database BusinessAccount (text flags) to BusinessAccountDto (boolean flags)
export function toBusinessAccountDto(account: BusinessAccount): BusinessAccountDto {
  return {
    ...account,
    shopifyEnabled: account.shopifyEnabled === "true",
    appointmentsEnabled: account.appointmentsEnabled === "true",
    voiceModeEnabled: account.voiceModeEnabled === "true",
    visualSearchEnabled: account.visualSearchEnabled === "true",
    jewelryShowcaseEnabled: account.jewelryShowcaseEnabled === "true",
    supportTicketsEnabled: account.supportTicketsEnabled === "true",
    whatsappEnabled: account.whatsappEnabled === "true",
    instagramEnabled: account.instagramEnabled === "true",
    facebookEnabled: account.facebookEnabled === "true",
    chroneyEnabled: account.chroneyEnabled === "true",
    k12EducationEnabled: account.k12EducationEnabled === "true",
    k12ImageUploadEnabled: account.k12ImageUploadEnabled === "true",
    k12ContentOnlyMode: account.k12ContentOnlyMode === "true",
    k12VerbatimContentMode: account.k12VerbatimContentMode === "true",
    jobPortalEnabled: account.jobPortalEnabled === "true",
    demoOrdersEnabled: account.demoOrdersEnabled === "true",
    whatsappMarketingEnabled: account.whatsappMarketingEnabled === "true",
    productTier: (account.productTier || 'chroney') as ProductTier,
    systemMode: (account.systemMode || 'full') as SystemMode,
  };
}

// Convert BusinessAccountDto (boolean flags) back to database format (text flags)
export function fromBusinessAccountDto(dto: BusinessAccountDto): BusinessAccount {
  return {
    ...dto,
    shopifyEnabled: dto.shopifyEnabled ? "true" : "false",
    appointmentsEnabled: dto.appointmentsEnabled ? "true" : "false",
    voiceModeEnabled: dto.voiceModeEnabled ? "true" : "false",
    visualSearchEnabled: dto.visualSearchEnabled ? "true" : "false",
    jewelryShowcaseEnabled: dto.jewelryShowcaseEnabled ? "true" : "false",
    supportTicketsEnabled: dto.supportTicketsEnabled ? "true" : "false",
    whatsappEnabled: dto.whatsappEnabled ? "true" : "false",
    instagramEnabled: dto.instagramEnabled ? "true" : "false",
    facebookEnabled: dto.facebookEnabled ? "true" : "false",
    chroneyEnabled: dto.chroneyEnabled ? "true" : "false",
    k12EducationEnabled: dto.k12EducationEnabled ? "true" : "false",
    k12ImageUploadEnabled: dto.k12ImageUploadEnabled ? "true" : "false",
    k12ContentOnlyMode: dto.k12ContentOnlyMode ? "true" : "false",
    k12VerbatimContentMode: dto.k12VerbatimContentMode ? "true" : "false",
    jobPortalEnabled: dto.jobPortalEnabled ? "true" : "false",
    demoOrdersEnabled: dto.demoOrdersEnabled ? "true" : "false",
    whatsappMarketingEnabled: dto.whatsappMarketingEnabled ? "true" : "false",
    systemMode: dto.systemMode || 'full',
  };
}
