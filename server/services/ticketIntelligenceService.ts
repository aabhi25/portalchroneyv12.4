import OpenAI from 'openai';
import { storage } from '../storage';
import type { SupportTicket } from '@shared/schema';

interface TicketAnalysis {
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'technical' | 'billing' | 'feature_request' | 'general' | 'bug_report' | 'account' | 'product_inquiry';
  sentimentScore: number; // -1 to 1 (-1 = very negative, 0 = neutral, 1 = very positive)
  emotionalState: 'happy' | 'neutral' | 'frustrated' | 'angry';
  churnRisk: 'low' | 'medium' | 'high';
  summary: string;
  suggestedActions: string[];
  requiresImmediate: boolean;
  keyIssues: string[];
}

interface AutoResolutionAttempt {
  canResolve: boolean;
  confidence: number; // 0-1
  proposedSolution: string;
  reasoning: string;
  requiresHumanReview: boolean;
  additionalQuestionsNeeded: string[];
}

export class TicketIntelligenceService {
  
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    const apiKey = businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }
    
    return new OpenAI({ apiKey });
  }

  async analyzeTicket(
    businessAccountId: string,
    ticketId: string,
    subject: string,
    description: string,
    customerEmail: string,
    conversationHistory?: Array<{ role: 'customer' | 'agent'; content: string; timestamp: Date }>
  ): Promise<TicketAnalysis> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Build context from conversation history
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = '\n\nConversation History:\n' + conversationHistory.map(msg => 
        `[${msg.timestamp.toISOString()}] ${msg.role.toUpperCase()}: ${msg.content}`
      ).join('\n');
    }

    const analysisPrompt = `You are an expert customer support analyst. Analyze the following support ticket and provide detailed insights.

Ticket Information:
Subject: ${subject}
Description: ${description}
Customer Email: ${customerEmail}${conversationContext}

Please analyze this ticket and provide the following information in JSON format:

1. priority: Classify as "low", "medium", "high", or "urgent"
   - urgent: Customer is angry, threatening to leave, or has a critical issue blocking their business
   - high: Important issue affecting customer's work but has workarounds
   - medium: Non-critical issue or general inquiry
   - low: Nice-to-have requests or low-impact issues

2. category: Classify as "technical", "billing", "feature_request", "general", "bug_report", "account", or "product_inquiry"

3. sentimentScore: Rate from -1 (very negative) to 1 (very positive)

4. emotionalState: Classify as "happy", "neutral", "frustrated", or "angry"

5. churnRisk: Assess as "low", "medium", or "high" based on:
   - Keywords like "cancel", "refund", "disappointed", "frustrated"
   - Repeated issues or escalations
   - Negative sentiment
   - Threats to leave

6. summary: Brief 1-2 sentence summary of the issue

7. suggestedActions: Array of 2-4 specific action items for the support team

8. requiresImmediate: Boolean - true if needs immediate attention (angry customer, security issue, critical bug)

9. keyIssues: Array of 2-4 core problems identified in the ticket

Respond with ONLY valid JSON matching this exact structure:
{
  "priority": "low|medium|high|urgent",
  "category": "technical|billing|feature_request|general|bug_report|account|product_inquiry",
  "sentimentScore": -1 to 1,
  "emotionalState": "happy|neutral|frustrated|angry",
  "churnRisk": "low|medium|high",
  "summary": "string",
  "suggestedActions": ["action1", "action2", ...],
  "requiresImmediate": boolean,
  "keyIssues": ["issue1", "issue2", ...]
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a customer support analyst. Always respond with valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const responseText = completion.choices[0].message.content?.trim() || '{}';
      
      // Remove markdown code blocks if present
      let jsonText = responseText;
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      const analysis: TicketAnalysis = JSON.parse(jsonText);
      
      // Store AI analysis in database
      await storage.updateTicketAIAnalysis(
        ticketId,
        JSON.stringify(analysis),
        analysis.priority,
        analysis.category,
        analysis.sentimentScore,
        analysis.emotionalState,
        analysis.churnRisk
      );
      
      return analysis;
    } catch (error: any) {
      console.error('Ticket analysis error:', error);
      
      // Return fallback analysis
      const fallbackAnalysis: TicketAnalysis = {
        priority: 'medium',
        category: 'general',
        sentimentScore: 0,
        emotionalState: 'neutral',
        churnRisk: 'low',
        summary: 'Unable to analyze ticket automatically. Manual review required.',
        suggestedActions: ['Review ticket manually', 'Contact customer within 24 hours'],
        requiresImmediate: false,
        keyIssues: ['Analysis failed - manual review needed']
      };
      
      await storage.updateTicketAIAnalysis(
        ticketId,
        JSON.stringify(fallbackAnalysis),
        fallbackAnalysis.priority,
        fallbackAnalysis.category,
        fallbackAnalysis.sentimentScore,
        fallbackAnalysis.emotionalState,
        fallbackAnalysis.churnRisk
      );
      
      return fallbackAnalysis;
    }
  }

  async attemptAutoResolution(
    businessAccountId: string,
    ticketId: string,
    subject: string,
    description: string,
    customerContext?: {
      previousTickets?: number;
      accountAge?: string;
      productsPurchased?: string[];
    }
  ): Promise<AutoResolutionAttempt> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Get business context (products, FAQs) for better resolution
    const [products, faqs, businessAccount] = await Promise.all([
      storage.getAllProducts(businessAccountId),
      storage.getAllFaqs(businessAccountId),
      storage.getBusinessAccount(businessAccountId)
    ]);

    const contextInfo = {
      business: {
        name: businessAccount?.name || 'Our Business',
        description: businessAccount?.description || '',
        products: products.slice(0, 10).map(p => ({ name: p.name, description: p.description })),
        faqs: faqs.slice(0, 15).map(f => ({ question: f.question, answer: f.answer }))
      },
      customer: customerContext || {}
    };

    const resolutionPrompt = `You are an AI customer support agent attempting to resolve a support ticket automatically.

