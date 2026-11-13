// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { OnlineBridge, OnlinePhase } from "@/features/games/online/bridge";
import { createShooterGame } from "@/features/games/shooter/game";

interface FakeBridge extends OnlineBridge {
  readonly moves: unknown[];
  emitMove: (payload: unknown) => void;
  emitPeerLeft: () => void;
}

/**
 * @brief Builds a scriptable bridge for one seat.
 * @param seat Local seat.
 * @return The fake bridge.
 */
function fakeBridge(seat: 1 | 2): FakeBridge {
  const moves: unknown[] = [];
  const moveHandlers = new Set<(payload: unknown) => void>();
  const peerHandlers = new Set<() => void>();
  const phaseHandlers = new Set<(phase: OnlinePhase) => void>();

  return {
    role: seat === 1 ? "host" : "guest",
    seat,
    seed: 7,
    peerNick: "Bob",
    moves,
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
    setStatus: vi.fn(),
    leave: vi.fn(),
    emitMove: (payload) => {
      for (const handler of moveHandlers) handler(payload);
    },
    emitPeerLeft: () => {
      for (const handler of peerHandlers) handler();
    },
  };
}

/** Mounts the shooter into a detached host with the given bridge. */
function mountShooter(bridge: FakeBridge): { host: HTMLElement; game: ReturnType<typeof createShooterGame> } {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createShooterGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Reads the HUD text. */
function hudText(host: HTMLElement): string {
  return host.querySelector(".stage-hud")?.textContent ?? "";
}

describe("Shooter online race", () => {
  it("announces its first wave to the rival", () => {
    const bridge = fakeBridge(1);
    const { game } = mountShooter(bridge);

    expect(bridge.moves).toEqual([{ kind: "progress", wave: 1, score: 0, dead: false }]);
    game.unmount();
  });

  it("shows the rival wave and score from progress messages", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountShooter(bridge);

    bridge.emitMove({ kind: "progress", wave: 3, score: 40, dead: false });
    expect(hudText(host)).toContain("rival wave");
    expect(hudText(host)).toContain("3");
    expect(host.querySelector(".stage-status")?.textContent).toContain("you wave 1");
    game.unmount();
  });

  it("wins when the rival reports a death first", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountShooter(bridge);

    bridge.emitMove({ kind: "progress", wave: 2, score: 30, dead: true });
    expect(host.querySelector(".stage-status")?.textContent).toContain("you win");
    game.unmount();
  });

  it("ignores malformed or foreign payloads", () => {
    const bridge = fakeBridge(2);
    const { host, game } = mountShooter(bridge);
    const before = hudText(host);

    bridge.emitMove(null);
    bridge.emitMove({ kind: "nope" });
    bridge.emitMove({ kind: "progress", wave: "many", score: {}, dead: "yes" });
    expect(hudText(host)).toBe(before);
    game.unmount();
  });

  it("reports the rival leaving in the status line", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountShooter(bridge);

    bridge.emitPeerLeft();
    expect(host.querySelector(".stage-status")?.textContent).toContain("opponent left");
    game.unmount();
  });

  it("does not restart an online race locally", () => {
    const bridge = fakeBridge(1);
    const { host, game } = mountShooter(bridge);
    const before = bridge.moves.length;

    const restart = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")].find(
      (button) => button.textContent === "Restart",
    );
    restart?.click();

    expect(bridge.moves.length).toBe(before);
    game.unmount();
  });

  it("unsubscribes from the bridge on unmount", () => {
    const bridge = fakeBridge(2);
    const { game } = mountShooter(bridge);
    game.unmount();

    expect(() => bridge.emitMove({ kind: "progress", wave: 9, dead: false })).not.toThrow();
    expect(() => bridge.emitPeerLeft()).not.toThrow();
  });
});
