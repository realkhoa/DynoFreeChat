// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTienLenGame, createTwoPlayerState, type TienLenDuoState } from "@/features/games/tienlen/game";
import type { OnlineBridge, OnlinePhase } from "@/features/games/online/bridge";

interface FakeBridge extends OnlineBridge {
  /** Payloads the game sent to the opponent. */
  readonly moves: unknown[];
  /** Delivers one opponent move to the game. */
  emitMove: (payload: unknown) => void;
  /** Simulates the opponent leaving. */
  emitPeerLeft: () => void;
  /** Number of live move subscriptions. */
  moveSubscribers: () => number;
  /** Number of live peer-left subscriptions. */
  peerSubscribers: () => number;
}

/**
 * @brief Builds a scriptable online bridge for one seat.
 * @param seat Local seat, 1 moves first.
 * @param seed Shared deal seed.
 * @return The fake bridge.
 */
function fakeBridge(seat: 1 | 2, seed = 42): FakeBridge {
  const moves: unknown[] = [];
  const moveHandlers = new Set<(payload: unknown) => void>();
  const peerHandlers = new Set<() => void>();
  const phaseHandlers = new Set<(phase: OnlinePhase) => void>();

  return {
    role: seat === 1 ? "host" : "guest",
    seat,
    seed,
    peerNick: "Bob",
    moves,
    sendMove: (payload) => moves.push(payload),
    onMove: (handler) => {
      moveHandlers.add(handler);
      return () => {
        moveHandlers.delete(handler);
      };
    },
    onPeerLeft: (handler) => {
      peerHandlers.add(handler);
      return () => {
        peerHandlers.delete(handler);
      };
    },
    onPhase: (handler) => {
      phaseHandlers.add(handler);
      return () => {
        phaseHandlers.delete(handler);
      };
    },
    setStatus: vi.fn(),
    leave: vi.fn(),
    emitMove: (payload) => {
      for (const handler of moveHandlers) handler(payload);
    },
    emitPeerLeft: () => {
      for (const handler of peerHandlers) handler();
    },
    moveSubscribers: () => moveHandlers.size,
    peerSubscribers: () => peerHandlers.size,
  };
}

/** Mounts Tien Len into a detached host with the given bridge. */
function mountTienLen(bridge: FakeBridge): {
  host: HTMLElement;
  game: ReturnType<typeof createTienLenGame>;
} {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createTienLenGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Card ids rendered in the local hand, in DOM order. */
function cardIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button.stage-card")].map(
    (button) => button.dataset.cardId ?? "",
  );
}

/** Clicks the hand card with one stable id. */
function clickCard(host: HTMLElement, id: string): void {
  host.querySelector<HTMLButtonElement>(`button.stage-card[data-card-id="${id}"]`)?.click();
}

/** Finds a toolbar button by its caption. */
function toolbar(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button.stage-btn")].find(
    (button) => button.textContent === text,
  );
}

/** Local and opponent hands predicted from the seed. */
function predictedHands(seed = 42): { local: string[]; remote: string[] } {
  const state: TienLenDuoState = createTwoPlayerState(seed);
  return {
    local: state.hands[0].map((card) => card.id),
    remote: state.hands[1].map((card) => card.id),
  };
}

