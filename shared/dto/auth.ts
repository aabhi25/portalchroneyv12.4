import type { User } from "../schema";
import type { BusinessAccountDto, ProductTier, SystemMode } from "./businessAccount";

// MeResponseDto - Response type for /api/auth/me endpoint
export type MeResponseDto = User & {
  activeBusinessAccountId?: string | null; // For multi-account switching
  businessAccount?: {
    id: string;
    name: string;
    status: string;
    productTier: ProductTier;
    systemMode: SystemMode;
    shopifyEnabled: boolean;
    appointmentsEnabled: boolean;
    voiceModeEnabled: boolean;
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
    isTopscholar: boolean;
  } | null;
};

// Convert User with optional BusinessAccount to MeResponseDto
export function toMeResponseDto(
  user: User,
  businessAccount?: BusinessAccountDto | null,
  activeBusinessAccountId?: string | null,
  isTopscholar?: boolean
): MeResponseDto {
  if (businessAccount) {
    return {
      ...user,
      activeBusinessAccountId: activeBusinessAccountId || null,
      businessAccount: {
        id: businessAccount.id,
        name: businessAccount.name,
        status: businessAccount.status,
        productTier: businessAccount.productTier,
        systemMode: businessAccount.systemMode,
        shopifyEnabled: businessAccount.shopifyEnabled,
        appointmentsEnabled: businessAccount.appointmentsEnabled,
        voiceModeEnabled: businessAccount.voiceModeEnabled,
        jewelryShowcaseEnabled: businessAccount.jewelryShowcaseEnabled,
        supportTicketsEnabled: businessAccount.supportTicketsEnabled,
        whatsappEnabled: businessAccount.whatsappEnabled,
        instagramEnabled: businessAccount.instagramEnabled,
        facebookEnabled: businessAccount.facebookEnabled,
        chroneyEnabled: businessAccount.chroneyEnabled,
        k12EducationEnabled: businessAccount.k12EducationEnabled,
        k12ImageUploadEnabled: businessAccount.k12ImageUploadEnabled,
        k12ContentOnlyMode: businessAccount.k12ContentOnlyMode,
        k12VerbatimContentMode: businessAccount.k12VerbatimContentMode,
        jobPortalEnabled: businessAccount.jobPortalEnabled,
        demoOrdersEnabled: businessAccount.demoOrdersEnabled,
        whatsappMarketingEnabled: businessAccount.whatsappMarketingEnabled,
        isTopscholar: !!isTopscholar,
      },
    };
  }
  
  return {
    ...user,
    activeBusinessAccountId: activeBusinessAccountId || null,
    businessAccount: null,
  };
}
