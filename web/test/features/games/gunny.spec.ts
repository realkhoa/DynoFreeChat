// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUNNY_BLAST_RADIUS,
  GUNNY_HEIGHT,
  GUNNY_MAX_DAMAGE,
  GUNNY_SPEED_SCALE,
  GUNNY_TERRAIN_MAX,
  GUNNY_TERRAIN_MIN,
  aiAim,
  computeDamage,
  createGunnyGame,
  generateTerrain,
  launchProjectile,
  stepProjectile,
  terrainHeightAt,
  type GunnyProjectile,
} from "@/features/games/gunny/game";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

describe("gunny terrain", () => {
  it("is deterministic per seed and stays inside the playable band", () => {
    const first = generateTerrain(1234, 96);
    expect(first).toHaveLength(96);
    for (const height of first) {
      expect(height).toBeGreaterThanOrEqual(GUNNY_TERRAIN_MIN);
      expect(height).toBeLessThanOrEqual(GUNNY_TERRAIN_MAX);
    }
    expect(generateTerrain(1234, 96)).toEqual(first);
    expect(generateTerrain(4321, 96)).not.toEqual(first);
    expect(generateTerrain(7, 0)).toEqual([]);
  });

  it("samples the heightmap with clamped columns", () => {
    const terrain = generateTerrain(9, 50);
    expect(terrainHeightAt(terrain, -20)).toBe(terrain[0]);
    expect(terrainHeightAt(terrain, 9999)).toBe(terrain[49]);
    expect(terrainHeightAt([], 10)).toBe(GUNNY_HEIGHT);
  });
});

describe("gunny ballistics", () => {
  it("integrates velocity and gravity one step at a time", () => {
    const start: GunnyProjectile = {
      x: 100,
      y: 100,
      vx: 50,
      vy: -100,
      wind: 0,
      gravity: 260,
      dtMs: 100,
      alive: true,
    };
    const afterOne = stepProjectile(start);
    expect(afterOne.x).toBeCloseTo(105, 5);
    expect(afterOne.y).toBeCloseTo(92.6, 5);
    expect(afterOne.vy).toBeCloseTo(-74, 5);

    let falling = start;
    for (let step = 0; step < 10; step += 1) falling = stepProjectile(falling);
    expect(falling.vy).toBeGreaterThan(0);
    expect(stepProjectile({ ...start, alive: false })).toMatchObject({ alive: false });
  });

  it("pushes the projectile with the wind", () => {
    const windy: GunnyProjectile = {
      x: 500,
      y: 100,
      vx: 0,
      vy: 0,
      wind: 40,
      gravity: 0,
      dtMs: 100,
      alive: true,
    };
    expect(stepProjectile(windy).vx).toBeCloseTo(4, 5);
  });

  it("launches with the requested power, angle and facing", () => {
    const shot = launchProjectile(70, 240, 45, 80, 0, 1);
    expect(shot.vx).toBeGreaterThan(0);
    expect(shot.vy).toBeLessThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(80 * GUNNY_SPEED_SCALE, 5);

    const left = launchProjectile(830, 240, 45, 80, 0, -1);
    expect(left.vx).toBeLessThan(0);

    const clamped = launchProjectile(0, 0, 500, 500, 0, 1);
    expect(clamped.vx).toBeCloseTo(launchProjectile(0, 0, 80, 100, 0, 1).vx, 5);
  });

  it("flies up, reaches an apex and then falls back", () => {
    let flight = launchProjectile(70, 240, 45, 80, 0, 1);
    const startX = flight.x;
    const startY = flight.y;
    let apex = startY;
    for (let step = 0; step < 120; step += 1) {
      flight = stepProjectile(flight);
      apex = Math.min(apex, flight.y);
    }
    expect(flight.x).toBeGreaterThan(startX);
    expect(apex).toBeLessThan(startY);
    expect(flight.y).toBeGreaterThan(apex);
    expect(Number.isFinite(flight.x)).toBe(true);
  });
});

