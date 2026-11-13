// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createChessGame, squareIndex } from "@/features/games/chess/game";
import type { OnlineBridge, OnlinePhase } from "@/features/games/online/bridge";

interface FakeBridge extends OnlineBridge {
  /** Payloads the game sent to the opponent. */
  readonly moves: unknown[];
  /** Delivers one opponent move to the game. */
  emitMove: (payload: unknown) => void;
  /** Simulates the opponent leaving. */
  emitPeerLeft: () => void;
  /** Statuses the game asked the bridge to show. */
  readonly statuses: string[];
}

/**
 * @brief Builds a scriptable online bridge for one seat.
 * @param seat Local seat, 1 moves first.
 * @return The fake bridge.
 */
function fakeBridge(seat: 1 | 2): FakeBridge {
  const moves: unknown[] = [];
  const statuses: string[] = [];
  const moveHandlers = new Set<(payload: unknown) => void>();
  const peerHandlers = new Set<() => void>();
  const phaseHandlers = new Set<(phase: OnlinePhase) => void>();

  return {
    role: seat === 1 ? "host" : "guest",
    seat,
    seed: 42,
    peerNick: "Bob",
    moves,
    statuses,
    sendMove: (payload) => moves.push(payload),
    onMove: (handler) => {
      moveHandlers.add(handler);
      return () => moveHandlers.delete(handler);
    },
    onPeerLeft: (handler) => {
      peerHandlers.add(handler);
      return () => peerHandlers.delete(handler);
    },
    onPhase: (handler) => {
      phaseHandlers.add(handler);
      return () => phaseHandlers.delete(handler);
    },
    setStatus: (text) => statuses.push(text),
    leave: vi.fn(),
    emitMove: (payload) => {
      for (const handler of moveHandlers) handler(payload);
    },
    emitPeerLeft: () => {
      for (const handler of peerHandlers) handler();
    },
  };
}

/** Mounts chess into a detached host with the given bridge. */
function mountChess(bridge: FakeBridge): { host: HTMLElement; game: ReturnType<typeof createChessGame> } {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createChessGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Re-queries one board cell by algebraic name (the board is rebuilt on render). */
function cell(host: HTMLElement, name: string): HTMLButtonElement | null {
  return host.querySelectorAll<HTMLButtonElement>(".stage-cell")[squareIndex(name)] ?? null;
}

/** Clicks one square on the freshly rendered board. */
function click(host: HTMLElement, name: string): void {
  cell(host, name)?.click();
}

/** Current status line text. */
function status(host: HTMLElement): string {
  return host.querySelector(".stage-status")?.textContent ?? "";
}

describe("Chess online", () => {
  it("relays the White opening move and updates the board", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountChess(bridge);
    expect(status(host)).toContain("Your move");
    expect(status(host)).toContain("White");

    click(host, "e2");
    expect(cell(host, "e3")?.textContent).toBe("·");
    click(host, "e4");

    expect(cell(host, "e4")?.textContent).toBe("\u2659");
    expect(cell(host, "e2")?.textContent).toBe("");
    expect(bridge.moves).toEqual([{ from: squareIndex("e2"), to: squareIndex("e4") }]);
    expect(status(host)).toContain("Opponent's move");
    game.unmount();
  });

  it("keeps seat 2 from moving first and then plays Black", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountChess(bridge);
    expect(status(host)).toContain("you are Black");

    // White opens, so the guest cannot select or move anything yet.
    click(host, "e7");
    click(host, "e5");
    expect(cell(host, "e7")?.textContent).toBe("\u265F");
    expect(cell(host, "e5")?.textContent).toBe("");
    expect(bridge.moves).toEqual([]);
    expect(status(host)).toContain("Opponent's move");

    bridge.emitMove({ from: squareIndex("e2"), to: squareIndex("e4") });
    expect(cell(host, "e4")?.textContent).toBe("\u2659");
    expect(status(host)).toContain("Your move");

    click(host, "e7");
    click(host, "e5");
    expect(cell(host, "e5")?.textContent).toBe("\u265F");
    expect(bridge.moves).toEqual([{ from: squareIndex("e7"), to: squareIndex("e5") }]);
    game.unmount();
  });

  it("ignores malformed and illegal remote payloads", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountChess(bridge);
    const before = status(host);
    const payloads: unknown[] = [
      null,
      undefined,
      42,
      "e2e4",
      {},
      { from: squareIndex("e2") },
      { from: "52", to: "36" },
      { from: 52.5, to: 36 },
      { from: -1, to: 36 },
      { from: 0, to: 99 },
      // Legal indices, but a pawn cannot jump from e2 to e6.
      { from: squareIndex("e2"), to: squareIndex("e6") },
      { from: squareIndex("e2"), to: squareIndex("e4"), promotion: "q" },
    ];

    for (const payload of payloads) {
      expect(() => bridge.emitMove(payload)).not.toThrow();
    }
    expect(cell(host, "e2")?.textContent).toBe("\u2659");
    expect(cell(host, "e4")?.textContent).toBe("");
    expect(status(host)).toBe(before);
    game.unmount();
  });

  it("ignores remote payloads that are out of turn", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountChess(bridge);

    // It is White's turn, so a Black move is out of turn.
    bridge.emitMove({ from: squareIndex("e7"), to: squareIndex("e5") });
    expect(cell(host, "e7")?.textContent).toBe("\u265F");
    expect(status(host)).toContain("Your move");

    click(host, "e2");
    click(host, "e4");
    const sent = bridge.moves.length;

    // It is Black's turn now, so a second White move must not apply.
    bridge.emitMove({ from: squareIndex("d2"), to: squareIndex("d4") });
    expect(cell(host, "d2")?.textContent).toBe("\u2659");
    expect(bridge.moves).toHaveLength(sent);
    expect(status(host)).toContain("Opponent's move");
    game.unmount();
  });

  it("disables undo and restart and reports the opponent leaving", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountChess(bridge);

    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);

    bridge.emitPeerLeft();
    expect(status(host)).toContain("Opponent left");

    // The game is still on screen but no longer accepts local input.
    const moves = bridge.moves.length;
    click(host, "e2");
    expect(bridge.moves).toHaveLength(moves);
    game.unmount();
  });

  it("unsubscribes from the bridge on unmount", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountChess(bridge);
    game.unmount();

    expect(() => bridge.emitMove({ from: squareIndex("e2"), to: squareIndex("e4") })).not.toThrow();
    expect(() => bridge.emitPeerLeft()).not.toThrow();
    expect(host.querySelectorAll(".stage-cell")).toHaveLength(64);
    expect(cell(host, "e4")?.textContent).toBe("");
  });
});
