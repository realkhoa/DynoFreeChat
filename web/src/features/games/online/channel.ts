/**
 * @file channel.ts
 * @brief Minimal room socket used by online matches.
 * @details The chat client owns the room UI; a match only needs to join a room
 * and exchange opaque `game` frames, so this wrapper keeps a tiny surface and a
 * socket factory seam for tests. The Worker already rate-limits and relays game
 * frames between joined sockets, so nothing extra is required server side.
 */

import { HEARTBEAT_INTERVAL_MS, type ServerFrame } from "@dyno/shared/protocol";
import { readPresenceState, watchPresence } from "@/shared/net/presence";

/** Options for one room connection. */
export interface RoomChannelOptions {
  /** Absolute socket URL including the room slug. */
  url: string;
  /** Nickname announced in the join frame. */
  nick: string;
  /** Avatar colour announced in the join frame. */
  color: string;
  /** Room password, when the room is locked. */
  pass?: string;
}

/** Callbacks the match listens to. */
export interface RoomChannelHandlers {
  /** The join was accepted. */
  onWelcome: (info: { slug: string; locked: boolean; online: number }) => void;
  /** One relayed game frame arrived from a peer. */
  onGame: (data: string, nick: string) => void;
  /** Presence count changed. */
  onPresence: (online: number) => void;
  /** The server refused a frame. */
  onError: (code: string, detail?: string) => void;
  /** The socket closed. */
  onClose: () => void;
}

/** Factory seam so tests can hand in a fake socket. */
export type SocketFactory = (url: string) => WebSocket;

/**
 * @brief Owns one room socket for an online match.
 */
export class RoomChannel {
  private socket: WebSocket | null = null;
  private online = 0;
  private closed = false;
  private pingTimer: number | null = null;
  private unwatchPresence: (() => void) | null = null;

  /**
   * @param handlers Channel callbacks.
   * @param socketFactory Socket constructor seam.
   */
  constructor(
    private readonly handlers: RoomChannelHandlers,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url),
  ) {}

  /** Number of players currently in the room. */
  get playerCount(): number {
    return this.online;
  }

  /** Whether the socket is still open. */
  get isOpen(): boolean {
    return this.socket !== null && !this.closed;
  }

  /**
   * @brief Opens the socket and joins the room.
   * @param options Connection details.
   */
  connect(options: RoomChannelOptions): void {
    this.close();

    const socket = this.socketFactory(options.url);
    this.socket = socket;
    this.closed = false;

    socket.addEventListener("open", () => {
      const join: Record<string, string> = { t: "join", nick: options.nick, color: options.color };
      if (options.pass !== undefined && options.pass.length > 0) join.pass = options.pass;
      socket.send(JSON.stringify(join));
      this.pingTimer = window.setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS);
      // A tab switch is a presence event, not something to discover 10s later.
      this.unwatchPresence = watchPresence(() => this.sendPing());
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      const frame = this.parseFrame(String(event.data));
      if (frame === null) return;

      if (frame.t === "welcome") {
        this.online = Math.max(1, this.online);
        this.handlers.onWelcome({ slug: frame.room.slug, locked: frame.room.locked, online: this.online });
        return;
      }
      if (frame.t === "game") {
        this.handlers.onGame(frame.data, frame.nick);
        return;
      }
      if (frame.t === "presence") {
        this.online = frame.online;
        this.handlers.onPresence(frame.online);
        return;
      }
      if (frame.t === "error") {
        this.handlers.onError(frame.code, frame.detail);
      }
    });

    socket.addEventListener("close", () => {
      this.closed = true;
      this.socket = null;
      this.stopPing();
      this.handlers.onClose();
    });

    socket.addEventListener("error", () => {
      this.handlers.onError("SOCKET_ERROR");
    });
  }

  /**
   * @brief Sends one game frame.
   * @param data Encoded match message.
   * @return Whether the frame was sent.
   */
  sendGame(data: string): boolean {
    if (this.socket === null || this.closed) return false;
    try {
      this.socket.send(JSON.stringify({ t: "game", data }));
      return true;
    } catch {
      return false;
    }
  }

  /** @brief Sends one heartbeat frame carrying the current presence state. */
  private sendPing(): void {
    if (this.socket === null || this.closed) return;
    try {
      this.socket.send(JSON.stringify({ t: "ping", state: readPresenceState(), unfocus: false }));
    } catch {
      // The close handler will clean up a dead socket.
    }
  }

  /** @brief Stops the heartbeat interval and presence watcher. */
  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.unwatchPresence !== null) {
      this.unwatchPresence();
      this.unwatchPresence = null;
    }
  }

  /** @brief Closes the socket without notifying the handlers. */
  close(): void {
    this.stopPing();
    if (this.socket === null) return;
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  /**
   * @brief Parses one server frame, ignoring junk.
   * @param raw Frame text.
   * @return The frame, or `null`.
   */
  private parseFrame(raw: string): ServerFrame | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.t !== "string") return null;
      return parsed as ServerFrame;
    } catch {
      return null;
    }
  }
}
