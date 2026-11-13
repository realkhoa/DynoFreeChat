/**
 * @file game.ts
 * @brief Shooter game module: a vertical space shooter on a canvas.
 * @details The simulation lives in pure functions ({@link spawnWave},
 * {@link stepEntities}, {@link hitTest}) so the rules are testable without a
 * canvas. The factory only wires input, a fixed-timestep loop and painting.
 */

import type { GameContext, GameMount } from "../mount";
import type { OnlineBridge } from "../online/bridge";

/** @brief Playfield width in logical pixels. */
export const SHOOTER_WIDTH = 640;

/** @brief Playfield height in logical pixels. */
export const SHOOTER_HEIGHT = 480;

/** @brief Fixed simulation step in milliseconds (60 Hz). */
export const SHOOTER_STEP_MS = 1000 / 60;

/** @brief Points awarded for one destroyed enemy. */
export const SHOOTER_KILL_SCORE = 10;

/** @brief Lives the player starts with. */
export const SHOOTER_START_LIVES = 3;

const PLAYER_WIDTH = 34;
const PLAYER_HEIGHT = 22;
const PLAYER_SPEED = 330;
const PLAYER_BOTTOM_GAP = 42;
const BULLET_WIDTH = 4;
const BULLET_HEIGHT = 12;
const BULLET_SPEED = 540;
const MAX_BULLETS = 4;
const ENEMY_WIDTH = 30;
const ENEMY_HEIGHT = 22;
const WAVE_MARGIN = 36;
const WAVE_COLUMNS = 6;
const WAVE_MAX_ENEMIES = 12;
const WAVE_BASE_SPEED = 22;
const WAVE_SPEED_STEP = 8;
const WAVE_ROW_SPEED = 3;
const WAVE_ROW_GAP = 46;
const FIRE_COOLDOWN_MS = 150;

/** @brief Axis-aligned box shared by every shooter entity. */
export interface ShooterBox {
  /** Left edge in logical pixels. */
  x: number;
  /** Top edge in logical pixels. */
  y: number;
  /** Box width in logical pixels. */
  width: number;
  /** Box height in logical pixels. */
  height: number;
}

/** @brief Player ship: a box that slides along the bottom edge. */
export interface ShooterPlayer extends ShooterBox {
  /** Horizontal speed in pixels per second. */
  speed: number;
}

/** @brief Enemy ship falling towards the player. */
export interface ShooterEnemy extends ShooterBox {
  /** Downward speed in pixels per second. */
  speed: number;
  /** Row inside the spawned wave, used for the stagger. */
  row: number;
}

/** @brief Player bullet travelling upwards. */
export interface ShooterBullet extends ShooterBox {
  /** Upward speed in pixels per second. */
  speed: number;
}

/** @brief Lifecycle of one shooter run. */
export type ShooterStatus = "running" | "paused" | "over";

/** @brief Complete shooter simulation state. */
export interface ShooterState {
  /** Playfield width in logical pixels. */
  width: number;
  /** Playfield height in logical pixels. */
  height: number;
  /** Player ship. */
  player: ShooterPlayer;
  /** Bullets currently in flight. */
  bullets: ShooterBullet[];
  /** Enemies currently on screen. */
  enemies: ShooterEnemy[];
  /** Points collected so far. */
  score: number;
  /** Remaining lives. */
  lives: number;
  /** Current wave, starting at 1. */
  wave: number;
  /** Run lifecycle. */
  status: ShooterStatus;
}

/**
 * @brief Clamps a number into an inclusive range.
 * @param value Input value.
 * @param min Lower bound.
 * @param max Upper bound.
 * @return The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * @brief Builds the descending formation for one wave.
 * @details Enemy count grows with the wave (capped), speed grows per wave and
 * per row, and the formation starts just above the playfield.
 * @param wave Wave number, starting at 1.
 * @param width Playfield width in logical pixels.
 * @return Fresh enemies for that wave.
 */
