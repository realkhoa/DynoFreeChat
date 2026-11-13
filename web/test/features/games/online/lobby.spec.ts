// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineBridge } from "@/features/games/online/bridge";
import { MatchView, type MatchDeps, type MatchElements } from "@/features/games/online/lobby";
import type { OnlineMatchOptions } from "@/features/games/online/match";
import type { GameDefinition } from "@/features/games/registry";

const GAMES: GameDefinition[] = [
  {
    id: "caro",
    name: "Caro",
    className: "Caro",
    documentTitle: "Caro.cs",
    summary: "gomoku 15x15 | online match",
    hotkey: "↵",
    icon: "hash",
    online: true,
  },
  {
    id: "chess",
    name: "Chess",
    className: "Chess",
    documentTitle: "Chess.cs",
    summary: "full rules | minimax AI",
    hotkey: "↵",
    icon: "hash",
  },
];

/** Builds the lobby document hosts. */
function makeElements(): MatchElements {
  document.body.replaceChildren();
  const panel = document.createElement("section");
  panel.id = "match-view";
  panel.innerHTML = `
    <select id="match-game"></select>
    <input id="match-slug" />
    <input id="match-pass" />
    <button id="match-create"></button>
    <button id="match-join"></button>
    <button id="match-leave"></button>
    <div id="match-status"></div>
    <div id="match-roster"></div>`;
  document.body.append(panel);

  return {
    panel,
    gameSelect: panel.querySelector<HTMLSelectElement>("#match-game")!,
    slug: panel.querySelector<HTMLInputElement>("#match-slug")!,
    pass: panel.querySelector<HTMLInputElement>("#match-pass")!,
    createButton: panel.querySelector<HTMLButtonElement>("#match-create")!,
    joinButton: panel.querySelector<HTMLButtonElement>("#match-join")!,
    leaveButton: panel.querySelector<HTMLButtonElement>("#match-leave")!,
    status: panel.querySelector<HTMLElement>("#match-status")!,
    roster: panel.querySelector<HTMLElement>("#match-roster")!,
  };
}

interface Harness {
  view: MatchView;
  elements: MatchElements;
  onMatch: ReturnType<typeof vi.fn<(game: GameDefinition, bridge: OnlineBridge) => void>>;
  options: OnlineMatchOptions[];
  start: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
}

/** Builds the lobby with a fake fetch and a fake match. */
function makeHarness(): Harness {
  const elements = makeElements();
  const onMatch = vi.fn<(game: GameDefinition, bridge: OnlineBridge) => void>();
  const options: OnlineMatchOptions[] = [];
  const start = vi.fn();
  const leave = vi.fn();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ slug: "caro-test" }), { status: 201 }));

  const deps: MatchDeps = {
    wsUrl: "wss://api.example/ws",
    apiBase: "https://api.example",
    nick: () => "An",
    color: () => "hsl(200 60% 60%)",
    games: GAMES,
    onMatch,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    createMatch: (matchOptions) => {
      options.push(matchOptions);
      return { start, leave } as unknown as ReturnType<NonNullable<MatchDeps["createMatch"]>>;
    },
  };

  return { view: new MatchView(elements, deps), elements, onMatch, options, start, leave, fetchImpl };
}

/** Minimal bridge the lobby only passes through. */
function bridge(): OnlineBridge {
  return {
    role: "host",
    seat: 1,
    seed: 1,
    peerNick: "Bob",
    sendMove: vi.fn(),
    onMove: () => () => {},
    onPeerLeft: () => () => {},
    onPhase: () => () => {},
    setStatus: vi.fn(),
    leave: vi.fn(),
  };
}

describe("MatchView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("lists only games that advertise online play", () => {
    h.view.start();
    const options = [...h.elements.gameSelect.options].map((option) => option.value);
    expect(options).toEqual(["caro"]);
    expect(h.view.currentGame?.id).toBe("caro");
  });

  it("creates a room through the lobby API and connects to it", async () => {
    h.view.start();
    h.elements.slug.value = "caro-test";
    h.elements.pass.value = "1234";

    await h.view.createAndJoin();

    expect(h.fetchImpl).toHaveBeenCalledWith(
      "https://api.example/api/rooms",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: "caro-test", pass: "1234" }) }),
    );
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.options[0]?.url).toContain("r=caro-test");
    expect(h.options[0]).toMatchObject({ game: "caro", nick: "An", pass: "1234" });
    expect(h.view.isConnected).toBe(true);
  });

  it("generates a slug when the box is empty", async () => {
    h.view.start();
    await h.view.createAndJoin();
    const slug = h.elements.slug.value;
    expect(slug.startsWith("caro-")).toBe(true);
    expect(h.options[0]?.url).toContain(`r=${slug}`);
  });

  it("joins an existing slug without creating a room", () => {
    h.view.start();
    h.elements.slug.value = "friend-room";
    h.view.join();

    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.options[0]?.url).toContain("r=friend-room");
  });

  it("refuses an invalid room slug", () => {
    h.view.start();
    h.elements.slug.value = "NO WAY!";
    h.view.join();

    expect(h.start).not.toHaveBeenCalled();
    expect(h.elements.status.textContent).toContain("slug");
  });

  it("opens the game stage when the match starts", async () => {
    h.view.start();
    await h.view.createAndJoin();

    const fakeBridge = bridge();
    h.options[0]?.onStart?.(fakeBridge);
    expect(h.onMatch).toHaveBeenCalledWith(expect.objectContaining({ id: "caro" }), fakeBridge);
    expect(h.elements.roster.textContent).toContain("you are host");
  });

  it("leaves the match on demand", async () => {
    h.view.start();
    await h.view.createAndJoin();
    h.view.leave();

    expect(h.leave).toHaveBeenCalledTimes(1);
    expect(h.view.isConnected).toBe(false);
    expect(h.elements.status.textContent).toContain("left the match");
  });
});
