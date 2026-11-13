// @vitest-environment jsdom
/**
 * @file sokoban.spec.ts
 * @brief Engine rules and one DOM smoke test for the sokoban module.
 */

import { describe, expect, it } from "vitest";
import {
  LEVELS,
  applyMove,
  boxTotal,
  boxesOnGoals,
  createSokobanGame,
  directionForMoveKey,
  isSolved,
  loadLevel,
  parseLevel,
  undoMove,
  type LevelState,
} from "@/features/games/sokoban/game";

/**
 * @brief Builds a tiny controlled level.
 * @param rows ASCII rows.
 * @return Parsed level.
 */
function levelOf(rows: readonly string[]): LevelState {
  return parseLevel(rows);
}

describe("sokoban parsing", () => {
  it("reads walls, goals, boxes and the player", () => {
    const level = levelOf(["####", "#@$#", "#.*#", "####"]);
    expect(level.width).toBe(4);
    expect(level.height).toBe(4);
    expect(level.player).toBe(5);
    expect(level.walls[0]).toBe(true);
    expect(level.boxes[6]).toBe(true);
    expect(level.goals[10]).toBe(true);
    expect(level.boxes[10]).toBe(true);
  });

  it("reads a player already standing on a goal", () => {
    const level = levelOf(["####", "#+ #", "#  #", "####"]);
    expect(level.player).toBe(5);
    expect(level.goals[5]).toBe(true);
  });

  it("rejects a map without a player", () => {
    expect(() => levelOf(["####", "#  #", "####"])).toThrow();
  });

  it("ships levels that parse into a consistent shape", () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(3);
    for (const definition of LEVELS) {
      expect(new Set(definition.rows.map((row) => row.length)).size).toBe(1);
      const level = levelOf(definition.rows);
      expect(boxTotal(level)).toBeGreaterThan(0);
      expect(isSolved(level)).toBe(false);
    }
  });
});

describe("sokoban movement", () => {
  it("walks onto floor and refuses walls", () => {
    const level = levelOf(["#####", "#@  #", "#####"]);
    expect(level.player).toBe(6);
    const walked = applyMove(level, "right");
    expect(walked.moved).toBe(true);
    expect(walked.pushed).toBe(false);
    expect(walked.level.player).toBe(7);

    const blocked = applyMove(level, "left");
    expect(blocked.moved).toBe(false);
    expect(blocked.level).toBe(level);
    expect(blocked.level.player).toBe(6);
  });

  it("pushes a box one cell", () => {
    const level = levelOf(["#####", "#@$ #", "#####"]);
    const pushed = applyMove(level, "right");
    expect(pushed.moved).toBe(true);
    expect(pushed.pushed).toBe(true);
    expect(pushed.level.boxes[8]).toBe(true);
    expect(pushed.level.boxes[7]).toBe(false);
    expect(pushed.level.player).toBe(7);
    expect(level.boxes[7]).toBe(true);
  });

  it("refuses to push a box into a wall", () => {
    const level = levelOf(["#####", "#@$##", "#####"]);
    const blocked = applyMove(level, "right");
    expect(blocked.moved).toBe(false);
    expect(blocked.level.boxes[7]).toBe(true);
  });

  it("refuses to push two boxes at once", () => {
    const level = levelOf(["######", "#@$$ #", "######"]);
    const blocked = applyMove(level, "right");
    expect(blocked.moved).toBe(false);
    expect(blocked.level.player).toBe(7);
  });

  it("solves the warm up level with one push", () => {
    const level = loadLevel(0).level;
    const solved = applyMove(level, "right");
    expect(solved.pushed).toBe(true);
    expect(isSolved(solved.level)).toBe(true);
    expect(boxesOnGoals(solved.level)).toBe(1);
  });

  it("stops being solved when a box leaves its goal", () => {
    const level = levelOf(["#####", "#@* #", "#####"]);
    expect(isSolved(level)).toBe(true);
    const shifted = applyMove(level, "right").level;
    expect(shifted.boxes[8]).toBe(true);
    expect(shifted.goals[8]).toBe(false);
    expect(isSolved(shifted)).toBe(false);
  });
});

describe("sokoban undo", () => {
  it("restores the previous snapshot", () => {
    const start = levelOf(["#####", "#@$ #", "#####"]);
    const moved = applyMove(start, "right").level;
    const undone = undoMove([start]);
    expect(undone).not.toBeNull();
    expect(undone?.level).toBe(start);
    expect(undone?.history).toEqual([]);
    expect(moved.player).not.toBe(start.player);
  });

  it("returns null on an empty history", () => {
    expect(undoMove([])).toBeNull();
  });

  it("maps arrows, WASD and ignores undo keys", () => {
    expect(directionForMoveKey("ArrowUp")).toBe("up");
    expect(directionForMoveKey("ArrowDown")).toBe("down");
    expect(directionForMoveKey("ArrowLeft")).toBe("left");
    expect(directionForMoveKey("ArrowRight")).toBe("right");
    expect(directionForMoveKey("w")).toBe("up");
    expect(directionForMoveKey("A")).toBe("left");
    expect(directionForMoveKey("s")).toBe("down");
    expect(directionForMoveKey("d")).toBe("right");
    expect(directionForMoveKey("z")).toBeNull();
  });
});

describe("sokoban view", () => {
  it("mounts, solves a level, undoes and switches levels", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const game = createSokobanGame();

    expect(() => game.mount(host)).not.toThrow();
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[role=gridcell]")).toHaveLength(35);

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(host.querySelector(".stage-status")?.textContent).toContain("Solved");

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    expect(host.querySelector(".stage-status")?.textContent).toBe("Move undone.");

    const picker = host.querySelectorAll<HTMLButtonElement>(".stage-btn");
    const second = picker[1];
    if (second === undefined) throw new Error("expected a level button");
    second.click();
    expect(host.querySelectorAll("[role=gridcell]")).toHaveLength(48);

    expect(() => game.unmount()).not.toThrow();
    expect(host.children).toHaveLength(0);
    document.body.removeChild(host);
  });
});
