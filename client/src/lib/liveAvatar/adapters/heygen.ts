/**
 * HeyGen LiveAvatar (LITE) — browser side. SERVER audio route.
 *
 * Our server minted the session and holds the provider's command WebSocket
 * (it forwards our TTS audio there). The browser only joins the LiveKit room
 * (livekit_url + livekit_client_token from our server) and plays the avatar
 * participant's synced audio+video. We never publish the visitor's microphone
 * or camera into the room — the mic goes to OUR voice socket only.
 *
 * Uses `livekit-client` directly (the official @heygen/liveavatar-web-sdk calls
 * /v1/sessions/start itself and opens the command socket in the browser, which
 * would take audio control away from our server). The SDK's avatar participant
 * identity is "heygen".
 */
import { AdapterEvents, playInline, waitForFirstFrame, type AvatarClientAdapter, type AvatarConnectionInfo } from "../types";

const AVATAR_IDENTITY = "heygen";

export function createHeygenAdapter(): AvatarClientAdapter {
  const events = new AdapterEvents();
  let room: any = null;
  let videoEl: HTMLVideoElement | null = null;
  const attached: any[] = [];
  let closed = false;

  const attachTrack = (track: any) => {
    if (!videoEl || closed) return;
    try {
      track.attach(videoEl);
      attached.push(track);
    } catch (error) {
      console.warn("[LiveAvatar] attach failed", error);
    }
  };

  return {
    provider: "heygen_liveavatar",
    audioRoute: "server",

    async connect(video: HTMLVideoElement, info: AvatarConnectionInfo): Promise<void> {
      if (!info.livekitUrl || !info.livekitToken) throw new Error("missing LiveKit connection info");
      videoEl = video;
      const lk = await import("livekit-client");
      const { Room, RoomEvent } = lk;
      room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
        const identity = String(participant?.identity || "");
        // UNVERIFIED (from SDK source): the avatar publishes as identity "heygen".
        if (identity && identity !== AVATAR_IDENTITY && !identity.startsWith(AVATAR_IDENTITY)) return;
        if (track?.kind === "video" || track?.kind === "audio") attachTrack(track);
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        const talking = (speakers || []).some((p) => String(p?.identity || "").startsWith(AVATAR_IDENTITY));
        events.emit(talking ? "speaking" : "idle");
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
        if (String(participant?.identity || "").startsWith(AVATAR_IDENTITY) && !closed) events.emit("disconnected", "avatar left the room");
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!closed) events.emit("disconnected", "room disconnected");
      });
      await room.connect(info.livekitUrl, info.livekitToken, { autoSubscribe: true });
      // Tracks published before we joined arrive via TrackSubscribed as well.
      void playInline(video);
      await waitForFirstFrame(video, 30_000);
      events.emit("connected");
    },

    // Server route: audio and interruptions go through our server.
    interrupt() { /* the server sends agent.interrupt */ },

    setMuted(muted: boolean) {
      if (videoEl) videoEl.muted = muted;
    },

    setVolume(volume: number) {
      if (videoEl) videoEl.volume = Math.max(0, Math.min(1, volume));
    },

    providerSessionId() {
      return null;
    },

    on: (event, listener) => events.on(event, listener),

    async close() {
      if (closed) return;
      closed = true;
      for (const track of attached) {
        try { track.detach(); } catch { /* ignore */ }
      }
      attached.length = 0;
      try { await room?.disconnect(); } catch { /* ignore */ }
      room = null;
      if (videoEl) {
        try { videoEl.pause(); videoEl.srcObject = null; } catch { /* ignore */ }
      }
      events.clear();
    },
  };
}
