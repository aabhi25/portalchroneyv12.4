/**
 * Ordered, pipelined sentence-by-sentence text-to-speech for one answer.
 *
 * Sentences are enqueued as the answer streams in. Up to `maxParallel`
 * sentences are synthesised at once: the HEAD sentence's PCM is forwarded to
 * the client live, the next sentence's PCM is buffered and released the
 * instant the head finishes — so there is no network gap between sentences,
 * and audio always plays in order.
 *
 * Provider failure: if the primary provider (ElevenLabs) fails on a sentence
 * — an error, or no audio within `firstChunkTimeoutMs` — the pipeline marks
 * it broken for the rest of the answer and speaks that sentence, and every
 * later one, with the fallback provider (OpenAI TTS) instead of going silent.
 *
 * Cancellation (a confirmed interruption) aborts every in-flight request and
 * drops all buffered audio. Nothing is sent after `cancel()` returns.
 */

export type TtsSynthesize = (
  text: string,
  signal: AbortSignal,
  onChunk: (pcm: Buffer) => void,
) => Promise<void>;

export interface TtsProvider {
  name: string;
  synthesize: TtsSynthesize;
}

export interface SentenceTtsPipelineOptions {
  primary: TtsProvider | null;
  fallback?: TtsProvider | null;
  /** Receives even-length PCM16 buffers, in playback order. */
  sendAudio: (pcm: Buffer) => void;
  /** Checked before every send; true drops audio (e.g. response superseded). */
  isCancelled?: () => boolean;
  maxParallel?: number;
  firstChunkTimeoutMs?: number;
  onFirstAudio?: () => void;
  onProviderFailure?: (provider: string, error: unknown, text: string) => void;
}

interface PipelineItem {
  index: number;
  text: string;
  started: boolean;
  done: boolean;
  buffered: Buffer[];
  leftover: Buffer | null;
  emittedBytes: number;
  controller: AbortController | null;
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string })?.name === 'AbortError';
}

export class SentenceTtsPipeline {
  private readonly items: PipelineItem[] = [];
  private head = 0;
  private closed = false;
  private cancelled = false;
  private primaryBroken = false;
  private firstAudioSent = false;
  private finishedResolve: (() => void) | null = null;
  private readonly finishedPromise: Promise<void>;
  private readonly maxParallel: number;
  private readonly firstChunkTimeoutMs: number;
  /** Provider names used per sentence, for diagnostics and tests. */
  readonly providerLog: Array<{ index: number; provider: string; ok: boolean }> = [];

  constructor(private readonly options: SentenceTtsPipelineOptions) {
    this.maxParallel = Math.max(1, options.maxParallel ?? 2);
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 6000;
    this.finishedPromise = new Promise<void>((resolve) => { this.finishedResolve = resolve; });
  }

  /** Which providers spoke this answer, e.g. "elevenlabs" or "elevenlabs+openai" (diagnostics). */
  providerUsed(): string {
    const used = Array.from(new Set(this.providerLog.filter(p => p.ok).map(p => p.provider)));
    return used.join('+') || 'none';
  }

  /** Queue the next sentence (already converted to speech text). */
  enqueue(text: string): void {
    const t = (text || '').trim();
    if (!t || this.cancelled || this.closed) return;
    this.items.push({
      index: this.items.length, text: t, started: false, done: false,
      buffered: [], leftover: null, emittedBytes: 0, controller: null,
    });
    this.pump();
  }

  /** No more sentences will be enqueued. */
  close(): void {
    this.closed = true;
    this.checkFinished();
  }

  /** Resolves once every sentence has been sent (or the pipeline was cancelled). */
  finished(): Promise<void> {
    return this.finishedPromise;
  }

