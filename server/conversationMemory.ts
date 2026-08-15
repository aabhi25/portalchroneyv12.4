interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UserConversation {
  messages: ConversationMessage[];
  lastActivity: Date;
}

export class ConversationMemoryService {
  private conversations: Map<string, UserConversation> = new Map();
  private messageCounters: Map<string, number> = new Map();
  private readonly RETENTION_MINUTES = 15;
  private readonly CLEANUP_FREQUENCY = 10; // Run cleanup every 10th message

  storeMessage(userId: string, role: 'user' | 'assistant', content: string) {
    const conversation = this.conversations.get(userId) || {
      messages: [],
      lastActivity: new Date()
    };

    conversation.messages.push({
      role,
      content,
      timestamp: new Date()
    });

    conversation.lastActivity = new Date();
    this.conversations.set(userId, conversation);

    // Debounced cleanup - only run every 10th message to reduce overhead
    const messageCount = (this.messageCounters.get(userId) || 0) + 1;
    this.messageCounters.set(userId, messageCount);
    
    if (messageCount % this.CLEANUP_FREQUENCY === 0) {
      this.cleanupOldMessages(userId);
    }
  }

  getConversationHistory(userId: string): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    this.cleanupExpiredConversations();
    const conversation = this.conversations.get(userId);
    
    if (!conversation) {
      return [];
    }

    return conversation.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  clearConversation(userId: string) {
    this.conversations.delete(userId);
    this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
  }

  private cleanupOldMessages(userId: string) {
    const conversation = this.conversations.get(userId);
    if (!conversation) return;

    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - this.RETENTION_MINUTES);

    conversation.messages = conversation.messages.filter(
      msg => msg.timestamp > cutoffTime
    );

    if (conversation.messages.length === 0) {
      this.conversations.delete(userId);
      this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
    }
  }

  private cleanupExpiredConversations() {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - this.RETENTION_MINUTES);

    Array.from(this.conversations.entries()).forEach(([userId, conversation]) => {
      if (conversation.lastActivity < cutoffTime) {
        this.conversations.delete(userId);
        this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
      }
    });
  }
}

export const conversationMemory = new ConversationMemoryService();