describe("Tien Len online", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("deals the same 13-card hand to both seats from the shared seed", () => {
    const first = mountTienLen(fakeBridge(1));
    const second = mountTienLen(fakeBridge(2));
    const predicted = predictedHands(42);

    expect(cardIds(first.host)).toHaveLength(13);
    expect(cardIds(second.host)).toHaveLength(13);
    expect(cardIds(first.host)).toEqual(predicted.local);
    expect(cardIds(second.host)).toEqual(predicted.local);
    expect(new Set([...predicted.local, ...predicted.remote]).size).toBe(26);

    first.game.unmount();
    second.game.unmount();
  });

  it("lets seat 1 lead and blocks seat 2 from leading out of turn", () => {
    const hostSeat = mountTienLen(fakeBridge(1));
    expect(hostSeat.host.querySelector(".stage-status")?.textContent).toContain("your turn");
    hostSeat.game.unmount();

    const guestBridge = fakeBridge(2);
    const guestSeat = mountTienLen(guestBridge);
    expect(guestSeat.host.querySelector(".stage-status")?.textContent).toContain("opponent's turn");
    expect(toolbar(guestSeat.host, "Play")?.disabled).toBe(true);

    const first = predictedHands().local[0] ?? "";
    clickCard(guestSeat.host, first);
    toolbar(guestSeat.host, "Play")?.click();
    expect(guestSeat.host.querySelector(".is-selected")).toBeNull();
    expect(cardIds(guestSeat.host)).toHaveLength(13);
    expect(guestBridge.moves).toEqual([]);
    guestSeat.game.unmount();
  });

  it("relays a legal play with stable card ids and applies it locally", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountTienLen(bridge);
    const first = predictedHands().local[0] ?? "";

    clickCard(host, first);
    expect(host.querySelector(`[data-card-id="${first}"]`)?.classList.contains("is-selected")).toBe(true);
    toolbar(host, "Play")?.click();

    expect(bridge.moves).toEqual([{ kind: "play", cards: [first] }]);
    expect(cardIds(host)).toHaveLength(12);
    expect(host.querySelector(".stage-status")?.textContent).toContain("You played");
    game.unmount();
  });

  it("relays a pass and resets the two-player trick", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountTienLen(bridge);
    const remote = predictedHands().remote[0] ?? "";
    bridge.emitMove({ kind: "play", cards: [remote] });

    expect(host.querySelector(".stage-status")?.textContent).toContain("Opponent played");
    expect(toolbar(host, "Pass")?.disabled).toBe(false);
    toolbar(host, "Pass")?.click();

    expect(bridge.moves).toEqual([{ kind: "pass" }]);
    expect(host.querySelector(".stage-status")?.textContent).toContain("new trick");
    expect(host.querySelector(".stage-row")?.textContent).toContain("free trick");
    expect(toolbar(host, "Pass")?.disabled).toBe(true);
    game.unmount();
  });

  it("applies a remote play and updates the table", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountTienLen(bridge);
    const remote = predictedHands().remote[0] ?? "";

    bridge.emitMove({ kind: "play", cards: [remote] });

    const stats = [...host.querySelectorAll<HTMLElement>(".stage-hud b")];
    expect(stats[1]?.textContent).toBe("12");
    const tableRow = host.querySelector(".stage-row");
    expect(tableRow?.textContent).toContain("Opponent played:");
    expect(tableRow?.querySelectorAll(".stage-card")).toHaveLength(1);
    expect(host.querySelector(".stage-status")?.textContent).toContain("your turn");
    game.unmount();
  });

  it("ignores malformed, foreign, duplicate and out-of-turn payloads", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountTienLen(bridge);
    const predicted = predictedHands();
    const remote = predicted.remote[0] ?? "";
    const foreign = predicted.local[0] ?? "";

    expect(() => {
      bridge.emitMove(null);
      bridge.emitMove({ kind: "nope" });
      bridge.emitMove({ kind: "play" });
      bridge.emitMove({ kind: "play", cards: ["bogus-card"] });
      bridge.emitMove({ kind: "play", cards: [foreign] });
      bridge.emitMove({ kind: "play", cards: [remote, remote] });
      bridge.emitMove({ kind: "play", cards: [42] });
      bridge.emitMove({ kind: "pass" });
    }).not.toThrow();

    const stats = [...host.querySelectorAll<HTMLElement>(".stage-hud b")];
    expect(stats[1]?.textContent).toBe("13");
    expect(host.querySelector(".stage-status")?.textContent).toContain("opponent's turn");

    bridge.emitMove({ kind: "play", cards: [remote] });
    expect(stats[1]?.textContent).toBe("12");
    // The table now belongs to the local seat, so a second remote play is out of turn.
    bridge.emitMove({ kind: "play", cards: [predicted.remote[1] ?? ""] });
    expect(stats[1]?.textContent).toBe("12");
    expect(bridge.moves).toEqual([]);
    game.unmount();
  });

  it("reports the opponent leaving and unsubscribes on unmount", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountTienLen(bridge);

    bridge.emitPeerLeft();
    expect(host.querySelector(".stage-status")?.textContent).toContain("Opponent left");
    expect(toolbar(host, "Play")?.disabled).toBe(true);

    game.unmount();
    expect(bridge.moveSubscribers()).toBe(0);
    expect(bridge.peerSubscribers()).toBe(0);
    expect(() => bridge.emitMove({ kind: "pass" })).not.toThrow();
  });
});
