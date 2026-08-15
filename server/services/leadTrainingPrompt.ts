export interface LeadTrainingField {
  id: string;
  enabled: boolean;
  required: boolean;
  priority: number;
  captureStrategy?: 'start' | 'smart' | 'custom' | 'keyword' | 'end' | 'intent';
  captureKeywords?: string[];
  phoneValidation?: string;
  intentIntensity?: string;
  digitCount?: number;
  customAskAfter?: number;
  otpEnabled?: boolean;
}

/**
 * Builds a prompt override that runs when an OTP challenge is currently
 * awaiting verification on this conversation. The AI MUST only call
 * verify_phone_otp or resend_phone_otp until the challenge resolves; it must
 * not capture additional fields, run product/lookup tools, or chit-chat.
 */
export function buildOtpGatingOverride(state: {
  awaiting_otp: boolean;
  locked: boolean;
  phone_masked?: string;
  expires_at?: string;
  locked_until?: string;
  attempts_remaining?: number;
  resends_remaining?: number;
}): string {
  if (state.locked) {
    return `\n\n=== OTP VERIFICATION LOCKED ===\nThe customer has exceeded the OTP attempt limit on this conversation. Verification is locked until ${state.locked_until}. Do NOT call any tools. Reply briefly that verification is temporarily locked and they can try again after the lockout. Do NOT ask for any contact information again.\n=== END OTP LOCK ===\n`;
  }
  if (!state.awaiting_otp) return '';
  return `\n\n=== OTP VERIFICATION IN PROGRESS — STRICT MODE ===\nA 6-digit verification code was sent to ${state.phone_masked || 'the customer'}. It expires at ${state.expires_at}.\nYou have ${state.attempts_remaining ?? 3} verification attempt(s) and ${state.resends_remaining ?? 3} resend(s) remaining.\n\nRULES (non-negotiable):\n1. If the user's message contains a 6-digit number, IMMEDIATELY call the tool verify_phone_otp with that code. Do not say anything before the tool call.\n2. If the user asks to resend or didn't receive the code, call resend_phone_otp.\n3. Do NOT call product/search/order tools, do NOT collect any other field (name, email, etc.), do NOT answer unrelated questions until verification succeeds or the challenge expires. capture_lead may ONLY be called if the user explicitly provides a CORRECTED mobile number (e.g. "wait, my number is actually 9876543210") — in that case call capture_lead(phone=...) so the OTP can be re-issued to the right number; otherwise do not call it.\n4. If the user's message is not a 6-digit code and not a resend request, reply with one short sentence asking them to enter the 6-digit code that was sent to their mobile.\n5. Never reveal the code or the masked phone in any other format than what you were told.\n=== END OTP STRICT MODE ===\n`;
}

export interface LeadTrainingConfig {
  fields: LeadTrainingField[];
}

