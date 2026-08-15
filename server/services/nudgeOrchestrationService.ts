import { db } from "../db";
import { discountRules, discountOffers, intentScores, type DiscountRule } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getIntentScore } from "./intentScoringService";

export interface DiscountNudge {
  offerId: string;
  discountCode: string;
  discountPercentage: number;
  message: string;
  expiresAt: Date | null;
  productId?: string;
}

function generateDiscountCode(businessId: string): string {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  return `DISC${timestamp}${randomPart}`;
}

function buildNudgeMessage(template: string | null, discount: number, expiresAt: Date | null): string {
  if (template) {
    return template
      .replace('{discount}', discount.toString())
      .replace('{expiry}', expiresAt ? expiresAt.toLocaleString() : 'limited time');
  }
  
  const defaultMessage = expiresAt
    ? `Great news! You've unlocked a ${discount}% discount. Use your code at checkout before ${expiresAt.toLocaleTimeString()}!`
    : `Congratulations! You've earned a special ${discount}% discount. Apply your code at checkout!`;
  
  return defaultMessage;
}

export async function checkDiscountEligibility(
  businessAccountId: string,
  visitorSessionId: string,
  productId?: string
): Promise<DiscountNudge | null> {
  try {
    const currentScore = await getIntentScore(businessAccountId, visitorSessionId, productId);
    
    if (!currentScore) {
      return null;
    }

    const score = parseFloat(currentScore.score);

    // Fetch product-specific and site-wide rules
    const productRules: DiscountRule[] = productId
      ? await db.query.discountRules.findMany({
          where: and(
            eq(discountRules.businessAccountId, businessAccountId),
            eq(discountRules.productId, productId),
            eq(discountRules.isActive, true)
          ),
          orderBy: [desc(discountRules.intentThreshold)]
        })
      : [];

    const siteWideRules: DiscountRule[] = await db.query.discountRules.findMany({
      where: and(
        eq(discountRules.businessAccountId, businessAccountId),
        sql`${discountRules.productId} IS NULL`,
        eq(discountRules.isActive, true)
      ),
      orderBy: [desc(discountRules.intentThreshold)]
    });

    // Try product-specific rules first, then fall back to site-wide
    const allRuleSets = [productRules, siteWideRules];

    for (const rules of allRuleSets) {
      if (rules.length === 0) continue;

      for (const rule of rules) {
      const threshold = rule.intentThreshold;
      
      if (score < threshold) {
        continue;
      }

      const maxUses = rule.maxUsesPerVisitor || 1;
      const existingOffers = await db.query.discountOffers.findMany({
        where: and(
          eq(discountOffers.businessAccountId, businessAccountId),
          eq(discountOffers.visitorSessionId, visitorSessionId),
          eq(discountOffers.discountRuleId, rule.id)
        )
      });

      if (existingOffers.length >= maxUses) {
        console.log(`[Nudge Orchestration] Max uses (${maxUses}) reached for rule ${rule.id}`);
        continue;
      }

      if (rule.cooldownMinutes && existingOffers.length > 0) {
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        const lastOffer = existingOffers.sort((a, b) => 
          new Date(b.offeredAt).getTime() - new Date(a.offeredAt).getTime()
        )[0];
        const timeSinceLastOffer = Date.now() - new Date(lastOffer.offeredAt).getTime();
        
        if (timeSinceLastOffer < cooldownMs) {
          console.log(`[Nudge Orchestration] Cooldown active for rule ${rule.id}`);
          continue;
        }
      }

      const discountCode = generateDiscountCode(businessAccountId);
      const expiresAt = rule.expiryMinutes 
        ? new Date(Date.now() + rule.expiryMinutes * 60 * 1000)
        : null;

      const [offer] = await db.insert(discountOffers).values({
        businessAccountId,
        visitorSessionId,
        discountRuleId: rule.id,
        discountCode,
        discountPercentage: rule.discountPercentage.toString(),
        intentScore: score.toString(),
        expiresAt,
        redeemed: false
      }).returning();

      const message = buildNudgeMessage(
        rule.discountMessage, 
        rule.discountPercentage, 
        expiresAt
      );

      console.log(`[Nudge Orchestration] Created offer ${offer.id} for session ${visitorSessionId}`);

      return {
        offerId: offer.id,
        discountCode,
        discountPercentage: rule.discountPercentage,
        message,
        expiresAt,
        productId: rule.productId || undefined
      };
      }
    }

    return null;
  } catch (error) {
    console.error('[Nudge Orchestration] Error checking eligibility:', error);
    return null;
  }
}

export async function redeemDiscount(
  offerId: string,
  businessAccountId: string
): Promise<boolean> {
  try {
    const [offer] = await db.query.discountOffers.findMany({
      where: and(
        eq(discountOffers.id, offerId),
        eq(discountOffers.businessAccountId, businessAccountId)
      )
    });

    if (!offer) {
      return false;
    }

    if (offer.redeemed) {
      return false;
    }

    if (offer.expiresAt && new Date(offer.expiresAt) < new Date()) {
      return false;
    }

    await db.update(discountOffers)
      .set({
        redeemed: true,
        redeemedAt: new Date()
      })
      .where(eq(discountOffers.id, offerId));

    console.log(`[Nudge Orchestration] Redeemed offer ${offerId}`);
    return true;
  } catch (error) {
    console.error('[Nudge Orchestration] Error redeeming discount:', error);
    return false;
  }
}

export async function getActiveOffer(
  businessAccountId: string,
  visitorSessionId: string
): Promise<DiscountNudge | null> {
  try {
    const offers = await db.query.discountOffers.findMany({
      where: and(
        eq(discountOffers.businessAccountId, businessAccountId),
        eq(discountOffers.visitorSessionId, visitorSessionId),
        eq(discountOffers.redeemed, false)
      ),
      orderBy: [desc(discountOffers.offeredAt)]
    });

    const activeOffers = offers.filter(offer => {
      if (offer.expiresAt && new Date(offer.expiresAt) < new Date()) {
        return false;
      }
      return true;
    });

    if (activeOffers.length === 0) {
      return null;
    }

    const offer = activeOffers[0];
    const rule = await db.query.discountRules.findFirst({
      where: eq(discountRules.id, offer.discountRuleId)
    });

    if (!rule) {
      return null;
    }

    const message = buildNudgeMessage(
      rule.discountMessage,
      parseFloat(offer.discountPercentage),
      offer.expiresAt
    );

    return {
      offerId: offer.id,
      discountCode: offer.discountCode,
      discountPercentage: parseFloat(offer.discountPercentage),
      message,
      expiresAt: offer.expiresAt,
      productId: rule.productId || undefined
    };
  } catch (error) {
    console.error('[Nudge Orchestration] Error getting active offer:', error);
    return null;
  }
}
