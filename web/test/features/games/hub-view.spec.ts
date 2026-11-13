// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamesHubView, type GameEntry } from "@/features/games/hub-view";

const ENTRIES: GameEntry[] = [
  {
    id: "tictactoe",
    title: "Cờ Caro (Tic-Tac-Toe)",
    subtitle: "Đấu online, với máy, 2 người trên cùng máy.",
    icon: "hash",
    shortcut: "↵ mở",
  },
  {
    id: "caro5",
    title: "Caro 5",
    subtitle: "Bàn 10x10, thắng 5 liên tiếp.",
    icon: "solution",
    shortcut: "↵ mở",
  },
];

describe("GamesHubView", () => {
  let list: HTMLElement;
  let onOpen: (id: string) => void;
  let hub: GamesHubView;

  beforeEach(() => {
    document.body.replaceChildren();
    list = document.createElement("div");
    document.body.append(list);
    onOpen = vi.fn<(id: string) => void>();
    hub = new GamesHubView(list, { onOpen });
    hub.setGames(ENTRIES);
  });

  it("renders one large button per game with a clear title and description", () => {
    const cards = list.querySelectorAll<HTMLButtonElement>(".game-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.dataset.gameId).toBe("tictactoe");
    expect(cards[0]?.querySelector(".game-card-title")?.textContent).toBe("Cờ Caro (Tic-Tac-Toe)");
    expect(cards[0]?.querySelector(".game-card-subtitle")?.textContent).toContain("online");
    expect(cards[0]?.querySelector(".game-card-hint")?.textContent).toBe("↵ mở");
    expect(cards[0]?.getAttribute("aria-label")).toContain("Cờ Caro");
  });

  it("opens the game when its entry is clicked", () => {
    list.querySelector<HTMLButtonElement>('[data-game-id="caro5"]')?.click();
    expect(onOpen).toHaveBeenCalledWith("caro5");
  });

  it("opens the game with Enter or Space", () => {
    const card = list.querySelector<HTMLButtonElement>('[data-game-id="tictactoe"]');
    card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onOpen).toHaveBeenCalledWith("tictactoe");

    card?.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("focuses the first game when the tab activates", () => {
    hub.focusFirst();
    expect(document.activeElement).toBe(list.querySelector(".game-card"));
  });

  it("re-renders without duplicating entries", () => {
    hub.setGames(ENTRIES);
    expect(list.querySelectorAll(".game-card")).toHaveLength(2);
    expect(hub.games).toHaveLength(2);
  });

  it("renders an empty list when no games are registered", () => {
    hub.setGames([]);
    expect(list.querySelectorAll(".game-card")).toHaveLength(0);
  });
});
