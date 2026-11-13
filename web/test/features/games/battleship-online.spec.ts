// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBattleshipGame, indexOf, mulberry32, placeFleet } from "@/features/games/battleship/game";
import type { OnlineBridge, OnlinePhase } from "@/features/games/online/bridge";

interface FakeBridge extends OnlineBridge {
  /** Payloads the game sent to the opponent. */
  readonly moves: unknown[];
  /** Delivers one opponent payload to the game. */
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

/** Mounts battleship into a detached host with the given bridge. */
function mountBattleship(bridge: FakeBridge): {
  host: HTMLElement;
  game: ReturnType<typeof createBattleshipGame>;
} {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createBattleshipGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Finds a toolbar button by its caption. */
function toolbar(host: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")];
  return buttons.find((button) => button.textContent === text) ?? null;
}

/** Deploys a random local fleet and presses Ready. */
function deployAndReady(host: HTMLElement): void {
  toolbar(host, "Random placement")?.click();
  toolbar(host, "Ready")?.click();
}

/** Cells of the enemy (first) or own (second) grid, in board order. */
function gridCells(host: HTMLElement, side: "enemy" | "own"): HTMLButtonElement[] {
  const grids = host.querySelectorAll<HTMLElement>(".stage-board");
  const target = side === "enemy" ? grids[0] : grids[1];
  return [...(target?.querySelectorAll<HTMLButtonElement>(".stage-cell") ?? [])];
}

/** Current status line text. */
function status(host: HTMLElement): string {
  return host.querySelector(".stage-status")?.textContent ?? "";
}

/** HUD text, which carries the `turn:` chip. */
function hud(host: HTMLElement): string {
  return host.querySelector(".stage-hud")?.textContent ?? "";
}

/** Fixed opponent fleet, so every assertion stays deterministic. */
const REMOTE_CELLS = placeFleet(mulberry32(7)).flatMap((ship) => ship.cells.map(indexOf));
/** First cell of the opponent's Carrier: a hit marker, never a sunk ship. */
const REMOTE_HIT = REMOTE_CELLS[0] ?? 0;
/** Any index the opponent fleet does not occupy. */
const REMOTE_MISS =
  Array.from({ length: 100 }, (_, index) => index).find((index) => !REMOTE_CELLS.includes(index)) ?? 0;

describe("Battleship online", () => {
  it("exchanges fleets before either side may shoot", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountBattleship(bridge);
    expect(status(host)).toContain("Deploy your fleet");
    expect(bridge.moves).toEqual([]);

    // Placing a fleet no longer starts the battle on its own.
    toolbar(host, "Random placement")?.click();
    expect(bridge.moves).toEqual([]);
    expect(host.querySelectorAll(".stage-board")).toHaveLength(1);
    expect(status(host)).toContain("Press Ready");

    toolbar(host, "Ready")?.click();
    const fleet = bridge.moves[0] as { kind?: string; cells?: number[] } | undefined;
    expect(fleet?.kind).toBe("fleet");
    expect(fleet?.cells).toHaveLength(17);
    expect(new Set(fleet?.cells ?? []).size).toBe(17);
    expect(host.querySelectorAll(".stage-board")).toHaveLength(1);
    expect(status(host)).toContain("waiting");

    bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS });
    expect(host.querySelectorAll(".stage-board")).toHaveLength(2);
    expect(status(host)).toContain("your turn");
    expect(hud(host)).toContain("enemy sunk: 0/5");
    game.unmount();

    // Any valid deployment splits back into a five-ship fleet.
    for (const seed of [1, 2, 3, 11, 25]) {
      const other = fakeBridge(2);
      const second = mountBattleship(other);
      deployAndReady(second.host);
      const cells = placeFleet(mulberry32(seed)).flatMap((ship) => ship.cells.map(indexOf));
      other.emitMove({ kind: "fleet", cells });
      expect(hud(second.host)).toContain("enemy sunk: 0/5");
      second.game.unmount();
    }
  });

