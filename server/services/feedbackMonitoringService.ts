import { storage } from '../storage';
import { autoEscalationService } from './autoEscalationService';
import { aiLearningService } from './aiLearningService';

/**
 * Post-Resolution Feedback Monitoring Service
 * Monitors customer responses after AI auto-resolution to detect satisfaction or dissatisfaction
 */
class FeedbackMonitoringService {
  
  /**
   * Analyze customer message after AI auto-resolution to detect satisfaction
   * Returns true if customer is satisfied, false if dissatisfied, null if neutral
   */
  analyzeFeedback(message: string): { isSatisfied: boolean | null; reason: string } {
    const lowerMessage = message.toLowerCase().trim();
    
    // Positive feedback indicators
    const positivePatterns = [
      /thank/i,
      /thanks/i,
      /great/i,
      /perfect/i,
      /helpful/i,
      /appreciate/i,
      /awesome/i,
      /excellent/i,
      /good/i,
      /solved/i,
      /fixed/i,
      /works/i,
      /^ok$/i,
      /^okay$/i,
      /got it/i,
      /understood/i,
    ];

    // Negative feedback indicators
    const negativePatterns = [
      /doesn't work/i,
      /not working/i,
      /didn't help/i,
      /still (have|got|experiencing)/i,
      /that's wrong/i,
      /incorrect/i,
      /doesn't make sense/i,
      /confused/i,
      /speak to (a )?human/i,
      /talk to (a )?person/i,
      /representative/i,
      /supervisor/i,
      /manager/i,
      /not satisfied/i,
      /unhappy/i,
      /frustrated/i,
      /angry/i,
      /terrible/i,
      /awful/i,
      /useless/i,
    ];

    // Check for positive feedback
    for (const pattern of positivePatterns) {
      if (pattern.test(lowerMessage)) {
        return { isSatisfied: true, reason: 'Positive feedback detected' };
      }
    }

    // Check for negative feedback
    for (const pattern of negativePatterns) {
      if (pattern.test(lowerMessage)) {
        return { isSatisfied: false, reason: 'Negative feedback or escalation request detected' };
      }
    }

    // Neutral - just a follow-up question or continuation
    if (lowerMessage.includes('?') || lowerMessage.split(' ').length > 5) {
      return { isSatisfied: null, reason: 'Follow-up question or neutral message' };
    }

    return { isSatisfied: null, reason: 'Unclear feedback' };
  }

  /**
   * Monitor post-resolution feedback from customer
   * Called when customer sends a message after AI auto-resolved their ticket
   */
  async monitorPostResolutionFeedback(
    businessAccountId: string,
    conversationId: string,
    customerMessage: string
  ): Promise<void> {
    try {
      // Find any recently auto-resolved tickets for this conversation
      const allTickets = await storage.getAllSupportTickets(businessAccountId);
      const recentlyResolvedTicket = allTickets.find((t: any) => 
        t.conversationId === conversationId &&
        t.autoResolved === 'true' &&
        t.status === 'resolved' &&
        // Only check tickets resolved in last 24 hours
        t.resolvedAt && new Date(t.resolvedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
      );

      if (!recentlyResolvedTicket) {
        return; // No recent auto-resolved ticket to monitor
      }

      // Analyze the feedback
      const feedback = this.analyzeFeedback(customerMessage);
      
      console.log(`[FeedbackMonitor] Post-resolution feedback for ticket ${recentlyResolvedTicket.id}:`, feedback);

      // Store feedback in ticket
      await storage.updateSupportTicket(
        recentlyResolvedTicket.id,
        businessAccountId,
        { customerFeedback: feedback.isSatisfied === null ? 'neutral' : feedback.isSatisfied ? 'positive' : 'negative' }
      );

      // If negative feedback, reopen ticket and escalate to human
      if (feedback.isSatisfied === false) {
        console.log(`[FeedbackMonitor] Negative feedback detected - reopening ticket and escalating to human`);
        
        // Reopen the ticket
        await storage.reopenTicket(recentlyResolvedTicket.id, businessAccountId);
        
        // Update with high priority
        await storage.updateSupportTicket(
          recentlyResolvedTicket.id,
          businessAccountId,
          {
            priority: 'high',
            autoResolved: 'false', // Mark as NOT auto-resolved since it failed
            description: `${recentlyResolvedTicket.description}\n\n[Escalation] Customer dissatisfied with AI resolution: "${feedback.reason}". Original message: "${customerMessage}"`
          }
        );

        // Add internal note about the escalation
        await storage.createTicketMessage({
          ticketId: recentlyResolvedTicket.id,
          senderName: 'System',
          senderType: 'agent',
          message: `⚠️ AI auto-resolution failed. Customer expressed dissatisfaction: "${customerMessage}". Ticket reopened and escalated to human agent.`,
          messageType: 'text',
          isInternal: 'true',
          aiDrafted: 'false'
        });
      } else if (feedback.isSatisfied === true) {
        console.log(`[FeedbackMonitor] ✓ Positive feedback - AI resolution successful`);
        
        // Mark as confirmed successful
        await storage.updateSupportTicket(
          recentlyResolvedTicket.id,
          businessAccountId,
          { status: 'closed' }
        );

        // AI Learning: Store successful resolution pattern
        const autoResolvedResponse = await autoEscalationService.getAutoResolvedResponse(
          recentlyResolvedTicket.id,
          businessAccountId
        );
        
        if (autoResolvedResponse) {
          await aiLearningService.learnFromSuccessfulAutoResolution(
            businessAccountId,
            recentlyResolvedTicket.id,
            recentlyResolvedTicket.subject,
            autoResolvedResponse
          );
        }
      }

      // If negative feedback, also trigger AI learning
      if (feedback.isSatisfied === false) {
        const autoResolvedResponse = await autoEscalationService.getAutoResolvedResponse(
          recentlyResolvedTicket.id,
          businessAccountId
        );
        
        if (autoResolvedResponse) {
          await aiLearningService.learnFromFailedAutoResolution(
            businessAccountId,
            recentlyResolvedTicket.id,
            recentlyResolvedTicket.subject,
            autoResolvedResponse,
            customerMessage
          );
        }
      }
    } catch (error) {
      console.error('[FeedbackMonitor] Error monitoring post-resolution feedback:', error);
      // Don't fail the chat if feedback monitoring fails
    }
  }
}

export const feedbackMonitoringService = new FeedbackMonitoringService();
