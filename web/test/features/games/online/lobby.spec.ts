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

/** One room summary as the Worker returns it. */
interface RoomRow {
  slug: string;
  locked: boolean;
  lastSeen: number;
}

/** Builds the lobby document hosts. */
function makeElements(): MatchElements {
  document.body.replaceChildren();
  const panel = document.createElement("section");
  panel.id = "match-view";
  panel.innerHTML = `
    <select id="match-game"></select>
    <input id="match-create-code" />
    <input id="match-create-pass" />
    <button id="match-create"></button>
    <input id="match-join-code" />
    <input id="match-join-pass" />
    <button id="match-join"></button>
    <button id="match-leave"></button>
    <div id="match-status"></div>
    <div id="match-roster"></div>
    <div id="match-rooms"></div>
    <button id="match-refresh"></button>`;
  document.body.append(panel);

  return {
    panel,
    gameSelect: panel.querySelector<HTMLSelectElement>("#match-game")!,
    createCode: panel.querySelector<HTMLInputElement>("#match-create-code")!,
    createPass: panel.querySelector<HTMLInputElement>("#match-create-pass")!,
    createButton: panel.querySelector<HTMLButtonElement>("#match-create")!,
    joinCode: panel.querySelector<HTMLInputElement>("#match-join-code")!,
    joinPass: panel.querySelector<HTMLInputElement>("#match-join-pass")!,
    joinButton: panel.querySelector<HTMLButtonElement>("#match-join")!,
    leaveButton: panel.querySelector<HTMLButtonElement>("#match-leave")!,
    status: panel.querySelector<HTMLElement>("#match-status")!,
    roster: panel.querySelector<HTMLElement>("#match-roster")!,
    roomList: panel.querySelector<HTMLElement>("#match-rooms")!,
    refreshButton: panel.querySelector<HTMLButtonElement>("#match-refresh")!,
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
  rooms: RoomRow[];
}

/** Builds the lobby with fake fetch, room list and match. */
function makeHarness(rooms: RoomRow[] = []): Harness {
  const elements = makeElements();
  const onMatch = vi.fn<(game: GameDefinition, bridge: OnlineBridge) => void>();
  const options: OnlineMatchOptions[] = [];
  const start = vi.fn();
  const leave = vi.fn();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ slug: "caro-test" }), { status: 201 }));
  const state = { rooms: [...rooms] };

  const deps: MatchDeps = {
    wsUrl: "wss://api.example/ws",
    apiBase: "https://api.example",
    nick: () => "An",
    color: () => "hsl(200 60% 60%)",
    games: GAMES,
    onMatch,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    listRooms: async () => [...state.rooms],
    createMatch: (matchOptions) => {
      options.push(matchOptions);
      return { start, leave } as unknown as ReturnType<NonNullable<MatchDeps["createMatch"]>>;
    },
  };

  return {
    view: new MatchView(elements, deps),
    elements,
    onMatch,
    options,
    start,
    leave,
    fetchImpl,
    rooms: state.rooms,
  };
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
    h = makeHarness([
      { slug: "caro-a1", locked: false, lastSeen: 1_700_000_000_000 },
      { slug: "chess-b2", locked: true, lastSeen: 1_700_000_100_000 },
    ]);
  });

  it("lists only games that advertise online play", () => {
    h.view.start();
    const options = [...h.elements.gameSelect.options].map((option) => option.value);
    expect(options).toEqual(["caro"]);
    expect(h.view.currentGame?.id).toBe("caro");
  });

  it("paints the room list newest first with its lock state", async () => {
    h.view.start();
    await vi.waitFor(() => expect(h.elements.roomList.querySelectorAll(".match-room")).toHaveLength(2));

    const rows = [...h.elements.roomList.querySelectorAll<HTMLElement>(".match-room")];
    expect(rows[0]?.dataset.room).toBe("chess-b2");
    expect(rows[0]?.dataset.locked).toBe("true");
    expect(rows[1]?.dataset.room).toBe("caro-a1");
    expect(h.elements.status.textContent).toContain("2 room");
  });

  it("joins an open room when its row is clicked", async () => {
    h.view.start();
    await vi.waitFor(() => expect(h.elements.roomList.querySelectorAll(".match-room")).toHaveLength(2));

    h.elements.roomList.querySelector<HTMLElement>('[data-room="caro-a1"]')?.click();
    expect(h.elements.joinCode.value).toBe("caro-a1");
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.options[0]?.url).toContain("r=caro-a1");
  });

  it("asks for the password instead of joining a locked room", async () => {
    h.view.start();
    await vi.waitFor(() => expect(h.elements.roomList.querySelectorAll(".match-room")).toHaveLength(2));

    h.elements.roomList.querySelector<HTMLElement>('[data-room="chess-b2"]')?.click();
    expect(h.elements.joinCode.value).toBe("chess-b2");
    expect(h.start).not.toHaveBeenCalled();
    expect(h.elements.status.textContent).toContain("locked");
  });

  it("creates a room with a code and password, then connects", async () => {
    h.view.start();
    h.elements.createCode.value = "caro-test";
    h.elements.createPass.value = "1234";

    await h.view.createAndJoin();

    expect(h.fetchImpl).toHaveBeenCalledWith(
      "https://api.example/api/rooms",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: "caro-test", pass: "1234" }) }),
    );
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.options[0]?.url).toContain("r=caro-test");
    expect(h.options[0]).toMatchObject({ game: "caro", nick: "An", pass: "1234" });
    expect(h.elements.joinCode.value).toBe("caro-test");
    expect(h.view.isConnected).toBe(true);
  });

  it("generates a code when the create box is empty", async () => {
    h.view.start();
    await h.view.createAndJoin();
    expect(h.elements.joinCode.value.startsWith("caro-")).toBe(true);
    expect(h.options[0]?.url).toContain(`r=${h.elements.joinCode.value}`);
  });

  it("joins by code and password without creating a room", () => {
    h.view.start();
    h.elements.joinCode.value = "friend-room";
    h.elements.joinPass.value = "secret";
    h.view.join();

    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.options[0]).toMatchObject({ url: expect.stringContaining("r=friend-room"), pass: "secret" });
  });

  it("refuses an invalid room code", () => {
    h.view.start();
    h.elements.joinCode.value = "NO WAY!";
    h.view.join();

    expect(h.start).not.toHaveBeenCalled();
    expect(h.elements.status.textContent).toContain("code");
  });

  it("opens the game stage when the match starts", async () => {
    h.view.start();
    h.elements.joinCode.value = "caro-test";
    h.view.join();

    const fakeBridge = bridge();
    h.options[0]?.onStart?.(fakeBridge);
    expect(h.onMatch).toHaveBeenCalledWith(expect.objectContaining({ id: "caro" }), fakeBridge);
    expect(h.elements.roster.textContent).toContain("you are host");
  });

  it("refreshes the room list from the refresh button", async () => {
    h.view.start();
    await vi.waitFor(() => expect(h.elements.roomList.querySelectorAll(".match-room")).toHaveLength(2));

    h.rooms.push({ slug: "caro-new", locked: false, lastSeen: 1_700_000_200_000 });
    h.elements.refreshButton.click();
    await vi.waitFor(() => expect(h.elements.roomList.querySelectorAll(".match-room")).toHaveLength(3));
  });

  it("leaves the match on demand", async () => {
    h.view.start();
    h.elements.joinCode.value = "caro-test";
    h.view.join();
    h.view.leave();

    expect(h.leave).toHaveBeenCalledTimes(1);
    expect(h.view.isConnected).toBe(false);
    expect(h.elements.status.textContent).toContain("left the match");
  });
});