  it("makes seat 2 wait for the host's opening shot", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountBattleship(bridge);
    deployAndReady(host);
    bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS });

    expect(host.querySelectorAll(".stage-board")).toHaveLength(2);
    expect(status(host)).toContain("opponent's shot");

    const sent = bridge.moves.length;
    gridCells(host, "enemy")[REMOTE_HIT]?.click();
    expect(bridge.moves).toHaveLength(sent);
    expect(gridCells(host, "enemy")[REMOTE_HIT]?.textContent).toBe("");
    game.unmount();
  });

  it("relays a local shot, marks the opponent board and alternates turns", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountBattleship(bridge);
    deployAndReady(host);
    bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS });

    gridCells(host, "enemy")[REMOTE_HIT]?.click();
    expect(bridge.moves[1]).toEqual({ kind: "shot", index: REMOTE_HIT });
    expect(gridCells(host, "enemy")[REMOTE_HIT]?.textContent).toBe("x");
    expect(hud(host)).toContain("turn: opponent");

    // Local clicks are ignored while the opponent is to move.
    const sent = bridge.moves.length;
    gridCells(host, "enemy")[REMOTE_MISS]?.click();
    expect(bridge.moves).toHaveLength(sent);

    // The opponent's reply hands the turn back.
    bridge.emitMove({ kind: "shot", index: 0 });
    expect(status(host)).toContain("Opponent fired at");
    expect(hud(host)).toContain("turn: you");

    gridCells(host, "enemy")[REMOTE_MISS]?.click();
    expect(bridge.moves[sent]).toEqual({ kind: "shot", index: REMOTE_MISS });
    expect(gridCells(host, "enemy")[REMOTE_MISS]?.textContent).toBe("·");
    expect(hud(host)).toContain("turn: opponent");
    game.unmount();
  });

  it("ignores duplicate, out-of-range and wrong-kind payloads", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountBattleship(bridge);
    deployAndReady(host);
    bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS });

    gridCells(host, "enemy")[REMOTE_HIT]?.click();
    const junk: unknown[] = [
      null,
      7,
      {},
      { kind: "shot" },
      { kind: "shot", index: 100 },
      { kind: "shot", index: -1 },
      { kind: "shot", index: "5" },
      { kind: "shot", index: 2.5 },
      { kind: "nuke", index: 4 },
      { kind: "fleet", cells: REMOTE_CELLS },
    ];
    for (const payload of junk) {
      expect(() => bridge.emitMove(payload)).not.toThrow();
    }
    expect(hud(host)).toContain("turn: opponent");
    expect(status(host)).not.toContain("fired at");

    // A legitimate reply, then a repeat of the same cell.
    bridge.emitMove({ kind: "shot", index: 0 });
    expect(status(host)).toContain("Opponent fired at");
    expect(hud(host)).toContain("turn: you");

    gridCells(host, "enemy")[REMOTE_MISS]?.click();
    const sent = bridge.moves.length;
    const beforeRepeat = status(host);
    bridge.emitMove({ kind: "shot", index: 0 });
    expect(status(host)).toBe(beforeRepeat);
    expect(hud(host)).toContain("turn: opponent");
    expect(bridge.moves).toHaveLength(sent);
    game.unmount();
  });

  it("reports the opponent leaving and stops relaying shots", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountBattleship(bridge);
    deployAndReady(host);
    bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS });

    bridge.emitPeerLeft();
    expect(status(host)).toContain("Opponent left");

    const sent = bridge.moves.length;
    gridCells(host, "enemy")[REMOTE_HIT]?.click();
    expect(bridge.moves).toHaveLength(sent);
    expect(gridCells(host, "enemy")[REMOTE_HIT]?.textContent).toBe("");
    game.unmount();
  });

  it("unsubscribes from the bridge on unmount", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountBattleship(bridge);
    deployAndReady(host);
    game.unmount();

    expect(() => bridge.emitMove({ kind: "fleet", cells: REMOTE_CELLS })).not.toThrow();
    expect(() => bridge.emitMove({ kind: "shot", index: 0 })).not.toThrow();
    expect(() => bridge.emitPeerLeft()).not.toThrow();
    expect(host.querySelectorAll(".stage-board")).toHaveLength(1);
  });
});
