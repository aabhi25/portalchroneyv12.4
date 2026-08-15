import { db } from "../db";
import { customerProfiles, customerIdentities, customerMemorySnapshots, customerMergeAudit } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";

// NOTE: A previous implementation of `normalizeExistingPhones()` lived here and
// was called from server/index.ts on every startup. It executed
//   UPDATE customer_profiles SET normalized_phone = RIGHT(normalized_phone, 10)
//   WHERE LENGTH(normalized_phone) > 10
// which destructively truncated stored phone numbers down to their last 10
// digits, silently stripping country codes. That broke WhatsApp campaign
// delivery (MSG91 needs the full international number). The function and its
// startup hook have been removed. Country-code handling is now an opt-in
// per-contact-group setting (`defaultCountryCode`) applied at send time.

export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d]/g, "");
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length > 10) {
    cleaned = cleaned.slice(-10);
  }
  return cleaned;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

interface ResolveProfileInput {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  city?: string | null;
  platform: string;
  platformUserId: string;
}

export async function resolveProfile(
  businessAccountId: string,
  input: ResolveProfileInput
) {
  try {
    return await _resolveProfile(businessAccountId, input);
  } catch (error: any) {
    if (error?.code === "23505") {
      return await _resolveProfile(businessAccountId, input);
    }
    throw error;
  }
}

