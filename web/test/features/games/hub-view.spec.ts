// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamesHubView, type GamesHubElements } from "@/features/games/hub-view";
import type { GameDefinition } from "@/features/games/registry";

const GAMES: GameDefinition[] = [
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    className: "TicTacToe",
    documentTitle: "TicTacToe.cs",
    summary: "online session | local simulation | dual-thread",
    hotkey: "F6",
    icon: "hash",
  },
  {
    id: "caro5",
    name: "Caro 5",
    className: "Caro5",
    documentTitle: "Caro5.cs",
    summary: "online session | local simulation",
    hotkey: "F7",
    icon: "hash",
  },
];

interface Harness {
  view: GamesHubView;
  elements: GamesHubElements;
  onOpen: (id: string) => void;
}

function makeHarness(): Harness {
  document.body.replaceChildren();

  const content = document.createElement("div");
  content.id = "games-content";
  content.innerHTML = `
    <div class="code-line comment">// header</div>
    <div class="code-line empty"></div>
    <div class="code-line">namespace X;</div>
    <div class="code-line empty"></div>
    <div class="code-line comment">// game modules</div>
    <div class="code-line empty"></div>
    <div class="games-list" id="games-list"></div>
    <div class="code-line comment">// footer</div>
  `;
  const gutter = document.createElement("div");
  gutter.id = "games-gutter";
  const chip = document.createElement("span");
  document.body.append(content, gutter, chip);

  const elements: GamesHubElements = {
    list: content.querySelector<HTMLElement>("#games-list")!,
    gutter,
    chip,
  };
  const onOpen = vi.fn<(id: string) => void>();
  const view = new GamesHubView(elements, { onOpen });

  return { view, elements, onOpen };
}

describe("GamesHubView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.view.setGames(GAMES);
  });

  it("shows the real game name so the game is easy to find", () => {
    const first = h.elements.list.querySelector<HTMLButtonElement>(".module-row");
    expect(first?.querySelector(".module-lens")?.textContent).toContain("Tic-Tac-Toe");
    expect(first?.querySelector(".module-lens")?.textContent).toContain("F6");
    expect(first?.getAttribute("aria-label")).toContain("Tic-Tac-Toe");
  });

  it("renders each game as a C# class block with three code lines", () => {
    const blocks = h.elements.list.querySelectorAll<HTMLButtonElement>(".module-row");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.dataset.gameId).toBe("tictactoe");
    expect(blocks[0]?.textContent).toContain("public sealed class TicTacToe : IGameModule");
    expect(blocks[1]?.textContent).toContain("public sealed class Caro5 : IGameModule");
    for (const block of blocks) expect(block.querySelectorAll(".code-line")).toHaveLength(3);
  });

  it("numbers the gutter from the static lines plus the game blocks", () => {
    // seven static lines in the fixture plus three lines per game
    expect(h.elements.gutter.querySelectorAll("span")).toHaveLength(7 + 2 * 3);
    expect(h.elements.gutter.lastElementChild?.textContent).toBe("13");
  });

  it("reports the game count in the toolbar chip", () => {
    expect(h.elements.chip?.textContent).toBe("// registry: 2 games");
    h.view.setGames(GAMES.slice(0, 1));
    expect(h.elements.chip?.textContent).toBe("// registry: 1 game");
  });

  it("opens the game when its class block is clicked", () => {
    h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="caro5"]')?.click();
    expect(h.onOpen).toHaveBeenCalledWith("caro5");
  });

  it("opens the game with Enter or Space", () => {
    const block = h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="tictactoe"]');
    block?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.onOpen).toHaveBeenCalledWith("tictactoe");

    block?.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(h.onOpen).toHaveBeenCalledTimes(2);
  });

  it("focuses the first game when the tab activates", () => {
    h.view.focusFirst();
    expect(document.activeElement).toBe(h.elements.list.querySelector(".module-row"));
  });

  it("re-renders without duplicating games", () => {
    h.view.setGames(GAMES);
    expect(h.elements.list.querySelectorAll(".module-row")).toHaveLength(2);
    expect(h.view.games).toHaveLength(2);
  });
});
