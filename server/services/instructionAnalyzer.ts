import OpenAI from 'openai';

export interface InstructionConflict {
  instructionIds: string[];
  severity: 'high' | 'medium' | 'low';
  type: 'rigid_sequence' | 'repeated_questions' | 'context_ignorance' | 'contradictory' | 'ux_harm';
  description: string;
  suggestedFix: string;
}

export interface BestPracticeRule {
  id: string;
  text: string;
  reason: string;
  autoAdd: boolean;
}

export interface RefinementSuggestion {
  instructionId: string;
  originalText: string;
  refinedText: string;
  reason: string;
  confidence: number;
}

export interface AnalysisResult {
  conflicts: InstructionConflict[];
  bestPractices: BestPracticeRule[];
  refinements: RefinementSuggestion[];
  qualityScore: number;
  summary: string;
}

interface Instruction {
  id: string;
  text: string;
}

export class InstructionAnalyzer {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
    });
  }

  async analyzeInstructions(instructions: Instruction[]): Promise<AnalysisResult> {
    if (instructions.length === 0) {
      return {
        conflicts: [],
        bestPractices: [],
        refinements: [],
        qualityScore: 100,
        summary: 'No instructions to analyze.'
      };
    }

    const prompt = this.buildAnalysisPrompt(instructions);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert AI chatbot trainer who analyzes training instructions to detect conflicts, UX issues, and suggest improvements. You focus on making chatbots feel natural, context-aware, and user-friendly. Be consistent and deterministic in your analysis.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      return this.validateAndTransformResult(result, instructions);
    } catch (error) {
      console.error('[InstructionAnalyzer] Analysis failed:', error);
      throw new Error('Failed to analyze instructions');
    }
  }

  private buildAnalysisPrompt(instructions: Instruction[]): string {
    const instructionList = instructions
      .map((inst, idx) => `[ID: ${inst.id}] Instruction ${idx + 1}: ${inst.text}`)
      .join('\n\n');

    return `Analyze the following chatbot training instructions and provide a comprehensive analysis.

TRAINING INSTRUCTIONS:
${instructionList}

Your task is to:

1. **Detect Conflicts**: Identify instructions that contradict each other, create rigid sequences that ignore user context, or cause repeated questions.
   - Look for: "BEFORE answering", "THEN ask", "mandatory", "always", "never" that create inflexible flows
   - Detect: Instructions that don't allow context extraction from user messages
   - Flag: Rules that force AI to ask for info already mentioned

2. **Skip Best Practices Suggestions**: 
   DO NOT suggest any best practices to add. Core conversation best practices (checking history, extracting contact info, acknowledging shared information, flexible collection, context awareness) are now built into Chroney's system prompt and always followed automatically.
   
   ALWAYS return an empty bestPractices array: []

3. **Provide Refinement Suggestions**: Rewrite problematic instructions to be context-aware:
   - Change "collect X BEFORE answering" → "ensure X is collected"
   - Change "THEN ask Y" → "if Y is not known, ask for Y"
   - Add context checks: "Check conversation history first"
   - ONLY suggest refinements for instructions that have actual problems

4. **Calculate Quality Score (0-100)** - Be objective and achievable:
   - Start at 100 points
   - Deduct for ONLY actual issues found:
     * High severity conflict: −20 points each
     * Medium severity conflict: −10 points each
     * Low severity conflict: −5 points each
   - If NO conflicts are found, score MUST be 90-100
   - A score of 100 means: zero conflicts detected, no rigid sequences, well-written instructions
   - DO NOT invent minor issues just to lower the score
   - If instructions are well-written and context-aware, acknowledge it with a high score

5. **Write a Summary**: 2-3 sentence overview focusing on what was found (or that everything looks good)

Return your analysis in this exact JSON format:
{
  "conflicts": [
    {
      "instructionIds": ["id1", "id2"],
      "severity": "high" | "medium" | "low",
      "type": "rigid_sequence" | "repeated_questions" | "context_ignorance" | "contradictory" | "ux_harm",
      "description": "Clear explanation of the conflict",
      "suggestedFix": "How to resolve this conflict"
    }
  ],
  "bestPractices": [
    {
      "id": "bp_1",
      "text": "The exact rule text to add",
      "reason": "Why this rule is needed",
      "autoAdd": true
    }
  ],
  "refinements": [
    {
      "instructionId": "id1",
      "originalText": "Original instruction text",
      "refinedText": "Improved, context-aware version",
      "reason": "Why this refinement improves UX",
      "confidence": 0.95
    }
  ],
  "qualityScore": 75,
  "summary": "Brief 2-3 sentence overview"
}

CRITICAL RULES TO FOLLOW:
1. **Always Return Empty Best Practices**: Core conversation best practices are now built into Chroney's system. ALWAYS return bestPractices: []
2. **Refinements Only for Problems**: Don't suggest refinements for instructions that are already well-written
3. **Honest Scoring**: If no conflicts are found, score should be 90-100
4. **100% is Achievable**: A perfect score (100) means zero conflicts detected and well-written instructions
5. **Don't Invent Issues**: Be honest about quality - focus only on real conflicts and problems`;
  }

  private validateAndTransformResult(result: any, instructions: Instruction[]): AnalysisResult {
    // Ensure all required fields exist
    const validated: AnalysisResult = {
      conflicts: Array.isArray(result.conflicts) ? result.conflicts : [],
      bestPractices: [], // ALWAYS empty - best practices are now built into Chroney's system prompt
      refinements: Array.isArray(result.refinements) ? result.refinements : [],
      qualityScore: typeof result.qualityScore === 'number' ? Math.max(0, Math.min(100, result.qualityScore)) : 50,
      summary: typeof result.summary === 'string' ? result.summary : 'Analysis completed.'
    };

    // Validate instruction IDs exist
    const validIds = new Set(instructions.map(i => i.id));
    
    validated.conflicts = validated.conflicts.filter(c => 
      Array.isArray(c.instructionIds) && c.instructionIds.some(id => validIds.has(id))
    );

    validated.refinements = validated.refinements.filter(r => 
      validIds.has(r.instructionId)
    );

    return validated;
  }

  // Get predefined best practices based on instruction patterns
  getBestPracticeLibrary(): BestPracticeRule[] {
    return [
      {
        id: 'bp_no_repeat',
        text: 'Before asking for any information (name, mobile, email), always check the conversation history first. If the user has already mentioned it in any previous message, use that information instead of asking again. Never ask repeated questions.',
        reason: 'Prevents frustrating repeated questions that damage user experience',
        autoAdd: true
      },
      {
        id: 'bp_proactive_extract',
        text: 'When users mention their name, phone number, or email anywhere in their message (e.g., "Hi, I\'m John, tell me about courses"), extract and remember this information immediately. Don\'t ask for it again later.',
        reason: 'Enables natural conversation flow by recognizing proactively shared information',
        autoAdd: true
      },
      {
        id: 'bp_acknowledge_context',
        text: 'When collecting information, acknowledge what the user has already shared before asking for missing details. Example: "Thanks for sharing your number, [Name]. May I also have your email?" instead of asking all questions from scratch.',
        reason: 'Shows the AI is listening and creates a more human-like conversation',
        autoAdd: false
      },
      {
        id: 'bp_flexible_sequence',
        text: 'Collect required information in a flexible order based on what the user provides. If they volunteer information out of sequence, accept it and move forward. Don\'t force a rigid question order.',
        reason: 'Allows users to communicate naturally instead of following a script',
        autoAdd: false
      }
    ];
  }
}
