/**
 * Fake OpenAI server with scripted answers for Aadhaar extraction scenarios.
 * Point the SDK at it with OPENAI_BASE_URL. Test-only.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { verhoeffCheckDigit } from "@shared/aadhaar";

export const VALID = (() => { const b = '23456789012'; return b + verhoeffCheckDigit(b); })();
export const MISREAD = VALID.slice(0, 6) + ((Number(VALID[6]) + 1) % 10) + VALID.slice(7);
export const VID = '9123456789012345';

// Scripted answers per scenario: [mini answer, gpt-4o answer]. The scenario id
// travels in the fake image data URL.
type Answer = { data: Record<string, string | null>; confidence: number; isValid?: boolean; side?: string | null; delayMs?: number; notes?: string };
export const SCENARIOS: Record<string, { cls?: string; mini: Answer; gpt4o?: Answer; byDoc?: Record<string, Answer> }> = {
  // A PAN card: the Aadhaar extractor says it's a different document; the PAN extractor reads it.
  pan_card: {
    cls: 'pan',
    mini: { data: {}, confidence: 0 },
    byDoc: {
      aadhaar: { data: { aadhaar_number: null, full_name: null, address: null, dob: null, gender: null, father_name: null }, confidence: 0, isValid: false, notes: 'actual_type=pan_card' },
      pan: { data: { pan_number: 'APRPC5124K', full_name: 'PRINCE CHAKRABORTY', dob: '14/06/1989', father_name: 'AVIJIT CHAKRABORTY' }, confidence: 0.96, side: 'front' },
    },
  },
  back_side: {
    mini: { data: { aadhaar_number: VALID, full_name: null, address: '12 MG Road, Pune, Maharashtra 411001', dob: null, gender: null, father_name: null }, confidence: 0.7, side: 'back' },
  },
  vid_on_back: {
    mini: { data: { aadhaar_number: VID, full_name: null, address: '12 MG Road, Pune 411001', dob: null, gender: null, father_name: null }, confidence: 0.9, side: 'back' },
    gpt4o: { data: { aadhaar_number: VALID, full_name: null, address: '12 MG Road, Pune 411001', dob: null, gender: null, father_name: null }, confidence: 0.95, side: 'back' },
  },
  misread_front: {
    mini: { data: { aadhaar_number: MISREAD, full_name: 'Asha Verma', address: null, dob: '01/02/1990', gender: 'Female', father_name: null }, confidence: 0.92, side: 'front' },
    gpt4o: { data: { aadhaar_number: VALID, full_name: 'Asha Verma', address: null, dob: '01/02/1990', gender: 'Female', father_name: null }, confidence: 0.97, side: 'front' },
  },
  masked: {
    mini: { data: { aadhaar_number: 'XXXX XXXX 1234', full_name: 'Asha Verma', address: '12 MG Road, Pune 411001', dob: null, gender: null, father_name: null }, confidence: 0.9, side: null },
  },
  slow_tier2: {
    mini: { data: { aadhaar_number: MISREAD, full_name: null, address: '5 Park Street, Kolkata 700016', dob: null, gender: null, father_name: null }, confidence: 0.8, side: 'back' },
    gpt4o: { data: { aadhaar_number: VALID, full_name: null, address: null, dob: null, gender: null, father_name: null }, confidence: 0.9, delayMs: 3000 },
  },
  both_sides: {
    mini: { data: { aadhaar_number: `${VALID.slice(0, 4)} ${VALID.slice(4, 8)} ${VALID.slice(8)}`, full_name: 'Asha Verma', address: '12 MG Road, Pune 411001', dob: '01/02/1990', gender: 'Female', father_name: null }, confidence: 0.95, side: null },
  },
  not_a_doc: { cls: 'unknown', mini: { data: {}, confidence: 0 } },
};

export interface Call { kind: 'classify' | 'strict'; model: string; scenario: string; detail?: string; system: string; user: string }
export const calls: Call[] = [];

/** Extra delay on extraction answers, to mimic real AI latency in conversation tests. */
export const fakeTiming = { extractionDelayMs: 0 };

export function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}');
      const system = body.messages?.[0]?.content || '';
      const userParts = body.messages?.[1]?.content || [];
      const image = userParts.find((p: any) => p.type === 'image_url');
      const payload = String(image?.image_url?.url || '').split(',')[1] || 'unknown';
      // The scenario id is either the raw payload or base64 of it (when it went
      // through the WhatsApp flow as an image buffer).
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      const scenario = SCENARIOS[payload] ? payload : SCENARIOS[decoded] ? decoded : payload;
      const userText = userParts.find((p: any) => p.type === 'text')?.text || '';
      const isClassify = /document type classifier/i.test(system);
      calls.push({ kind: isClassify ? 'classify' : 'strict', model: body.model, scenario, detail: image?.image_url?.detail, system, user: userText });
      const sc = SCENARIOS[scenario];
      let content: string;
      if (isClassify) {
        content = JSON.stringify({ docType: sc?.cls ?? 'aadhaar', confidence: 0.95, validationNotes: sc?.cls === 'unknown' ? 'appears to be a selfie' : null });
      } else {
        const docKey = /extraction specialist for PAN/i.test(system) ? 'pan' : /extraction specialist for Aadhaar/i.test(system) ? 'aadhaar' : '';
        const a = (sc.byDoc && sc.byDoc[docKey]) || (body.model === 'gpt-4o' ? (sc.gpt4o || sc.mini) : sc.mini);
        const delay = (a.delayMs || 0) + fakeTiming.extractionDelayMs;
        if (delay) await new Promise(r => setTimeout(r, delay));
        content = JSON.stringify({ extractedData: a.data, confidence: a.confidence, isValid: a.isValid ?? true, validationNotes: a.notes ?? null, side: a.side ?? null });
      }
      // The client may have given up (timeout); check the response side — req is
      // already "destroyed" once its body has been read.
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
  }));
}

