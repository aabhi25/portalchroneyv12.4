import WebSocket from 'ws';
import { aiTools } from './aiTools';
import { ToolExecutionService } from './services/toolExecutionService';
import { conversationMemory } from './conversationMemory';
import { storage } from './storage';
import { businessContextCache } from './services/businessContextCache';

interface VoiceSessionConfig {
  userId: string;
  businessAccountId: string;
  personality: string;
  companyDescription: string;
  openaiApiKey?: string;
  customInstructions?: string;
}

interface VoiceChunk {
  type: 'audio' | 'transcript' | 'tool_call' | 'error' | 'session_ready';
  data: any;
}

export class VoiceService {
  private ws: WebSocket | null = null;
  private sessionConfig: VoiceSessionConfig | null = null;
  private conversationId: string | null = null;
  private activeSessionKey: string | null = null;

  /**
   * Create a client auth token for OpenAI Realtime API
   * This token is used by the frontend to connect directly to OpenAI
   */
  async createClientToken(apiKey: string): Promise<string> {
    // For OpenAI Realtime API, we use ephemeral tokens
    // The frontend will connect directly to OpenAI's WebSocket
    return apiKey; // In production, you'd create an ephemeral token
  }

  /**
   * Initialize a voice session with business context
   */
  async initializeSession(config: VoiceSessionConfig): Promise<WebSocket> {
    this.sessionConfig = config;
    this.activeSessionKey = `${config.userId}_${config.businessAccountId}`;

    // Get or create conversation
    const conversation = await storage.createConversation({
      businessAccountId: config.businessAccountId,
      title: 'Voice Conversation'
    });
    this.conversationId = conversation.id;

    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Connect to OpenAI Realtime API
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      this.ws.on('open', async () => {
        console.log('[Voice] Connected to OpenAI Realtime API');
        
        // Build system context with business information
        const systemContext = await this.buildSystemContext(config);
        
        // Configure session with business context and tools
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions: systemContext,
            voice: 'alloy', // Default voice, can be customized
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'gpt-4o-mini-transcribe'
            },
            input_audio_noise_reduction: {
              type: 'far_field'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.8,
              prefix_padding_ms: 300,
              silence_duration_ms: 800
            },
            tools: this.convertToRealtimeTools(aiTools),
            tool_choice: 'auto',
            temperature: 0.8
          }
        };

        this.ws?.send(JSON.stringify(sessionUpdate));
        console.log('[Voice] Session configured with business context and tools');
        
