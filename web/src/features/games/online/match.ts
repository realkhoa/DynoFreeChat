/**
 * @file match.ts
 * @brief Online match orchestration on top of one room socket.
 * @details Both players join the same chat room, exchange a hello handshake, and
 * the lexicographically smaller session id hosts. The host picks the shared
 * seed, announces the start, and then both sides relay moves through the
 * Worker's opaque game frames. The match owns no game rules: it only decides who
 * moves first and delivers the opponent's payloads.
 */

import type { OnlineBridge, OnlinePhase, OnlineSeat } from "./bridge";
import { RoomChannel, type SocketFactory } from "./channel";
import { MATCH_PROTOCOL_VERSION, decodeMessage, encodeMessage, type MatchMessage } from "./protocol";

/** Options for one online match. */
export interface OnlineMatchOptions {
  /** Absolute socket URL of the room. */
  url: string;
  /** Local nickname. */
  nick: string;
  /** Local avatar colour. */
  color: string;
  /** Room password, when locked. */
  pass?: string;
  /** Game id both sides must agree on. */
  game: string;
  /** Random session id; tests inject a deterministic one. */
  sessionId?: string;
  /** Socket constructor seam. */
  socketFactory?: SocketFactory;
  /** Random source for the shared seed. */
  random?: () => number;
  /** Called once both sides agreed and the match can start. */
  onStart: (bridge: OnlineBridge) => void;
  /** Called with every status line change. */
  onStatus?: (text: string) => void;
  /** Called with protocol or transport errors. */
  onError?: (text: string) => void;
  /** Called with every phase change. */
  onPhase?: (phase: OnlinePhase) => void;
}

/**
 * @brief Owns one online match: handshake, role election and move relay.
 */
export class OnlineMatch {
  private readonly channel: RoomChannel;
  private readonly sessionId: string;
  private phase: OnlinePhase = "connecting";
  private peerId: string | null = null;
  private peerNick: string | null = null;
  private seed = 0;
  private seq = 0;
  private lastPeerSeq = -1;
  private started = false;
  private leaving = false;
  private hostRole: boolean | null = null;
  private bridge: OnlineBridge | null = null;

  private readonly moveHandlers = new Set<(payload: unknown) => void>();
  private readonly peerLeftHandlers = new Set<() => void>();
  private readonly phaseHandlers = new Set<(phase: OnlinePhase) => void>();

  /**
   * @param options Match configuration and callbacks.
   */
  constructor(private readonly options: OnlineMatchOptions) {
    this.sessionId = options.sessionId ?? randomId(options.random);
    this.channel = new RoomChannel(
      {
        onWelcome: () => this.handleWelcome(),
        onGame: (data, nick) => this.handleGame(data, nick),
        onPresence: (online) => this.handlePresence(online),
        onError: (code, detail) => this.handleError(code, detail),
        onClose: () => this.handleClose(),
      },
      options.socketFactory,
    );
  }

  /** Current transport phase. */
  get currentPhase(): OnlinePhase {
    return this.phase;
  }

  /** Nick of the opponent, once known. */
  get opponentNick(): string | null {
    return this.peerNick;
  }

  /** @brief Opens the room socket and begins the handshake. */
  start(): void {
    this.setPhase("connecting");
    this.setStatus("joining room…");
    this.channel.connect({
      url: this.options.url,
      nick: this.options.nick,
      color: this.options.color,
      ...(this.options.pass !== undefined ? { pass: this.options.pass } : {}),
    });
  }

  /** @brief Leaves the room and tears the socket down. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.send({ k: "bye" });
    this.channel.close();
    this.setPhase("closed");
    this.setStatus("left the match");
  }

  /** @brief Handles the accepted join: announce ourselves to the peer. */
  private handleWelcome(): void {
    this.sendHello();
    this.setStatus("waiting for opponent…");
    this.setPhase("waiting");
  }

  /** @brief Sends (or re-sends) the hello handshake. */
  private sendHello(): void {
    this.send({
      k: "hello",
      v: MATCH_PROTOCOL_VERSION,
      id: this.sessionId,
      game: this.options.game,
      nick: this.options.nick,
    });
  }

  /** @brief Sends the start message; only the host calls this. */
  private sendStart(): void {
    this.send({ k: "start", v: MATCH_PROTOCOL_VERSION, seed: this.seed, game: this.options.game });
  }

