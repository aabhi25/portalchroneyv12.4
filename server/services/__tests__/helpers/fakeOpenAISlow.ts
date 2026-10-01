/**
 * Fake OpenAI server that streams SLOWLY (a delay between chunks) and records every
 * request with start / end times — for the chat-speed tests (live streaming must show
 * text before the model has finished). Test-only.
 *
 *  - /embeddings: deterministic vectors (fakeEmbedding), recorded with their inputs.
 *  - chat calls are classified (`purpose`) and answered by `script(call)` when it returns
 *    something, else by sensible defaults:
 *      spam      → state.spamVerdict ("OK" | "SPAM")      (first-message AI spam check)
 *      language  → "en"                                    (widget language detector)
 *      intro     → "Welcome to our club! How can I help?"  (AI widget greeting, slow)
 *      translate → "[translated] <text>"
 *      rephrase  → "REPHRASED FALLBACK: please contact our team."
 *      main      → `Here is what I found about "<message>".` streamed in small pieces
 *      continuation → "Here are the details you asked for."
 *  - a reply may carry `content` (streamed first — a "preamble" when tool calls follow)
 *    and/or `toolCalls`.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fakeEmbedding } from './fakeOpenAIChat';

export type SlowPurpose = 'embedding' | 'spam' | 'language' | 'intro' | 'translate' | 'rephrase' | 'main' | 'continuation' | 'other';

export interface SlowCall {
  kind: 'chat' | 'embedding';
  stream: boolean;
  purpose: SlowPurpose;
  messages: Array<{ role: string; content: any; tool_calls?: any; tool_call_id?: string }>;
  tools: any[];
  inputs?: string[];
  startedAt: number;
  endedAt?: number;
  /** Final system message (the "final rules" block) for chat calls. */
  finalRules: string;
}

export interface SlowReply {
  content?: string;
  /** Exact stream pieces (default: content split into 6-char pieces). */
  chunks?: string[];
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
}

export interface FakeSlowOpenAI {
  baseUrl: string;
  calls: SlowCall[];
  script: ((call: SlowCall) => SlowReply | null | undefined) | null;
  chunkDelayMs: number;
  nonStreamDelayMs: Partial<Record<SlowPurpose, number>>;
  spamVerdict: 'OK' | 'SPAM';
  reset(): void;
  of(purpose: SlowPurpose): SlowCall[];
  close(): Promise<void>;
}

export const textOf = (content: any): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text || '').join(' ') : content == null ? '' : JSON.stringify(content);

export const lastUserOf = (call: SlowCall): string => {
  for (let i = call.messages.length - 1; i >= 0; i--) if (call.messages[i].role === 'user') return textOf(call.messages[i].content);
  return '';
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function startFakeOpenAISlow(): Promise<FakeSlowOpenAI> {
  const state: FakeSlowOpenAI = {
    baseUrl: '',
    calls: [],
    script: null,
    chunkDelayMs: 60,
    nonStreamDelayMs: {},
    spamVerdict: 'OK',
    reset() { state.calls.length = 0; state.script = null; state.spamVerdict = 'OK'; },
    of(purpose) { return state.calls.filter(c => c.purpose === purpose); },
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      const startedAt = Date.now();
      if (req.url?.includes('/embeddings')) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        const call: SlowCall = { kind: 'embedding', stream: false, purpose: 'embedding', messages: [], tools: [], inputs, startedAt, finalRules: '' };
        state.calls.push(call);
        await sleep(state.nonStreamDelayMs.embedding ?? 0);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ object: 'list', model: body.model, data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: fakeEmbedding(String(t)) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
        call.endedAt = Date.now();
        return;
      }

      const messages = (body.messages || []) as SlowCall['messages'];
      const tools = body.tools || [];
      const all = messages.map(m => textOf(m.content)).join('\n');
      const sys0 = textOf(messages[0]?.content);
      const hasToolResult = messages.some(m => m.role === 'tool');
      const purpose: SlowPurpose = /spam detector/i.test(sys0) ? 'spam'
        : /language detector/i.test(sys0) ? 'language'
        : /Generate a brief, friendly welcome message|welcome back greeting/i.test(all) ? 'intro'
        : /^Translate the following text to/m.test(sys0) ? 'translate'
        : /FALLBACK MESSAGE TO USE AS BASE|Message to rephrase/.test(all) ? 'rephrase'
        : body.stream && hasToolResult ? 'continuation'
        : body.stream ? 'main' : 'other';
      const finalRules = textOf([...messages].reverse().find(m => m.role === 'system')?.content);
      const call: SlowCall = { kind: 'chat', stream: !!body.stream, purpose, messages, tools, startedAt, finalRules };
      state.calls.push(call);

      let reply: SlowReply | null | undefined = state.script ? state.script(call) : null;
      if (!reply) {
        switch (purpose) {
          case 'spam': reply = { content: state.spamVerdict }; break;
          case 'language': reply = { content: 'en' }; break;
          case 'intro': reply = { content: 'Welcome to our club! How can I help?' }; break;
          case 'translate': reply = { content: `[translated] ${lastUserOf(call)}` }; break;
          case 'rephrase': reply = { content: 'REPHRASED FALLBACK: please contact our team.' }; break;
          case 'continuation': reply = { content: 'Here are the details you asked for.' }; break;
          case 'main': reply = { content: `Here is what I found about "${lastUserOf(call).slice(0, 40)}".` }; break;
          default: reply = { content: 'OK' };
        }
      }

      if (!body.stream) {
        await sleep(state.nonStreamDelayMs[purpose] ?? 0);
        const message: any = { role: 'assistant', content: reply.content ?? null };
        if (reply.toolCalls?.length) {
          message.tool_calls = reply.toolCalls.map((t, i) => ({ id: `call_${i}_${Date.now()}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }));
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: reply.toolCalls?.length ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        call.endedAt = Date.now();
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      const pieces = reply.chunks || (reply.content ? reply.content.match(/[\s\S]{1,6}/g) || [] : []);
      for (const piece of pieces) {
        await sleep(state.chunkDelayMs);
        send({ content: piece });
      }
      if (reply.toolCalls?.length) {
        for (let i = 0; i < reply.toolCalls.length; i++) {
          const t = reply.toolCalls[i];
          await sleep(state.chunkDelayMs);
          send({ tool_calls: [{ index: i, id: `call_${i}_${Date.now()}`, type: 'function', function: { name: t.name, arguments: '' } }] });
          send({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(t.args) } }] });
        }
        send({}, 'tool_calls');
      } else {
        send({}, 'stop');
      }
      await sleep(state.chunkDelayMs);
      res.write('data: [DONE]\n\n');
      call.endedAt = Date.now();
      res.end();
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    state.baseUrl = `http://127.0.0.1:${port}/v1`;
    state.close = () => new Promise<void>(r => server.close(() => r()));
    resolve(state);
  }));
}
