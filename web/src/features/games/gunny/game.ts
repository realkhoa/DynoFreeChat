/**
 * @file game.ts
 * @brief Gunny game module: a turn-based artillery duel against the AI or online.
 * @details Terrain, ballistics, damage and the AI aim are pure functions, so the
 * duel is testable without a canvas. The factory owns inputs, the flight loop,
 * the alternating turns and the AI timer. Online the seed drives the terrain and
 * the wind for every round; each shot is simulated to impact synchronously and
 * relayed as its angle and power, so both clients apply identical damage.
 */

import type { GameContext, GameMount } from "../mount";
import type { OnlineBridge } from "../online/bridge";

/** @brief Playfield width in logical pixels. */
export const GUNNY_WIDTH = 900;
/** @brief Playfield height in logical pixels. */
export const GUNNY_HEIGHT = 360;
/** @brief Downward acceleration in pixels per second squared. */
export const GUNNY_GRAVITY = 260;
/** @brief Muzzle speed in pixels per second for one unit of power. */
export const GUNNY_SPEED_SCALE = 5;
/** @brief Explosion radius in pixels; damage reaches zero at this distance. */
export const GUNNY_BLAST_RADIUS = 60;
/** @brief Damage dealt by a shot landing exactly on the target. */
export const GUNNY_MAX_DAMAGE = 45;
/** @brief Highest terrain surface the generator produces, in pixels from the top. */
export const GUNNY_TERRAIN_MIN = 150;
/** @brief Lowest terrain surface the generator produces, in pixels from the top. */
export const GUNNY_TERRAIN_MAX = 330;
/** @brief Horizontal position of the player tank. */
export const GUNNY_PLAYER_X = 70;
/** @brief Horizontal position of the AI tank. */
export const GUNNY_ENEMY_X = 830;
/** @brief Height of a tank hull in pixels. */
export const GUNNY_TANK_HEIGHT = 18;
/** @brief Width of a tank hull in pixels. */
export const GUNNY_TANK_WIDTH = 34;
/** @brief Fixed flight step in milliseconds (60 Hz). */
export const GUNNY_STEP_MS = 1000 / 60;

const ANGLE_MIN = 10;
const ANGLE_MAX = 80;
const POWER_MIN = 10;
const POWER_MAX = 100;
const AI_ANGLE_ERROR = 3.2;
const AI_POWER_ERROR = 0.07;
/** Safety bound for the synchronous online shot simulation (about 100 seconds). */
const MAX_SHOT_STEPS = 6000;

/** @brief Ballistic projectile advanced by {@link stepProjectile}. */
export interface GunnyProjectile {
  /** Horizontal position in pixels. */
  x: number;
  /** Vertical position in pixels. */
  y: number;
  /** Horizontal velocity in pixels per second. */
  vx: number;
  /** Vertical velocity in pixels per second, positive pointing down. */
  vy: number;
  /** Horizontal wind acceleration in pixels per second squared. */
  wind: number;
  /** Downward gravity in pixels per second squared. */
  gravity: number;
  /** Time the next step will advance. */
  dtMs: number;
  /** False once the shot has resolved. */
  alive: boolean;
}

/** @brief What the AI knows about the shot it is about to take. */
export interface GunnyAimState {
  /** Horizontal gap to the target in pixels. */
  distance: number;
  /** Target surface minus shooter surface; positive means the target is lower. */
  heightDelta: number;
  /** Wind acceleration; positive blows to the right. */
  wind: number;
  /** +1 when the shot flies right, -1 when it flies left. */
  direction: 1 | -1;
}

/** @brief Gun settings the AI decided to use. */
export interface GunnyAim {
  /** Barrel angle in degrees, 10 to 80. */
  angle: number;
  /** Power setting, 10 to 100. */
  power: number;
}

/** @brief One live duel. */
interface GunnySession {
  /** Surface height per terrain column. */
  terrain: number[];
  /** Player hit points, 0 to 100. */
  playerHp: number;
  /** AI hit points, 0 to 100. */
  enemyHp: number;
  /** Wind acceleration for the round. */
  wind: number;
  /** Round counter, starting at 1. */
  round: number;
  /** Whose turn it is. */
  turn: "player" | "ai";
  /** Player barrel angle in degrees. */
  angle: number;
  /** Player power setting. */
  power: number;
  /** AI barrel angle, kept for painting. */
  aiAngle: number;
  /** Shot in flight, if any. */
  projectile: GunnyProjectile | null;
  /** Recent projectile positions for the smoke trail. */
  trail: Array<{ x: number; y: number }>;
  /** Expanding explosion marker, if any. */
  boom: { x: number; y: number; alpha: number } | null;
  /** Who fired the shot currently resolving. */
  shooter: "player" | "ai";
  /** One line describing the last event. */
  message: string;
  /** True once one tank is destroyed. */
  over: boolean;
}