async function _resolveProfile(
  businessAccountId: string,
  input: ResolveProfileInput
) {
  const { platform, platformUserId } = input;
  const normPhone = input.phone ? normalizePhone(input.phone) : null;
  const normEmail = input.email ? normalizeEmail(input.email) : null;

  const existingIdentity = await db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.businessAccountId, businessAccountId),
        eq(customerIdentities.platform, platform),
        eq(customerIdentities.platformUserId, platformUserId)
      )
    )
    .limit(1);

  if (existingIdentity.length > 0) {
    const identity = existingIdentity[0];
    const profiles = await db
      .select()
      .from(customerProfiles)
      .where(
        and(
          eq(customerProfiles.id, identity.profileId),
          eq(customerProfiles.businessAccountId, businessAccountId)
        )
      )
      .limit(1);

    if (profiles.length > 0) {
      const profile = profiles[0];
      const updates: Record<string, any> = {
        lastActivePlatform: platform,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      };
      if (input.name && !profile.displayName) updates.displayName = input.name;
      if (input.city && !profile.city) updates.city = input.city;

      await db
        .update(customerProfiles)
        .set(updates)
        .where(
          and(
            eq(customerProfiles.id, profile.id),
            eq(customerProfiles.businessAccountId, businessAccountId)
          )
        );

      await db
        .update(customerIdentities)
        .set({ lastSeenAt: new Date() })
        .where(eq(customerIdentities.id, identity.id));

      if (normPhone && !profile.normalizedPhone) {
        const phoneMatch = await findProfileByPhone(businessAccountId, normPhone);
        if (phoneMatch && phoneMatch.id !== profile.id) {
          return await mergeProfiles(businessAccountId, profile.id, phoneMatch.id, "phone_match");
        }
        try {
          await db
            .update(customerProfiles)
            .set({ normalizedPhone: normPhone, updatedAt: new Date() })
            .where(
              and(
                eq(customerProfiles.id, profile.id),
                eq(customerProfiles.businessAccountId, businessAccountId)
              )
            );
        } catch (e: any) {
          if (e?.code !== "23505") throw e;
        }
      }

      if (normEmail && !profile.normalizedEmail) {
        const emailMatch = await findProfileByEmail(businessAccountId, normEmail);
        if (emailMatch && emailMatch.id !== profile.id) {
          return await mergeProfiles(businessAccountId, profile.id, emailMatch.id, "email_match");
        }
        try {
          await db
            .update(customerProfiles)
            .set({ normalizedEmail: normEmail, updatedAt: new Date() })
            .where(
              and(
                eq(customerProfiles.id, profile.id),
                eq(customerProfiles.businessAccountId, businessAccountId)
              )
            );
        } catch (e: any) {
          if (e?.code !== "23505") throw e;
        }
      }

      const updated = await db
        .select()
        .from(customerProfiles)
        .where(
          and(
            eq(customerProfiles.id, profile.id),
            eq(customerProfiles.businessAccountId, businessAccountId)
          )
        )
        .limit(1);
      return updated[0];
    }
  }

  if (normPhone) {
    const phoneMatch = await findProfileByPhone(businessAccountId, normPhone);
    if (phoneMatch) {
      await upsertIdentity(phoneMatch.id, businessAccountId, platform, platformUserId);
      const emailUpdate: Record<string, any> = {
        lastActivePlatform: platform,
        lastActiveAt: new Date(),
        displayName: input.name || phoneMatch.displayName,
        city: input.city || phoneMatch.city,
        updatedAt: new Date(),
      };
      if (normEmail && !phoneMatch.normalizedEmail) {
        const emailConflict = await findProfileByEmail(businessAccountId, normEmail);
        if (emailConflict && emailConflict.id !== phoneMatch.id) {
          await upsertIdentity(phoneMatch.id, businessAccountId, platform, platformUserId);
          return await mergeProfiles(businessAccountId, phoneMatch.id, emailConflict.id, "phone_email_cross_match");
        }
        emailUpdate.normalizedEmail = normEmail;
      }
      await db
        .update(customerProfiles)
        .set(emailUpdate)
        .where(
          and(
            eq(customerProfiles.id, phoneMatch.id),
            eq(customerProfiles.businessAccountId, businessAccountId)
          )
        );
      const updated = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.id, phoneMatch.id))
        .limit(1);
      return updated[0];
    }
  }

  if (normEmail) {
    const emailMatch = await findProfileByEmail(businessAccountId, normEmail);
    if (emailMatch) {
      await upsertIdentity(emailMatch.id, businessAccountId, platform, platformUserId);
      const phoneUpdate: Record<string, any> = {
        lastActivePlatform: platform,
        lastActiveAt: new Date(),
        displayName: input.name || emailMatch.displayName,
        city: input.city || emailMatch.city,
        updatedAt: new Date(),
      };
      if (normPhone && !emailMatch.normalizedPhone) {
        phoneUpdate.normalizedPhone = normPhone;
      }
      await db
        .update(customerProfiles)
        .set(phoneUpdate)
        .where(
          and(
            eq(customerProfiles.id, emailMatch.id),
            eq(customerProfiles.businessAccountId, businessAccountId)
          )
        );
      const updated = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.id, emailMatch.id))
        .limit(1);
      return updated[0];
    }
  }

  const [newProfile] = await db
    .insert(customerProfiles)
    .values({
      businessAccountId,
      normalizedPhone: normPhone,
      normalizedEmail: normEmail,
      displayName: input.name || null,
      city: input.city || null,
      firstSeenPlatform: platform,
      lastActivePlatform: platform,
      lastActiveAt: new Date(),
    })
    .returning();

  await upsertIdentity(newProfile.id, businessAccountId, platform, platformUserId);

  return newProfile;
}

async function findProfileByPhone(businessAccountId: string, normalizedPhone: string) {
  const results = await db
    .select()
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.businessAccountId, businessAccountId),
        eq(customerProfiles.normalizedPhone, normalizedPhone)
      )
    )
    .limit(1);
  return results[0] || null;
}

async function findProfileByEmail(businessAccountId: string, normalizedEmail: string) {
  const results = await db
    .select()
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.businessAccountId, businessAccountId),
        eq(customerProfiles.normalizedEmail, normalizedEmail)
      )
    )
    .limit(1);
  return results[0] || null;
}

async function upsertIdentity(
  profileId: string,
  businessAccountId: string,
  platform: string,
  platformUserId: string
) {
  await db
    .insert(customerIdentities)
    .values({
      profileId,
      businessAccountId,
      platform,
      platformUserId,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [customerIdentities.businessAccountId, customerIdentities.platform, customerIdentities.platformUserId],
      set: {
        profileId,
        lastSeenAt: new Date(),
      },
    });
}

