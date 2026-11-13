// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  allSunk,
  aiNextShot,
  BATTLESHIP_SIZE,
  coordName,
  createBattleshipGame,
  createBoard,
  FLEET_SPEC,
  fire,
  indexOf,
  isShipSunk,
  mulberry32,
  placeFleet,
  shipCells,
  type BoardState,
  type Coord,
  type Ship,
  type ShotMark,
} from "@/features/games/battleship/game";

/** Builds a ship record from explicit cells. */
function makeShip(name: string, cells: Coord[]): Ship {
  return { name, length: cells.length, cells };
}

/** Builds a board carrying the given ships with no shots fired. */
function boardWith(ships: Ship[]): BoardState {
  return { ships, shots: Array<ShotMark>(BATTLESHIP_SIZE * BATTLESHIP_SIZE).fill("") };
}

/** Reads one shot mark. */
function markAt(board: BoardState, row: number, col: number): string {
  return board.shots[row * BATTLESHIP_SIZE + col] ?? "";
}

describe("battleship engine", () => {
  it("places a valid, non-overlapping fleet of 5,4,3,3,2 for many seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const fleet = placeFleet(mulberry32(seed));
      expect(fleet.map((ship) => ship.length)).toEqual([5, 4, 3, 3, 2]);
      expect(fleet.map((ship) => ship.name)).toEqual(FLEET_SPEC.map((spec) => spec.name));

      const occupied = new Set<number>();
      for (const ship of fleet) {
        expect(ship.cells).toHaveLength(ship.length);
        for (const cell of ship.cells) {
          expect(cell.row).toBeGreaterThanOrEqual(0);
          expect(cell.row).toBeLessThan(BATTLESHIP_SIZE);
          expect(cell.col).toBeGreaterThanOrEqual(0);
          expect(cell.col).toBeLessThan(BATTLESHIP_SIZE);
          const key = indexOf(cell);
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
      expect(occupied.size).toBe(17);
    }
  });

  it("is reproducible for the same seed and differs across seeds", () => {
    expect(placeFleet(mulberry32(42))).toEqual(placeFleet(mulberry32(42)));
    expect(placeFleet(mulberry32(1))).not.toEqual(placeFleet(mulberry32(2)));
  });

  it("rejects ship cells that leave the board", () => {
    expect(shipCells({ row: 0, col: 7 }, 4, "h")).toBeNull();
    expect(shipCells({ row: 8, col: 0 }, 3, "v")).toBeNull();
    expect(shipCells({ row: 0, col: 0 }, 5, "h")).toHaveLength(5);
    expect(shipCells({ row: 5, col: 9 }, 3, "v")).toEqual([
      { row: 5, col: 9 },
      { row: 6, col: 9 },
      { row: 7, col: 9 },
    ]);
  });

  it("marks a miss in open water", () => {
    const board = boardWith([]);
    const result = fire(board, { row: 2, col: 3 });
    expect(result.result).toBe("miss");
    expect(result.sunkShip).toBeNull();
    expect(result.won).toBe(false);
    expect(markAt(result.state, 2, 3)).toBe("miss");
    expect(markAt(board, 2, 3)).toBe("");
  });

  it("marks a hit and then a sunk ship", () => {
    const destroyer = makeShip("Destroyer", [
      { row: 4, col: 4 },
      { row: 4, col: 5 },
    ]);
    const board = boardWith([destroyer]);

    const first = fire(board, { row: 4, col: 4 });
    expect(first.result).toBe("hit");
    expect(first.sunkShip).toBeNull();
    expect(isShipSunk(first.state, destroyer)).toBe(false);
    expect(first.won).toBe(false);

    const second = fire(first.state, { row: 4, col: 5 });
    expect(second.result).toBe("sunk");
    expect(second.sunkShip?.name).toBe("Destroyer");
    expect(markAt(second.state, 4, 4)).toBe("sunk");
    expect(markAt(second.state, 4, 5)).toBe("sunk");
    expect(second.won).toBe(true);
  });

  it("leaves the board unchanged when shooting the same cell twice", () => {
    const board = boardWith([
      makeShip("Destroyer", [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ]),
    ]);
    const first = fire(board, { row: 0, col: 0 });
    const again = fire(first.state, { row: 0, col: 0 });
    expect(again.result).toBe("hit");
    expect(again.state.shots).toEqual(first.state.shots);
    expect(again.won).toBe(false);
  });

  it("declares a win only when every ship is sunk", () => {
    const fleet = [
      makeShip("Cruiser", [
        { row: 1, col: 1 },
        { row: 1, col: 2 },
        { row: 1, col: 3 },
      ]),
      makeShip("Destroyer", [
        { row: 8, col: 8 },
        { row: 8, col: 9 },
      ]),
    ];
    let board = boardWith(fleet);
    expect(allSunk(createBoard())).toBe(false);

    for (const cell of fleet[0]?.cells ?? []) board = fire(board, cell).state;
    expect(allSunk(board)).toBe(false);

    for (const cell of fleet[1]?.cells ?? []) board = fire(board, cell).state;
    expect(allSunk(board)).toBe(true);
  });

  it("targets an orthogonal neighbour after a hit", () => {
    const board = boardWith([
      makeShip("Carrier", [
        { row: 5, col: 5 },
        { row: 5, col: 6 },
        { row: 5, col: 7 },
        { row: 5, col: 8 },
        { row: 5, col: 9 },
      ]),
    ]);
    board.shots[indexOf({ row: 5, col: 6 })] = "hit";
    board.shots[indexOf({ row: 9, col: 0 })] = "miss";

    const shot = aiNextShot(board, mulberry32(3));
    const distance = Math.abs(shot.row - 5) + Math.abs(shot.col - 6);
    expect(distance).toBe(1);
    expect(markAt(board, shot.row, shot.col)).toBe("");
  });

  it("extends a line of two hits instead of probing sideways", () => {
    const board = boardWith([
      makeShip("Carrier", [
        { row: 2, col: 2 },
        { row: 2, col: 3 },
        { row: 2, col: 4 },
        { row: 2, col: 5 },
        { row: 2, col: 6 },
      ]),
    ]);
    board.shots[indexOf({ row: 2, col: 2 })] = "hit";
    board.shots[indexOf({ row: 2, col: 3 })] = "hit";
    expect(aiNextShot(board, mulberry32(5))).toEqual({ row: 2, col: 4 });
    expect(aiNextShot(board, mulberry32(5))).toEqual({ row: 2, col: 4 });
  });

  it("never repeats a shot and stays in bounds while hunting", () => {
    let board = boardWith(placeFleet(mulberry32(11)));
    const rng = mulberry32(99);
    const seen = new Set<number>();

    for (let i = 0; i < 40; i++) {
      const shot = aiNextShot(board, rng);
      const key = indexOf(shot);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(shot.row).toBeGreaterThanOrEqual(0);
      expect(shot.row).toBeLessThan(BATTLESHIP_SIZE);
      expect(shot.col).toBeGreaterThanOrEqual(0);
      expect(shot.col).toBeLessThan(BATTLESHIP_SIZE);
      board = { ships: board.ships, shots: board.shots.slice() };
      board.shots[key] = "miss";
    }
  });

  it("uses parity shots while hunting on a clean board", () => {
    const board = boardWith(placeFleet(mulberry32(4)));
    for (let i = 0; i < 10; i++) {
      const shot = aiNextShot(board, mulberry32(i + 1));
      expect((shot.row + shot.col) % 2).toBe(0);
    }
  });

  it("names coordinates in the conventional way", () => {
    expect(coordName({ row: 0, col: 0 })).toBe("A1");
    expect(coordName({ row: 9, col: 9 })).toBe("J10");
    expect(coordName({ row: 2, col: 5 })).toBe("F3");
  });

  it("creates an empty 10x10 board", () => {
    const board = createBoard();
    expect(board.shots).toHaveLength(100);
    expect(board.ships).toHaveLength(0);
    expect(board.shots.every((mark) => mark === "")).toBe(true);
  });
});

