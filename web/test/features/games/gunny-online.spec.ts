// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUNNY_WIDTH,
  createGunnyGame,
  generateTerrain,
  simulateShot,
  windForRound,
} from "@/features/games/gunny/game";
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

interface Shot {
  angle: number;
  power: number;
  damage: number;
}

/**
 * @brief Builds a scriptable online bridge for one seat.
 * @param seat Local seat, 1 fires first.
 * @param seed Shared world seed.
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

/** Mounts Gunny into a detached host with the given bridge. */
function mountGunny(bridge: FakeBridge): {
  host: HTMLElement;
  game: ReturnType<typeof createGunnyGame>;
} {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const game = createGunnyGame();
  game.mount(host, { online: bridge });
  return { host, game };
}

/** Finds a toolbar button by its caption. */
function toolbar(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button.stage-btn")].find(
    (button) => button.textContent === text,
  );
}

/** Reads one numeric HUD value by label. */
function hudValue(host: HTMLElement, label: string): number {
  for (const wrapper of host.querySelectorAll<HTMLElement>(".stage-hud span")) {
    if (wrapper.firstChild?.textContent?.trim() !== label) continue;
    return Number(wrapper.querySelector("b")?.textContent ?? "NaN");
  }
  return Number.NaN;
}

/** Reads one text HUD value by label. */
function hudText(host: HTMLElement, label: string): string {
  for (const wrapper of host.querySelectorAll<HTMLElement>(".stage-hud span")) {
    if (wrapper.firstChild?.textContent?.trim() !== label) continue;
    return wrapper.querySelector("b")?.textContent ?? "";
  }
  return "";
}

/** Fills both number inputs with a shot. */
function setShot(host: HTMLElement, angle: number, power: number): void {
  const inputs = host.querySelectorAll<HTMLInputElement>("input.stage-input");
  if (inputs[0] !== undefined) inputs[0].value = String(angle);
  if (inputs[1] !== undefined) inputs[1].value = String(power);
}

/** Clicks Fire. */
function fire(host: HTMLElement): void {
  toolbar(host, "Fire")?.click();
}

const bestShots = new Map<string, Shot>();
const softShots = new Map<string, Shot>();

/**
 * @brief Finds the highest-damage shot for one seat and wind, cached per case.
 * @param terrain Shared heightmap.
 * @param shooter Seat that fires.
 * @param wind Wind acceleration for the round.
 * @return The best angle/power pair and its damage.
 */
function findBestShot(terrain: readonly number[], shooter: 1 | 2, wind: number): Shot {
  const key = `${shooter}:${wind}`;
  const cached = bestShots.get(key);
  if (cached !== undefined) return cached;

  let best: Shot = { angle: 45, power: 60, damage: -1 };
  for (let angle = 10; angle <= 80; angle += 1) {
    for (let power = 10; power <= 100; power += 1) {
      const damage = simulateShot(terrain, shooter, angle, power, wind).damage;
      if (damage > best.damage) best = { angle, power, damage };
    }
  }
  if (best.damage <= 0) throw new Error("no damaging shot exists for this seed");
  bestShots.set(key, best);
  return best;
}

/**
 * @brief Finds the lowest-damage shot, used to hand the turn back safely.
 * @param terrain Shared heightmap.
 * @param shooter Seat that fires.
 * @param wind Wind acceleration for the round.
 * @return The softest angle/power pair and its damage.
 */
function findSoftShot(terrain: readonly number[], shooter: 1 | 2, wind: number): Shot {
  const key = `${shooter}:${wind}`;
  const cached = softShots.get(key);
  if (cached !== undefined) return cached;

  let best: Shot = { angle: 45, power: 60, damage: Number.POSITIVE_INFINITY };
  for (let angle = 10; angle <= 80; angle += 1) {
    for (let power = 10; power <= 100; power += 1) {
      const damage = simulateShot(terrain, shooter, angle, power, wind).damage;
      if (damage < best.damage) best = { angle, power, damage };
      if (damage === 0) {
        softShots.set(key, best);
        return best;
      }
    }
  }
  softShots.set(key, best);
  return best;
}

