// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createCaroGame } from "@/features/games/caro/game";
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

/** Mounts caro into a detached host with the given bridge. */
function mountCaro(bridge: FakeBridge): { host: HTMLElement; game: ReturnType<typeof createCaroGame> } {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createCaroGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Reads the text of the cell at one board index. */
function cellText(host: HTMLElement, index: number): string {
  return host.querySelectorAll<HTMLButtonElement>(".stage-cell")[index]?.textContent ?? "";
}

describe("Caro online", () => {
  it("plays as X on the host seat and relays the move", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountCaro(bridge);

    host.querySelectorAll<HTMLButtonElement>(".stage-cell")[0]?.click();

    expect(cellText(host, 0)).toBe("X");
    expect(bridge.moves).toEqual([{ index: 0 }]);
    game.unmount();
  });

  it("applies the opponent's move on the guest seat", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountCaro(bridge);

    // The guest is O; the host (X) opens at index 0.
    bridge.emitMove({ index: 0 });
    expect(cellText(host, 0)).toBe("X");

    host.querySelectorAll<HTMLButtonElement>(".stage-cell")[1]?.click();
    expect(cellText(host, 1)).toBe("O");
    expect(bridge.moves).toEqual([{ index: 1 }]);
    game.unmount();
  });

  it("ignores clicks that are not on the local player's turn", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountCaro(bridge);

    // It is X's turn and the guest plays O, so the click must be ignored.
    host.querySelectorAll<HTMLButtonElement>(".stage-cell")[5]?.click();
    expect(cellText(host, 5)).toBe("");
    expect(bridge.moves).toEqual([]);
    game.unmount();
  });

  it("ignores a remote move on an occupied cell and malformed payloads", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountCaro(bridge);

    bridge.emitMove({ index: 0 });
    bridge.emitMove({ index: 0 });
    bridge.emitMove({ index: 999 });
    bridge.emitMove({ nope: true });
    expect(cellText(host, 0)).toBe("X");
    game.unmount();
  });

  it("reports the opponent leaving in the status line", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountCaro(bridge);

    bridge.emitPeerLeft();
    expect(host.querySelector(".stage-status")?.textContent).toContain("Opponent left");
    game.unmount();
  });

  it("disables undo and restart while online", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountCaro(bridge);

    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    game.unmount();
  });

  it("unsubscribes from the bridge on unmount", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountCaro(bridge);
    game.unmount();

    // After unmount the host is detached from the bridge: no throw, no render.
    expect(() => bridge.emitMove({ index: 3 })).not.toThrow();
    expect(host.querySelectorAll(".stage-cell")).toHaveLength(225);
  });
});