  /** Stop immediately: abort requests, drop buffered audio. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const item of this.items) {
      item.buffered = [];
      try { item.controller?.abort(); } catch { /* ignore */ }
    }
    this.finishedResolve?.();
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** True while audio may still be produced. */
  get isActive(): boolean {
    return !this.cancelled && (!this.closed || this.head < this.items.length);
  }

  get sentenceCount(): number {
    return this.items.length;
  }

  private externallyCancelled(): boolean {
    return this.cancelled || !!this.options.isCancelled?.();
  }

  private pump(): void {
    if (this.cancelled) return;
    const limit = Math.min(this.items.length, this.head + this.maxParallel);
    for (let i = this.head; i < limit; i++) {
      const item = this.items[i];
      if (!item.started) {
        item.started = true;
        void this.runItem(item);
      }
    }
  }

  private emit(item: PipelineItem, chunk: Buffer): void {
    if (this.externallyCancelled()) return;
    const merged = item.leftover ? Buffer.concat([item.leftover, chunk]) : chunk;
    const evenLen = merged.length & ~1;
    item.leftover = evenLen < merged.length ? Buffer.from(merged.subarray(evenLen)) : null;
    if (evenLen === 0) return;
    const aligned = merged.subarray(0, evenLen);
    if (item.index === this.head) {
      if (!this.firstAudioSent) {
        this.firstAudioSent = true;
        this.options.onFirstAudio?.();
      }
      item.emittedBytes += aligned.length;
      this.options.sendAudio(aligned);
    } else {
      item.buffered.push(Buffer.from(aligned));
    }
  }

  private async synthesizeWith(provider: TtsProvider, item: PipelineItem): Promise<void> {
    const controller = new AbortController();
    item.controller = controller;
    let gotAudio = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!gotAudio) {
        timedOut = true;
        try { controller.abort(); } catch { /* ignore */ }
      }
    }, this.firstChunkTimeoutMs);
    try {
      await provider.synthesize(item.text, controller.signal, (chunk) => {
        if (controller.signal.aborted) return;
        if (chunk.length > 0) gotAudio = true;
        this.emit(item, chunk);
      });
      if (timedOut) throw new Error(`${provider.name} produced no audio within ${this.firstChunkTimeoutMs}ms`);
    } catch (error) {
      if (timedOut && !this.cancelled) {
        throw new Error(`${provider.name} produced no audio within ${this.firstChunkTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runItem(item: PipelineItem): Promise<void> {
    const primary = this.options.primary;
    const fallback = this.options.fallback ?? null;
    const usePrimary = !!primary && !this.primaryBroken;
    const first = usePrimary ? primary! : fallback;
    try {
      if (first) {
        try {
          await this.synthesizeWith(first, item);
          this.providerLog.push({ index: item.index, provider: first.name, ok: true });
        } catch (error) {
          if (this.cancelled || (isAbortError(error) && this.externallyCancelled())) return;
          this.providerLog.push({ index: item.index, provider: first.name, ok: false });
          this.options.onProviderFailure?.(first.name, error, item.text);
          if (usePrimary && fallback) {
            this.primaryBroken = true;
            // Start the sentence over with the fallback voice.
            item.buffered = [];
            item.leftover = null;
            try {
              await this.synthesizeWith(fallback, item);
              this.providerLog.push({ index: item.index, provider: fallback.name, ok: true });
            } catch (fallbackError) {
              if (this.cancelled) return;
              this.providerLog.push({ index: item.index, provider: fallback.name, ok: false });
              this.options.onProviderFailure?.(fallback.name, fallbackError, item.text);
            }
          }
        }
      }
    } finally {
      item.done = true;
      item.controller = null;
      this.advance();
    }
  }

  /** Move the head past finished sentences, releasing buffered audio in order. */
  private advance(): void {
    if (this.cancelled) return;
    while (this.head < this.items.length && this.items[this.head].done) {
      this.head++;
      const next = this.items[this.head];
      if (next && next.buffered.length > 0) {
        const chunks = next.buffered;
        next.buffered = [];
        for (const chunk of chunks) {
          if (this.externallyCancelled()) break;
          if (!this.firstAudioSent) {
            this.firstAudioSent = true;
            this.options.onFirstAudio?.();
          }
          next.emittedBytes += chunk.length;
          this.options.sendAudio(chunk);
        }
      }
    }
    this.pump();
    this.checkFinished();
  }

  private checkFinished(): void {
    if (this.cancelled) return;
    if (this.closed && this.head >= this.items.length) this.finishedResolve?.();
  }
}