describe("gunny damage", () => {
  it("falls off linearly to zero at the blast radius", () => {
    expect(computeDamage(0, GUNNY_BLAST_RADIUS)).toBe(GUNNY_MAX_DAMAGE);
    expect(computeDamage(10, GUNNY_BLAST_RADIUS)).toBeGreaterThan(computeDamage(40, GUNNY_BLAST_RADIUS));
    expect(computeDamage(GUNNY_BLAST_RADIUS, GUNNY_BLAST_RADIUS)).toBe(0);
    expect(computeDamage(GUNNY_BLAST_RADIUS * 2, GUNNY_BLAST_RADIUS)).toBe(0);
    expect(computeDamage(10, 0)).toBe(0);
    expect(computeDamage(-20, GUNNY_BLAST_RADIUS)).toBe(GUNNY_MAX_DAMAGE);
  });
});

describe("gunny AI", () => {
  it("keeps angle and power inside the legal gun settings", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const aim = aiAim(
        {
          distance: 100 + seed * 55,
          heightDelta: (seed % 5) * 20,
          wind: seed - 6,
          direction: seed % 2 === 0 ? 1 : -1,
        },
        mulberry32(seed),
      );
      expect(aim.angle).toBeGreaterThanOrEqual(10);
      expect(aim.angle).toBeLessThanOrEqual(80);
      expect(aim.power).toBeGreaterThanOrEqual(10);
      expect(aim.power).toBeLessThanOrEqual(100);
    }
  });

  it("is deterministic for the same seed", () => {
    const input = { distance: 620, heightDelta: 12, wind: -2.5, direction: -1 } as const;
    expect(aiAim(input, mulberry32(42))).toEqual(aiAim(input, mulberry32(42)));
  });

  it("uses more power for a longer shot", () => {
    const steady = (): number => 0.5;
    const near = aiAim({ distance: 300, heightDelta: 0, wind: 0, direction: 1 }, steady);
    const far = aiAim({ distance: 780, heightDelta: 0, wind: 0, direction: 1 }, steady);
    expect(far.power).toBeGreaterThan(near.power);
    expect(far.angle).toBeLessThan(near.angle);
  });

  it("compensates for the wind direction", () => {
    const steady = (): number => 0.5;
    const calm = aiAim({ distance: 700, heightDelta: 0, wind: 0, direction: 1 }, steady);
    const tailwind = aiAim({ distance: 700, heightDelta: 0, wind: 6, direction: 1 }, steady);
    const headwind = aiAim({ distance: 700, heightDelta: 0, wind: 6, direction: -1 }, steady);
    expect(tailwind.power).toBeLessThan(calm.power);
    expect(headwind.power).toBeGreaterThan(calm.power);
  });
});

describe("gunny mount", () => {
  let restoreCanvas: (() => void) | null = null;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreCanvas?.();
    restoreCanvas = null;
  });

  it("mounts the battlefield, fires without throwing and cancels its frame", () => {
    vi.useFakeTimers();
    const original = HTMLCanvasElement.prototype.getContext;
    const context = createFakeContext();
    HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof original;
    restoreCanvas = () => {
      HTMLCanvasElement.prototype.getContext = original;
    };

    const pending = new Set<number>();
    let nextId = 1;
    const raf = vi.fn((): number => {
      const id = nextId;
      nextId += 1;
      pending.add(id);
      return id;
    });
    const cancel = vi.fn((id: number): void => {
      pending.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const host = document.createElement("div");
    const game = createGunnyGame();
    game.mount(host);

    expect(host.querySelector("canvas")).not.toBeNull();
    expect(host.querySelectorAll("input.stage-input")).toHaveLength(2);
    const buttons = host.querySelectorAll<HTMLButtonElement>("button.stage-btn");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const status = host.querySelector(".stage-status");
    buttons[0]?.click();
    expect(status?.textContent).toContain("Shot away");

    buttons[1]?.click();
    expect(status?.textContent).toContain("Round 1");

    game.unmount();
    expect(cancel).toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });
});