/** @brief Clamps a number into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** @brief Rounds a number to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** @brief Deterministic 32-bit PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @brief Builds a seeded, smooth terrain heightmap.
 * @details A bounded random walk keeps the seabed plausible: no cliffs, nothing
 * outside the playable band, identical output for identical seeds.
 * @param seed Starting state for the generator.
 * @param width Number of columns to generate.
 * @return Surface height in pixels from the top, one entry per column.
 */
export function generateTerrain(seed: number, width: number): number[] {
  const samples = Math.max(0, Math.floor(width));
  if (samples === 0) return [];
  const rng = createRng(seed);
  const heights: number[] = [];
  let value = GUNNY_TERRAIN_MIN + 60 + rng() * 70;
  let slope = (rng() - 0.5) * 2;
  for (let column = 0; column < samples; column += 1) {
    slope = clamp(slope + (rng() - 0.5) * 2.6, -2.4, 2.4);
    value += slope;
    if (value < GUNNY_TERRAIN_MIN) {
      value = GUNNY_TERRAIN_MIN;
      slope = Math.abs(slope);
    } else if (value > GUNNY_TERRAIN_MAX) {
      value = GUNNY_TERRAIN_MAX;
      slope = -Math.abs(slope);
    }
    heights.push(Math.round(value * 100) / 100);
  }
  return heights;
}

/**
 * @brief Samples the terrain surface under a horizontal position.
 * @param terrain Heightmap from {@link generateTerrain}.
 * @param x Horizontal position in pixels.
 * @return The surface height, or the canvas floor for an empty heightmap.
 */
export function terrainHeightAt(terrain: readonly number[], x: number): number {
  if (terrain.length === 0) return GUNNY_HEIGHT;
  const index = Math.round(clamp(x, 0, terrain.length - 1));
  return terrain[index] ?? GUNNY_HEIGHT;
}

/** @brief Where an online shot landed and how much damage it dealt. */
export interface GunnyShotResult {
  /** Impact horizontal position in world pixels. */
  x: number;
  /** Impact vertical position in world pixels. */
  y: number;
  /** Whole damage dealt to the target tank. */
  damage: number;
}

/**
 * @brief Derives the wind acceleration for one online round from the match seed.
 * @details A dedicated generator is advanced once per round, so both clients
 * compute the same wind without exchanging any extra message.
 * @param seed Shared seed chosen by the host.
 * @param round Round counter starting at 1.
 * @return Wind acceleration in pixels per second squared, -6 to 6.
 */
export function windForRound(seed: number, round: number): number {
  const steps = Math.max(1, Math.floor(round));
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  let value = 0;
  for (let index = 0; index < steps; index += 1) value = rng();
  return round1(value * 12 - 6);
}

/**
 * @brief Runs one shot to impact on a shared world, without animation.
 * @details Seat 1 always fires from the left and seat 2 from the right, so the
 * same angle, power and wind produce the same impact on both clients. The step
 * order mirrors the local flight loop: advance, test the tank, test the ground.
 * @param terrain Heightmap both clients generated from the shared seed.
 * @param shooterSeat Seat that fired: 1 fires right, 2 fires left.
 * @param angle Barrel angle in degrees, clamped to 10..80.
 * @param power Power setting, clamped to 10..100.
 * @param wind Wind acceleration for the round.
 * @return The impact point and the whole damage dealt to the target tank.
 */
export function simulateShot(
  terrain: readonly number[],
  shooterSeat: 1 | 2,
  angle: number,
  power: number,
  wind: number,
): GunnyShotResult {
  const facing: 1 | -1 = shooterSeat === 1 ? 1 : -1;
  const startX = shooterSeat === 1 ? GUNNY_PLAYER_X : GUNNY_ENEMY_X;
  const targetX = shooterSeat === 1 ? GUNNY_ENEMY_X : GUNNY_PLAYER_X;
  const targetY = tankTop(terrain, targetX);
  let projectile = launchProjectile(startX, tankTop(terrain, startX), angle, power, wind, facing);

  for (let step = 0; step < MAX_SHOT_STEPS; step += 1) {
    projectile = stepProjectile(projectile);
    const distance = Math.hypot(projectile.x - targetX, projectile.y - targetY);
    if (distance <= GUNNY_TANK_WIDTH / 2) {
      return { x: projectile.x, y: projectile.y, damage: computeDamage(distance, GUNNY_BLAST_RADIUS) };
    }
    const ground = terrainHeightAt(terrain, projectile.x);
    if (
      projectile.x <= 0 ||
      projectile.x >= GUNNY_WIDTH ||
      projectile.y >= ground ||
      projectile.y > GUNNY_HEIGHT
    ) {
      const x = clamp(projectile.x, 0, GUNNY_WIDTH);
      const y = Math.min(projectile.y, GUNNY_HEIGHT);
      return { x, y, damage: computeDamage(Math.hypot(x - targetX, y - targetY), GUNNY_BLAST_RADIUS) };
    }
  }

  const x = clamp(projectile.x, 0, GUNNY_WIDTH);
  const y = Math.min(projectile.y, GUNNY_HEIGHT);
  return { x, y, damage: computeDamage(Math.hypot(x - targetX, y - targetY), GUNNY_BLAST_RADIUS) };
}

