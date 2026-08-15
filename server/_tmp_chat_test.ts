import { chatService } from './chatService';
import { storage } from './storage';
import { TOPSCHOLAR_ACCOUNT_ID } from './services/topscholar/config';

async function ask(label: string, message: string) {
  const businessAccountId = TOPSCHOLAR_ACCOUNT_ID;
  const settings = await storage.getWidgetSettings(businessAccountId);
  const businessAccount = await storage.getBusinessAccount(businessAccountId);
  const openaiApiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
  const context: any = {
    userId: 'verify-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    businessAccountId,
    openaiApiKey,
    personality: settings?.personality || 'friendly',
    responseLength: settings?.responseLength || 'balanced',
    companyDescription: businessAccount?.description || '',
    customInstructions: settings?.customInstructions || undefined,
    k12EducationEnabled: businessAccount?.k12EducationEnabled === 'true',
    // Pass flag FALSE on purpose — identity must still force content-only + tool.
    k12ContentOnlyMode: false,
    k12VerbatimContentMode: businessAccount?.k12VerbatimContentMode === 'true',
  };
  const reply = await chatService.processMessage(message, context);
  console.log(`\n##### ${label}: "${message}"`);
  console.log(reply);
}

async function main() {
  await ask('A in-syllabus', 'Opposite of Exhume');
  await ask('B off-syllabus', 'Who won the 2018 FIFA World Cup final and what was the score?');
  await ask('C greeting', 'hi');
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1); });
