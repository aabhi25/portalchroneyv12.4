/**
 * Temporary verification for the single-turn voice answer fix. Delete after use.
 */
import { realtimeVoiceService } from './realtimeVoiceService';
import { ToolExecutionService } from './services/toolExecutionService';

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`  ✗ ${label}`); } else { console.log(`  ✓ ${label}`); }
}

function fakeConversation(transcript: string) {
  const sent: any[] = [];
  const toClient: any[] = [];
  const conversation: any = {
    businessAccountId: 'acct', userId: 'user', conversationId: 'conv',
    currentUserTranscript: transcript,
    k12ContentOnly: true,
    topscholarCpIds: ['cp'], topscholarChapter: null,
    cancelledResponseIds: new Set<string>(),
    openaiWs: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    clientWs: { readyState: 1, send: (raw: string) => toClient.push(JSON.parse(raw)) },
  };
  return { conversation, sent, toClient };
}

async function turn(label: string, transcript: string, stub: any, expected: {
  injects: boolean; toolsClosed: boolean; contextMatches?: RegExp;
}) {
  console.log(`\n--- ${label} ---`);
  const original = (ToolExecutionService as any).executeTool;
  (ToolExecutionService as any).executeTool = async () => stub;
  const { conversation, sent } = fakeConversation(transcript);
  try {
    await (realtimeVoiceService as any).sendNormalResponse(conversation);
  } finally {
    (ToolExecutionService as any).executeTool = original;
  }

  const context = sent.find(m => m.type === 'conversation.item.create');
  const create = sent.find(m => m.type === 'response.create');
  expect(!!create, 'a response was still requested (the turn is never dropped)');
  expect(!!context === expected.injects, expected.injects ? 'context injected' : 'nothing injected');
  expect((create?.response?.tool_choice === 'none') === expected.toolsClosed,
    expected.toolsClosed ? 'tool calling closed — single reply' : 'lookup left available for the model');
  if (expected.contextMatches) {
    expect(expected.contextMatches.test(context?.item?.content?.[0]?.text || ''), 'context says the right thing');
  }
}

async function main() {
  await turn('CONTENT FOUND', 'Tell me about stems',
    { success: true, message: 'Found 6 relevant passage(s) from your syllabus.', data: [{ topic: 'Stems', content: 'A stem supports the plant.' }] },
    { injects: true, toolsClosed: true, contextMatches: /ALREADY BEEN RUN/ });

  await turn('GENUINE NO MATCH', 'Tell me about quantum tunnelling',
    { success: true, message: 'No curriculum content found in your syllabus for "quantum tunnelling".', data: [] },
    { injects: true, toolsClosed: true, contextMatches: /found nothing/ });

  await turn('STORE UNREACHABLE (must not become a refusal)', 'Tell me about stems',
    { success: true, message: 'SYSTEM ERROR: The curriculum content store is temporarily unreachable. You MUST NOT answer the student\'s question from your general knowledge.', data: [] },
    { injects: false, toolsClosed: false });

  await turn('EXTERNAL API DOWN', 'Tell me about stems',
    { success: true, message: 'External API error: ECONNREFUSED', data: [] },
    { injects: false, toolsClosed: false });

  await turn('TOOL DISPATCH THREW', 'Tell me about stems',
    { success: false, error: 'boom' },
    { injects: false, toolsClosed: false });

  console.log('\n--- SERVER-SIDE CANCELLATION TELLS THE CLIENT ---');
  const { conversation, toClient } = fakeConversation('anything');
  conversation.isProcessing = true;
  conversation.currentResponseId = 'resp_live';
  conversation.ttsResponseId = 'resp_tts';
  conversation.activeElevenLabsAbort = { abort: () => {} };
  conversation.activeElevenLabsResponseId = 'resp_synth';
  (realtimeVoiceService as any).cancelResponse(conversation);
  const cancelled = toClient.filter(m => m.type === 'response_cancelled').map(m => m.responseId);
  expect(cancelled.includes('resp_live'), 'client told the live response was cancelled');
  expect(cancelled.includes('resp_tts'), 'client told the queued speech was cancelled');
  expect(cancelled.includes('resp_synth'), 'client told the in-flight synth was cancelled');
  expect(conversation.cancelledResponseIds.has('resp_live'), 'server still suppresses late chunks');

  console.log(failed === 0 ? '\nAll checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