/**
 * @brief Launches a projectile from a muzzle.
 * @param x Muzzle horizontal position.
 * @param y Muzzle vertical position.
 * @param angleDeg Barrel angle above the horizon, clamped to 10..80.
 * @param power Power setting, clamped to 10..100.
 * @param wind Wind acceleration for the round.
 * @param facing +1 to fire right, -1 to fire left.
 * @param dtMs Step the next update will use.
 * @return A fresh projectile with gravity and wind attached.
 */
export function launchProjectile(
  x: number,
  y: number,
  angleDeg: number,
  power: number,
  wind: number,
  facing: 1 | -1,
  dtMs: number = GUNNY_STEP_MS,
): GunnyProjectile {
  const radians = (clamp(angleDeg, ANGLE_MIN, ANGLE_MAX) * Math.PI) / 180;
  const speed = clamp(power, POWER_MIN, POWER_MAX) * GUNNY_SPEED_SCALE;
  return {
    x,
    y,
    vx: Math.cos(radians) * speed * facing,
    vy: -Math.sin(radians) * speed,
    wind,
    gravity: GUNNY_GRAVITY,
    dtMs,
    alive: true,
  };
}

/**
 * @brief Advances a projectile one ballistic step.
 * @details Semi-implicit Euler: wind and gravity change the velocities first,
 * then the position integrates the new velocities.
 * @param state Current projectile.
 * @return A new projectile state; the same object once the shot resolved.
 */
export function stepProjectile(state: GunnyProjectile): GunnyProjectile {
  if (!state.alive) return state;
  const seconds = Math.max(0, state.dtMs) / 1000;
  const vx = state.vx + state.wind * seconds;
  const vy = state.vy + state.gravity * seconds;
  return { ...state, vx, vy, x: state.x + vx * seconds, y: state.y + vy * seconds };
}

/**
 * @brief Computes explosion damage with linear falloff.
 * @param distance Distance from the blast centre to the target, in pixels.
 * @param radius Distance at which damage reaches zero.
 * @return Whole hit points between 0 and {@link GUNNY_MAX_DAMAGE}.
 */
export function computeDamage(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) return 0;
  const closeness = 1 - Math.max(0, distance) / radius;
  if (closeness <= 0) return 0;
  return Math.round(GUNNY_MAX_DAMAGE * closeness);
}

/**
 * @brief Chooses gun settings for the AI.
 * @details Solves the ballistic range equation for a sensible angle, compensates
 * for height and wind, then adds a bounded human-like error.
 * @param state What the AI knows about the shot.
 * @param rng Deterministic random source in [0, 1).
 * @return Angle in 10..80 degrees and power in 10..100.
 */
export function aiAim(state: GunnyAimState, rng: () => number): GunnyAim {
  const baseAngle = state.distance < 320 ? 58 : state.distance < 560 ? 50 : 44;
  const radians = (baseAngle * Math.PI) / 180;
  const lift = Math.max(0.2, Math.sin(2 * radians));
  const idealSpeed = Math.sqrt((Math.max(0, state.distance) * GUNNY_GRAVITY) / lift);
  const heightFactor = clamp(1 - state.heightDelta / 600, 0.85, 1.15);
  const windFactor = clamp(1 - state.wind * 0.03 * state.direction, 0.8, 1.2);
  const idealPower = (idealSpeed / GUNNY_SPEED_SCALE) * heightFactor * windFactor;
  const angleError = (rng() - 0.5) * 2 * AI_ANGLE_ERROR;
  const powerError = 1 + (rng() - 0.5) * 2 * AI_POWER_ERROR;
  return {
    angle: Math.round(clamp(baseAngle + angleError, ANGLE_MIN, ANGLE_MAX)),
    power: Math.round(clamp(idealPower * powerError, POWER_MIN, POWER_MAX)),
  };
}

/** @brief Describes the wind for the status line. */
function describeWind(wind: number): string {
  if (Math.abs(wind) < 0.2) return "calm";
  return `${Math.abs(wind).toFixed(1)} to the ${wind > 0 ? "right" : "left"}`;
}

/** @brief Vertical position of a tank hull top at a horizontal position. */
function tankTop(terrain: readonly number[], x: number): number {
  return terrainHeightAt(terrain, x) - GUNNY_TANK_HEIGHT;
}