describe("battleship view", () => {
  it("deploys a random fleet, fires a shot and unmounts cleanly", () => {
    const host = document.createElement("div");
    const game = createBattleshipGame();
    game.mount(host);
    expect(host.children.length).toBeGreaterThan(0);

    const status = host.querySelector(".stage-status");
    expect(status?.textContent).toContain("Deploy your fleet");

    const random = [...host.querySelectorAll<HTMLButtonElement>(".stage-btn")].find(
      (btn) => btn.textContent === "Random placement",
    );
    random?.click();

    const grids = host.querySelectorAll(".stage-board");
    expect(grids).toHaveLength(2);
    expect(host.querySelectorAll(".stage-cell")).toHaveLength(200);
    expect(host.querySelectorAll(".stage-cell.is-primary")).toHaveLength(17);

    const before = host.querySelector(".stage-status")?.textContent ?? "";
    const enemyCells = grids[0]?.querySelectorAll<HTMLButtonElement>(".stage-cell") ?? [];
    enemyCells[0]?.click();
    const after = host.querySelector(".stage-status")?.textContent ?? "";
    expect(after).not.toBe(before);
    expect(after).toContain("A1");

    expect(() => game.unmount()).not.toThrow();
    game.mount(host);
    expect(host.querySelectorAll(".stage-status")[0]?.textContent).toContain("Deploy your fleet");
    game.unmount();
  });
});
