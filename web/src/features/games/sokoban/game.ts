/**
 * @file game.ts
 * @brief Sokoban: hand-authored string levels, push rules, undo and a level picker.
 * @details Levels are plain ASCII maps so adding one is one array in {@link LEVELS}.
 * The engine works on flat arrays and returns new states, which makes undo a stack
 * of snapshots and the tests independent from the DOM.
 */

import type { GameMount } from "../mount";

/** Direction a step is taken in. */
export type SokobanDirection = "up" | "down" | "left" | "right";

/** One parsed level: static geometry plus the live player and box positions. */
export interface LevelState {
  width: number;
  height: number;
  walls: boolean[];
  goals: boolean[];
  boxes: boolean[];
  player: number;
}

/** One hand-authored level; `#` wall, `.` goal, `$` box, `*` box on goal, `@` player, `+` player on goal. */
export interface LevelDefinition {
  name: string;
  rows: readonly string[];
}

/** Outcome of one step. */
export interface MoveOutcome {
  level: LevelState;
  moved: boolean;
  pushed: boolean;
}

/** Outcome of undoing one step. */
export interface UndoResult {
  level: LevelState;
  history: LevelState[];
}

/** Levels shipped with the module. */
export const LEVELS: readonly LevelDefinition[] = [
  {
    name: "warm up",
    rows: ["#######", "#     #", "# @$. #", "#     #", "#######"],
  },
  {
    name: "detour",
    rows: ["########", "#      #", "#  $   #", "#  @   #", "#  .   #", "########"],
  },
  {
    name: "two boxes",
    rows: ["########", "#      #", "# $$   #", "# @    #", "# ..   #", "########"],
  },
  {
    name: "relay",
    rows: ["#########", "#       #", "#  * $  #", "#  @ .  #", "#       #", "#########"],
  },
];

/** Step delta per direction. */
const DELTAS: Record<SokobanDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * @brief Parses one ASCII map into a playable level.
 * @throws When the map is empty or has no player.
 */
export function parseLevel(rows: readonly string[]): LevelState {
  const height = rows.length;
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  if (height === 0 || width === 0) throw new Error("Level map is empty");

  const total = width * height;
  const level: LevelState = {
    width,
    height,
    walls: new Array<boolean>(total).fill(false),
    goals: new Array<boolean>(total).fill(false),
    boxes: new Array<boolean>(total).fill(false),
    player: -1,
  };

  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) {
      const char = row.charAt(x) || " ";
      const index = y * width + x;
      if (char === "#") level.walls[index] = true;
      else if (char === ".") level.goals[index] = true;
      else if (char === "$") level.boxes[index] = true;
      else if (char === "*") {
        level.boxes[index] = true;
        level.goals[index] = true;
      } else if (char === "@") level.player = index;
      else if (char === "+") {
        level.player = index;
        level.goals[index] = true;
      }
    }
  });

  if (level.player < 0) throw new Error("Level map needs one player");
  return level;
}

/** @brief Loads one shipped level by index, clamped into range. */
export function loadLevel(index: number): { level: LevelState; index: number } {
  const safeIndex = Math.min(Math.max(index, 0), LEVELS.length - 1);
  const definition = LEVELS[safeIndex];
  if (definition === undefined) throw new Error("No sokoban levels configured");
  return { level: parseLevel(definition.rows), index: safeIndex };
}

/**
 * @brief Moves the player one step, pushing a box when one blocks the way.
 * @details A box only moves when the cell behind it is inside the level, free of
 * walls and free of other boxes; otherwise the whole step is refused.
 */