export function spawnWave(wave: number, width: number): ShooterEnemy[] {
  const safeWave = Math.max(1, Math.floor(wave));
  const count = Math.min(WAVE_MAX_ENEMIES, 3 + safeWave * 2);
  const usable = Math.max(ENEMY_WIDTH + 8, width - WAVE_MARGIN * 2);
  const cell = usable / WAVE_COLUMNS;
  const enemies: ShooterEnemy[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / WAVE_COLUMNS);
    const column = index % WAVE_COLUMNS;
    const x = clamp(
      WAVE_MARGIN + column * cell + (cell - ENEMY_WIDTH) / 2,
      0,
      Math.max(0, width - ENEMY_WIDTH),
    );
    enemies.push({
      x,
      y: -ENEMY_HEIGHT - row * WAVE_ROW_GAP,
      width: ENEMY_WIDTH,
      height: ENEMY_HEIGHT,
      speed: WAVE_BASE_SPEED + safeWave * WAVE_SPEED_STEP + row * WAVE_ROW_SPEED,
      row,
    });
  }
  return enemies;
}

/**
 * @brief Axis-aligned overlap test.
 * @details Touching edges do not count as a hit, so a bullet grazing the hull
 * never kills.
 * @param a First box.
 * @param b Second box.
 * @return True when the boxes overlap.
 */