  /**
   * @brief Handles one relayed frame.
   * @param data Encoded match message.
   * @param nick Sender nick as attached by the Worker.
   */
  private handleGame(data: string, nick: string): void {
    const message = decodeMessage(data);
    if (message === null) return;

    if (message.k === "hello") {
      if (message.game !== this.options.game) {
        this.send({ k: "bye" });
        this.options.onError?.(`opponent wants ${message.game}, not ${this.options.game}`);
        return;
      }
      this.peerId = message.id;
      this.peerNick = nick.length > 0 ? nick : message.nick;
      this.setStatus(`matched with ${this.peerNick}`);

      // Both sides compare the same pair of ids, so they agree on the host.
      this.hostRole = this.sessionId < message.id;
      if (this.hostRole) {
        if (!this.started) {
          this.seed = Math.floor((this.options.random ?? Math.random)() * 1_000_000_000);
          this.sendStart();
          this.begin("host");
        }
      } else {
        this.setStatus(`waiting for ${this.peerNick} to start…`);
      }
      return;
    }

    if (message.k === "start") {
      if (this.started) return;
      this.seed = message.seed;
      this.begin("guest");
      return;
    }

    if (message.k === "move") {
      if (message.seq <= this.lastPeerSeq) return;
      this.lastPeerSeq = message.seq;
      for (const handler of this.moveHandlers) handler(message.payload);
      return;
    }

    if (message.k === "bye") {
      this.notifyPeerLeft();
    }
  }

  /**
   * @brief Handles presence changes: the peer dropping out ends the match.
   * @param online Current player count.
   */
  private handlePresence(online: number): void {
    if (online >= 2) {
      if (!this.started) {
        // A hello sent before the peer had joined is dropped by the relay, so the
        // second presence frame is the reliable moment to (re)announce ourselves.
        if (this.peerId === null) this.sendHello();
        else if (this.hostRole === true) this.sendStart();
      }
      this.setStatus(this.started ? "match running" : "opponent connected");
      return;
    }
    if (this.started) this.notifyPeerLeft();
  }

  /**
   * @brief Maps a server refusal to a readable message.
   * @param code Error code from the Worker.
   * @param detail Optional detail (e.g. retry delay).
   */
  private handleError(code: string, detail?: string): void {
    if (code === "BAD_PASS") {
      this.options.onError?.("wrong room password");
      return;
    }
    if (code === "RATE_LIMIT") {
      this.options.onError?.(`too many frames, retry in ${detail ?? "?"}ms`);
      return;
    }
    if (code === "ROOM_FULL") {
      this.options.onError?.("room is full");
      return;
    }
    this.options.onError?.(`server refused the match: ${code}`);
  }

  /** @brief Handles an unexpected socket close. */
  private handleClose(): void {
    if (this.leaving) return;
    if (this.started) this.notifyPeerLeft();
    else {
      this.setPhase("closed");
      this.setStatus("connection closed");
    }
  }

  /**
   * @brief Publishes the match start to the game.
   * @param role Role of the local player.
   */
  private begin(role: "host" | "guest"): void {
    if (this.started) return;
    this.started = true;
    this.setPhase("playing");
    this.setStatus(role === "host" ? "you host — your move" : "guest — waiting for host move");

    const seat: OnlineSeat = role === "host" ? 1 : 2;
    const bridge: OnlineBridge = {
      role,
      seat,
      seed: this.seed,
      peerNick: this.peerNick,
      sendMove: (payload) => {
        this.seq += 1;
        this.send({ k: "move", seq: this.seq, payload });
      },
      onMove: (handler) => {
        this.moveHandlers.add(handler);
        return () => this.moveHandlers.delete(handler);
      },
      onPeerLeft: (handler) => {
        this.peerLeftHandlers.add(handler);
        return () => this.peerLeftHandlers.delete(handler);
      },
      onPhase: (handler) => {
        this.phaseHandlers.add(handler);
        return () => this.phaseHandlers.delete(handler);
      },
      setStatus: (text) => this.setStatus(text),
      leave: () => this.leave(),
    };
    this.bridge = bridge;
    this.options.onStart(bridge);
  }

  /** @brief Notifies the game that the opponent is gone. */
  private notifyPeerLeft(): void {
    this.setPhase("peer-left");
    this.setStatus("opponent left the match");
    for (const handler of this.peerLeftHandlers) handler();
    this.bridge?.setStatus("opponent left — press Leave, then start a new match");
  }

  /**
   * @brief Sends one protocol message when the socket is open.
   * @param message Message to send.
   */
  private send(message: MatchMessage): void {
    this.channel.sendGame(encodeMessage(message));
  }

  /**
   * @brief Updates the phase and notifies subscribers.
   * @param phase New phase.
   */
  private setPhase(phase: OnlinePhase): void {
    this.phase = phase;
    this.options.onPhase?.(phase);
    for (const handler of this.phaseHandlers) handler(phase);
  }

  /**
   * @brief Updates the status line.
   * @param text Short status text.
   */
  private setStatus(text: string): void {
    this.options.onStatus?.(text);
  }
}

/**
 * @brief Builds a random session id used for host election.
 * @param random Random source.
 * @return Lower-case base-36 id.
 */
function randomId(random: (() => number) | undefined): string {
  const source = random ?? Math.random;
  return `${Math.floor(source() * 0xffffffff).toString(36)}${Math.floor(source() * 0xffffffff).toString(36)}`;
}
