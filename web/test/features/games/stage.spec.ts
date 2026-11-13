// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GAME_FACTORIES } from "@/features/games/factories";
import type { GameMount } from "@/features/games/mount";
import { GAMES } from "@/features/games/registry";
import { GameStage, type StageElements } from "@/features/games/stage";

/** Records mount/unmount calls so the stage lifecycle is observable. */
function fakeGame(): GameMount & { mounts: number; unmounts: number } {
  const game = {
    mounts: 0,
    unmounts: 0,
    mount(host: HTMLElement): void {
      game.mounts += 1;
      const board = document.createElement("div");
      board.className = "stage-board";
      board.textContent = "board";
      host.append(board);
    },
    unmount(): void {
      game.unmounts += 1;
    },
  };
  return game;
}

/** Builds the stage hosts. */
function makeElements(): StageElements {
  document.body.replaceChildren();
  const panel = document.createElement("section");
  panel.id = "game-stage-view";
  panel.innerHTML = `
    <span id="game-stage-title"></span>
    <span id="game-stage-chip"></span>
    <div id="game-stage-host"></div>
    <span id="game-stage-status"></span>
    <button id="game-stage-restart"></button>
    <button id="game-stage-focus"></button>`;
  document.body.append(panel);

  return {
    panel,
    host: panel.querySelector<HTMLElement>("#game-stage-host")!,
    title: panel.querySelector<HTMLElement>("#game-stage-title")!,
    chip: panel.querySelector<HTMLElement>("#game-stage-chip")!,
    status: panel.querySelector<HTMLElement>("#game-stage-status")!,
    restart: panel.querySelector<HTMLButtonElement>("#game-stage-restart")!,
    focus: panel.querySelector<HTMLButtonElement>("#game-stage-focus")!,
  };
}

describe("GameStage", () => {
  it("dims the board and hides the comments when Focus is on", () => {
    const elements = makeElements();
    const stage = new GameStage(elements, { demo: () => fakeGame() });
    stage.open("demo", "Demo.cs", "local simulation");

    expect(elements.host.dataset.focus).toBe("off");
    expect(stage.toggleFocus()).toBe(true);
    expect(elements.host.dataset.focus).toBe("on");
    expect(elements.focus.getAttribute("aria-pressed")).toBe("true");
    expect(stage.toggleFocus()).toBe(false);
    expect(elements.host.dataset.focus).toBe("off");
  });

  it("remembers the Focus preference in storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    } as unknown as Storage;

    const first = new GameStage(makeElements(), { demo: () => fakeGame() }, storage);
    first.toggleFocus();

    const elements = makeElements();
    const second = new GameStage(elements, { demo: () => fakeGame() }, storage);
    expect(second.isFocused).toBe(true);
    expect(elements.host.dataset.focus).toBe("on");
  });

  it("mounts the requested game and paints the tab chrome", () => {
    const elements = makeElements();
    const game = fakeGame();
    const stage = new GameStage(elements, { demo: () => game });

    expect(stage.open("demo", "Demo.cs", "local simulation")).toBe(true);
    expect(stage.activeId).toBe("demo");
    expect(game.mounts).toBe(1);
    expect(elements.host.querySelector(".stage-game-host")?.textContent).toBe("board");
    // Real code lines surround the board literal so it reads as part of a file.
    expect(elements.host.textContent).toContain("static const BoardCell g_Board[] = {");
    expect(elements.host.textContent).toContain('#include "dynofreechat/board.h"');
    expect(elements.host.textContent).toContain("} // namespace DynoFreeChat::Games");
    expect(elements.title.textContent).toBe("Demo.cs");
    expect(elements.chip.textContent).toBe("// generated · read-only");
  });

  it("unmounts the previous game before mounting the next one", () => {
    const elements = makeElements();
    const first = fakeGame();
    const second = fakeGame();
    const stage = new GameStage(elements, { first: () => first, second: () => second });

    stage.open("first", "First.cs", "one");
    stage.open("second", "Second.cs", "two");

    expect(first.unmounts).toBe(1);
    expect(second.mounts).toBe(1);
    expect(stage.activeId).toBe("second");
  });

  it("remounts the active game from the restart button", () => {
    const elements = makeElements();
    const game = fakeGame();
    const stage = new GameStage(elements, { demo: () => game });

    stage.open("demo", "Demo.cs", "local simulation");
    elements.restart.click();

    expect(game.unmounts).toBe(1);
    expect(game.mounts).toBe(2);
  });

  it("refuses an unknown game id without touching the mounted one", () => {
    const elements = makeElements();
    const game = fakeGame();
    const stage = new GameStage(elements, { demo: () => game });

    stage.open("demo", "Demo.cs", "local simulation");
    expect(stage.open("nope", "Nope.cs", "?")).toBe(false);
    expect(stage.activeId).toBe("demo");
    expect(game.unmounts).toBe(0);
  });

  it("survives a game whose unmount throws", () => {
    const elements = makeElements();
    const broken: GameMount = {
      mount: vi.fn(),
      unmount: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const stage = new GameStage(elements, { broken: () => broken, demo: () => fakeGame() });

    stage.open("broken", "Broken.cs", "x");
    expect(() => stage.open("demo", "Demo.cs", "y")).not.toThrow();
    expect(stage.activeId).toBe("demo");
  });
});

describe("game factories", () => {
  it("has a factory for every playable registry game", () => {
    const missing = GAMES.filter((game) => game.id !== "tictactoe" && GAME_FACTORIES[game.id] === undefined);
    expect(missing.map((game) => game.id)).toEqual([]);
  });

  it("mounts every factory without throwing", () => {
    for (const [id, factory] of Object.entries(GAME_FACTORIES)) {
      const host = document.createElement("div");
      const game = factory();
      expect(() => game.mount(host), `mount ${id}`).not.toThrow();
      expect(host.childElementCount, `children for ${id}`).toBeGreaterThan(0);
      expect(() => game.unmount(), `unmount ${id}`).not.toThrow();
    }
  });
});
