// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamesHubView, type GameEntry, type GamesHubElements } from "@/features/games/hub-view";

const ENTRIES: GameEntry[] = [
  {
    id: "tictactoe",
    module: "MatrixInspector",
    summary: "3x3 pointer buffer - remote attach | local simulation | dual-thread",
    hotkey: "F6",
  },
  {
    id: "caro5",
    module: "LinearPatternProbe",
    summary: "5x5 pattern buffer - remote attach | local simulation",
    hotkey: "F7",
  },
];

interface Harness {
  view: GamesHubView;
  elements: GamesHubElements;
  onOpen: (id: string) => void;
  content: HTMLElement;
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
    <div class="code-line comment">// analyzer modules</div>
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

  return { view, elements, onOpen, content };
}

describe("GamesHubView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.view.setGames(ENTRIES);
  });

  it("renders each module as a C# class block, not a game card", () => {
    const blocks = h.elements.list.querySelectorAll<HTMLButtonElement>(".module-row");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.dataset.gameId).toBe("tictactoe");
    expect(blocks[0]?.querySelector(".module-lens")?.textContent).toContain("run");
    expect(blocks[0]?.querySelector(".module-lens")?.textContent).toContain("F6");
    expect(blocks[0]?.textContent).toContain("public sealed class MatrixInspector : IGameModule");
    expect(blocks[0]?.textContent).toContain("3x3 pointer buffer");
    expect(blocks[0]?.textContent).not.toContain("Cờ Caro");
  });

  it("gives every module exactly three rendered code lines", () => {
    for (const block of h.elements.list.querySelectorAll(".module-row")) {
      expect(block.querySelectorAll(".code-line")).toHaveLength(3);
    }
  });

  it("numbers the gutter from the static lines plus the module blocks", () => {
    // seven static lines in the fixture plus three lines per module
    expect(h.elements.gutter.querySelectorAll("span")).toHaveLength(7 + 2 * 3);
    expect(h.elements.gutter.lastElementChild?.textContent).toBe("13");
  });

  it("reports the module count in the toolbar chip", () => {
    expect(h.elements.chip?.textContent).toBe("// registry: 2 modules");
    h.view.setGames(ENTRIES.slice(0, 1));
    expect(h.elements.chip?.textContent).toBe("// registry: 1 module");
  });

  it("runs the module when its class block is clicked", () => {
    h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="caro5"]')?.click();
    expect(h.onOpen).toHaveBeenCalledWith("caro5");
  });

  it("runs the module with Enter or Space", () => {
    const block = h.elements.list.querySelector<HTMLButtonElement>('[data-game-id="tictactoe"]');
    block?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.onOpen).toHaveBeenCalledWith("tictactoe");

    block?.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(h.onOpen).toHaveBeenCalledTimes(2);
  });

  it("focuses the first module when the tab activates", () => {
    h.view.focusFirst();
    expect(document.activeElement).toBe(h.elements.list.querySelector(".module-row"));
  });

  it("re-renders without duplicating modules", () => {
    h.view.setGames(ENTRIES);
    expect(h.elements.list.querySelectorAll(".module-row")).toHaveLength(2);
    expect(h.view.games).toHaveLength(2);
  });
});
