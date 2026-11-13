import {
  HEARTBEAT_INTERVAL_MS,
  type ClientFrame,
  type PresenceState,
  type ServerFrame,
} from "@dyno/shared/protocol";
import { nextDelay } from "@/shared/net/backoff";

export type SocketState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** Presence fields the app attaches to every heartbeat. */
export interface SocketPresence {
  state: PresenceState;
  unfocus: boolean;
}

export type FrameHandler = (frame: ServerFrame) => void;
export type StateHandler = (state: SocketState, detail: { attempt: number; reason?: string }) => void;

/** Close codes that mean "no point retrying on our own": bad password, room gone. */
const FATAL_CODES = new Set([4403, 4404]);

export interface ChatSocketOptions {
  url: string;
  factory?: (url: string) => WebSocket;
  rand?: () => number;
  setTimeoutImpl?: (handler: () => void, ms: number) => number;
  clearTimeoutImpl?: (id: number) => void;
  setIntervalImpl?: (handler: () => void, ms: number) => number;
  clearIntervalImpl?: (id: number) => void;
}

/**
 * Reconnecting WebSocket client. Owns transport concerns only: no DOM, no
 * rendering, no application state.
 */
export class ChatSocket {
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private manualClose = false;
  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly factory: (url: string) => WebSocket;
  private readonly rand: () => number;
  private readonly setTimer: (handler: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;
  private readonly setInterval: (handler: () => void, ms: number) => number;
  private readonly clearInterval: (id: number) => void;
  private presence: SocketPresence = { state: "active", unfocus: false };

  state: SocketState = "idle";

  constructor(private readonly options: ChatSocketOptions) {
    this.factory = options.factory ?? ((url) => new WebSocket(url));
    this.rand = options.rand ?? Math.random;
    this.setTimer = options.setTimeoutImpl ?? ((handler, ms) => setTimeout(handler, ms) as unknown as number);
    this.clearTimer = options.clearTimeoutImpl ?? ((id) => clearTimeout(id));
    this.setInterval =
      options.setIntervalImpl ?? ((handler, ms) => setInterval(handler, ms) as unknown as number);
    this.clearInterval = options.clearIntervalImpl ?? ((id) => clearInterval(id));
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  connect(): void {
    this.manualClose = false;
    this.open();
  }

  /** Called by the app once the server confirms the session (`welcome`). */
  acknowledge(): void {
    this.attempt = 0;
  }

  send(frame: ClientFrame): boolean {
    if (this.socket === null || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  close(reason?: string): void {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.socket?.close(1000, reason ?? "client closed");
    this.socket = null;
    this.setState("closed", reason);
  }

  /** @brief Sends a heartbeat so the Worker keeps the session alive. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = this.setInterval(() => this.ping(), HEARTBEAT_INTERVAL_MS);
  }

  /**
   * @brief Sends one heartbeat carrying the current presence fields.
   * @details The Worker treats a heartbeat as the presence event: the page
   * visibility, window focus and the unfocus toggle all travel here.
   * @return void
   */
  private ping(): void {
    this.send({ t: "ping", state: this.presence.state, unfocus: this.presence.unfocus });
  }

  /**
   * @brief Updates the presence payload and announces a change immediately.
   * @details Waiting for the next heartbeat would leave the online list stale
   * for up to {@link HEARTBEAT_INTERVAL_MS}, which is the whole point of the
   * event. An unchanged patch costs nothing.
   * @param patch Fields to update; omitted fields keep their value.
   * @return void
   */
  setPresence(patch: Partial<SocketPresence>): void {
    const next: SocketPresence = {
      state: patch.state ?? this.presence.state,
      unfocus: patch.unfocus ?? this.presence.unfocus,
    };
    if (next.state === this.presence.state && next.unfocus === this.presence.unfocus) return;
    this.presence = next;
    this.ping();
  }

  /** @brief Stops the heartbeat interval. */
  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    this.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private open(): void {
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = this.factory(this.options.url);
    } catch (error) {
      this.scheduleRetry(String(error));
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.setState("open");
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame;
      } catch {
        return;
      }
      for (const handler of this.frameHandlers) handler(frame);
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      this.socket = null;
      // `close()` already reported the final state; the event arriving later
      // must not emit a second, reason-less "closed".
      if (this.manualClose) return;
      if (FATAL_CODES.has(event.code)) {
        this.setState("closed", `server closed: ${event.reason || event.code}`);
        return;
      }
      this.scheduleRetry(event.reason || `code ${event.code}`);
    });

    socket.addEventListener("error", () => {
      // `close` always follows, which is where the retry is scheduled.
    });
  }

  /**
   * Retries forever: an outage or a sleeping tab should heal on its own instead
   * of leaving the room dead until someone reloads the page. The delay is capped
   * at 30s, so long outages cost one request every half minute.
   */
  private scheduleRetry(reason: string): void {
    if (this.manualClose) return;

    const delay = nextDelay(this.attempt, this.rand);
    this.attempt += 1;
    this.setState("reconnecting", reason);

    this.timer = this.setTimer(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  private setState(state: SocketState, reason?: string): void {
    this.state = state;
    for (const handler of this.stateHandlers) handler(state, { attempt: this.attempt, reason });
  }
}
