/**
 * AI Calling — phone bridge: connects one phone call to the voice pipeline.
 *
 * RealtimeVoiceService normally talks to a browser over a WebSocket (binary PCM16 24 kHz
 * + JSON control messages). For a phone call we hand it a VIRTUAL client socket instead:
 * caller audio (already resampled to 24 kHz) is pushed in as binary messages, and whatever
 * the service "sends to the browser" (answer audio, ai_done, response_cancelled, duck…) is
 * turned into PhoneEngine events for the media stream (mediaStream.ts). The call therefore
 * gets the business's whole brain — knowledge, lead capture, identity, reply-language
 * policy, voice and gender, barge-in — without a second implementation.
 *
 * Fillers ("Let me check that") stay OFF on the phone: the service only plays them on video
 * calls, where a cached clip exists; on a phone line an uncached filler would arrive later
 * than the answer itself.
 */
import { EventEmitter } from "events";
import type { ChatContext } from "../../chatService";
import type { FixedLine } from "./phonePrompt";

export interface PhoneEngineEvents {
  /** Voice session is up; the call transcript lives in this conversation. */
  onReady(conversationId: string): void;
  /** A new answer (or fixed line) starts; following audio belongs to it. */
  onAnswerStart(responseId: string): void;
  /** Answer audio, PCM16 mono 24 kHz. */
  onAudio(pcm24k: Buffer): void;
  /** All audio of this answer has been produced. */
  onAiDone(responseId: string): void;
  /** The answer was cut off (confirmed barge-in): drop its audio now. */
  onCancelled(responseId: string): void;
  /** Possible interruption: hold the answer's audio until confirmed / resumed. */
  onDuck(): void;
  onUnduck(): void;
  /** A caller turn was accepted and is being answered. */
  onThinking(): void;
  onUserTranscript(text: string): void;
  onError(message: string): void;
  /** The voice session ended (by itself or because we closed it). */
  onClosed(reason: string): void;
}

export interface PhoneEngine {
  readonly conversationId: string | null;
  sendCallerAudio(pcm24k: Buffer): void;
  playbackComplete(responseId: string): void;
  /** Say a fixed line (localized when given as a FixedLine). Returns its responseId. */
  say(line: string | FixedLine, opts?: { persist?: boolean }): Promise<string | null>;
  close(): void;
}

export interface PhoneEngineStartInput {
  callId: string;
  businessAccountId: string;
  conversationTitle: string;
  chat: NonNullable<ChatContext["phoneCall"]>;
  skipLeadTraining: boolean;
  screenTranscript?: (text: string) => "continue" | "drop";
  onSpeech?: (event: "started" | "stopped") => void;
}

export type PhoneEngineFactory = (input: PhoneEngineStartInput, events: PhoneEngineEvents) => PhoneEngine | Promise<PhoneEngine>;

/** The subset of RealtimeVoiceService the bridge uses (lets tests pass a configured instance). */
export interface VoiceServiceLike {
  handleConnection(clientWs: any, businessAccountId: string, userId: string, existingConversationId?: string, selectedLanguage?: string, textConversationId?: string, topscholarDoubtId?: string, topscholarScope?: any, isInternalTest?: boolean, options?: any): Promise<void>;
  speakPhoneLine(conversationId: string, text: string, opts?: { persist?: boolean }): Promise<string | null>;
  phoneLocalizedText(conversationId: string, line: FixedLine): Promise<string>;
}

const OPEN = 1;
const CLOSED = 3;

/**
 * Looks like a `ws` WebSocket to RealtimeVoiceService: readyState, send, close, ping and
 * the 'message' / 'close' / 'error' events it subscribes to.
 */
export class VirtualClientSocket extends EventEmitter {
  readyState = OPEN;
  closeReason = "";

  constructor(private readonly onServerData: (data: Buffer | string) => void) {
    super();
    this.setMaxListeners(20);
  }