export function hitTest(a: ShooterBox, b: ShooterBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * @brief Creates a fresh run at the requested size.
 * @param width Playfield width in logical pixels.
 * @param height Playfield height in logical pixels.
 * @return A running state with lives, wave 1 and the player centred at the bottom.
 */
export function createShooterState(
  width: number = SHOOTER_WIDTH,
  height: number = SHOOTER_HEIGHT,
): ShooterState {
  return {
    width,
    height,
    player: {
      x: width / 2 - PLAYER_WIDTH / 2,
      y: height - PLAYER_HEIGHT - PLAYER_BOTTOM_GAP,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      speed: PLAYER_SPEED,
    },
    bullets: [],
    enemies: spawnWave(1, width),
    score: 0,
    lives: SHOOTER_START_LIVES,
    wave: 1,
    status: "running",
  };
}

/**
 * @brief Moves the player ship horizontally, clamped to the playfield.
 * @param state Current state.
 * @param dx Horizontal delta in pixels (negative moves left).
 * @return A new state, or the same state when the ship cannot move further.
 */
export function movePlayer(state: ShooterState, dx: number): ShooterState {
  const x = clamp(state.player.x + dx, 0, Math.max(0, state.width - state.player.width));
  if (x === state.player.x) return state;
  return { ...state, player: { ...state.player, x } };
}

/**
 * @brief Centres the player ship on a horizontal position.
 * @param state Current state.
 * @param centerX Target centre in logical pixels.
 * @return A new state with the ship clamped inside the playfield.
 */
export function movePlayerTo(state: ShooterState, centerX: number): ShooterState {
  return movePlayer(state, centerX - (state.player.x + state.player.width / 2));
}

/**
 * @brief Fires one bullet from the nose of the ship.
 * @details Refused when the run is not running or the screen already holds the
 * maximum number of bullets.
 * @param state Current state.
 * @return A new state with one extra bullet, or the same state when refused.
 */
export function fireBullet(state: ShooterState): ShooterState {
  if (state.status !== "running" || state.bullets.length >= MAX_BULLETS) return state;
  const bullet: ShooterBullet = {
    x: state.player.x + state.player.width / 2 - BULLET_WIDTH / 2,
    y: state.player.y - BULLET_HEIGHT,
    width: BULLET_WIDTH,
    height: BULLET_HEIGHT,
    speed: BULLET_SPEED,
  };
  return { ...state, bullets: [...state.bullets, bullet] };
}

/**
 * @brief Advances one simulation step: movement, collisions, score and lives.
 * @details Enemies that reach the ship (or leave the bottom edge) cost a life and
 * disappear. Bullets that overlap an enemy destroy both and score
 * {@link SHOOTER_KILL_SCORE}. Reaching zero lives ends the run.
 * @param state Current state.
 * @param dtMs Elapsed time in milliseconds.
 * @return A new state; the same state when paused, over or with no elapsed time.
 */
export function stepEntities(state: ShooterState, dtMs: number): ShooterState {
  if (state.status !== "running") return state;
  const seconds = Math.max(0, dtMs) / 1000;
  if (seconds === 0) return state;

  const bullets: ShooterBullet[] = [];
  for (const bullet of state.bullets) {
    const moved: ShooterBullet = { ...bullet, y: bullet.y - bullet.speed * seconds };
    if (moved.y + moved.height > 0) bullets.push(moved);
  }

  let score = state.score;
  let lives = state.lives;
  const enemies: ShooterEnemy[] = [];
  for (const enemy of state.enemies) {
    const moved: ShooterEnemy = { ...enemy, y: enemy.y + enemy.speed * seconds };
    const hitIndex = bullets.findIndex((bullet) => hitTest(moved, bullet));
    if (hitIndex >= 0) {
      bullets.splice(hitIndex, 1);
      score += SHOOTER_KILL_SCORE;
      continue;
    }
    if (hitTest(moved, state.player) || moved.y > state.height) {
      lives -= 1;
      continue;
    }
    enemies.push(moved);
  }

  const nextLives = Math.max(0, lives);
  return {
    ...state,
    bullets,
    enemies,
    score,
    lives: nextLives,
    status: nextLives <= 0 ? "over" : state.status,
  };
}

/**
 * @brief Starts the next wave after the current formation is cleared.
 * @param state Current state.
 * @return A new state with the wave counter advanced and a fresh formation.
 */
export function nextWave(state: ShooterState): ShooterState {
  if (state.status !== "running") return state;
  const wave = state.wave + 1;
  return { ...state, wave, enemies: spawnWave(wave, state.width) };
}

/**
 * @brief Paints one frame of the run.
 * @param ctx Two dimensional canvas context, already proven non-null.
 * @param state State to paint.
 */
function drawScene(ctx: CanvasRenderingContext2D, state: ShooterState): void {
  const { width, height } = state;
  ctx.fillStyle = "#101016";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let y = 24; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = "#dcdcaa";
  for (const bullet of state.bullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }

  for (const enemy of state.enemies) {
    ctx.fillStyle = "#f48771";
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    ctx.fillStyle = "#7a3a30";
    ctx.fillRect(enemy.x + 6, enemy.y + 6, enemy.width - 12, enemy.height - 12);
  }

  const player = state.player;
  ctx.fillStyle = "#4ec9b0";
  ctx.fillRect(player.x + player.width / 2 - 4, player.y - 6, 8, 8);
  ctx.fillRect(player.x, player.y, player.width, player.height);
  ctx.fillStyle = "#1f6f63";
  ctx.fillRect(player.x + 6, player.y + 5, player.width - 12, 8);

  ctx.fillStyle = "#1f2430";
  ctx.fillRect(0, height - 6, width, 6);

  if (state.status !== "running") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f0f0f0";
    ctx.font = "20px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      state.status === "paused" ? "PAUSED — press P" : `GAME OVER — score ${state.score}`,
      width / 2,
      height / 2,
    );
    ctx.font = "12px monospace";
    ctx.fillStyle = "#9a9a9a";
    ctx.fillText(
      state.status === "paused" ? "the loop is frozen" : "press R or Restart to fly again",
      width / 2,
      height / 2 + 24,
    );
    ctx.textAlign = "start";
  }
}

/**
 * @brief Creates one shooter game instance.
 * @details All state lives in this closure, so a fresh instance is a fresh run.
 * @return A mountable game module.
 */
