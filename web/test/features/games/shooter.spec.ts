// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHOOTER_HEIGHT,
  SHOOTER_KILL_SCORE,
  SHOOTER_START_LIVES,
  SHOOTER_STEP_MS,
  SHOOTER_WIDTH,
  createShooterGame,
  createShooterState,
  fireBullet,
  hitTest,
  movePlayer,
  movePlayerTo,
  nextWave,
  spawnWave,
  stepEntities,
  type ShooterBullet,
  type ShooterEnemy,
  type ShooterState,
} from "@/features/games/shooter/game";

function enemyAt(x: number, y: number, speed = 0): ShooterEnemy {
  return { x, y, width: 30, height: 22, speed, row: 0 };
}

function bulletAt(x: number, y: number, speed = 0): ShooterBullet {
  return { x, y, width: 4, height: 12, speed };
}

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

function stubCanvas(): () => void {
  const original = HTMLCanvasElement.prototype.getContext;
  const context = createFakeContext();
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof original;
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

describe("shooter engine", () => {
  it("detects overlapping boxes but not touching edges", () => {
    expect(hitTest({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(hitTest({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(
      false,
    );
    expect(hitTest({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 10, width: 10, height: 10 })).toBe(
      false,
    );
  });

  it("spawns a legal wave above the playfield and speeds it up per wave", () => {
    const first = spawnWave(1, SHOOTER_WIDTH);
    const fourth = spawnWave(4, SHOOTER_WIDTH);

    expect(first).toHaveLength(5);
    expect(fourth.length).toBeGreaterThan(first.length);
    expect(fourth[0]?.speed ?? 0).toBeGreaterThan(first[0]?.speed ?? 0);
    for (const enemy of first) {
      expect(enemy.y).toBeLessThan(0);
      expect(enemy.x).toBeGreaterThanOrEqual(0);
      expect(enemy.x + enemy.width).toBeLessThanOrEqual(SHOOTER_WIDTH);
    }
  });

  it("moves bullets up, enemies down and drops bullets that leave the top", () => {
    const base = createShooterState();
    const state: ShooterState = {
      ...base,
      bullets: [bulletAt(100, 200, 300), bulletAt(10, -8, 300)],
      enemies: [enemyAt(400, 40, 100)],
    };

    const next = stepEntities(state, 100);
    expect(next.bullets).toHaveLength(1);
    expect(next.bullets[0]?.y).toBeCloseTo(170, 5);
    expect(next.enemies[0]?.y).toBeCloseTo(50, 5);
  });

  it("scores a kill when a bullet overlaps an enemy", () => {
    const base = createShooterState();
    const state: ShooterState = {
      ...base,
      bullets: [bulletAt(100, 100)],
      enemies: [enemyAt(100, 96)],
    };

    const next = stepEntities(state, SHOOTER_STEP_MS);
    expect(next.bullets).toHaveLength(0);
    expect(next.enemies).toHaveLength(0);
    expect(next.score).toBe(SHOOTER_KILL_SCORE);
    expect(next.lives).toBe(SHOOTER_START_LIVES);
  });

  it("costs a life when an enemy slips past the bottom", () => {
    const base = createShooterState();
    const state: ShooterState = { ...base, enemies: [enemyAt(10, SHOOTER_HEIGHT - 10, 1200)] };

    const next = stepEntities(state, SHOOTER_STEP_MS);
    expect(next.enemies).toHaveLength(0);
    expect(next.lives).toBe(SHOOTER_START_LIVES - 1);
    expect(next.status).toBe("running");
  });

  it("ends the run once the last life is gone", () => {
    const base = createShooterState();
    const state: ShooterState = {
      ...base,
      lives: 1,
      enemies: [enemyAt(10, SHOOTER_HEIGHT - 10, 1200)],
    };

    const next = stepEntities(state, SHOOTER_STEP_MS);
    expect(next.lives).toBe(0);
    expect(next.status).toBe("over");
    expect(stepEntities(next, SHOOTER_STEP_MS)).toBe(next);
  });

  it("freezes the simulation while paused", () => {
    const paused: ShooterState = { ...createShooterState(), status: "paused" };
    expect(stepEntities(paused, 100)).toBe(paused);
    expect(stepEntities(createShooterState(), 0)).toEqual(createShooterState());
  });

  it("fires from the nose of the ship and caps the bullets on screen", () => {
    const base = createShooterState();
    const fired = fireBullet(base);
    expect(fired.bullets).toHaveLength(1);
    expect(fired.bullets[0]?.y).toBeLessThan(fired.player.y);
    expect(fired.bullets[0]?.x).toBeCloseTo(base.player.x + base.player.width / 2 - 2, 5);

    let capped = base;
    for (let shot = 0; shot < 8; shot += 1) capped = fireBullet(capped);
    expect(capped.bullets).toHaveLength(4);
    expect(fireBullet({ ...base, status: "over" }).bullets).toHaveLength(0);
  });

  it("keeps the ship inside the playfield", () => {
    const base = createShooterState();
    expect(movePlayer(base, 10000).player.x).toBe(SHOOTER_WIDTH - base.player.width);
    expect(movePlayer(base, -10000).player.x).toBe(0);
    expect(movePlayerTo(base, 320).player.x + base.player.width / 2).toBeCloseTo(320, 5);
    expect(movePlayer(base, 0)).toBe(base);
  });

  it("advances to a denser wave and refuses to advance a finished run", () => {
    const base = createShooterState();
    const next = nextWave(base);
    expect(next.wave).toBe(2);
    expect(next.enemies).toHaveLength(spawnWave(2, SHOOTER_WIDTH).length);
    expect(nextWave({ ...base, status: "over" })).toEqual({ ...base, status: "over" });
  });
});

describe("shooter mount", () => {
  let restoreCanvas: (() => void) | null = null;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreCanvas?.();
    restoreCanvas = null;
  });

  it("mounts a canvas with controls, then cancels its animation frame on unmount", () => {
    vi.useFakeTimers();
    restoreCanvas = stubCanvas();

    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const raf = vi.fn((callback: FrameRequestCallback): number => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id: number): void => {
      pending.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const host = document.createElement("div");
    const game = createShooterGame();
    game.mount(host);

    expect(host.querySelector("canvas")).not.toBeNull();
    expect(pending.size).toBe(1);

    const entry = [...pending.entries()][0];
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      pending.delete(entry[0]);
      entry[1](16);
    }

    const pause = host.querySelector<HTMLButtonElement>("button.stage-btn");
    expect(pause?.textContent).toBe("Pause");
    pause?.click();
    expect(pause?.textContent).toBe("Resume");
    pause?.click();
    expect(pause?.textContent).toBe("Pause");

    game.mount(host);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(pending.size).toBe(1);

    game.unmount();
    expect(cancel).toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });
});