        resolve(this.ws!);
      });

      this.ws.on('error', (error) => {
        console.error('[Voice] WebSocket error:', error);
        reject(error);
      });

      // Handle messages from OpenAI
      this.ws.on('message', async (data) => {
        await this.handleRealtimeMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log('[Voice] WebSocket connection closed');
        this.cleanup();
      });
    });
  }

  /**
   * Build system context with business information, FAQs, and custom instructions
   */
  private async buildSystemContext(config: VoiceSessionConfig): Promise<string> {
    const { businessAccountId, personality, companyDescription, customInstructions } = config;

    // Get business context from cache
    const faqs = await businessContextCache.getOrFetch(
      `faqs_${businessAccountId}`,
      () => storage.getAllFaqs(businessAccountId)
    );

    const websiteAnalysis = await businessContextCache.getOrFetch(
      `website_analysis_${businessAccountId}`,
      () => storage.getWebsiteAnalysis(businessAccountId)
    );

    // Build comprehensive system prompt
    let context = `You are Chroney, an AI voice assistant for this business.

PERSONALITY: ${this.getPersonalityTraits(personality)}

CURRENT CONTEXT:
- Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}

`;

    // Add company description
    if (companyDescription) {
      context += `\nCOMPANY INFORMATION:\n${companyDescription}\n`;
    }

    // Add custom instructions
    if (customInstructions) {
      context += `\nCUSTOM BUSINESS INSTRUCTIONS:\n${customInstructions}\n`;
    }

    // Add FAQs knowledge base
    if (faqs.length > 0) {
      context += `\nKNOWLEDGE BASE (FAQs):\n`;
      faqs.forEach((faq, index) => {
        context += `${index + 1}. Q: ${faq.question}\n   A: ${faq.answer}\n\n`;
      });
    }

    // Add website analysis if available
    if (websiteAnalysis && websiteAnalysis.analyzedContent) {
      context += `\nWEBSITE ANALYSIS:\n${websiteAnalysis.analyzedContent}\n`;
    }

    // Add lead training configuration (from Train Chroney page)
    try {
      const widgetSettings = await storage.getWidgetSettings(businessAccountId);
      if (widgetSettings?.leadTrainingConfig) {
        const leadConfig = widgetSettings.leadTrainingConfig as any;
        
        // Guard against invalid config structure
        if (!leadConfig.fields || !Array.isArray(leadConfig.fields)) {
          console.warn('[Voice Context] Invalid lead training config structure, skipping');
          throw new Error('Invalid lead config structure');
        }
        
        const enabledFields = leadConfig.fields
          .filter((f: any) => 
            f && typeof f === 'object' && f.enabled === true && typeof f.id === 'string'
          )
          .sort((a: any, b: any) => {
            // Sort by priority (ascending)
            const priorityA = typeof a.priority === 'number' ? a.priority : 999;
            const priorityB = typeof b.priority === 'number' ? b.priority : 999;
            return priorityA - priorityB;
          });
        
        if (enabledFields.length > 0) {
          context += `\nSMART LEAD CAPTURE CONFIGURATION:\n`;
          
          // Build field requirements (in priority order)
          const requiredFields = enabledFields.filter((f: any) => f.required).map((f: any) => f.id);
          const optionalFields = enabledFields.filter((f: any) => !f.required).map((f: any) => f.id);
          
          context += `Required Contact Information (ask in this order):\n`;
          if (requiredFields.length > 0) {
            context += `- ${requiredFields.join(', ')}\n`;
          } else {
            context += `- None (all fields are optional)\n`;
          }
          
          if (optionalFields.length > 0) {
            context += `\nOptional Contact Information (ask in this order):\n`;
            context += `- ${optionalFields.join(', ')}\n`;
          }
          
          context += `\nSEQUENTIAL COLLECTION RULES (CRITICAL):\n`;
          context += `1. ⚠️ ONLY REQUEST ONE FIELD AT A TIME - Never ask for multiple fields together\n`;
          context += `2. Ask for the FIRST priority field only, wait for user's response\n`;
          context += `3. After receiving the answer, acknowledge it, then ask for the NEXT priority field\n`;
          context += `4. Do NOT mention or reference the next field until the current field is collected\n`;
          context += `5. Follow priority order strictly: priority 1 → priority 2 → priority 3 → priority 4\n\n`;
          context += `CORRECT EXAMPLE (mobile is priority 1, name is priority 2):\n`;
          context += `❌ WRONG: "May I know your mobile number and name?"\n`;
          context += `✅ CORRECT: "May I know your mobile number?"\n`;
          context += `[User provides mobile]\n`;
          context += `✅ THEN: "Thanks! And what's your name?"\n\n`;
          
          // Group fields by their capture strategy for timing instructions
          const fieldsByStrategy = {
            start: enabledFields.filter((f: any) => f.captureStrategy === 'start').map((f: any) => f.id),
            end: enabledFields.filter((f: any) => f.captureStrategy === 'end').map((f: any) => f.id),
            smart: enabledFields.filter((f: any) => !f.captureStrategy || f.captureStrategy === 'smart' || f.captureStrategy === 'custom').map((f: any) => f.id)
          };
          
          context += `\nPER-FIELD COLLECTION TIMING:\n`;
          
          // Add timing instructions for each strategy
          if (fieldsByStrategy.start.length > 0) {
            context += `At Conversation START (immediately after greeting):\n`;
            context += `- Ask for: ${fieldsByStrategy.start.join(', ')}\n`;
            context += `- Timing: After your welcome message, politely request these fields before discussing their needs.\n\n`;
          }
          
          if (fieldsByStrategy.end.length > 0) {
            context += `At Conversation END (after helping with their query):\n`;
            context += `- Ask for: ${fieldsByStrategy.end.join(', ')}\n`;
            context += `- Timing: Wait until you've answered their questions before requesting these fields.\n\n`;
          }
          
          if (fieldsByStrategy.smart.length > 0) {
            context += `Using SMART Timing (natural conversation flow):\n`;
            context += `- Collect: ${fieldsByStrategy.smart.join(', ')}\n`;
            context += `- Timing: Proactively detect and extract from user messages, or ask when it makes sense in the flow.\n\n`;
          }
          
          // Add explicit refusal handling for required fields
          if (requiredFields.length > 0) {
            context += `🚨 MANDATORY REQUIREMENT - REQUIRED FIELDS ENFORCEMENT:\n`;
            context += `The following fields are REQUIRED: ${requiredFields.join(', ')}\n\n`;
            context += `ABSOLUTE RULES - NO EXCEPTIONS:\n`;
            context += `1. You MUST collect ALL required fields before you can help the user with their request\n`;
            context += `2. If a user asks a question but hasn't provided required fields yet, politely redirect them to provide the required information first\n`;
            context += `3. DO NOT answer product questions, provide information, or help with their query until ALL required fields are collected\n`;
            context += `4. EXCEPTION: For fields with "end" timing, you may answer their question first, then collect those specific fields\n`;
            context += `5. For fields with "start" or "smart" timing: BLOCK all assistance until those fields are provided\n`;
            context += `6. ⚠️ CRITICAL: After collecting ALL required fields, IMMEDIATELY answer the user's ORIGINAL question\n`;
            context += `   - DO NOT ask "How can I assist you further?" - they already asked!\n`;
            context += `   - REMEMBER their original question from the conversation history\n`;
            context += `   - ANSWER it right after thanking them for their details\n\n`;
            
            context += `CORRECT FLOW EXAMPLE:\n`;
            context += `User: "Tell me about MBA programs"\n`;
            context += `AI: "I'd love to help! May I know your mobile number first?"\n`;
            context += `User: "9876543210"\n`;
            context += `AI: "Thanks! May I also have your name?"\n`;
            context += `User: "Godse"\n`;
            context += `AI: "Thank you, Godse! [THEN IMMEDIATELY ANSWER ABOUT MBA PROGRAMS - don't ask what they need help with]"\n\n`;
            
            context += `HANDLING REQUIRED FIELD REFUSALS:\n`;
            context += `When a user refuses to provide a REQUIRED field (e.g., says "no" when you ask for their mobile):\n`;
            context += `1. DO NOT accept the refusal and move on - these fields are mandatory\n`;
            context += `2. DO NOT proceed to answer their questions or help them\n`;
            context += `3. Politely explain WHY the information is needed (e.g., "I need your mobile number to provide personalized assistance")\n`;
            context += `4. Reassure them about privacy/data usage if appropriate\n`;
            context += `5. Continue to politely insist on required fields - be friendly but firm\n`;
            context += `6. NEVER call capture_lead tool if any required field is missing\n\n`;
            
            context += `Example conversation when user refuses required fields:\n`;
            context += `User: "Can you tell me about your MBA programs?"\n`;
            context += `AI: "I'd love to help you with that! May I know your mobile number first so I can provide personalized program recommendations?"\n`;
            context += `User: "No, just tell me about the programs"\n`;
            context += `AI: "I understand! However, I need your mobile number to better assist you and provide tailored information. Could you please share it?"\n`;
            context += `User: "Why do you need it?"\n`;
            context += `AI: "Your mobile number helps me personalize my recommendations and ensure you get the most relevant program details. What's your mobile number?"\n\n`;
          }
        }
      }
    } catch (error) {
      console.error('[Voice Context] Error loading lead training config:', error);
    }

    context += `\nIMPORTANT VOICE ASSISTANT GUIDELINES:
- Speak naturally and conversationally
- Keep responses concise and clear for voice interaction
- Always respond in the same language the user speaks (automatic language detection)
- When switching languages, maintain conversation context
- For appointment booking, use the list_available_slots and book_appointment tools
- For lead capture, use the capture_lead tool when users provide contact information
- For product inquiries, use the get_products tool
- Be proactive in helping users accomplish their goals
- Confirm important information (appointments, contact details) before finalizing

CRITICAL: PROACTIVE CONTACT INFORMATION DETECTION
AFTER EVERY USER MESSAGE, you MUST:
1. Carefully analyze the message for ANY contact information (name, email, phone number, WhatsApp)
2. If you detect name, email, phone, or WhatsApp number:
   - Extract it immediately
   - Check if you now have ALL REQUIRED contact fields
   - If ALL REQUIRED fields are collected → call capture_lead RIGHT AWAY
   - If still missing required fields → ask for them conversationally
3. Examples of contact info to detect:
   - "My name is John" → extract name: "John"
   - "I'm Sarah" → extract name: "Sarah"
   - "john@email.com" → extract email: "john@email.com"
   - "Call me at 555-1234" → extract phone: "555-1234"
   - "9876543210" → extract phone: "9876543210"

IMPORTANT: Only call capture_lead when ALL REQUIRED fields are collected. If fields are optional, you can call capture_lead without them.

TOOL USAGE RULES:
1. For appointment questions: ALWAYS call list_available_slots first
2. For booking: Call book_appointment with the chosen slot
3. For lead capture: Detect contact info from EVERY message, collect ALL REQUIRED fields, then call capture_lead
4. For products: Use get_products to show available items
`;

    return context;
  }

  /**
   * Convert existing aiTools to OpenAI Realtime API format
   */
  private convertToRealtimeTools(tools: any[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }));
  }

  /**
   * Handle incoming messages from OpenAI Realtime API
   */
  private async handleRealtimeMessage(message: string) {
    try {
      const event = JSON.parse(message);
      
      // Log important events
      if (event.type !== 'response.audio.delta' && event.type !== 'input_audio_buffer.speech_started') {
        console.log('[Voice] Event:', event.type);
      }

      // Handle different event types
      switch (event.type) {
        case 'session.created':
          console.log('[Voice] Session created:', event.session.id);
          break;

        case 'session.updated':
          console.log('[Voice] Session updated');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User's speech was transcribed
          const userTranscript = event.transcript;
          console.log('[Voice] User said:', userTranscript);
          
          // Store in conversation memory
          if (this.sessionConfig) {
            conversationMemory.storeMessage(this.sessionConfig.userId, 'user', userTranscript);
            if (this.conversationId) {
              await storage.createMessage({
                conversationId: this.conversationId,
                role: 'user',
                content: userTranscript
              });
            }
          }
          break;

        case 'response.function_call_arguments.done':
          // AI wants to call a tool
          await this.handleToolCall(event);
          break;

        case 'response.audio_transcript.done':
          // AI's full response transcript is ready
          const assistantTranscript = event.transcript;
          console.log('[Voice] AI said:', assistantTranscript);
          
          // Store in conversation memory
          if (this.sessionConfig) {
            conversationMemory.storeMessage(this.sessionConfig.userId, 'assistant', assistantTranscript);
            if (this.conversationId) {
              await storage.createMessage({
                conversationId: this.conversationId,
                role: 'assistant',
                content: assistantTranscript
              });
            }
          }
          break;

        case 'response.done':
          console.log('[Voice] Response completed');
          break;

        case 'error':
          console.error('[Voice] API Error:', event.error);
          break;
      }
    } catch (error) {
      console.error('[Voice] Error handling message:', error);
    }
  }

  /**
   * Execute tool calls requested by the AI
   */
  private async handleToolCall(event: any) {
    const { call_id, name, arguments: argsString } = event;
    
    console.log('[Voice] Tool call:', name, argsString);

    try {
      const args = JSON.parse(argsString);
      
      if (!this.sessionConfig) {
        throw new Error('Session not configured');
      }

      // Execute the tool using existing ToolExecutionService
      // Note: Voice service doesn't have access to the original user message at this point
      const result = await ToolExecutionService.executeTool(
        name,
        args,
        {
          businessAccountId: this.sessionConfig.businessAccountId,
          userId: this.sessionConfig.userId,
          conversationId: this.conversationId!
        },
        undefined
      );

      // Send tool result back to OpenAI
      const toolOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      };

      this.ws?.send(JSON.stringify(toolOutput));
      
      // Request new response from AI with tool result
      this.ws?.send(JSON.stringify({ type: 'response.create' }));

      console.log('[Voice] Tool result sent:', name, result);
    } catch (error: any) {
      console.error('[Voice] Tool execution error:', error);
      
      // Send error back to AI
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ error: error.message })
        }
      };
      this.ws?.send(JSON.stringify(errorOutput));
    }
  }

  /**
   * Send audio data to OpenAI
   */
  sendAudio(audioBase64: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Voice] WebSocket not ready');
      return;
    }

    const message = {
      type: 'input_audio_buffer.append',
      audio: audioBase64
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Commit audio buffer (tell OpenAI we're done sending this chunk)
   */
  commitAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'input_audio_buffer.commit'
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Cancel current response
   */
  cancelResponse() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'response.cancel'
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Get personality traits for system prompt
   */
  private getPersonalityTraits(personality: string): string {
    const traits: Record<string, string> = {
      friendly: 'Warm, helpful, and approachable - like a knowledgeable friend',
      professional: 'Business-focused, concise, and respectful',
      casual: 'Relaxed, conversational, and easy-going',
      enthusiastic: 'Energetic, positive, and encouraging',
      helpful: 'Solution-oriented, patient, and supportive'
    };

    return traits[personality] || traits.friendly;
  }

  /**
   * Close the WebSocket connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.cleanup();
    }
  }

  /**
   * Cleanup session resources
   */
  private cleanup() {
    this.ws = null;
    this.sessionConfig = null;
    this.conversationId = null;
    this.activeSessionKey = null;
  }

  /**
   * Get WebSocket instance (for proxying messages)
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }
}

export const voiceService = new VoiceService();
