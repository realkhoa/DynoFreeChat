/**
 * @file bridge.ts
 * @brief Contract between an online match and one game module.
 * @details A game that supports online play receives a bridge when it mounts.
 * The bridge hides the transport: the game emits its own moves and applies the
 * opponent's, while the match handles the room socket, role election and
 * presence. Games without online support simply ignore the context.
 */

/** Seat of the local player: seat 1 moves first, seat 2 answers. */
export type OnlineSeat = 1 | 2;

/** Connection state surfaced to the game and the lobby. */
export type OnlinePhase = "connecting" | "waiting" | "playing" | "peer-left" | "closed";

/**
 * @brief Live match handle handed to the mounted game.
 */
export interface OnlineBridge {
  /** Role of the local player in the room handshake. */
  readonly role: "host" | "guest";
  /** Seat of the local player: 1 moves first. */
  readonly seat: OnlineSeat;
  /** Shared seed the host chose; both sides build the same starting position. */
  readonly seed: number;
  /** Nick of the opponent, once their hello arrived. */
  readonly peerNick: string | null;
  /** Sends one local move to the opponent. */
  sendMove(payload: unknown): void;
  /**
   * Subscribes to the opponent's moves.
   * @param handler Called with the decoded payload.
   * @return Unsubscribe function.
   */
  onMove(handler: (payload: unknown) => void): () => void;
  /**
   * Subscribes to the opponent leaving the room.
   * @param handler Called once.
   * @return Unsubscribe function.
   */
  onPeerLeft(handler: () => void): () => void;
  /**
   * Subscribes to transport phase changes.
   * @param handler Called with the new phase.
   * @return Unsubscribe function.
   */
  onPhase(handler: (phase: OnlinePhase) => void): () => void;
  /**
   * Replaces the shared status line.
   * @param text Short status text.
   */
  setStatus(text: string): void;
  /** Leaves the room and tears the socket down. */
  leave(): void;
}
