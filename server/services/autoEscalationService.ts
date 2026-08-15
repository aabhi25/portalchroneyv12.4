import OpenAI from 'openai';
import { storage } from '../storage';
import { ticketIntelligenceService } from './ticketIntelligenceService';

interface EscalationAnalysis {
  shouldEscalate: boolean;
  confidence: number;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  sentiment: number;
  emotionalState: 'happy' | 'neutral' | 'frustrated' | 'angry';
  churnRisk: 'low' | 'medium' | 'high';
}

export class AutoEscalationService {
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    const apiKey = businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }
    
    return new OpenAI({ apiKey });
  }

  /**
   * Analyzes a conversation to determine if it should be escalated to a support ticket
   * This runs automatically after AI responses
   */
  async analyzeForEscalation(
    businessAccountId: string,
    conversationId: string,
    customerMessage: string,
    aiResponse: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<EscalationAnalysis> {
    const openai = await this.getOpenAIClient(businessAccountId);
    
    // Build conversation context
    const conversationContext = conversationHistory.slice(-6).map(msg => 
      `${msg.role === 'user' ? 'CUSTOMER' : 'AI'}: ${msg.content}`
    ).join('\n');

    const analysisPrompt = `You are an AI support escalation analyzer. Determine if this conversation needs to be escalated to a human support agent.

Recent Conversation:
${conversationContext}

Latest Exchange:
CUSTOMER: ${customerMessage}
AI: ${aiResponse}

ESCALATION TRIGGERS (auto-escalate if ANY detected):
1. **Frustrated/Angry Customer**: Language like "this is ridiculous", "terrible", "useless", "waste of time"
2. **Repeated Questions**: Customer asks same question 2+ times because AI didn't fully resolve it
3. **Complex Issue**: Requires account access, billing changes, refunds, cancellations, technical troubleshooting
4. **AI Confusion**: AI gave vague, uncertain, or "I don't know" type response
5. **Explicit Human Request**: "I want to speak to someone", "talk to a human", "this isn't helping"
6. **Churn Risk**: Words like "cancel", "refund", "disappointed", "switch to competitor"
7. **Urgent Problem**: "not working", "broken", "emergency", "asap", "immediately"

DO NOT ESCALATE for:
- Simple product questions successfully answered
- General browsing/exploring
- Small talk or greetings
- Successfully completed bookings/lead captures
- Questions fully answered by AI

Respond with ONLY valid JSON:
{
  "shouldEscalate": boolean,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation why escalate or not",
  "priority": "low|medium|high|urgent",
  "sentiment": -1 to 1 (negative to positive),
  "emotionalState": "happy|neutral|frustrated|angry",
  "churnRisk": "low|medium|high"
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an AI escalation analyzer. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 400
      });

      const responseText = completion.choices[0].message.content?.trim() || '{}';
      let jsonText = responseText;
      
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      const analysis: EscalationAnalysis = JSON.parse(jsonText);
      
      console.log('[AutoEscalation] Analysis:', {
        shouldEscalate: analysis.shouldEscalate,
        confidence: analysis.confidence,
        reason: analysis.reason
      });
      
      return analysis;
    } catch (error: any) {
      console.error('[AutoEscalation] Analysis error:', error);
      
      // Conservative fallback - don't escalate unless obvious
      return {
        shouldEscalate: false,
        confidence: 0,
        reason: 'Analysis failed - no escalation',
        priority: 'medium',
        sentiment: 0,
        emotionalState: 'neutral',
        churnRisk: 'low'
      };
    }
  }

  /**
   * Automatically creates a support ticket and attempts AI auto-resolution
   * Returns the ticket ID if created, null otherwise
   */
  async autoEscalateToTicket(
    businessAccountId: string,
    conversationId: string,
    escalationAnalysis: EscalationAnalysis
  ): Promise<string | null> {
    try {
      // Get conversation details
      const conversation = await storage.getConversation(conversationId, businessAccountId);
      const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
      
      if (!conversation || messages.length === 0) {
        console.error('[AutoEscalation] No conversation found');
        return null;
      }

      // Extract customer info from conversation (try to get from lead if exists)
      const allLeads = await storage.getAllLeads(businessAccountId);
      const lead = allLeads.find(l => l.conversationId === conversationId) || null;

      const customerName = lead?.name || conversation.title || 'Unknown Customer';
      const customerEmail = lead?.email || null;
      const customerPhone = lead?.phone || null;

      // Generate ticket subject from first user message
      const firstUserMessage = messages.find(m => m.role === 'user');
      const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0];
      
      const subject = firstUserMessage?.content.substring(0, 100) || 'Customer Support Request';
      const description = lastUserMessage?.content || 'Customer needs assistance';

      // Create support ticket
      const ticket = await storage.createSupportTicket({
        businessAccountId,
        conversationId,
        customerName,
        customerEmail,
        customerPhone,
        subject,
        description,
        status: 'open',
        priority: escalationAnalysis.priority,
        category: 'general', // Will be updated by AI analysis
        aiPriority: escalationAnalysis.priority,
        sentimentScore: escalationAnalysis.sentiment.toString(),
        emotionalState: escalationAnalysis.emotionalState,
        churnRisk: escalationAnalysis.churnRisk,
        autoResolved: 'false'
      });

      console.log('[AutoEscalation] Created ticket:', ticket.ticketNumber, 'for conversation:', conversationId);

      // Immediately run AI analysis on the ticket
      await ticketIntelligenceService.analyzeTicket(
        businessAccountId,
        ticket.id,
        subject,
        description,
        customerEmail || 'Unknown',
        messages.map(m => ({
          role: m.role === 'user' ? 'customer' as const : 'agent' as const,
          content: m.content,
          timestamp: m.createdAt
        }))
      );

      // Get business account's autonomous settings
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      const autoResolutionEnabled = businessAccount?.autoResolutionEnabled !== 'false';
      const confidenceThreshold = Number(businessAccount?.autoResolutionConfidence || 75) / 100; // Convert 75 to 0.75
      const humanOnlyCategories = (businessAccount?.humanOnlyCategories || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

      // Attempt auto-resolution
      const autoResolveAttempt = await ticketIntelligenceService.attemptAutoResolution(
        businessAccountId,
        ticket.id,
        subject,
        description,
        {
          previousTickets: 0,
          accountAge: 'new',
          productsPurchased: []
        }
      );

      // Check if this category requires human-only handling
      const ticketCategory = autoResolveAttempt.category?.toLowerCase() || 'general';
      const requiresHuman = humanOnlyCategories.includes(ticketCategory);

      // If AI is confident it can resolve (configurable threshold), auto-resolve the ticket
      if (autoResolutionEnabled && !requiresHuman && autoResolveAttempt.canResolve && autoResolveAttempt.confidence >= confidenceThreshold) {
        console.log('[AutoEscalation] Auto-resolving ticket with confidence:', autoResolveAttempt.confidence);

        // Store the AI response as a message in the ticket
        await storage.createTicketMessage({
          ticketId: ticket.id,
          senderName: 'AI Assistant',
          senderType: 'agent',
          message: autoResolveAttempt.proposedSolution
        });

        // Actually close the ticket - this is what completes the auto-resolution
        await storage.resolveTicket(ticket.id, businessAccountId, true, autoResolveAttempt.proposedSolution);
        
        // Send the AI solution back to the chat conversation so customer sees it seamlessly
        await this.sendResolutionToChat(conversationId, businessAccountId, autoResolveAttempt.proposedSolution);
        
        console.log(`[AutoEscalation] ✓ Ticket ${ticket.id} auto-resolved and sent to chat (confidence: ${autoResolveAttempt.confidence}, threshold: ${confidenceThreshold})`);
        return ticket.id;
      } else {
        // Low confidence, human-only category, or auto-resolution disabled - needs human review
        const reason = !autoResolutionEnabled ? 'auto-resolution disabled' : 
                      requiresHuman ? `category '${ticketCategory}' requires human` :
                      `low confidence (${autoResolveAttempt.confidence.toFixed(2)} < ${confidenceThreshold})`;
        console.log(`[AutoEscalation] Ticket created but needs human review. Reason: ${reason}`);
        
        // Store AI draft for human to review
        await storage.updateSupportTicket(ticket.id, businessAccountId, {
          aiDraftedResponse: autoResolveAttempt.proposedSolution
        });
        
        return ticket.id;
      }
    } catch (error: any) {
      console.error('[AutoEscalation] Error creating/resolving ticket:', error);
      return null;
    }
  }

  /**
   * Get the auto-resolved response for a ticket to send back to customer
   */
  async getAutoResolvedResponse(ticketId: string, businessAccountId: string): Promise<string | null> {
    try {
      const messages = await storage.getTicketMessages(ticketId, businessAccountId);
      const aiMessage = messages.find(m => m.senderType === 'agent' && m.senderName === 'AI Assistant');
      return aiMessage?.message || null;
    } catch (error) {
      console.error('[AutoEscalation] Error getting auto-resolved response:', error);
      return null;
    }
  }

  /**
   * Send the AI resolution back to the chat conversation
   * This makes the auto-resolution seamless - customer just sees Chroney respond
   */
  private async sendResolutionToChat(
    conversationId: string,
    businessAccountId: string,
    resolutionMessage: string
  ): Promise<void> {
    try {
      // Store the AI resolution as a chat message so it appears in the conversation
      await storage.createMessage({
        conversationId,
        businessAccountId,
        role: 'assistant',
        content: resolutionMessage,
        timestamp: new Date()
      });
      
      console.log('[AutoEscalation] AI resolution sent to chat conversation');
    } catch (error) {
      console.error('[AutoEscalation] Error sending resolution to chat:', error);
      // Don't fail the whole process if chat update fails
    }
  }
}

export const autoEscalationService = new AutoEscalationService();
