/**
 * Scriptable fake OpenAI server for the website-chat lead-training tests. Test-only.
 *
 * Records every request (messages + tools) so tests can assert on the exact prompt, and answers:
 *  - /embeddings: deterministic vectors (fakeEmbedding);
 *  - chat calls: `script(call)` decides (text and/or tool calls); without a script it behaves like
 *    a compliant model: it follows the "LEAD COLLECTION (THIS TURN)" / OTP blocks in the final
 *    rules (asks for exactly the field the block names, or just answers).
 * Works for streaming and non-streaming calls.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fakeEmbedding } from './fakeOpenAIChat';

export interface LeadRecordedCall {
  stream: boolean;
  messages: Array<{ role: string; content: any; tool_calls?: any; tool_call_id?: string }>;
  tools: any[];
  purpose: 'main' | 'continuation' | 'name_extraction' | 'other';
  finalRules: string;
}

export interface ScriptReply { content?: string; toolCalls?: Array<{ name: string; args: Record<string, any> }> }
export type Script = (call: LeadRecordedCall) => ScriptReply | null | undefined;

export interface FakeLeadOpenAI {
  baseUrl: string;
  calls: LeadRecordedCall[];
  script: Script | null;
  nameExtraction: string;
  reset(): void;
  mainCalls(): LeadRecordedCall[];
  close(): Promise<void>;
}

export const textOf = (content: any): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text || '').join(' ') : content == null ? '' : JSON.stringify(content);

export const lastUser = (call: LeadRecordedCall) => {
  for (let i = call.messages.length - 1; i >= 0; i--) if (call.messages[i].role === 'user') return textOf(call.messages[i].content);
  return '';
};

/** What a well-behaved model would reply given the final rules. */
export function compliantReply(call: LeadRecordedCall): string {
  const rules = call.finalRules;
  if (/OTP VERIFICATION IN PROGRESS/.test(rules)) return 'Please enter the 6-digit code sent to your mobile.';
  const instr = (rules.match(/"_instruction":"([^"]+)"/) || [])[1];
  if (call.purpose === 'continuation' && instr) {
    const ask = instr.match(/ask (?:them to re-enter only their|for their|once for their) ([a-zA-Z ]+?)(?:[.(—]| only| \(| before|$)/);
    if (/re-enter/.test(instr) && ask) return `Sorry, that doesn't look right. Could you re-enter your ${ask[1].trim()}?`;
    if (/before answering/.test(instr) && ask) return `Thanks! Could you share your ${ask[1].trim()}?`;
  }
  const now = (rules.match(/^NOW: (.*)$/m) || [])[1] || '';
  const label = (s: string) => (s.match(/their (name|mobile number|WhatsApp number|email address)/) || [])[1];
  if (/^MANDATORY/.test(now)) return `I'd love to help with that! Before I answer, may I have your ${label(now)}?`;
  if (/also on WhatsApp/.test(now)) return 'Sure! Is this number also on WhatsApp?';
  if (/call back/.test(now)) return `Of course! Could you share your ${label(now)} so our team can call you?`;
  if (/ask (?:once|ONE more time)/.test(now) && label(now)) return `Here is the answer about "${lastUser(call).slice(0, 40)}". Could you share your ${label(now)}?`;
  return `Here is the answer about "${lastUser(call).slice(0, 40)}".`;
}

export function startFakeOpenAILead(port = 0): Promise<FakeLeadOpenAI> {
  const state: FakeLeadOpenAI = {
    baseUrl: '',
    calls: [],
    script: null,
    nameExtraction: 'NONE',
    reset() { state.calls.length = 0; state.script = null; state.nameExtraction = 'NONE'; },
    mainCalls() { return state.calls.filter(c => c.purpose === 'main'); },
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.includes('/embeddings')) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ object: 'list', model: body.model, data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: fakeEmbedding(String(t)) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
        return;
      }
      const messages = (body.messages || []) as LeadRecordedCall['messages'];
      const tools = body.tools || [];
      const sys0 = textOf(messages[0]?.content);
      const hasToolResult = messages.some(m => m.role === 'tool');
      const finalRules = textOf([...messages].reverse().find(m => m.role === 'system')?.content);
      const purpose: LeadRecordedCall['purpose'] = /Extract the person's name/.test(sys0) ? 'name_extraction'
        : hasToolResult ? 'continuation'
        : tools.length > 0 || /FINAL RULES|CRITICAL FINAL INSTRUCTION/.test(finalRules) ? 'main' : 'other';
      const call: LeadRecordedCall = { stream: !!body.stream, messages, tools, purpose, finalRules: purpose === 'continuation' ? finalRules + '\n' + messages.filter(m => m.role === 'tool').map(m => textOf(m.content)).join('\n') : finalRules };
      state.calls.push(call);

      let reply: ScriptReply;
      if (purpose === 'name_extraction') reply = { content: state.nameExtraction };
      else if (purpose === 'other') reply = { content: /language/i.test(sys0) ? 'en' : 'OK' };
      else reply = (state.script && state.script(call)) || { content: compliantReply(call) };

      if (!body.stream) {
        const message: any = { role: 'assistant', content: reply.content ?? null };
        if (reply.toolCalls?.length) {
          message.tool_calls = reply.toolCalls.map((t, i) => ({ id: `call_${i}_${Date.now()}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }));
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: reply.toolCalls?.length ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (reply.toolCalls?.length) {
        reply.toolCalls.forEach((t, i) => {
          send({ role: 'assistant', tool_calls: [{ index: i, id: `call_${i}_${Date.now()}`, type: 'function', function: { name: t.name, arguments: '' } }] });
          send({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(t.args) } }] });
        });
        send({}, 'tool_calls');
      } else {
        send({ role: 'assistant', content: '' });
        for (const piece of (reply.content || '').match(/[\s\S]{1,16}/g) || []) send({ content: piece });
        send({}, 'stop');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const bound = (server.address() as AddressInfo).port;
    state.baseUrl = `http://127.0.0.1:${bound}/v1`;
    state.close = () => new Promise<void>(r => server.close(() => r()));
    resolve(state);
  }));
}