export function buildLeadTrainingPrompt(
  leadTrainingConfig: any,
  responseCount: number = 0,
  channel: 'website' | 'whatsapp' | 'instagram' = 'website'
): string {
  if (!leadTrainingConfig) return '';

  const leadConfig = leadTrainingConfig;

  if (!leadConfig.fields || !Array.isArray(leadConfig.fields)) {
    return '';
  }

  const enabledFields = leadConfig.fields
    .filter((f: any) =>
      f && typeof f === 'object' && f.enabled === true && typeof f.id === 'string'
    )
    .sort((a: any, b: any) => {
      const priorityA = typeof a.priority === 'number' ? a.priority : 999;
      const priorityB = typeof b.priority === 'number' ? b.priority : 999;
      return priorityA - priorityB;
    });

  if (enabledFields.length === 0) return '';

  let prompt = `SMART LEAD CAPTURE CONFIGURATION:\n`;

  const requiredFields = enabledFields.filter((f: any) => f.required).map((f: any) => f.id);
  const optionalFields = enabledFields.filter((f: any) => !f.required).map((f: any) => f.id);

  prompt += `Required Contact Information (ask in this order):\n`;
  if (requiredFields.length > 0) {
    prompt += `- ${requiredFields.join(', ')}\n`;
  } else {
    prompt += `- None (all fields are optional)\n`;
  }

  if (optionalFields.length > 0) {
    prompt += `\nOptional Contact Information (ask in this order):\n`;
    prompt += `- ${optionalFields.join(', ')}\n`;
  }

  const fieldsByStrategy = {
    start: enabledFields.filter((f: any) => f.captureStrategy === 'start').map((f: any) => f.id),
    keyword: enabledFields.filter((f: any) => f.captureStrategy === 'keyword' || f.captureStrategy === 'end').map((f: any) => f.id),
    smart: enabledFields.filter((f: any) => !f.captureStrategy || f.captureStrategy === 'smart').map((f: any) => f.id),
    custom: enabledFields.filter((f: any) => f.captureStrategy === 'custom').map((f: any) => f.id),
    intent: enabledFields.filter((f: any) => f.captureStrategy === 'intent').map((f: any) => f.id)
  };

  const hasSmartFields = fieldsByStrategy.smart.length > 0;
  const hasCustomFields = fieldsByStrategy.custom.length > 0;

  const smartMandatoryFields = enabledFields.filter((f: any) =>
    (!f.captureStrategy || f.captureStrategy === 'smart') && f.required
  ).map((f: any) => f.id);
  const smartOptionalFields = enabledFields.filter((f: any) =>
    (!f.captureStrategy || f.captureStrategy === 'smart') && !f.required
  ).map((f: any) => f.id);

  const customMandatoryFields = enabledFields.filter((f: any) =>
    f.captureStrategy === 'custom' && f.required
  );
  const customOptionalFields = enabledFields.filter((f: any) =>
    f.captureStrategy === 'custom' && !f.required
  );

  if (hasSmartFields && smartMandatoryFields.length > 0) {
    prompt += `\n⚡ CRITICAL - SMART LEAD COLLECTION (VALUE-FIRST APPROACH) ⚡\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `Fields with SMART timing: ${fieldsByStrategy.smart.join(', ')}\n`;
    prompt += `Mandatory: ${smartMandatoryFields.join(', ') || 'none'} | Optional: ${smartOptionalFields.join(', ') || 'none'}\n\n`;

    prompt += `🎯 THE #1 RULE - VALUE FIRST:\n`;
    prompt += `When user sends their FIRST message → ANSWER IT or greet them back!\n`;
    prompt += `- Do NOT ask for name/phone/email before answering the first message\n`;
    prompt += `- Give them value FIRST to build trust\n`;
    prompt += `- The first message gets a FREE answer with no lead gate\n\n`;

    prompt += `🚦 SECOND MESSAGE ONWARDS - LEAD GATE ACTIVATED:\n`;
    prompt += `When user sends their SECOND message (or any subsequent message):\n`;
    prompt += `1. STOP - Do NOT answer yet\n`;
    prompt += `2. Politely ask for the mandatory contact info: ${smartMandatoryFields.join(', ')}\n`;
    prompt += `3. Example: "I'd love to help you with that! Before I continue, may I get your name?"\n`;
    prompt += `4. WAIT for them to provide the info before answering\n`;
    prompt += `5. If they refuse and field is MANDATORY → Keep asking politely, explain you need it to help them\n`;
    prompt += `6. If they refuse and field is OPTIONAL → Proceed with answering\n\n`;

    if (smartOptionalFields.length > 0) {
      prompt += `📋 OPTIONAL SMART FIELDS (${smartOptionalFields.join(', ')}):\n`;
      prompt += `- After collecting mandatory fields, you may ask for these optional fields\n`;
      prompt += `- If user declines an optional field, gracefully proceed without it\n`;
      prompt += `- Example: "Would you also like to share your email for updates?" → User: "No" → "No problem!"\n\n`;
    }

    prompt += `📝 EXAMPLE CONVERSATION FLOW:\n`;
    prompt += `User: "Hey" or "What products do you have?" (1st message)\n`;
    prompt += `AI: [ANSWER or greet - no lead ask yet]\n\n`;
    prompt += `User: "Tell me more" or "wassup" (2nd message)\n`;
    prompt += `AI: "I'd be happy to help! Before I continue, may I get your name?"\n`;
    prompt += `User: "John"\n`;
    if (smartOptionalFields.length > 0) {
      prompt += `AI: "Thanks John! Would you also like to share your ${smartOptionalFields[0]}?" (optional)\n`;
      prompt += `User: "No thanks"\n`;
      prompt += `AI: "No problem! [NOW answer their question]"\n`;
    } else {
      prompt += `AI: "Thanks John! [NOW answer their question]"\n`;
    }
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (hasCustomFields && customMandatoryFields.length > 0) {
    const askAfter = customMandatoryFields[0].customAskAfter || 2;
    const freeMessages = askAfter - 1;
    const customMandatoryNames = customMandatoryFields.map((f: any) => f.id);
    const customOptionalNames = customOptionalFields.map((f: any) => f.id);

    prompt += `\n⚡ CRITICAL - CUSTOM TIMING LEAD COLLECTION ⚡\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `Fields with CUSTOM timing: ${fieldsByStrategy.custom.join(', ')}\n`;
    prompt += `Mandatory: ${customMandatoryNames.join(', ') || 'none'} | Optional: ${customOptionalNames.join(', ') || 'none'}\n`;
    prompt += `Configured to ask on user's message #${askAfter}\n\n`;

    if (responseCount > 0) {
      prompt += `📊 CURRENT STATUS: You have already sent ${responseCount} response(s) to this user.\n`;
      if (responseCount >= freeMessages) {
        prompt += `🔴 YOU HAVE REACHED THE THRESHOLD. You MUST ask for ${customMandatoryNames.join(', ')} NOW in your very next response.\n`;
        prompt += `DO NOT answer any more questions until you collect: ${customMandatoryNames.join(', ')}\n`;
        prompt += `Ask IMMEDIATELY in your next response. Do NOT skip this.\n\n`;
      } else {
        prompt += `🟢 You have NOT yet reached the threshold. Respond normally for now.\n`;
        prompt += `You will need to ask for ${customMandatoryNames.join(', ')} when you've sent ${freeMessages} response(s).\n\n`;
      }
    }

    prompt += `🔒 MANDATORY RULES FOR CUSTOM TIMING:\n`;
    if (freeMessages > 0) {
      prompt += `1. For the first ${freeMessages} user message(s), respond normally (greet, answer, chat)\n`;
    } else {
      prompt += `1. There are NO free messages — ask for contact info immediately\n`;
    }
    prompt += `2. Starting from user message #${askAfter}, you MUST ask for: ${customMandatoryNames.join(', ')}\n`;
    prompt += `3. Do NOT answer any further questions until mandatory fields are collected\n`;
    prompt += `4. COUNT EVERY USER MESSAGE — greetings like "hi", "hey", "wassup" ALL count as messages\n`;
    prompt += `5. After collecting all fields, immediately answer whatever the user last asked\n\n`;

    prompt += `📝 EXAMPLE CONVERSATION FLOW (ask on message #${askAfter}):\n`;
    for (let i = 1; i <= freeMessages; i++) {
      prompt += `User: [message #${i}]\n`;
      prompt += `AI: [respond normally - response #${i}]\n\n`;
    }
    prompt += `User: [message #${askAfter}]\n`;
    prompt += `AI: "Before I continue, may I get your ${customMandatoryNames[0]}?" ← MUST ASK NOW\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (hasCustomFields && customMandatoryFields.length === 0 && customOptionalFields.length > 0) {
    const askAfter = customOptionalFields[0].customAskAfter || 2;
    const freeMessages = askAfter - 1;
    const customOptionalNames = customOptionalFields.map((f: any) => f.id);

    prompt += `\n🎯 CUSTOM TIMING (OPTIONAL FIELDS ONLY):\n`;
    prompt += `Fields: ${customOptionalNames.join(', ')}\n`;
    prompt += `- Respond normally for the first ${freeMessages} message(s)\n`;
    prompt += `- On message #${askAfter}, you may ask for these fields but user can decline\n`;
    prompt += `- If user declines, proceed with answering\n\n`;
  }

  if (fieldsByStrategy.start.length > 0) {
    prompt += `\n📍 START TIMING FIELDS - COLLECT IMMEDIATELY:\n`;
    prompt += `Fields: ${fieldsByStrategy.start.join(', ')}\n`;
    prompt += `These must be collected BEFORE answering ANY questions.\n`;
    prompt += `SEQUENTIAL COLLECTION RULES:\n`;
    prompt += `1. ⚠️ ONLY REQUEST ONE FIELD AT A TIME - Never ask for multiple fields together\n`;
    prompt += `2. Ask for the FIRST priority field only, wait for user's response\n`;
    prompt += `3. After receiving the answer, acknowledge it, then ask for the NEXT priority field\n`;
    prompt += `4. Do NOT mention or reference the next field until the current field is collected\n`;
    prompt += `5. 🔴 IF USER DECLINES (says "no", "not now", "skip", etc.):\n`;
    prompt += `   - Acknowledge their choice politely ("No problem!" or "That's fine!")\n`;
    prompt += `   - IMMEDIATELY answer their original pending question from the conversation\n`;
    prompt += `   - Look back at what they asked before you requested contact info and answer THAT question now\n`;
    prompt += `   - Do NOT just say "feel free to ask" - you already know what they want to know!\n\n`;
  }

  if (fieldsByStrategy.keyword.length > 0) {
    const keywordFields = enabledFields.filter((f: any) => f.captureStrategy === 'keyword' || f.captureStrategy === 'end');
    prompt += `\n🔑 KEYWORD-BASED LEAD COLLECTION:\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `Fields with KEYWORD timing:\n`;
    keywordFields.forEach((f: any) => {
      const keywords = (f.captureKeywords || []).join(', ');
      const requirement = f.required ? 'MANDATORY' : 'OPTIONAL';
      prompt += `  - ${f.id}: ${requirement}, Keywords: [${keywords}]\n`;
    });
    prompt += `\nWhen the user's message contains any configured keyword, ask for contact info.\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (fieldsByStrategy.intent.length > 0) {
    const intentFields = enabledFields.filter((f: any) => f.captureStrategy === 'intent');
    prompt += `\n🎯 INTENT-BASED LEAD COLLECTION (AI-DRIVEN):\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `Fields with INTENT timing:\n`;
    intentFields.forEach((f: any) => {
      const sensitivity = (f.intentIntensity || 'medium').toUpperCase();
      const requirement = f.required ? 'MANDATORY' : 'OPTIONAL';
      prompt += `  - ${f.id}: ${requirement}, Sensitivity: ${sensitivity}\n`;
    });
    prompt += `\n📌 WHEN TO ASK FOR CONTACT INFO:\n`;
    prompt += `AI will use its judgment to detect user intent based on the configured sensitivity level for each field.\n`;
    prompt += `Detailed sensitivity instructions are provided in the response-time prompt.\n\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (hasSmartFields && smartMandatoryFields.length === 0 && smartOptionalFields.length > 0) {
    prompt += `\n🎯 SMART TIMING (OPTIONAL FIELDS ONLY):\n`;
    prompt += `Fields: ${smartOptionalFields.join(', ')}\n`;
    prompt += `- Answer the first message freely\n`;
    prompt += `- On subsequent messages, you may ask for these fields but user can decline\n`;
    prompt += `- If user declines, proceed with answering\n\n`;
  }

  const isWhatsApp = channel === 'whatsapp';

  prompt += `\nCRITICAL: INSTANT PROGRESSIVE LEAD CAPTURE\n`;
  prompt += `AFTER EVERY USER MESSAGE, you MUST:\n`;
  if (isWhatsApp) {
    prompt += `1. Carefully analyze the message for ANY contact information (name, email)\n`;
    prompt += `2. If you detect name or email:\n`;
  } else {
    prompt += `1. Carefully analyze the message for ANY contact information (name, email, phone number, WhatsApp)\n`;
    prompt += `2. If you detect name, email, phone, or WhatsApp number:\n`;
  }
  prompt += `   - Extract it immediately\n`;
  prompt += `   - CALL capture_lead tool RIGHT AWAY with whatever contact info you have (even if partial)\n`;
  prompt += `   - After calling capture_lead, if required fields are still missing, continue asking for them\n`;
  prompt += `   - When you get more contact info later, call capture_lead again to update the lead\n`;
  prompt += `3. Examples of contact info in messages:\n`;
  prompt += `   - "My name is John" → Call capture_lead(name="John") immediately\n`;
  prompt += `   - "I'm Sarah" → Call capture_lead(name="Sarah") immediately\n`;
  prompt += `   - "john@email.com" → Call capture_lead(email="john@email.com") immediately\n`;
  if (!isWhatsApp) {
    prompt += `   - "Call me at 555-1234" → Call capture_lead(phone="555-1234") immediately\n`;
    prompt += `   - "9876543210" → Call capture_lead(phone="9876543210") immediately\n`;
    prompt += `   - "My WhatsApp is +91 98765 43210" → Call capture_lead(phone="+919876543210") immediately\n`;
  }
  prompt += `\n`;
  prompt += `INSTANT PROGRESSIVE CAPTURE RULES:\n`;
  if (isWhatsApp) {
    prompt += `- ✅ ALWAYS call capture_lead IMMEDIATELY when you receive ANY contact info (name OR email)\n`;
  } else {
    prompt += `- ✅ ALWAYS call capture_lead IMMEDIATELY when you receive ANY contact info (name, email, OR phone)\n`;
  }
  prompt += `- ✅ Partial data is OK - the system saves partial leads to prevent data loss\n`;
  prompt += `- ✅ After calling capture_lead with partial data, continue asking for missing REQUIRED fields\n`;
  prompt += `- ✅ When user provides more info later, call capture_lead again - it will update the same lead\n`;
  prompt += `- ✅ Always acknowledge shared contact information naturally (e.g., "Thanks for sharing that!").\n`;
  prompt += `- ✅ Be conversational and natural when collecting information - don't make it feel like a form.\n`;
  prompt += `- ⛔ DO NOT call capture_lead if user only expresses a PREFERENCE without actual contact data!\n`;
  prompt += `  Examples of preference expressions (NOT contact info):\n`;
  prompt += `  - "Via mail please" or "By email" → User wants email but hasn't provided one - ASK for their email!\n`;
  if (!isWhatsApp) {
    prompt += `  - "Please call me" or "Via phone" → User wants a call but hasn't provided number - ASK for their phone!\n`;
    prompt += `  - "WhatsApp me" → User wants WhatsApp but hasn't provided number - ASK for their number!\n`;
    prompt += `  The correct response is: "Sure! Could you please share your [email/phone] so I can [send details/arrange a callback]?"\n\n`;
  } else {
    prompt += `  The correct response is: "Sure! Could you please share your email so I can send you the details?"\n\n`;
    prompt += `⚠️ WHATSAPP OVERRIDE: The user's phone/mobile number is ALREADY KNOWN from WhatsApp. Do NOT ask for phone or mobile number. Only collect name and email if configured.\n\n`;
  }

  const mobileField = enabledFields.find((f: any) => f.id === 'mobile');
  const whatsappField = enabledFields.find((f: any) => f.id === 'whatsapp');

  if (mobileField || whatsappField) {
    prompt += `📱 PHONE NUMBER VALIDATION RULES:\n`;

    if (mobileField) {
      const validation = mobileField.phoneValidation || '10';
      let validationRule = '';
      switch (validation) {
        case '10': validationRule = 'exactly 10 digits (excluding country code)'; break;
        case '12': validationRule = 'exactly 12 digits (may include country code)'; break;
        case '8-12': validationRule = 'between 8 and 12 digits'; break;
        case 'any': validationRule = 'any reasonable length (no strict validation)'; break;
        default: validationRule = 'exactly 10 digits';
      }
      prompt += `Mobile Number: Must have ${validationRule}\n`;
      prompt += `- If the number doesn't meet this requirement, politely ask the user to re-enter a valid number\n`;
      prompt += `- Example: "Could you please provide a valid ${validation === '10' ? '10-digit' : validation === '12' ? '12-digit' : ''} mobile number?"\n`;
    }

    if (whatsappField) {
      const validation = whatsappField.phoneValidation || '10';
      let validationRule = '';
      switch (validation) {
        case '10': validationRule = 'exactly 10 digits (excluding country code)'; break;
        case '12': validationRule = 'exactly 12 digits (may include country code)'; break;
        case '8-12': validationRule = 'between 8 and 12 digits'; break;
        case 'any': validationRule = 'any reasonable length (no strict validation)'; break;
        default: validationRule = 'exactly 10 digits';
      }
      prompt += `WhatsApp Number: Must have ${validationRule}\n`;
      prompt += `- If the number doesn't meet this requirement, politely ask the user to re-enter a valid number\n`;
    }

    prompt += `\n`;
  }

  if (requiredFields.length > 0) {
    const requiredStartFields = enabledFields.filter((f: any) => f.required && f.captureStrategy === 'start').map((f: any) => f.id);
    const requiredSmartFields = enabledFields.filter((f: any) => f.required && (!f.captureStrategy || f.captureStrategy === 'smart')).map((f: any) => f.id);
    const requiredCustomFields = enabledFields.filter((f: any) => f.required && f.captureStrategy === 'custom');
    const requiredKeywordFields = enabledFields.filter((f: any) => f.required && (f.captureStrategy === 'keyword' || f.captureStrategy === 'end')).map((f: any) => f.id);

    prompt += `🚨 MANDATORY REQUIREMENT - REQUIRED FIELDS ENFORCEMENT:\n`;
    prompt += `The following fields are REQUIRED: ${requiredFields.join(', ')}\n\n`;

    prompt += `TIMING-BASED ENFORCEMENT RULES:\n\n`;

    if (requiredStartFields.length > 0) {
      prompt += `📍 "START" TIMING FIELDS (${requiredStartFields.join(', ')}):\n`;
      prompt += `- BLOCK all assistance until these fields are provided\n`;
      prompt += `- Ask immediately after greeting, before answering ANY questions\n\n`;
    }

    if (requiredSmartFields.length > 0) {
      prompt += `🎯 "SMART" TIMING FIELDS (${requiredSmartFields.join(', ')}):\n`;
      prompt += `- FIRST MESSAGE: Respond to the user's first message WITHOUT asking for these fields\n`;
      prompt += `- SECOND MESSAGE: Before responding to any subsequent messages, you MUST collect these fields\n`;
      prompt += `- BLOCK further assistance after first message until these fields are provided\n`;
      prompt += `- If user refuses, politely explain you need this info to continue helping them\n\n`;
    }

    if (requiredCustomFields.length > 0) {
      const askAfter = requiredCustomFields[0].customAskAfter || 2;
      const freeMessages = askAfter - 1;
      const customFieldNames = requiredCustomFields.map((f: any) => f.id);
      prompt += `⏱️ "CUSTOM" TIMING FIELDS (${customFieldNames.join(', ')}):\n`;
      if (freeMessages > 0) {
        prompt += `- Respond normally for the first ${freeMessages} message(s) (ALL messages count — including greetings)\n`;
      } else {
        prompt += `- No free messages — collect these fields immediately\n`;
      }
      prompt += `- On user message #${askAfter}, you MUST collect these fields before answering further\n`;
      prompt += `- BLOCK further assistance after message #${askAfter} until these fields are provided\n`;
      prompt += `- If user refuses, politely explain you need this info to continue helping them\n\n`;
    }

    if (requiredKeywordFields.length > 0) {
      prompt += `🔑 "KEYWORD" TIMING FIELDS (${requiredKeywordFields.join(', ')}):\n`;
      prompt += `- Collect when the user's message contains configured trigger keywords\n\n`;
    }

    prompt += `⚠️ CRITICAL: After collecting ALL required fields, IMMEDIATELY answer the user's ORIGINAL question\n`;
    prompt += `   - DO NOT ask "How can I assist you further?" - they already asked!\n`;
    prompt += `   - REMEMBER their original question from the conversation history\n`;
    prompt += `   - ANSWER it right after thanking them for their details\n\n`;

    prompt += `HANDLING REQUIRED FIELD REFUSALS (CRITICAL - MUST FOLLOW):\n`;
    prompt += `When a user refuses to provide a REQUIRED field:\n`;
    prompt += `🚫 REFUSAL PATTERNS TO DETECT: "no", "I don't want to", "skip", "not now", "later", "why do you need", "I'd rather not", "pass", "nope", "can't share"\n`;
    prompt += `1. ⛔ DO NOT accept the refusal - these fields are MANDATORY, not optional\n`;
    prompt += `2. ⛔ DO NOT move on to ask for the next field - stay on the current required field\n`;
    prompt += `3. ⛔ DO NOT ask for their name if they refused to provide their mobile number (or vice versa)\n`;
    prompt += `4. ✅ Politely explain why you need the information and ask again\n`;
    prompt += `5. ✅ Give a SPECIFIC reason: "I need your mobile number to provide personalized assistance and ensure we can follow up with you"\n`;
    prompt += `6. ✅ Be friendly but FIRM - you cannot proceed without required fields\n`;
    prompt += `7. ✅ VARY your responses - don't use the same phrases repeatedly\n\n`;
  }

  return prompt;
}

export function buildPhoneValidationOverride(userMessage: string, leadTrainingConfig: any): string | null {
  if (!leadTrainingConfig?.fields || !Array.isArray(leadTrainingConfig.fields)) {
    return null;
  }

  const phonePattern = /\+?[\d\s().-]{7,20}/g;
  const phoneMatches = userMessage.match(phonePattern);

  if (!phoneMatches || phoneMatches.length === 0) {
    return null;
  }

  const mobileField = leadTrainingConfig.fields.find((f: any) => f.id === 'mobile' && f.enabled);
  const whatsappField = leadTrainingConfig.fields.find((f: any) => f.id === 'whatsapp' && f.enabled);
  const phoneValidation = mobileField?.phoneValidation || whatsappField?.phoneValidation || '10';

  let foundValidPhone = false;
  let rejectedDigits = '';
  let rejectedDigitCount = 0;

  for (const match of phoneMatches) {
    const digitsOnly = match.replace(/[^\d]/g, '');
    if (digitsOnly.length < 7) continue;

    let isValid = false;
    switch (phoneValidation) {
      case '10': isValid = digitsOnly.length === 10; break;
      case '12': isValid = digitsOnly.length === 12; break;
      case '8-12': isValid = digitsOnly.length >= 8 && digitsOnly.length <= 12; break;
      case 'any': isValid = digitsOnly.length >= 7 && digitsOnly.length <= 15; break;
      default: isValid = digitsOnly.length === 10;
    }

    if (isValid) {
      foundValidPhone = true;
      break;
    } else {
      rejectedDigits = digitsOnly;
      rejectedDigitCount = digitsOnly.length;
    }
  }

  if (!foundValidPhone && rejectedDigits) {
    let requiredFormat = '';
    switch (phoneValidation) {
      case '10': requiredFormat = 'exactly 10 digits'; break;
      case '12': requiredFormat = 'exactly 12 digits'; break;
      case '8-12': requiredFormat = 'between 8 and 12 digits'; break;
      case 'any': requiredFormat = 'a valid length (7-15 digits)'; break;
      default: requiredFormat = 'exactly 10 digits';
    }
    console.log(`[Phone Validation Gate] REJECTED: "${userMessage}" has ${rejectedDigitCount} digits, requires ${requiredFormat}`);
    return `[PHONE VALIDATION FAILED: The user entered "${userMessage}" which contains "${rejectedDigits}" (${rejectedDigitCount} digits). This is INVALID — a valid number must have ${requiredFormat}. You MUST tell the user this number is not valid and ask them to provide a correct number with ${requiredFormat}. Do NOT accept it. Do NOT thank them. Respond naturally based on whatever field (mobile/WhatsApp/phone) you were asking about.]`;
  }

  return null;
}
