import OpenAI from "openai";
import { storage } from "../storage";
import { aiUsageLogger } from "./aiUsageLogger";

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SmartNudgeContext {
  businessAccountId: string;
  conversationHistory: ConversationMessage[];
  productsViewed?: string[];
  discountAvailable?: boolean;
  discountMessage?: string;
}

interface SmartNudgeResult {
  nudgeMessage: string;
  includesDiscount: boolean;
  context: {
    lastTopic: string;
    detectedIntent: string;
  };
}

export class SmartNudgeService {
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    if (!businessAccount?.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    return new OpenAI({ apiKey: businessAccount.openaiApiKey });
  }

  async generateSmartNudge(context: SmartNudgeContext): Promise<SmartNudgeResult> {
    const { businessAccountId, conversationHistory, productsViewed, discountAvailable, discountMessage } = context;

    if (!conversationHistory || conversationHistory.length === 0) {
      return {
        nudgeMessage: "Still there? Let me know if you have any questions!",
        includesDiscount: false,
        context: { lastTopic: "general", detectedIntent: "unknown" }
      };
    }

    const lastMessages = conversationHistory.slice(-6);
    const lastUserMessage = [...lastMessages].reverse().find(m => m.role === 'user');
    const lastAIMessage = [...lastMessages].reverse().find(m => m.role === 'assistant');

    try {
      const openai = await this.getOpenAIClient(businessAccountId);

      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      const businessName = businessAccount?.name || "our business";

      const systemPrompt = `You are a helpful sales assistant for ${businessName}. The visitor has gone quiet after a conversation. Your task is to generate a short, engaging follow-up question to re-engage them.

RULES:
1. Keep it SHORT - max 2 sentences
2. Be conversational and friendly, not pushy
3. Reference what they were discussing if possible
4. Ask an open-ended question to encourage response
5. If they were asking about products/services, offer to help further
6. Do NOT be generic - make it specific to their conversation
${discountAvailable && discountMessage ? `7. If appropriate, mention: "${discountMessage}"` : ''}

Examples of GOOD nudges:
- "Would you like me to compare those two options for you?"
- "I can show you our most popular choices if that helps?"
- "Any other questions about the features I mentioned?"

Examples of BAD nudges (too generic):
- "Still there?"
- "Can I help you with anything?"
- "Hello?"`; 

      const userPrompt = `Here's the recent conversation:

${lastMessages.map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`).join('\n\n')}

${productsViewed && productsViewed.length > 0 ? `Products they viewed: ${productsViewed.join(', ')}` : ''}
${discountAvailable ? 'Note: They qualify for a special discount.' : ''}

Generate a contextual follow-up question to re-engage this visitor. Return ONLY the message text, nothing else.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      aiUsageLogger.logUsage({
        businessAccountId,
        category: 'chat',
        model: 'gpt-4o-mini',
        tokensInput: response.usage?.prompt_tokens || 0,
        tokensOutput: response.usage?.completion_tokens || 0,
        metadata: { type: 'smart_nudge' }
      }).catch(err => console.error('[SmartNudge] Usage logging failed:', err));

      const nudgeMessage = response.choices[0]?.message?.content?.trim() || 
        "Would you like me to help you with anything else?";

      const lastTopic = this.extractTopic(lastUserMessage?.content || "");
      const detectedIntent = this.detectIntent(lastMessages);

      console.log(`[SmartNudge] Generated: "${nudgeMessage.slice(0, 50)}..." (topic: ${lastTopic}, intent: ${detectedIntent})`);

      return {
        nudgeMessage,
        includesDiscount: Boolean(discountAvailable && nudgeMessage.toLowerCase().includes('discount')),
        context: { lastTopic, detectedIntent }
      };

    } catch (error: any) {
      console.error('[SmartNudge] Generation failed:', error.message);
      return {
        nudgeMessage: "Still interested? I'm here if you have any more questions!",
        includesDiscount: false,
        context: { lastTopic: "unknown", detectedIntent: "unknown" }
      };
    }
  }

  private extractTopic(message: string): string {
    const lowered = message.toLowerCase();
    
    if (lowered.match(/price|cost|pay|afford|budget|expensive|cheap/)) return "pricing";
    if (lowered.match(/product|item|buy|purchase|order/)) return "products";
    if (lowered.match(/deliver|ship|when.*arrive|how long/)) return "delivery";
    if (lowered.match(/return|refund|exchange|cancel/)) return "returns";
    if (lowered.match(/compare|difference|better|vs|versus/)) return "comparison";
    if (lowered.match(/feature|spec|detail|how.*work/)) return "features";
    if (lowered.match(/help|support|issue|problem/)) return "support";
    
    return "general";
  }

  private detectIntent(messages: ConversationMessage[]): string {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
    const combined = userMessages.join(' ');

    if (combined.match(/buy|purchase|order|checkout|add to cart/)) return "purchase";
    if (combined.match(/price|cost|how much|afford/)) return "price-check";
    if (combined.match(/compare|difference|which.*better|vs/)) return "comparing";
    if (combined.match(/browse|show|what.*have|options/)) return "browsing";
    if (combined.match(/help|issue|problem|not working/)) return "support";
    
    return "exploring";
  }
}

export const smartNudgeService = new SmartNudgeService();