Ticket Information:
Subject: ${subject}
Description: ${description}

Business Context:
${JSON.stringify(contextInfo, null, 2)}

Your task is to determine if this ticket can be resolved automatically and propose a solution.

Consider the following:
1. Can this be answered using the FAQ knowledge base?
2. Is this a simple how-to question?
3. Is this a product inquiry that can be answered with product information?
4. Or does this require human intervention (account changes, billing issues, complex technical problems)?

Respond with ONLY valid JSON matching this structure:
{
  "canResolve": boolean,
  "confidence": 0.0 to 1.0,
  "proposedSolution": "detailed solution text that will be sent to the customer",
  "reasoning": "internal explanation of why this can/cannot be auto-resolved",
  "requiresHumanReview": boolean,
  "additionalQuestionsNeeded": ["question1 if more info needed", ...]
}

Guidelines for proposedSolution:
- Be friendly, helpful, and professional
- Include specific steps if it's a how-to question
- Reference relevant products or FAQs when applicable
- If you need more information, ask clear questions
- Set canResolve=false if the issue requires account access, billing changes, or is too complex`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI customer support agent. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: resolutionPrompt
          }
        ],
        temperature: 0.5,
        max_tokens: 1500
      });

      const responseText = completion.choices[0].message.content?.trim() || '{}';
      
      // Remove markdown code blocks if present
      let jsonText = responseText;
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      const resolution: AutoResolutionAttempt = JSON.parse(jsonText);
      
      return resolution;
    } catch (error: any) {
      console.error('Auto-resolution attempt error:', error);
      
      // Return conservative fallback
      return {
        canResolve: false,
        confidence: 0,
        proposedSolution: '',
        reasoning: 'Auto-resolution failed - requires human agent',
        requiresHumanReview: true,
        additionalQuestionsNeeded: []
      };
    }
  }

  async generateAIDraftResponse(
    businessAccountId: string,
    ticketId: string,
    ticketSubject: string,
    ticketDescription: string,
    conversationHistory: Array<{ role: 'customer' | 'agent'; content: string }>
  ): Promise<string> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Get ticket analysis for context
    const ticket = await storage.getSupportTicket(ticketId, businessAccountId);
    const analysis = ticket?.aiAnalysis ? JSON.parse(ticket.aiAnalysis) as TicketAnalysis : null;
    
    // Get business context
    const [products, faqs, businessAccount] = await Promise.all([
      storage.getAllProducts(businessAccountId),
      storage.getAllFaqs(businessAccountId),
      storage.getBusinessAccount(businessAccountId)
    ]);

    const conversationContext = conversationHistory.map(msg => 
      `${msg.role.toUpperCase()}: ${msg.content}`
    ).join('\n\n');

    const draftPrompt = `You are drafting a response for a customer support agent to review and send.

Ticket Subject: ${ticketSubject}
Original Issue: ${ticketDescription}

Conversation So Far:
${conversationContext}