/** @brief Paints one tank, its barrel and its health bar. */
function drawTank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  angle: number,
  color: string,
  hp: number,
): void {
  const radians = (angle * Math.PI) / 180;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x + Math.cos(radians) * 24 * facing, y + 4 - Math.sin(radians) * 24);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillRect(x - GUNNY_TANK_WIDTH / 2, y, GUNNY_TANK_WIDTH, GUNNY_TANK_HEIGHT);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(x - GUNNY_TANK_WIDTH / 2 + 5, y + 5, GUNNY_TANK_WIDTH - 10, 8);

  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(x - 22, y - 14, 44, 5);
  ctx.fillStyle = hp > 35 ? "#dcdcaa" : "#f48771";
  ctx.fillRect(x - 22, y - 14, 44 * clamp(hp / 100, 0, 1), 5);
}

/** @brief Paints the terrain, both tanks, the shot and the explosion. */
function drawScene(ctx: CanvasRenderingContext2D, session: GunnySession): void {
  ctx.fillStyle = "#0f1622";
  ctx.fillRect(0, 0, GUNNY_WIDTH, GUNNY_HEIGHT);
  ctx.fillStyle = "#131d2b";
  ctx.fillRect(0, 0, GUNNY_WIDTH, 110);

  ctx.beginPath();
  ctx.moveTo(0, GUNNY_HEIGHT);
  session.terrain.forEach((height, column) => {
    ctx.lineTo(column, height);
  });
  ctx.lineTo(GUNNY_WIDTH, GUNNY_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = "#243b2c";
  ctx.fill();

  ctx.beginPath();
  session.terrain.forEach((height, column) => {
    if (column === 0) ctx.moveTo(column, height);
    else ctx.lineTo(column, height);
  });
  ctx.strokeStyle = "#3f6b4e";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const playerY = tankTop(session.terrain, GUNNY_PLAYER_X);
  const enemyY = tankTop(session.terrain, GUNNY_ENEMY_X);
  drawTank(ctx, GUNNY_PLAYER_X, playerY, 1, session.angle, "#4ec9b0", session.playerHp);
  drawTank(ctx, GUNNY_ENEMY_X, enemyY, -1, session.aiAngle, "#f48771", session.enemyHp);

  ctx.fillStyle = "rgba(220, 220, 170, 0.35)";
  for (const point of session.trail) ctx.fillRect(point.x - 1, point.y - 1, 2, 2);

  if (session.projectile !== null) {
    ctx.fillStyle = "#f0f0f0";
    ctx.beginPath();
    ctx.arc(session.projectile.x, session.projectile.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (session.boom !== null) {
    const radius = GUNNY_BLAST_RADIUS * (1 - session.boom.alpha) + 6;
    ctx.strokeStyle = `rgba(244, 135, 113, ${Math.max(0, session.boom.alpha).toFixed(2)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(session.boom.x, session.boom.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#8fa3b8";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    `wind ${session.wind >= 0 ? "→" : "←"} ${Math.abs(session.wind).toFixed(1)} · round ${session.round}`,
    GUNNY_WIDTH / 2,
    20,
  );
  ctx.textAlign = "start";
}

/**
 * @brief Creates one gunny duel instance.
 * @details Every field lives in this closure, so remounting restarts the duel.
 * @return A mountable game module.
 */
export function createGunnyGame(): GameMount {
  let host: HTMLElement | null = null;
  let mounted = false;
  let frameId = 0;
  let aiTimer: number | null = null;
  let rng = createRng(Date.now() >>> 0);
  let session: GunnySession = createSession(rng);
  const cleanups: Array<() => void> = [];
  let playerHpValue: HTMLElement | null = null;
  let enemyHpValue: HTMLElement | null = null;
  let windValue: HTMLElement | null = null;
  let roundValue: HTMLElement | null = null;
  let turnValue: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;
  let fireButton: HTMLButtonElement | null = null;
  let online: OnlineBridge | null = null;
  let onlineLocalSeat: 1 | 2 = 1;
  let onlineSeed = 0;
  let onlineTurn: 1 | 2 = 1;
  let onlineShots = 0;
  let peerLeft = false;
  let onlineCtx: CanvasRenderingContext2D | null = null;
  let onlineAngleField: HTMLInputElement | null = null;
  let onlinePowerField: HTMLInputElement | null = null;
  let unsubscribeMove: (() => void) | null = null;
  let unsubscribePeer: (() => void) | null = null;

  /** @brief Builds a duel: fresh terrain, full tanks and a random wind. */
  function createSession(source: () => number): GunnySession {
    const seed = Math.floor(source() * 0x7fffffff);
    const wind = round1(source() * 12 - 6);
    return {
      terrain: generateTerrain(seed, GUNNY_WIDTH),
      playerHp: 100,
      enemyHp: 100,
      wind,
      round: 1,
      turn: "player",
      angle: 45,
      power: 60,
      aiAngle: 45,
      projectile: null,
      trail: [],
      boom: null,
      shooter: "player",
      message: `Round 1 — wind ${describeWind(wind)}. Set angle and power, then fire.`,
      over: false,
    };
  }

  const addListener = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
  ): void => {
    const wrapped = (event: Event): void => handler(event as E);
    target.addEventListener(type, wrapped);
    cleanups.push(() => target.removeEventListener(type, wrapped));
  };

  const syncHud = (): void => {
    if (playerHpValue !== null) playerHpValue.textContent = String(Math.round(session.playerHp));
    if (enemyHpValue !== null) enemyHpValue.textContent = String(Math.round(session.enemyHp));
    if (windValue !== null) {
      windValue.textContent = `${session.wind >= 0 ? "→" : "←"} ${Math.abs(session.wind).toFixed(1)}`;
    }
    if (roundValue !== null) roundValue.textContent = String(session.round);
    if (turnValue !== null) {
      turnValue.textContent = session.over ? "over" : session.turn === "player" ? "you" : "AI";
    }
    if (fireButton !== null) {
      fireButton.disabled = session.over || session.turn !== "player" || session.projectile !== null;
    }
    if (statusLine !== null) statusLine.textContent = session.message;
  };

  const unmount = (): void => {
    mounted = false;
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    if (aiTimer !== null) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    for (const dispose of cleanups) dispose();
    cleanups.length = 0;
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = null;
    peerLeft = false;
    onlineCtx = null;
    onlineAngleField = null;
    onlinePowerField = null;
    playerHpValue = null;
    enemyHpValue = null;
    windValue = null;
    roundValue = null;
    turnValue = null;
    statusLine = null;
    fireButton = null;
    host = null;
  };

  const mount = (nextHost: HTMLElement, context?: GameContext): void => {
    unmount();
    mounted = true;
    host = nextHost;
    if (context?.online !== undefined) {
      mountOnline(nextHost, context.online);
      return;
    }
    rng = createRng(Date.now() >>> 0);
    session = createSession(rng);
    host.replaceChildren();

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const addStat = (label: string, initial: string): HTMLElement => {
      const wrapper = document.createElement("span");
      wrapper.append(`${label} `);
      const value = document.createElement("b");
      value.textContent = initial;
      wrapper.append(value);
      hud.append(wrapper);
      return value;
    };
    playerHpValue = addStat("hp", "100");
    enemyHpValue = addStat("enemy", "100");
    windValue = addStat("wind", "→ 0.0");
    roundValue = addStat("round", "1");
    turnValue = addStat("turn", "you");

    const canvas = document.createElement("canvas");
    canvas.className = "stage-canvas";
    canvas.width = GUNNY_WIDTH;
    canvas.height = GUNNY_HEIGHT;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Gunny battlefield");
    canvas.style.maxWidth = `${GUNNY_WIDTH}px`;

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const label = (text: string): HTMLElement => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    };
    const numberInput = (min: number, max: number, value: number, name: string): HTMLInputElement => {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "stage-input";
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      input.value = String(value);
      input.setAttribute("aria-label", name);
      input.style.width = "72px";
      return input;
    };
    const angleField = numberInput(ANGLE_MIN, ANGLE_MAX, session.angle, "Barrel angle in degrees");
    const powerField = numberInput(POWER_MIN, POWER_MAX, session.power, "Shot power");

    const makeButton = (text: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stage-btn";
      button.textContent = text;
      addListener<MouseEvent>(button, "click", onClick);
      return button;
    };
    const readNumber = (input: HTMLInputElement, fallback: number): number => {
      const raw = Number(input.value);
      return Number.isFinite(raw) ? raw : fallback;
    };

    const scheduleAi = (): void => {
      if (!mounted || session.over || aiTimer !== null) return;
      aiTimer = window.setTimeout(() => {
        aiTimer = null;
        if (!mounted || session.over || session.turn !== "ai") return;
        const enemyTop = tankTop(session.terrain, GUNNY_ENEMY_X);
        const aim = aiAim(
          {
            distance: Math.abs(GUNNY_ENEMY_X - GUNNY_PLAYER_X),
            heightDelta: tankTop(session.terrain, GUNNY_PLAYER_X) - enemyTop,
            wind: session.wind,
            direction: -1,
          },
          rng,
        );
        session.aiAngle = aim.angle;
        session.shooter = "ai";
        session.trail = [];
        session.projectile = launchProjectile(
          GUNNY_ENEMY_X,
          enemyTop,
          aim.angle,
          aim.power,
          session.wind,
          -1,
        );
        session.message = `AI fires at ${aim.angle}° with power ${aim.power}.`;
        syncHud();
      }, 760);
    };

    const resolveImpact = (x: number, y: number): void => {
      const targetX = session.shooter === "player" ? GUNNY_ENEMY_X : GUNNY_PLAYER_X;
      const distance = Math.hypot(x - targetX, y - tankTop(session.terrain, targetX));
      const damage = computeDamage(distance, GUNNY_BLAST_RADIUS);
      session.projectile = null;
      session.boom = { x, y, alpha: 1 };
      if (session.shooter === "player") session.enemyHp = Math.max(0, session.enemyHp - damage);
      else session.playerHp = Math.max(0, session.playerHp - damage);

      if (session.enemyHp <= 0) {
        session.over = true;
        session.message = "Direct hit — the enemy tank is scrap. You win.";
        syncHud();
        return;
      }
      if (session.playerHp <= 0) {
        session.over = true;
        session.message = "Your tank is scrap — the AI wins this duel.";
        syncHud();
        return;
      }
      if (session.shooter === "player") {
        session.turn = "ai";
        session.message = damage > 0 ? `Hit for ${damage}. The AI is aiming…` : "Missed. The AI is aiming…";
        syncHud();
        scheduleAi();
        return;
      }
      session.round += 1;
      session.wind = round1(rng() * 12 - 6);
      session.turn = "player";
      const wind = describeWind(session.wind);
      session.message =
        damage > 0
          ? `The AI hit you for ${damage}. Round ${session.round} — wind ${wind}.`
          : `The AI missed. Round ${session.round} — wind ${wind}.`;
      syncHud();
    };

    const advance = (dtMs: number): void => {
      const projectile = session.projectile;
      if (projectile === null) return;
      const next = stepProjectile({ ...projectile, dtMs });
      const targetX = session.shooter === "player" ? GUNNY_ENEMY_X : GUNNY_PLAYER_X;
      const targetY = tankTop(session.terrain, targetX);
      if (Math.hypot(next.x - targetX, next.y - targetY) <= GUNNY_TANK_WIDTH / 2) {
        resolveImpact(next.x, next.y);
        return;
      }
      const ground = terrainHeightAt(session.terrain, next.x);
      if (next.x <= 0 || next.x >= GUNNY_WIDTH || next.y >= ground || next.y > GUNNY_HEIGHT) {
        resolveImpact(clamp(next.x, 0, GUNNY_WIDTH), Math.min(next.y, GUNNY_HEIGHT));
        return;
      }
      session.projectile = next;
      session.trail.push({ x: next.x, y: next.y });
      if (session.trail.length > 80) session.trail.shift();
    };

    const firePlayer = (): void => {
      if (session.over || session.turn !== "player" || session.projectile !== null) return;
      session.angle = Math.round(clamp(readNumber(angleField, 45), ANGLE_MIN, ANGLE_MAX));
      session.power = Math.round(clamp(readNumber(powerField, 60), POWER_MIN, POWER_MAX));
      angleField.value = String(session.angle);
      powerField.value = String(session.power);
      session.shooter = "player";
      session.trail = [];
      session.projectile = launchProjectile(
        GUNNY_PLAYER_X,
        tankTop(session.terrain, GUNNY_PLAYER_X),
        session.angle,
        session.power,
        session.wind,
        1,
      );
      session.message = `Shot away: ${session.angle}° with power ${session.power}.`;
      syncHud();
    };

    const restart = (): void => {
      if (aiTimer !== null) {
        clearTimeout(aiTimer);
        aiTimer = null;
      }
      session = createSession(rng);
      angleField.value = String(session.angle);
      powerField.value = String(session.power);
      syncHud();
    };

    const fire = makeButton("Fire", firePlayer);
    fireButton = fire;
    bar.append(
      label("angle"),
      angleField,
      label("power"),
      powerField,
      fire,
      makeButton("New round", restart),
    );
    addListener<KeyboardEvent>(angleField, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      firePlayer();
    });
    addListener<KeyboardEvent>(powerField, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      firePlayer();
    });

    const status = document.createElement("p");
    status.className = "stage-status";
    statusLine = status;
    host.append(hud, canvas, bar, status);
    syncHud();

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    let lastTime = 0;
    let accumulator = 0;
    const frame = (now: number): void => {
      if (!mounted) return;
      frameId = requestAnimationFrame(frame);
      if (lastTime === 0) lastTime = now;
      const delta = Math.min(120, Math.max(0, now - lastTime));
      lastTime = now;
      if (session.projectile !== null) {
        accumulator += delta;
        while (accumulator >= GUNNY_STEP_MS && session.projectile !== null) {
          advance(GUNNY_STEP_MS);
          accumulator -= GUNNY_STEP_MS;
        }
        if (session.projectile === null) accumulator = 0;
      }
      if (session.boom !== null) {
        session.boom.alpha -= delta / 520;
        if (session.boom.alpha <= 0) session.boom = null;
      }
      drawScene(ctx, session);
    };

    drawScene(ctx, session);
    frameId = requestAnimationFrame(frame);
  };

  /** @brief Builds the online duel state from the shared seed. */
  function createOnlineSession(seed: number, localSeat: 1 | 2): GunnySession {
    const wind = windForRound(seed, 1);
    return {
      terrain: generateTerrain(seed, GUNNY_WIDTH),
      playerHp: 100,
      enemyHp: 100,
      wind,
      round: 1,
      turn: localSeat === 1 ? "player" : "ai",
      angle: 45,
      power: 60,
      aiAngle: 45,
      projectile: null,
      trail: [],
      boom: null,
      shooter: "player",
      message: `Round 1 — wind ${describeWind(wind)}. ${
        localSeat === 1 ? "Seat 1 fires first — you lead." : "Seat 1 fires first — opponent leads."
      }`,
      over: false,
    };
  }

  /** @brief Status line for the online duel, from the local seat's perspective. */
  function onlineStatusText(): string {
    if (peerLeft) return "Opponent left the match.";
    if (session.over) return session.message;
    const turn = onlineTurn === onlineLocalSeat ? "your turn" : "opponent's turn";
    return `${session.message} You are seat ${onlineLocalSeat} — ${turn}.`;
  }

  /** @brief Repaints the online HUD, the status line and the battlefield. */
  function syncOnlineHud(): void {
    const localHp = onlineLocalSeat === 1 ? session.playerHp : session.enemyHp;
    const foeHp = onlineLocalSeat === 1 ? session.enemyHp : session.playerHp;
    if (playerHpValue !== null) playerHpValue.textContent = String(Math.round(localHp));
    if (enemyHpValue !== null) enemyHpValue.textContent = String(Math.round(foeHp));
    if (windValue !== null) {
      windValue.textContent = `${session.wind >= 0 ? "→" : "←"} ${Math.abs(session.wind).toFixed(1)}`;
    }
    if (roundValue !== null) roundValue.textContent = String(session.round);
    if (turnValue !== null) {
      turnValue.textContent = session.over ? "over" : onlineTurn === onlineLocalSeat ? "you" : "opponent";
    }
    if (fireButton !== null) {
      fireButton.disabled = session.over || peerLeft || onlineTurn !== onlineLocalSeat;
    }
    if (statusLine !== null) statusLine.textContent = onlineStatusText();
    if (onlineCtx !== null) drawScene(onlineCtx, session);
  }

  /**
   * @brief Applies one resolved online shot to the shared world.
   * @param shooterSeat Seat that fired: 1 is the left tank, 2 the right tank.
   * @param angle Validated barrel angle in degrees.
   * @param power Validated power setting.
   */
  function applyOnlineShot(shooterSeat: 1 | 2, angle: number, power: number): void {
    const result = simulateShot(session.terrain, shooterSeat, angle, power, session.wind);
    const targetSeat: 1 | 2 = shooterSeat === 1 ? 2 : 1;
    const localShot = shooterSeat === onlineLocalSeat;
    session.projectile = null;
    session.trail = [];
    session.boom = { x: result.x, y: result.y, alpha: 1 };
    if (targetSeat === 1) session.playerHp = Math.max(0, session.playerHp - result.damage);
    else session.enemyHp = Math.max(0, session.enemyHp - result.damage);
    session.shooter = localShot ? "player" : "ai";
    const shot = `${angle}° at power ${power}`;
    if (result.damage > 0) {
      session.message = localShot
        ? `You fire ${shot} — hit for ${result.damage}.`
        : `Opponent fires ${shot} — you take ${result.damage}.`;
    } else {
      session.message = localShot ? `You fire ${shot} — miss.` : `Opponent fires ${shot} — no damage.`;
    }

    const targetHp = targetSeat === 1 ? session.playerHp : session.enemyHp;
    if (targetHp <= 0) {
      const winnerSeat: 1 | 2 = targetSeat === 1 ? 2 : 1;
      session.over = true;
      session.message +=
        winnerSeat === onlineLocalSeat
          ? " Opponent tank destroyed — you win."
          : " Your tank is scrap — opponent wins.";
      syncOnlineHud();
      return;
    }

    onlineShots += 1;
    if (onlineShots >= 2) {
      onlineShots = 0;
      session.round += 1;
      session.wind = windForRound(onlineSeed, session.round);
      session.message += ` Round ${session.round} — wind ${describeWind(session.wind)}.`;
    }
    onlineTurn = targetSeat;
    session.turn = onlineTurn === onlineLocalSeat ? "player" : "ai";
    syncOnlineHud();
  }

  /** @brief Resolves and relays one local shot. */
  function fireOnline(): void {
    if (online === null || session.over || peerLeft || onlineTurn !== onlineLocalSeat) return;
    if (onlineAngleField === null || onlinePowerField === null) return;
    const rawAngle = Number(onlineAngleField.value);
    const rawPower = Number(onlinePowerField.value);
    const angle = Math.round(clamp(Number.isFinite(rawAngle) ? rawAngle : 45, ANGLE_MIN, ANGLE_MAX));
    const power = Math.round(clamp(Number.isFinite(rawPower) ? rawPower : 60, POWER_MIN, POWER_MAX));
    onlineAngleField.value = String(angle);
    onlinePowerField.value = String(power);
    session.angle = angle;
    session.power = power;
    applyOnlineShot(onlineLocalSeat, angle, power);
    online.sendMove({ kind: "shot", angle, power });
  }

  /** @brief Applies one validated opponent shot. */
  function handleOnlineShot(payload: unknown): void {
    if (online === null || session.over || peerLeft) return;
    if (payload === null || typeof payload !== "object") return;
    const data = payload as { kind?: unknown; angle?: unknown; power?: unknown };
    if (data.kind !== "shot") return;
    const { angle, power } = data;
    if (typeof angle !== "number" || !Number.isFinite(angle)) return;
    if (typeof power !== "number" || !Number.isFinite(power)) return;
    if (angle < ANGLE_MIN || angle > ANGLE_MAX) return;
    if (power < POWER_MIN || power > POWER_MAX) return;
    const remoteSeat: 1 | 2 = onlineLocalSeat === 1 ? 2 : 1;
    if (onlineTurn !== remoteSeat) return;
    applyOnlineShot(remoteSeat, angle, power);
  }

  /**
   * @brief Builds the online duel and wires the bridge.
   * @param target Host element owned by the stage.
   * @param bridge Live online match handle.
   */
  function mountOnline(target: HTMLElement, bridge: OnlineBridge): void {
    online = bridge;
    onlineLocalSeat = bridge.seat;
    onlineSeed = bridge.seed;
    onlineTurn = 1;
    onlineShots = 0;
    peerLeft = false;
    onlineCtx = null;
    session = createOnlineSession(bridge.seed, bridge.seat);
    target.replaceChildren();

    unsubscribeMove = bridge.onMove(handleOnlineShot);
    unsubscribePeer = bridge.onPeerLeft(() => {
      peerLeft = true;
      syncOnlineHud();
    });

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const addStat = (label: string, initial: string): HTMLElement => {
      const wrapper = document.createElement("span");
      wrapper.append(`${label} `);
      const value = document.createElement("b");
      value.textContent = initial;
      wrapper.append(value);
      hud.append(wrapper);
      return value;
    };
    playerHpValue = addStat("you", "100");
    enemyHpValue = addStat("opponent", "100");
    windValue = addStat("wind", "→ 0.0");
    roundValue = addStat("round", "1");
    turnValue = addStat("turn", "you");

    const canvas = document.createElement("canvas");
    canvas.className = "stage-canvas";
    canvas.width = GUNNY_WIDTH;
    canvas.height = GUNNY_HEIGHT;
    canvas.setAttribute("aria-label", "Gunny battlefield");
    canvas.style.maxWidth = `${GUNNY_WIDTH}px`;

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const label = (text: string): HTMLElement => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    };
    const numberInput = (min: number, max: number, value: number, name: string): HTMLInputElement => {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "stage-input";
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      input.value = String(value);
      input.setAttribute("aria-label", name);
      input.style.width = "72px";
      return input;
    };
    const angleField = numberInput(ANGLE_MIN, ANGLE_MAX, session.angle, "Barrel angle in degrees");
    const powerField = numberInput(POWER_MIN, POWER_MAX, session.power, "Shot power");
    onlineAngleField = angleField;
    onlinePowerField = powerField;

    const makeButton = (text: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stage-btn";
      button.textContent = text;
      addListener<MouseEvent>(button, "click", onClick);
      return button;
    };
    const fire = makeButton("Fire", fireOnline);
    fireButton = fire;
    const restart = makeButton("New round", () => undefined);
    restart.disabled = true;
    bar.append(label("angle"), angleField, label("power"), powerField, fire, restart);
    addListener<KeyboardEvent>(angleField, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      fireOnline();
    });
    addListener<KeyboardEvent>(powerField, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      fireOnline();
    });

    const status = document.createElement("p");
    status.className = "stage-status";
    statusLine = status;
    target.append(hud, canvas, bar, status);

    onlineCtx = canvas.getContext("2d");
    syncOnlineHud();
  }

  return { mount, unmount };
}
