import { db } from "../db";
import { intentScores } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface IntentScore {
  score: number;
  level: 'low' | 'medium' | 'high' | 'very_high';
  signals: {
    pageViews: number;
    productViews: number;
    scrollEvents: number;
    clicks: number;
    returnVisits: number;
    avgDwellTime: number;
  };
}

export async function getIntentScore(
  businessAccountId: string,
  visitorSessionId: string,
  productId?: string
) {
  return await db.query.intentScores.findFirst({
    where: and(
      eq(intentScores.businessAccountId, businessAccountId),
      eq(intentScores.visitorSessionId, visitorSessionId),
      productId ? eq(intentScores.productId, productId) : sql`product_id IS NULL`
    ),
    orderBy: [desc(intentScores.lastUpdated)]
  });
}

export async function shouldTriggerDiscount(
  businessAccountId: string,
  visitorSessionId: string,
  thresholdScore: number = 60
): Promise<boolean> {
  const scoreData = await getIntentScore(businessAccountId, visitorSessionId);
  
  if (!scoreData) {
    return false;
  }

  const score = parseFloat(scoreData.score);
  
  let level: 'low' | 'medium' | 'high' | 'very_high';
  if (score >= 100) {
    level = 'very_high';
  } else if (score >= 60) {
    level = 'high';
  } else if (score >= 30) {
    level = 'medium';
  } else {
    level = 'low';
  }
  
  return score >= thresholdScore && level !== 'low';
}