Business Context:
- Business: ${businessAccount?.name || 'Our Business'}
- Description: ${businessAccount?.description || ''}
${analysis ? `\nTicket Analysis:
- Priority: ${analysis.priority}
- Category: ${analysis.category}
- Emotional State: ${analysis.emotionalState}
- Key Issues: ${analysis.keyIssues.join(', ')}` : ''}

Available Products: ${products.slice(0, 5).map(p => p.name).join(', ')}
FAQ Topics Available: ${faqs.slice(0, 8).map(f => f.question).join(', ')}

Draft a professional, empathetic response that:
1. Acknowledges the customer's issue
2. Provides a helpful solution or next steps
3. Matches the tone to the customer's emotional state (be more empathetic if they're frustrated/angry)
4. Is concise but thorough
5. Includes specific action items or timeline if applicable
6. Ends with an offer for further assistance

Write ONLY the draft response text (no JSON, no labels):`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional customer support agent. Write clear, empathetic responses that solve customer problems.'
          },
          {
            role: 'user',
            content: draftPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 800
      });

      return completion.choices[0].message.content?.trim() || 'Unable to generate draft response. Please compose manually.';
    } catch (error: any) {
      console.error('Draft response generation error:', error);
      return 'AI draft generation failed. Please compose your response manually.';
    }
  }

  async detectChurnRiskFromConversation(
    businessAccountId: string,
    conversationId: string,
    customerEmail: string
  ): Promise<{
    risk: 'low' | 'medium' | 'high';
    confidence: number;
    indicators: string[];
    recommendedActions: string[];
  }> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Get conversation messages
    const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
    
    const conversationText = messages.map(msg => 
      `${msg.role === 'user' ? 'CUSTOMER' : 'AI'}: ${msg.content}`
    ).join('\n');

    const churnPrompt = `Analyze this customer conversation for churn risk (likelihood they will cancel/leave).

Conversation:
${conversationText}

Look for indicators like:
- Cancellation intent ("cancel", "refund", "disappointed")
- Repeated frustration or unresolved issues
- Comparison to competitors
- Time/money complaints
- Negative sentiment patterns
- Threats to leave
- Requests for manager/escalation

Respond with ONLY valid JSON:
{
  "risk": "low|medium|high",
  "confidence": 0.0 to 1.0,
  "indicators": ["specific phrases or patterns found"],
  "recommendedActions": ["specific retention actions to take"]
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a customer retention analyst. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: churnPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 600
      });

      const responseText = completion.choices[0].message.content?.trim() || '{}';
      let jsonText = responseText.replace(/```json\n?/, '').replace(/```\n?/, '').replace(/\n?```$/, '');
      
      return JSON.parse(jsonText);
    } catch (error: any) {
      console.error('Churn detection error:', error);
      return {
        risk: 'low',
        confidence: 0,
        indicators: [],
        recommendedActions: ['Review conversation manually for retention opportunities']
      };
    }
  }

  async suggestFAQFromTickets(
    businessAccountId: string,
    ticketIds: string[]
  ): Promise<Array<{ question: string; answer: string; reasoning: string; frequency: number }>> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Get tickets
    const ticketsData = await Promise.all(
      ticketIds.map(id => storage.getSupportTicket(id, businessAccountId))
    );
    const tickets = ticketsData.filter(t => t !== undefined);

    if (tickets.length === 0) {
      return [];
    }

    const ticketSummaries = tickets.map(t => ({
      subject: t.subject,
      category: t.category,
      resolution: t.autoResolutionSummary || 'Human resolved'
    }));

    const faqPrompt = `Analyze these resolved support tickets and suggest new FAQ entries that could prevent similar tickets.

Resolved Tickets:
${JSON.stringify(ticketSummaries, null, 2)}

Identify common patterns and suggest 2-4 FAQ entries that would help customers find answers without creating tickets.

Respond with ONLY valid JSON array:
[
  {
    "question": "clear, customer-facing question",
    "answer": "helpful, detailed answer",
    "reasoning": "why this FAQ would be valuable",
    "frequency": number of similar tickets (estimate)
  }
]`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a knowledge base curator. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: faqPrompt
          }
        ],
        temperature: 0.6,
        max_tokens: 1200
      });

      const responseText = completion.choices[0].message.content?.trim() || '[]';
      let jsonText = responseText.replace(/```json\n?/, '').replace(/```\n?/, '').replace(/\n?```$/, '');
      
      return JSON.parse(jsonText);
    } catch (error: any) {
      console.error('FAQ suggestion error:', error);
      return [];
    }
  }
}

export const ticketIntelligenceService = new TicketIntelligenceService();
