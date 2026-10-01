interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UserConversation {
  messages: ConversationMessage[];
  lastActivity: Date;
}

/**
 * Short-lived, per-process chat memory keyed by the chat session's userId
 * (e.g. `widget_session_<sessionId>` — never by business alone).
 *
 * It is a cache, not the source of truth: a session idle for RETENTION_MINUTES is dropped and the
 * chat services reload the conversation from the messages table (bounded) when memory is empty,
 * belongs to a different conversation, or is behind the database (restart / another instance).
 * `bindConversation` records which DB conversation the cached messages belong to.
 */
export class ConversationMemoryService {
  private conversations: Map<string, UserConversation> = new Map();
  private messageCounters: Map<string, number> = new Map();
  /** userId → the DB conversation the cached messages belong to + visitor messages of it NOT in memory. */
  private bindings: Map<string, { conversationId: string; userOffset: number }> = new Map();
  private readonly RETENTION_MINUTES = 15;
  private readonly MAX_MESSAGES = 60; // per session; older ones are reloaded from the DB if ever needed
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

  /**
   * Remove the newest matching message. Used when a response-owned persistence
   * write loses an interruption race after the database insert completed.
   */
  removeLastMatchingMessage(userId: string, role: 'user' | 'assistant', content: string): void {
    const conversation = this.conversations.get(userId);
    if (!conversation) return;

    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const message = conversation.messages[i];
      if (message.role === role && message.content === content) {
        conversation.messages.splice(i, 1);
        conversation.lastActivity = new Date();
        if (conversation.messages.length === 0) {
          this.conversations.delete(userId);
          this.messageCounters.delete(userId);
          this.bindings.delete(userId);
        }
        return;
      }
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

  /** DB conversation id the cached messages belong to (undefined when unknown). */
  getBoundConversationId(userId: string): string | undefined {
    return this.bindings.get(userId)?.conversationId;
  }

  bindConversation(userId: string, conversationId: string): void {
    const current = this.bindings.get(userId);
    if (current?.conversationId === conversationId) return;
    this.bindings.set(userId, { conversationId, userOffset: 0 });
  }

  /**
   * Visitor messages of the bound conversation known to exist (cached + older ones not cached).
   * Compared with the database count to detect a stale cache (restart / another instance).
   */
  getKnownUserMessageCount(userId: string): number {
    const cached = (this.conversations.get(userId)?.messages || []).filter(m => m.role === 'user').length;
    return cached + (this.bindings.get(userId)?.userOffset || 0);
  }

  /**
   * Replace the session's cached messages with ones loaded from the database.
   * `totalUserMessages` = visitor messages in the whole conversation (the loaded window may hold fewer).
   */
  replaceHistory(userId: string, conversationId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, totalUserMessages?: number): void {
    const now = new Date();
    const kept = messages.slice(-this.MAX_MESSAGES);
    if (kept.length === 0) {
      this.conversations.delete(userId);
    } else {
      this.conversations.set(userId, {
        messages: kept.map(m => ({ role: m.role, content: m.content, timestamp: now })),
        lastActivity: now,
      });
    }
    const keptUsers = kept.filter(m => m.role === 'user').length;
    this.messageCounters.set(userId, kept.length);
    this.bindings.set(userId, { conversationId, userOffset: Math.max(0, (totalUserMessages ?? keptUsers) - keptUsers) });
  }

  clearConversation(userId: string) {
    this.conversations.delete(userId);
    this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
    this.bindings.delete(userId);
  }

  /**
   * Keep the session bounded. Messages of an ACTIVE session are no longer dropped by age (that
   * used to make the model forget the start of any chat longer than 15 minutes); only the count
   * is capped. Whole idle sessions still expire below.
   */
  private cleanupOldMessages(userId: string) {
    const conversation = this.conversations.get(userId);
    if (!conversation) return;

    if (conversation.messages.length > this.MAX_MESSAGES) {
      const dropped = conversation.messages.slice(0, conversation.messages.length - this.MAX_MESSAGES);
      conversation.messages = conversation.messages.slice(-this.MAX_MESSAGES);
      const binding = this.bindings.get(userId);
      if (binding) binding.userOffset += dropped.filter(m => m.role === 'user').length;
    }

    if (conversation.messages.length === 0) {
      this.conversations.delete(userId);
      this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
      this.bindings.delete(userId);
    }
  }

  private cleanupExpiredConversations() {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - this.RETENTION_MINUTES);

    Array.from(this.conversations.entries()).forEach(([userId, conversation]) => {
      if (conversation.lastActivity < cutoffTime) {
        this.conversations.delete(userId);
        this.messageCounters.delete(userId); // Clean up counter to prevent memory leaks
        this.bindings.delete(userId);
      }
    });
  }
}

export const conversationMemory = new ConversationMemoryService();