export function createShooterGame(): GameMount {
  let host: HTMLElement | null = null;
  let state: ShooterState = createShooterState();
  let frameId = 0;
  let mounted = false;
  let pointerDown = false;
  const held = new Set<"left" | "right" | "fire">();
  const cleanups: Array<() => void> = [];
  let scoreValue: HTMLElement | null = null;
  let livesValue: HTMLElement | null = null;
  let waveValue: HTMLElement | null = null;
  let rivalValue: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;
  let pauseButton: HTMLButtonElement | null = null;
  let online: OnlineBridge | null = null;
  let rivalWave = 0;
  let rivalScore = 0;
  let rivalDead = false;
  let selfDead = false;
  let lastRelayed = "";
  let unsubscribeMove: (() => void) | null = null;
  let unsubscribePeer: (() => void) | null = null;

  const addListener = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
  ): void => {
    const wrapped = (event: Event): void => handler(event as E);
    target.addEventListener(type, wrapped);
    cleanups.push(() => target.removeEventListener(type, wrapped));
  };

  const hintFor = (): string => {
    if (online !== null) {
      if (selfDead) return `You are down — rival wins. Score ${state.score} vs ${rivalScore}.`;
      if (rivalDead) return `Rival is down — you win! Score ${state.score} vs ${rivalScore}.`;
      if (state.status === "paused") return "Paused — press P to resume.";
      return `Race: you wave ${state.wave} · rival wave ${rivalWave} · arrows move, space fires`;
    }
    if (state.status === "over") return `Game over — score ${state.score}. Press R or Restart.`;
    if (state.status === "paused") return "Paused — press P to resume.";
    return "Arrows / A-D or drag to move · Space or click to fire · P pauses";
  };

  /** @brief Relays wave/death progress to the rival, at most once per change. */
  const relayProgress = (): void => {
    if (online === null) return;
    const dead = state.status === "over";
    const key = `${state.wave}:${dead ? 1 : 0}`;
    if (key === lastRelayed) return;
    lastRelayed = key;
    if (dead) selfDead = true;
    online.sendMove({ kind: "progress", wave: state.wave, score: state.score, dead });
  };

  const syncHud = (): void => {
    if (scoreValue !== null) scoreValue.textContent = String(state.score);
    if (livesValue !== null) livesValue.textContent = String(state.lives);
    if (waveValue !== null) waveValue.textContent = String(state.wave);
    if (rivalValue !== null) rivalValue.textContent = String(rivalWave);
    if (statusLine !== null) statusLine.textContent = hintFor();
    if (pauseButton !== null) {
      const paused = state.status === "paused";
      pauseButton.classList.toggle("is-active", paused);
      pauseButton.textContent = paused ? "Resume" : "Pause";
    }
    relayProgress();
  };

  const unmount = (): void => {
    mounted = false;
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    for (const dispose of cleanups) dispose();
    cleanups.length = 0;
    held.clear();
    pointerDown = false;
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = null;
    rivalWave = 0;
    rivalScore = 0;
    rivalDead = false;
    selfDead = false;
    lastRelayed = "";
    scoreValue = null;
    livesValue = null;
    waveValue = null;
    rivalValue = null;
    statusLine = null;
    pauseButton = null;
    host = null;
  };

  const mount = (nextHost: HTMLElement, context?: GameContext): void => {
    unmount();
    mounted = true;
    host = nextHost;
    online = context?.online ?? null;
    state = createShooterState();
    host.replaceChildren();

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const addStat = (label: string): HTMLElement => {
      const wrapper = document.createElement("span");
      wrapper.append(`${label} `);
      const value = document.createElement("b");
      value.textContent = "0";
      wrapper.append(value);
      hud.append(wrapper);
      return value;
    };
    scoreValue = addStat("score");
    livesValue = addStat("lives");
    waveValue = addStat("wave");
    if (online !== null) {
      rivalValue = addStat("rival wave");
      const bridge = online;
      unsubscribeMove = bridge.onMove((payload) => {
        const message = payload as { kind?: unknown; wave?: unknown; score?: unknown; dead?: unknown } | null;
        if (message?.kind !== "progress") return;
        if (typeof message.wave === "number" && Number.isFinite(message.wave)) {
          rivalWave = Math.max(0, Math.floor(message.wave));
        }
        if (typeof message.score === "number" && Number.isFinite(message.score)) {
          rivalScore = Math.max(0, Math.floor(message.score));
        }
        if (message.dead === true) rivalDead = true;
        syncHud();
      });
      unsubscribePeer = bridge.onPeerLeft(() => {
        if (statusLine !== null)
          statusLine.textContent = "opponent left — press Leave, then start a new match";
      });
    }

    const canvas = document.createElement("canvas");
    canvas.className = "stage-canvas";
    canvas.width = SHOOTER_WIDTH;
    canvas.height = SHOOTER_HEIGHT;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Shooter playfield");
    canvas.style.maxWidth = `${SHOOTER_WIDTH}px`;

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const makeButton = (label: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stage-btn";
      button.textContent = label;
      addListener<MouseEvent>(button, "click", onClick);
      return button;
    };

    const togglePause = (): void => {
      if (state.status === "over") return;
      state = { ...state, status: state.status === "paused" ? "running" : "paused" };
      syncHud();
    };

    const restart = (): void => {
      // An online race is a single shared run; restarting locally would desync it.
      if (online !== null) return;
      state = createShooterState();
      held.clear();
      pointerDown = false;
      syncHud();
    };

    pauseButton = makeButton("Pause", togglePause);
    bar.append(pauseButton, makeButton("Restart", restart));

    const status = document.createElement("p");
    status.className = "stage-status";
    statusLine = status;

    host.append(hud, canvas, bar, status);
    syncHud();

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    let lastTime = 0;
    let accumulator = 0;
    let cooldownMs = 0;

    const stepInput = (deltaMs: number): void => {
      const direction = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
      if (direction !== 0) {
        state = movePlayer(state, direction * state.player.speed * (deltaMs / 1000));
      }
      cooldownMs = Math.max(0, cooldownMs - deltaMs);
      if (held.has("fire") && cooldownMs === 0) {
        const fired = fireBullet(state);
        if (fired !== state) cooldownMs = FIRE_COOLDOWN_MS;
        state = fired;
      }
    };

    const frame = (now: number): void => {
      if (!mounted) return;
      frameId = requestAnimationFrame(frame);
      if (lastTime === 0) lastTime = now;
      const delta = Math.min(120, Math.max(0, now - lastTime));
      lastTime = now;
      if (state.status === "running") {
        stepInput(delta);
        accumulator += delta;
        while (accumulator >= SHOOTER_STEP_MS) {
          state = stepEntities(state, SHOOTER_STEP_MS);
          accumulator -= SHOOTER_STEP_MS;
        }
        if (state.status === "running" && state.enemies.length === 0) {
          state = nextWave(state);
        }
        syncHud();
      }
      drawScene(ctx, state);
    };

    const pointerX = (event: PointerEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width > 0 ? canvas.width / rect.width : 1;
      return (event.clientX - rect.left) * scale;
    };

    addListener<KeyboardEvent>(window, "keydown", (event) => {
      const key = event.key;
      if (key === "p" || key === "P") {
        if (!event.repeat) togglePause();
        return;
      }
      if ((key === "r" || key === "R") && state.status === "over") {
        restart();
        return;
      }
      if (key === "ArrowLeft" || key === "a" || key === "A") {
        held.add("left");
        event.preventDefault();
      } else if (key === "ArrowRight" || key === "d" || key === "D") {
        held.add("right");
        event.preventDefault();
      } else if (key === " " || key === "Spacebar") {
        held.add("fire");
        event.preventDefault();
      }
    });

    addListener<KeyboardEvent>(window, "keyup", (event) => {
      const key = event.key;
      if (key === "ArrowLeft" || key === "a" || key === "A") held.delete("left");
      else if (key === "ArrowRight" || key === "d" || key === "D") held.delete("right");
      else if (key === " " || key === "Spacebar") held.delete("fire");
    });

    addListener<PointerEvent>(canvas, "pointerdown", (event) => {
      event.preventDefault();
      if (state.status !== "running") return;
      pointerDown = true;
      state = movePlayerTo(state, pointerX(event));
      const fired = fireBullet(state);
      if (fired !== state) cooldownMs = FIRE_COOLDOWN_MS;
      state = fired;
    });

    addListener<PointerEvent>(canvas, "pointermove", (event) => {
      if (!pointerDown || state.status !== "running") return;
      state = movePlayerTo(state, pointerX(event));
    });

    addListener<PointerEvent>(window, "pointerup", () => {
      pointerDown = false;
    });

    addListener<PointerEvent>(window, "pointercancel", () => {
      pointerDown = false;
    });

    drawScene(ctx, state);
    frameId = requestAnimationFrame(frame);
  };

  return { mount, unmount };
}