export async function mergeProfiles(
  businessAccountId: string,
  survivorId: string,
  mergedId: string,
  reason: string
) {
  const [mergedProfile] = await db
    .select()
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.id, mergedId),
        eq(customerProfiles.businessAccountId, businessAccountId)
      )
    )
    .limit(1);

  if (!mergedProfile) {
    const survivor = await db
      .select()
      .from(customerProfiles)
      .where(
        and(
          eq(customerProfiles.id, survivorId),
          eq(customerProfiles.businessAccountId, businessAccountId)
        )
      )
      .limit(1);
    return survivor[0];
  }

  const [survivorProfile] = await db
    .select()
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.id, survivorId),
        eq(customerProfiles.businessAccountId, businessAccountId)
      )
    )
    .limit(1);

  if (!survivorProfile) {
    return mergedProfile;
  }

  const mergedIdentities = await db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.profileId, mergedId),
        eq(customerIdentities.businessAccountId, businessAccountId)
      )
    );

  const mergedSnapshots = await db
    .select()
    .from(customerMemorySnapshots)
    .where(
      and(
        eq(customerMemorySnapshots.profileId, mergedId),
        eq(customerMemorySnapshots.businessAccountId, businessAccountId)
      )
    );

  return await db.transaction(async (tx) => {
    await tx.insert(customerMergeAudit).values({
      businessAccountId,
      survivorProfileId: survivorId,
      mergedProfileId: mergedId,
      mergeReason: reason,
      mergedData: {
        profile: mergedProfile,
        identities: mergedIdentities,
        snapshots: mergedSnapshots,
      },
    });

    await tx
      .update(customerIdentities)
      .set({ profileId: survivorId })
      .where(
        and(
          eq(customerIdentities.profileId, mergedId),
          eq(customerIdentities.businessAccountId, businessAccountId)
        )
      );

    for (const snapshot of mergedSnapshots) {
      const existing = await tx
        .select()
        .from(customerMemorySnapshots)
        .where(
          and(
            eq(customerMemorySnapshots.profileId, survivorId),
            eq(customerMemorySnapshots.platform, snapshot.platform)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await tx
          .update(customerMemorySnapshots)
          .set({ profileId: survivorId })
          .where(eq(customerMemorySnapshots.id, snapshot.id));
      }
    }

    await tx
      .delete(customerMemorySnapshots)
      .where(
        and(
          eq(customerMemorySnapshots.profileId, mergedId),
          eq(customerMemorySnapshots.businessAccountId, businessAccountId)
        )
      );

    await tx
      .delete(customerProfiles)
      .where(
        and(
          eq(customerProfiles.id, mergedId),
          eq(customerProfiles.businessAccountId, businessAccountId)
        )
      );

    await tx
      .update(customerProfiles)
      .set({
        normalizedPhone: survivorProfile.normalizedPhone || mergedProfile.normalizedPhone,
        normalizedEmail: survivorProfile.normalizedEmail || mergedProfile.normalizedEmail,
        displayName: survivorProfile.displayName || mergedProfile.displayName,
        city: survivorProfile.city || mergedProfile.city,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerProfiles.id, survivorId),
          eq(customerProfiles.businessAccountId, businessAccountId)
        )
      );

    const [result] = await tx
      .select()
      .from(customerProfiles)
      .where(
        and(
          eq(customerProfiles.id, survivorId),
          eq(customerProfiles.businessAccountId, businessAccountId)
        )
      )
      .limit(1);

    return result;
  });
}

export async function getProfileByPlatformId(
  businessAccountId: string,
  platform: string,
  platformUserId: string
) {
  const identity = await db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.businessAccountId, businessAccountId),
        eq(customerIdentities.platform, platform),
        eq(customerIdentities.platformUserId, platformUserId)
      )
    )
    .limit(1);

  if (identity.length === 0) return null;

  const profile = await db
    .select()
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.id, identity[0].profileId),
        eq(customerProfiles.businessAccountId, businessAccountId)
      )
    )
    .limit(1);

  return profile[0] || null;
}

export async function getIdentitiesForProfile(profileId: string, businessAccountId?: string) {
  if (businessAccountId) {
    return db
      .select()
      .from(customerIdentities)
      .where(
        and(
          eq(customerIdentities.profileId, profileId),
          eq(customerIdentities.businessAccountId, businessAccountId)
        )
      );
  }
  return db
    .select()
    .from(customerIdentities)
    .where(eq(customerIdentities.profileId, profileId));
}
