// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OnlineGameSession } from "../src/game/session";
import { FakeSocket } from "./fake-socket";
import type { GameSnapshot, HelloMessage, MoveMessage } from "../src/game/protocol";
import type { PlayerMark } from "../src/game/tictactoe";

interface Harness {
  session: OnlineGameSession;
  socket: FakeSocket;
  url: string;
  statuses: string[];
  online: number[];
  hellos: HelloMessage[];
  states: GameSnapshot[];
  moves: MoveMessage[];
  rematches: PlayerMark[];
  resyncs: number;
  createCalls: number;
  connected: boolean[];
}

function makeSession(
  asHost = true,
  role: PlayerMark = "X",
  createResult: { ok: boolean; code?: string } = { ok: true },
): Harness {
  const socket = new FakeSocket("wss://fake/ws");
  const harness: Harness = {
    session: undefined as unknown as OnlineGameSession,
    socket,
    url: "",
    statuses: [],
    online: [],
    hellos: [],
    states: [],
    moves: [],
    rematches: [],
    resyncs: 0,
    createCalls: 0,
    connected: [],
  };

  harness.session = new OnlineGameSession({
    roomCode: "abcd",
    asHost,
    role,
    clientId: "client-1",
    wsUrl: "wss://fake/ws",
    apiBase: "https://fake",
    identity: { nick: "khoan", color: "hsl(0 0% 50%)" },
    socketFactory: (url) => {
      harness.url = url;
      return socket as unknown as WebSocket;
    },
    createRoomImpl: async () => {
      harness.createCalls += 1;
      return createResult;
    },
    onStatusText: (text) => harness.statuses.push(text),
    onConnectedChange: (value) => harness.connected.push(value),
    onPeerCount: (n) => harness.online.push(n),
    onHello: (m) => harness.hellos.push(m),
    onState: (s) => harness.states.push(s),
    onMove: (m) => harness.moves.push(m),
    onRematch: (starter) => harness.rematches.push(starter),
    onResyncRequest: () => {
      harness.resyncs += 1;
    },
  });

  return harness;
}

const welcome = (online: number): unknown => ({
  t: "welcome",
  you: { nick: "khoan", color: "hsl(0 0% 50%)" },
  room: { slug: "ttt-abcd", locked: false },
  history: [],
  online,
  serverTs: 1,
});

describe("OnlineGameSession", () => {
  it("creates the room as host and sends the game handshake once accepted", async () => {
    const h = makeSession(true, "X");
    await h.session.connect();

    expect(h.createCalls).toBe(1);
    expect(h.url).toBe("wss://fake/ws?r=ttt-abcd");

    h.socket.open();
    expect(h.socket.framesOfType("join")).toHaveLength(1);

    h.socket.receive(welcome(1));
    const [hello] = h.socket.gamePayloads<HelloMessage>();
    expect(hello).toEqual({ k: "hello", clientId: "client-1", role: "X", nick: "khoan" });
  });

  it("does not create a room when joining: a typo must not invent one", async () => {
    const h = makeSession(false, "O");
    await h.session.connect();
    expect(h.createCalls).toBe(0);
  });

  it("relays the peer count and re-handshakes on reconnect", async () => {
    const h = makeSession(true, "X");
    await h.session.connect();
    h.socket.open();
    h.socket.receive(welcome(1));
    expect(h.online).toEqual([1]);

    h.socket.receive({ t: "presence", online: 2 });
    expect(h.online).toEqual([1, 2]);

    h.socket.receive(welcome(2));
    expect(h.socket.gamePayloads()).toHaveLength(2);
    expect(h.hellos).toHaveLength(0);
  });

  it("dispatches every message kind and ignores malformed payloads", async () => {
    const h = makeSession(true, "X");
    await h.session.connect();
    h.socket.open();
    h.socket.receive(welcome(2));

    const relay = (payload: unknown): void =>
      h.socket.receive({ t: "game", data: JSON.stringify(payload), nick: "peer" });

    relay({ k: "hello", clientId: "peer-1", role: "O", nick: "bob" });
    relay({ k: "move", cell: 4, player: "X", seq: 1 });
    relay({ k: "rematch", starter: "O" });
    relay({ k: "resync" });
    relay({
      k: "state",
      board: ["X", null, null, null, null, null, null, null, null],
      turn: "O",
      scores: { x: 0, o: 0, draws: 0 },
      starter: "X",
      seq: 1,
    });

    expect(h.hellos).toEqual([{ k: "hello", clientId: "peer-1", role: "O", nick: "bob" }]);
    expect(h.moves).toEqual([{ k: "move", cell: 4, player: "X", seq: 1 }]);
    expect(h.rematches).toEqual(["O"]);
    expect(h.resyncs).toBe(1);
    expect(h.states).toHaveLength(1);

    h.socket.receive({ t: "game", data: "{rubbish", nick: "peer" });
    h.socket.receive({ t: "game", data: JSON.stringify({ k: "move", cell: 99 }), nick: "peer" });
    expect(h.moves).toHaveLength(1);
  });

  it("sends moves as game frames, never as chat messages", async () => {
    const h = makeSession(true, "X");
    await h.session.connect();
    h.socket.open();
    h.socket.receive(welcome(2));

    h.session.send({ k: "move", cell: 0, player: "X", seq: 1 });
    expect(h.socket.framesOfType("msg")).toHaveLength(0);
    expect(h.socket.gamePayloads()).toContainEqual({ k: "move", cell: 0, player: "X", seq: 1 });
  });

  it("reports a missing room instead of pretending to be connected", async () => {
    const h = makeSession(false, "O");
    await h.session.connect();
    h.socket.open();
    h.socket.receive({ t: "error", code: "ROOM_NOT_FOUND" });
    expect(h.statuses.some((text) => text.includes("Không tìm thấy phòng"))).toBe(true);
  });

  it("explains a refused room creation instead of dialling a room that cannot exist", async () => {
    const h = makeSession(true, "X", { ok: false, code: "TRY_LATER" });
    await h.session.connect();

    expect(h.createCalls).toBe(1);
    expect(h.url).toBe("");
    expect(h.statuses.some((text) => text.includes("giới hạn tạo phòng"))).toBe(true);
    expect(h.connected).toEqual([false]);
  });

  it("still connects when the code is already taken", async () => {
    const h = makeSession(true, "X", { ok: false, code: "ROOM_EXISTS" });
    await h.session.connect();

    expect(h.url).toBe("wss://fake/ws?r=ttt-abcd");
    h.socket.open();
    expect(h.connected.at(-1)).toBe(true);
  });

  it("reports the connection state and stops on close", async () => {
    const h = makeSession(true, "X");
    await h.session.connect();
    expect(h.connected.at(-1)).toBe(false);

    h.socket.open();
    expect(h.connected.at(-1)).toBe(true);

    h.session.close();
    expect(h.connected.at(-1)).toBe(false);
    expect(h.session.send({ k: "resync" })).toBe(false);
  });
});