  /** Server → "browser". */
  send(data: unknown, _opts?: unknown, cb?: (err?: Error) => void): void {
    if (this.readyState !== OPEN) return;
    try {
      if (Buffer.isBuffer(data)) this.onServerData(data);
      else if (data instanceof ArrayBuffer) this.onServerData(Buffer.from(data));
      else if (ArrayBuffer.isView(data)) this.onServerData(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      else this.onServerData(String(data));
    } finally {
      cb?.();
    }
  }

  ping(): void {}
  pong(): void {}

  close(_code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (reason) this.closeReason = reason;
    // Like a real socket: 'close' fires asynchronously.
    setImmediate(() => this.emit("close", 1000, Buffer.from(this.closeReason || "")));
  }

  terminate(): void {
    this.close();
  }

  /** "Browser" → server. */
  pushAudio(pcm: Buffer): void {
    if (this.readyState !== OPEN) return;
    this.emit("message", pcm, true);
  }

  pushJson(message: Record<string, unknown>): void {
    if (this.readyState !== OPEN) return;
    this.emit("message", Buffer.from(JSON.stringify(message)), false);
  }
}

/** Real engine: one RealtimeVoiceService session per call. */
export function createVoiceServiceEngine(getService: () => VoiceServiceLike | Promise<VoiceServiceLike>): PhoneEngineFactory {
  return async (input, events) => {
    const service = await getService();
    let conversationId: string | null = null;
    let closeReason = "voice_closed";
    let closedNotified = false;

    const socket = new VirtualClientSocket((data) => {
      if (Buffer.isBuffer(data)) {
        if (data.length) events.onAudio(data);
        return;
      }
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }
      switch (msg?.type) {
        case "ready":
          if (typeof msg.conversationId === "string") {
            conversationId = msg.conversationId;
            events.onReady(msg.conversationId);
          }
          break;
        case "voice_message_start":
          if (msg.responseId) events.onAnswerStart(String(msg.responseId));
          break;
        case "ai_done":
          if (msg.responseId) events.onAiDone(String(msg.responseId));
          break;
        case "response_cancelled":
          if (msg.responseId) events.onCancelled(String(msg.responseId));
          break;
        case "duck":
          events.onDuck();
          break;
        case "unduck":
          events.onUnduck();
          break;
        case "thinking":
          events.onThinking();
          break;
        case "transcript":
          if (msg.isFinal && typeof msg.text === "string" && msg.text.trim()) events.onUserTranscript(msg.text);
          break;
        case "ping":
          socket.pushJson({ type: "pong" });
          break;
        case "error":
          closeReason = "voice_error";
          events.onError(String(msg.message || "error"));
          break;
        case "session_closed":
          closeReason = String(msg.reason || "voice_closed");
          break;
        default:
          break;
      }
    });
    socket.on("close", () => {
      if (closedNotified) return;
      closedNotified = true;
      events.onClosed(closeReason);
    });

    void service.handleConnection(
      socket,
      input.businessAccountId,
      `phone_${input.callId}`,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      {
        channel: "phone",
        phone: {
          callId: input.callId,
          conversationTitle: input.conversationTitle,
          chat: input.chat,
          skipLeadTraining: input.skipLeadTraining,
          screenTranscript: input.screenTranscript,
          onSpeech: input.onSpeech,
        },
      },
    ).catch((err: unknown) => {
      events.onError(err instanceof Error ? err.message : String(err));
      socket.close(1011, "voice_error");
    });

    return {
      get conversationId() { return conversationId; },
      sendCallerAudio(pcm24k: Buffer) {
        if (pcm24k.length) socket.pushAudio(pcm24k);
      },
      playbackComplete(responseId: string) {
        socket.pushJson({ type: "playback_complete", responseId });
      },
      async say(line, opts) {
        if (!conversationId || socket.readyState !== OPEN) return null;
        const text = typeof line === "string" ? line : await service.phoneLocalizedText(conversationId, line);
        if (socket.readyState !== OPEN) return null;
        return service.speakPhoneLine(conversationId, text, opts);
      },
      close() {
        closeReason = closeReason === "voice_closed" ? "call_ended" : closeReason;
        socket.close(1000, "call_ended");
      },
    };
  };
}