/** Builds a proxy 2D context so jsdom can paint the canvas. */
function createFakeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  const proxy = new Proxy(target, {
    get(object, key): unknown {
      if (Reflect.has(object, key)) return Reflect.get(object, key);
      const value = (): void => undefined;
      Reflect.set(object, key, value);
      return value;
    },
    set(object, key, value): boolean {
      return Reflect.set(object, key, value);
    },
  });
  return proxy as unknown as CanvasRenderingContext2D;
}

describe("Gunny online", () => {
  let restoreCanvas: (() => void) | null = null;

  beforeEach(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const context = createFakeContext();
    HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof original;
    restoreCanvas = () => {
      HTMLCanvasElement.prototype.getContext = original;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreCanvas?.();
    restoreCanvas = null;
    document.body.replaceChildren();
  });

  it("builds the same terrain and wind from the seed on both seats", () => {
    vi.useFakeTimers();
    const terrain = generateTerrain(42, GUNNY_WIDTH);
    expect(generateTerrain(42, GUNNY_WIDTH)).toEqual(terrain);
    expect(generateTerrain(43, GUNNY_WIDTH)).not.toEqual(terrain);
    expect(windForRound(42, 1)).toBe(windForRound(42, 1));
    expect(windForRound(42, 2)).toBe(windForRound(42, 2));
    expect(windForRound(42, 1)).not.toBe(windForRound(42, 2));

    const hostSeat = mountGunny(fakeBridge(1));
    const guestSeat = mountGunny(fakeBridge(2));
    expect(hudText(hostSeat.host, "wind")).toBe(hudText(guestSeat.host, "wind"));
    expect(hudText(hostSeat.host, "wind")).toBe("← 0.2");
    expect(hudValue(hostSeat.host, "you")).toBe(100);
    expect(hudValue(guestSeat.host, "you")).toBe(100);

    hostSeat.game.unmount();
    guestSeat.game.unmount();
  });

  it("lets seat 1 fire first and keeps seat 2 waiting", () => {
    vi.useFakeTimers();
    const hostBridge = fakeBridge(1);
    const hostSeat = mountGunny(hostBridge);
    expect(toolbar(hostSeat.host, "Fire")?.disabled).toBe(false);
    expect(hostSeat.host.querySelector(".stage-status")?.textContent).toContain("your turn");
    hostSeat.game.unmount();

    const guestBridge = fakeBridge(2);
    const guestSeat = mountGunny(guestBridge);
    expect(toolbar(guestSeat.host, "Fire")?.disabled).toBe(true);
    expect(guestSeat.host.querySelector(".stage-status")?.textContent).toContain("opponent's turn");

    setShot(guestSeat.host, 45, 60);
    fire(guestSeat.host);
    expect(guestBridge.moves).toEqual([]);
    expect(hudValue(guestSeat.host, "opponent")).toBe(100);
    guestSeat.game.unmount();
  });

  it("relays a local shot and reduces the opponent's HP", () => {
    vi.useFakeTimers();
    const bridge = fakeBridge(1);
    const { host, game } = mountGunny(bridge);
    const terrain = generateTerrain(42, GUNNY_WIDTH);
    const shot = findBestShot(terrain, 1, windForRound(42, 1));

    setShot(host, shot.angle, shot.power);
    fire(host);

    expect(bridge.moves).toEqual([{ kind: "shot", angle: shot.angle, power: shot.power }]);
    expect(hudValue(host, "you")).toBe(100);
    expect(hudValue(host, "opponent")).toBe(100 - shot.damage);
    expect(hudText(host, "turn")).toBe("opponent");
    expect(toolbar(host, "Fire")?.disabled).toBe(true);
    game.unmount();
  });

  it("applies a remote shot to the local world with the same damage", () => {
    vi.useFakeTimers();
    const bridge = fakeBridge(2);
    const { host, game } = mountGunny(bridge);
    const terrain = generateTerrain(42, GUNNY_WIDTH);
    const shot = findBestShot(terrain, 1, windForRound(42, 1));

    bridge.emitMove({ kind: "shot", angle: shot.angle, power: shot.power });

    expect(hudValue(host, "you")).toBe(100 - shot.damage);
    expect(hudValue(host, "opponent")).toBe(100);
    expect(hudText(host, "turn")).toBe("you");
    expect(toolbar(host, "Fire")?.disabled).toBe(false);
    expect(bridge.moves).toEqual([]);
    game.unmount();
  });

  it("ignores out-of-range, malformed and out-of-turn shots", () => {
    vi.useFakeTimers();
    const bridge = fakeBridge(2);
    const { host, game } = mountGunny(bridge);
    const terrain = generateTerrain(42, GUNNY_WIDTH);
    const shot = findBestShot(terrain, 1, windForRound(42, 1));

    expect(() => {
      bridge.emitMove(null);
      bridge.emitMove({ kind: "nope" });
      bridge.emitMove({ kind: "shot", angle: 9, power: 60 });
      bridge.emitMove({ kind: "shot", angle: 81, power: 60 });
      bridge.emitMove({ kind: "shot", angle: 45, power: 9 });
      bridge.emitMove({ kind: "shot", angle: 45, power: 101 });
      bridge.emitMove({ kind: "shot", angle: Number.NaN, power: 60 });
      bridge.emitMove({ kind: "shot", angle: "45", power: 60 });
      bridge.emitMove({ kind: "shot", angle: 45, power: Number.POSITIVE_INFINITY });
    }).not.toThrow();
    expect(hudValue(host, "you")).toBe(100);
    expect(hudText(host, "turn")).toBe("opponent");

    bridge.emitMove({ kind: "shot", angle: shot.angle, power: shot.power });
    expect(hudValue(host, "you")).toBe(100 - shot.damage);

    // The local seat owns the turn now, so a second remote shot must be ignored.
    bridge.emitMove({ kind: "shot", angle: shot.angle, power: shot.power });
    expect(hudValue(host, "you")).toBe(100 - shot.damage);
    game.unmount();
  });

  it("reports a local win from the local perspective", () => {
    vi.useFakeTimers();
    const bridge = fakeBridge(1);
    const { host, game } = mountGunny(bridge);
    const terrain = generateTerrain(42, GUNNY_WIDTH);

    for (let round = 0; round < 8 && hudValue(host, "opponent") > 0; round += 1) {
      const wind = windForRound(42, hudValue(host, "round"));
      const shot = findBestShot(terrain, 1, wind);
      setShot(host, shot.angle, shot.power);
      fire(host);
      if (hudValue(host, "opponent") === 0) break;

      const soft = findSoftShot(terrain, 2, wind);
      bridge.emitMove({ kind: "shot", angle: soft.angle, power: soft.power });
    }

    expect(hudValue(host, "opponent")).toBe(0);
    expect(host.querySelector(".stage-status")?.textContent).toContain("you win");
    expect(hudText(host, "turn")).toBe("over");
    expect(toolbar(host, "Fire")?.disabled).toBe(true);
    game.unmount();
  });

  it("reports the opponent leaving, schedules no AI timer and unsubscribes", () => {
    vi.useFakeTimers();
    const bridge = fakeBridge(1);
    const { host, game } = mountGunny(bridge);
    expect(vi.getTimerCount()).toBe(0);

    const terrain = generateTerrain(42, GUNNY_WIDTH);
    const shot = findBestShot(terrain, 1, windForRound(42, 1));
    setShot(host, shot.angle, shot.power);
    fire(host);
    expect(vi.getTimerCount()).toBe(0);

    bridge.emitPeerLeft();
    expect(host.querySelector(".stage-status")?.textContent).toContain("Opponent left");
    expect(toolbar(host, "Fire")?.disabled).toBe(true);

    game.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(bridge.moveSubscribers()).toBe(0);
    expect(bridge.peerSubscribers()).toBe(0);
    expect(() => bridge.emitMove({ kind: "shot", angle: 45, power: 60 })).not.toThrow();
  });
});