export function applyMove(level: LevelState, direction: SokobanDirection): MoveOutcome {
  const delta = DELTAS[direction];
  const fromX = level.player % level.width;
  const fromY = Math.floor(level.player / level.width);
  const toX = fromX + delta.dx;
  const toY = fromY + delta.dy;
  if (!inside(level, toX, toY)) return { level, moved: false, pushed: false };

  const target = toY * level.width + toX;
  if (level.walls[target] === true) return { level, moved: false, pushed: false };

  const boxes = level.boxes.slice();
  if (boxes[target] === true) {
    const beyondX = toX + delta.dx;
    const beyondY = toY + delta.dy;
    if (!inside(level, beyondX, beyondY)) return { level, moved: false, pushed: false };
    const beyond = beyondY * level.width + beyondX;
    if (level.walls[beyond] === true || boxes[beyond] === true) {
      return { level, moved: false, pushed: false };
    }
    boxes[beyond] = true;
    boxes[target] = false;
    return { level: { ...level, boxes, player: target }, moved: true, pushed: true };
  }

  return { level: { ...level, player: target }, moved: true, pushed: false };
}

/** @brief Reports whether at least one box exists and every box stands on a goal. */
export function isSolved(level: LevelState): boolean {
  let boxes = 0;
  for (let index = 0; index < level.boxes.length; index += 1) {
    if (level.boxes[index] !== true) continue;
    boxes += 1;
    if (level.goals[index] !== true) return false;
  }
  return boxes > 0;
}

/** @brief Counts the boxes that already sit on a goal. */
export function boxesOnGoals(level: LevelState): number {
  return level.boxes.reduce((total, box, index) => total + (box && level.goals[index] === true ? 1 : 0), 0);
}

/** @brief Counts the boxes on a level. */
export function boxTotal(level: LevelState): number {
  return level.boxes.reduce((total, box) => total + (box ? 1 : 0), 0);
}

/** @brief Pops the last snapshot off an undo history, or returns `null`. */
export function undoMove(history: readonly LevelState[]): UndoResult | null {
  const previous = history[history.length - 1];
  if (previous === undefined) return null;
  return { level: previous, history: history.slice(0, -1) };
}

/** @brief Maps a keyboard key to a direction; `null` for unrelated keys. */
export function directionForMoveKey(key: string): SokobanDirection | null {
  const normalised = key.length === 1 ? key.toLowerCase() : key;
  if (normalised === "ArrowUp" || normalised === "w") return "up";
  if (normalised === "ArrowDown" || normalised === "s") return "down";
  if (normalised === "ArrowLeft" || normalised === "a") return "left";
  if (normalised === "ArrowRight" || normalised === "d") return "right";
  return null;
}

/** @brief Checks whether a cell lies inside a level. */
function inside(level: LevelState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.width && y < level.height;
}

/** One teardown callback registered while the view is mounted. */
type Cleanup = () => void;

/**
 * @brief Builds the sokoban game module.
 * @return A mount whose state is fully released by `unmount`.
 */
