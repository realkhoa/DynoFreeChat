// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamesHubView, type FeatureModule, type GamesHubElements } from "@/features/games/hub-view";
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
    id: "caro",
    name: "Caro",
    className: "Caro",
    documentTitle: "Caro.cs",
    summary: "online session | local simulation",
    hotkey: "↵",
    icon: "hash",
  },
];

const FEATURES: FeatureModule[] = [
  { id: "quotes", name: "Quotes", summary: "live quotes | index basket", hotkey: "F7" },
  { id: "chart", name: "Chart", summary: "candles | 1m..1D", hotkey: "F9" },
];

interface Harness {
  view: GamesHubView;
  elements: GamesHubElements;
  onOpen: (id: string) => void;
  onOpenFeature: (id: string) => void;
}

/**
 * @brief Builds the hub document hosts with the static file lines.
 * @return The harness.
 */
function makeHarness(): Harness {
  document.body.replaceChildren();

  const content = document.createElement("div");
  content.className = "game-code-content";
  content.id = "games-content";
  content.innerHTML = `
    <div class="code-line comment">// header</div>
    <div class="code-line empty"></div>
    <div class="code-line">namespace X;</div>
    <div class="code-line empty"></div>
    <div class="code-line comment">// feature documents</div>
    <div class="code-line empty"></div>
    <div class="games-feature-list" id="games-feature-list"></div>
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
    features: content.querySelector<HTMLElement>("#games-feature-list")!,
    list: content.querySelector<HTMLElement>("#games-list")!,
    gutter,
    chip,
  };
  const onOpen = vi.fn<(id: string) => void>();
  const onOpenFeature = vi.fn<(id: string) => void>();
  const view = new GamesHubView(elements, { onOpen, onOpenFeature });

  return { view, elements, onOpen, onOpenFeature };
}

describe("GamesHubView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.view.setFeatures(FEATURES);
    h.view.setGames(GAMES);
  });

  it("links every feature document as its own struct block", () => {
    const rows = h.elements.features.querySelectorAll<HTMLButtonElement>(".module-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.dataset.featureId).toBe("quotes");
    expect(rows[0]?.textContent).toContain("Quotes");
    expect(rows[0]?.textContent).toContain("F7");
    expect(rows[0]?.textContent).toContain("public sealed struct QuotesModule : IFeatureModule");
    expect(rows[1]?.textContent).toContain("Chart");
  });

  it("opens a feature document when its struct is clicked", () => {
    h.elements.features.querySelector<HTMLButtonElement>('[data-feature-id="chart"]')?.click();
    expect(h.onOpenFeature).toHaveBeenCalledWith("chart");
    expect(h.onOpen).not.toHaveBeenCalled();
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
    expect(blocks[1]?.textContent).toContain("public sealed class Caro : IGameModule");
    for (const block of blocks) expect(block.querySelectorAll(".code-line")).toHaveLength(3);
  });

  it("numbers the gutter from every rendered code line", () => {
    const content = h.elements.list.closest(".game-code-content")!;
    expect(h.elements.gutter.querySelectorAll("span")).toHaveLength(
      content.querySelectorAll(".code-line").length,
    );
    expect(h.elements.gutter.lastElementChild?.textContent).toBe(
      String(content.querySelectorAll(".code-line").length).padStart(2, "0"),
    );
  });

  it("reports both module counts in the toolbar chip", () => {
    expect(h.elements.chip?.textContent).toBe("// modules: 2 features | 2 games");
    h.view.setGames(GAMES.slice(0, 1));
    expect(h.elements.chip?.textContent).toBe("// modules: 2 features | 1 game");
  });

  it("opens the game when its class block is clicked", () => {
    h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="caro"]')?.click();
    expect(h.onOpen).toHaveBeenCalledWith("caro");
    expect(h.onOpenFeature).not.toHaveBeenCalled();
  });

  it("opens the game with Enter or Space", () => {
    const block = h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="tictactoe"]');
    block?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.onOpen).toHaveBeenCalledWith("tictactoe");

    block?.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(h.onOpen).toHaveBeenCalledTimes(2);
  });

  it("focuses the first feature, then the first game when there are none", () => {
    h.view.focusFirst();
    expect(document.activeElement).toBe(h.elements.features.querySelector(".module-row"));

    h.view.setFeatures([]);
    h.view.focusFirst();
    expect(document.activeElement).toBe(h.elements.list.querySelector(".module-row"));
  });

  it("re-renders without duplicating modules", () => {
    h.view.setFeatures(FEATURES);
    h.view.setGames(GAMES);
    expect(h.elements.features.querySelectorAll(".module-row")).toHaveLength(2);
    expect(h.elements.list.querySelectorAll(".module-row")).toHaveLength(2);
    expect(h.view.games).toHaveLength(2);
    expect(h.view.modules).toHaveLength(2);
  });
});
