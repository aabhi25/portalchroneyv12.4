import OpenAI from "openai";
import { storage } from "../storage";
import { Message } from "@shared/schema";

export async function extractTopicsOfInterest(
  conversationId: string,
  businessAccountId: string
): Promise<string[]> {
  try {
    // Get API key from business account or fallback to environment variable
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    const apiKey = businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.log('[Topic Extraction] No OpenAI API key available, skipping topic extraction');
      return [];
    }
    
    const openai = new OpenAI({ apiKey });
    const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
    
    if (!messages || messages.length === 0) {
      console.log('[Topic Extraction] No messages found for conversation');
      return [];
    }

    const conversationText = messages
      .filter((m: Message) => m.role === 'user')
      .map((m: Message) => m.content)
      .join('\n');

    if (!conversationText.trim()) {
      console.log('[Topic Extraction] No user messages to analyze');
      return [];
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a topic extraction assistant. Analyze the customer's messages and extract 2-4 short topic labels that summarize their main interests or concerns.

Rules:
- Each topic should be 1-3 words maximum
- Topics should be specific and actionable (e.g., "Diamond Pricing", "Wedding Rings", "EMI Options", "KYC Help")
- Focus on what the customer is interested in or asking about
- Return only the topic labels, no explanations
- If customer just provided contact info or casual greetings, return empty array
- Maximum 4 topics

Output format: Return a JSON array of strings, e.g.: ["Topic 1", "Topic 2", "Topic 3"]`
        },
        {
          role: "user",
          content: `Extract topic labels from this customer conversation:\n\n${conversationText.slice(0, 2000)}`
        }
      ],
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log('[Topic Extraction] No response from AI');
      return [];
    }

    try {
      const parsed = JSON.parse(content);
      const topics = Array.isArray(parsed) ? parsed : parsed.topics || [];
      
      const validTopics = topics
        .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
        .slice(0, 4)
        .map((t: string) => t.trim());
      
      console.log(`[Topic Extraction] Extracted ${validTopics.length} topics:`, validTopics);
      return validTopics;
    } catch (parseError) {
      console.error('[Topic Extraction] Failed to parse AI response:', content);
      return [];
    }
  } catch (error) {
    console.error('[Topic Extraction] Error:', error);
    return [];
  }
}

export async function updateLeadWithTopics(
  leadId: string,
  businessAccountId: string,
  conversationId: string
): Promise<void> {
  try {
    const topics = await extractTopicsOfInterest(conversationId, businessAccountId);
    
    if (topics.length > 0) {
      await storage.updateLead(leadId, businessAccountId, {
        topicsOfInterest: topics
      });
      console.log(`[Topic Extraction] Updated lead ${leadId} with topics:`, topics);
    }
  } catch (error) {
    console.error('[Topic Extraction] Error updating lead:', error);
  }
}
