/**
 * Per-message timing for the website / test / public-link text chat
 * (chatService.streamMessage), logged as ONE line when the turn ends, like the
 * voice [VoiceTiming] line:
 *
 *   [ChatTiming] first content 812ms | spam skipped | history 35ms | context 4ms |
 *   knowledge skipped (small_talk) | tools 12ms | lead 8ms | llm request +240 |
 *   first token +790 | first content +812 | done +1450 | tool calls 0 | live | "hey wassup"
 *
 * Durations ("history 35ms") are how long a stage took; "+N" marks are ms since the
 * message arrived. Stages that ran concurrently overlap, so durations don't add up.
 */
export class ChatTurnTiming {
  readonly startedAt = Date.now();
  private stages: Array<{ name: string; text: string }> = [];
  private marks = new Map<string, number>();
  toolCalls = 0;
  /** 'live' (streamed as written) or why the first answer was held back. */
  delivery: string | null = null;
  outcome = 'answered';
  private logged = false;

  constructor(private readonly text: string) {}

  /** Record a stage's duration (or a note such as "skipped (small_talk)"). Last write wins. */
  stage(name: string, msOrNote: number | string, note?: string): void {
    const text = typeof msOrNote === 'number' ? `${msOrNote}ms${note ? ` (${note})` : ''}` : msOrNote;
    const existing = this.stages.find(s => s.name === name);
    if (existing) existing.text = text;
    else this.stages.push({ name, text });
  }

  /** Time an async stage. */
  async time<T>(name: string, fn: () => Promise<T>, note?: string): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.stage(name, Date.now() - t, note);
    }
  }

  mark(name: string): void {
    if (!this.marks.has(name)) this.marks.set(name, Date.now());
  }

  has(name: string): boolean {
    return this.marks.has(name);
  }

  log(): void {
    if (this.logged) return;
    this.logged = true;
    const rel = (name: string) => {
      const at = this.marks.get(name);
      return at ? `+${at - this.startedAt}` : '—';
    };
    const first = this.marks.get('first content');
    const parts = [
      `[ChatTiming] ${first ? `first content ${first - this.startedAt}ms` : `no content (${this.outcome})`}`,
      ...this.stages.map(s => `${s.name} ${s.text}`),
      `llm request ${rel('llm request')}`,
      `first token ${rel('first token')}`,
      `first content ${rel('first content')}`,
      `done ${rel('done')}`,
      `tool calls ${this.toolCalls}`,
    ];
    if (this.delivery) parts.push(this.delivery);
    if (this.outcome !== 'answered') parts.push(`outcome ${this.outcome}`);
    const t = this.text.replace(/\s+/g, ' ').trim();
    parts.push(JSON.stringify(t.length > 40 ? `${t.slice(0, 40)}…` : t));
    console.log(parts.join(' | '));
  }
}