export function createSokobanGame(): GameMount {
  let host: HTMLElement | null = null;
  let cleanups: Cleanup[] = [];
  let boardSlot: HTMLDivElement | null = null;
  let cells: HTMLDivElement[] = [];
  let levelButtons: HTMLButtonElement[] = [];
  let hudLine: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;

  let levelIndex = 0;
  let level: LevelState = loadLevel(0).level;
  let history: LevelState[] = [];
  let message = "";

  /** @brief Registers a listener that `unmount` removes again. */
  function listen(target: HTMLElement, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** @brief Builds a styled toolbar button wired to `onClick`. */
  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-btn";
    button.textContent = label;
    listen(button, "click", onClick);
    return button;
  }

  /** @brief Loads a shipped level and clears the undo history. */
  function start(index: number): void {
    const loaded = loadLevel(index);
    levelIndex = loaded.index;
    level = loaded.level;
    history = [];
    message = "Arrow keys or WASD to move, z to undo.";
    if (boardSlot !== null) boardSlot.replaceChildren(buildBoard());
    render();
  }

  /** @brief Steps the player in one direction. */
  function move(direction: SokobanDirection): void {
    if (isSolved(level)) return;
    const outcome = applyMove(level, direction);
    if (!outcome.moved) return;
    history = [...history, level];
    level = outcome.level;
    message = isSolved(level)
      ? `Solved in ${history.length} move${history.length === 1 ? "" : "s"} — pick another level.`
      : "Arrow keys or WASD to move, z to undo.";
    render();
  }

  /** @brief Restores the previous snapshot. */
  function undo(): void {
    const result = undoMove(history);
    if (result === null) return;
    history = result.history;
    level = result.level;
    message = "Move undone.";
    render();
  }

  /** @brief Paints the HUD, the level picker, the status line and every cell. */
  function render(): void {
    if (hudLine !== null) {
      const name = LEVELS[levelIndex]?.name ?? "level";
      hudLine.textContent = `Level ${levelIndex + 1} · ${name} · Moves ${history.length} · Boxes ${boxesOnGoals(level)}/${boxTotal(level)}`;
    }
    if (statusLine !== null) statusLine.textContent = message;

    levelButtons.forEach((button, index) => {
      button.className = index === levelIndex ? "stage-btn is-active" : "stage-btn";
      button.setAttribute("aria-pressed", index === levelIndex ? "true" : "false");
    });

    if (cells.length !== level.width * level.height) return;
    cells.forEach((cell, index) => paintCell(cell, index));
  }

  /** @brief Paints one board cell. */
  function paintCell(cell: HTMLDivElement, index: number): void {
    const wall = level.walls[index] === true;
    const goal = level.goals[index] === true;
    const box = level.boxes[index] === true;
    const player = level.player === index;
    const row = Math.floor(index / level.width) + 1;
    const column = (index % level.width) + 1;
    let text = "";
    let className = "stage-cell";
    let label = "floor";

    if (wall) {
      text = "#";
      className = "stage-cell is-dim";
      label = "wall";
    } else if (box && goal) {
      text = "*";
      className = "stage-cell is-good";
      label = "box on goal";
    } else if (box) {
      text = "$";
      className = "stage-cell is-warn";
      label = "box";
    } else if (player && goal) {
      text = "+";
      className = "stage-cell is-primary";
      label = "player on goal";
    } else if (player) {
      text = "@";
      className = "stage-cell is-primary";
      label = "player";
    } else if (goal) {
      text = ".";
      className = "stage-cell is-muted";
      label = "goal";
    }

    cell.textContent = text;
    cell.className = className;
    cell.setAttribute("aria-label", `Row ${row} column ${column}: ${label}`);
  }

  /** @brief Builds the board for the current level. */
  function buildBoard(): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${level.width}, 44px)`;
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Sokoban board");

    const fragment = document.createDocumentFragment();
    cells = [];
    for (let index = 0; index < level.width * level.height; index += 1) {
      const cell = document.createElement("div");
      cell.className = "stage-cell";
      cell.setAttribute("role", "gridcell");
      fragment.append(cell);
      cells.push(cell);
    }
    grid.append(fragment);
    return grid;
  }

  /** @brief Handles movement and undo keys. */
  function onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      undo();
      return;
    }
    const direction = directionForMoveKey(event.key);
    if (direction === null) return;
    event.preventDefault();
    move(direction);
  }

  /** @brief Mounts the game into a host. */
  function mount(target: HTMLElement): void {
    unmount();
    host = target;
    target.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    levelButtons = [];
    LEVELS.forEach((definition, index) => {
      const button = makeButton(`${index + 1}. ${definition.name}`, () => start(index));
      bar.append(button);
      levelButtons.push(button);
    });
    bar.append(makeButton("Undo", () => undo()));

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    hudLine = document.createElement("span");
    hud.append(hudLine);

    statusLine = document.createElement("p");
    statusLine.className = "stage-status";
    statusLine.setAttribute("aria-live", "polite");

    boardSlot = document.createElement("div");
    target.append(bar, hud, boardSlot, statusLine);
    target.tabIndex = 0;
    target.setAttribute("aria-label", "Sokoban game");
    listen(target, "keydown", onKeyDown);
    target.focus();
    start(0);
  }

  /** @brief Releases listeners and the rendered DOM. */
  function unmount(): void {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (host !== null) {
      host.replaceChildren();
      host.removeAttribute("tabindex");
      host.removeAttribute("aria-label");
    }
    host = null;
    boardSlot = null;
    cells = [];
    levelButtons = [];
    hudLine = null;
    statusLine = null;
  }

  return { mount, unmount };
}
