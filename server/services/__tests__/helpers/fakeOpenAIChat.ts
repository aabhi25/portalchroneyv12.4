/**
 * Fake OpenAI server for website-chat tests and the context benchmark. Test-only.
 *
 *  - /embeddings: deterministic bag-of-words vectors (hashed keywords + a shared
 *    component, so unrelated texts score ~0.25 and related ones 0.45–0.9, roughly like
 *    text-embedding-3-small). Only the first 512 dimensions are used, so the truncated
 *    passage vectors in chatContext/passageVectors.ts lose nothing.
 *  - /chat/completions: records every request. Streaming main call: if the final rules
 *    tell the model to call tools first ("TOOL USAGE (CRITICAL)"), it calls get_faqs —
 *    what the real model does with that instruction; otherwise it answers directly.
 *    Non-streaming calls answer "en" to the language detector and "OK" to everything
 *    else (spam check, titles).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tokenize } from '../../chatContext/lexical';

export const EMBED_DIMS = 1536;
const HASH_DIMS = 500;
const COMMON_DIM = 511;
const COMMON_WEIGHT = 0.6;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function fakeEmbedding(text: string): number[] {
  const v = new Array(EMBED_DIMS).fill(0);
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) || 0) + 1);
  let norm = 0;
  counts.forEach((c, t) => {
    const h = fnv1a(t);
    const idx = h % HASH_DIMS;
    const w = (h & 0x10000 ? 1 : -1) * (1 + Math.log(c));
    v[idx] += w;
  });
  for (let i = 0; i < HASH_DIMS; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIMS; i++) v[i] /= norm;
  v[COMMON_DIM] = COMMON_WEIGHT;
  const total = Math.sqrt(1 + COMMON_WEIGHT * COMMON_WEIGHT);
  return v.map(x => x / total);
}

export interface RecordedCall {
  kind: 'chat' | 'embedding';
  stream: boolean;
  model?: string;
  messages: Array<{ role: string; content: any; tool_calls?: any }>;
  tools: any[];
  toolChoice?: any;
  inputs?: string[];
  purpose: 'main' | 'continuation' | 'language' | 'other' | 'embedding';
  at: number;
}

export interface FakeOpenAI {
  baseUrl: string;
  calls: RecordedCall[];
  reset(): void;
  close(): Promise<void>;
}

function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => p?.text || '').join(' ');
  return content == null ? '' : JSON.stringify(content);
}

export function lastUserText(messages: RecordedCall['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return textOf(messages[i].content);
  return '';
}

/** Rough prompt size of a recorded chat call (chars/4 over message text + tool schemas). */
export function promptTokens(call: RecordedCall): number {
  const chars = call.messages.reduce((n, m) => n + textOf(m.content).length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0)
    + (call.tools?.length ? JSON.stringify(call.tools).length : 0)
    + (call.inputs ? call.inputs.join('').length : 0);
  return Math.ceil(chars / 4);
}

export function promptText(call: RecordedCall): string {
  return call.messages.map(m => textOf(m.content)).join('\n\n');
}

export function startFakeOpenAIChat(): Promise<FakeOpenAI> {
  const calls: RecordedCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.includes('/embeddings')) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        calls.push({ kind: 'embedding', stream: false, messages: [], tools: [], inputs, purpose: 'embedding', at: Date.now() });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          object: 'list', model: body.model,
          data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: fakeEmbedding(String(t)) })),
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }));
        return;
      }

      const messages = (body.messages || []) as RecordedCall['messages'];
      const tools = body.tools || [];
      const sys0 = textOf(messages[0]?.content);
      const hasToolResult = messages.some(m => m.role === 'tool');
      const purpose: RecordedCall['purpose'] = /language detector/i.test(sys0) ? 'language'
        : body.stream && hasToolResult ? 'continuation'
        : body.stream ? 'main' : 'other';
      calls.push({ kind: 'chat', stream: !!body.stream, model: body.model, messages, tools, toolChoice: body.tool_choice, purpose, at: Date.now() });

      if (!body.stream) {
        const content = purpose === 'language' ? 'en' : 'OK';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'x', object: 'chat.completion', created: 0, model: body.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({
        id: 'c', object: 'chat.completion.chunk', created: 0, model: body.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      const finalRules = textOf([...messages].reverse().find(m => m.role === 'system')?.content);
      const toolFirst = /TOOL USAGE \(CRITICAL\)/.test(finalRules);
      const canFaq = tools.some((t: any) => t?.function?.name === 'get_faqs');
      if (purpose === 'main' && toolFirst && canFaq) {
        send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_faqs', arguments: '' } }] });
        send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ query: lastUserText(messages) }) } }] });
        send({}, 'tool_calls');
      } else {
        const answer = `Here is what I found about "${lastUserText(messages).slice(0, 60)}".`;
        send({ role: 'assistant', content: '' });
        for (const piece of answer.match(/.{1,12}/g) || []) send({ content: piece });
        send({}, 'stop');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    resolve({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      calls,
      reset: () => { calls.length = 0; },
      close: () => new Promise<void>(r => server.close(() => r())),
    });
  }));
}
