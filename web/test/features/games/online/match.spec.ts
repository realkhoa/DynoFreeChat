// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { OnlineBridge } from "@/features/games/online/bridge";
import { OnlineMatch } from "@/features/games/online/match";
import { MATCH_PROTOCOL_VERSION, encodeMessage } from "@/features/games/online/protocol";
import { FakeSocket } from "../../../helpers/fake-socket";

/** Builds one match wired to a captured fake socket. */
function makeMatch(
  sessionId: string,
  overrides: Partial<ConstructorParameters<typeof OnlineMatch>[0]> = {},
): {
  match: OnlineMatch;
  socket: FakeSocket;
  started: OnlineBridge[];
  errors: string[];
  statuses: string[];
} {
  let socket: FakeSocket | null = null;
  const started: OnlineBridge[] = [];
  const errors: string[] = [];
  const statuses: string[] = [];

  const match = new OnlineMatch({
    url: "wss://example.com/ws?r=caro-test",
    nick: "An",
    color: "hsl(200 60% 60%)",
    game: "caro",
    sessionId,
    random: () => 0.5,
    socketFactory: (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    },
    onStart: (bridge) => started.push(bridge),
    onError: (text) => errors.push(text),
    onStatus: (text) => statuses.push(text),
    ...overrides,
  });

  return {
    match,
    get socket() {
      return socket as unknown as FakeSocket;
    },
    started,
    errors,
    statuses,
  };
}

/** Builds a peer frame carrying one protocol message. */
function gameFrame(message: unknown, nick = "Bob"): unknown {
  return { t: "game", data: encodeMessage(message as never), nick };
}

/** One welcome frame. */
const WELCOME = {
  t: "welcome",
  you: { nick: "An", color: "x" },
  room: { slug: "caro-test", locked: false },
  history: [],
};

describe("OnlineMatch", () => {
  it("joins, says hello and hosts when its session id sorts first", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();

    expect(h.socket.framesOfType("join")).toHaveLength(1);
    h.socket.receive(WELCOME);
    expect(h.socket.gamePayloads()[0]).toMatchObject({ k: "hello", id: "aaa", game: "caro", nick: "An" });

    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "caro", nick: "Bob" }),
    );

    const start = h.socket.gamePayloads().find((message) => message.k === "start");
    expect(start).toMatchObject({ k: "start", seed: 500_000_000, game: "caro" });
    expect(h.started).toHaveLength(1);
    expect(h.started[0]).toMatchObject({ role: "host", seat: 1, seed: 500_000_000, peerNick: "Bob" });
    expect(h.match.currentPhase).toBe("playing");
  });

  it("waits as guest and starts on the host's start message", () => {
    const h = makeMatch("zzz");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "aaa", game: "caro", nick: "Bob" }),
    );

    expect(h.socket.gamePayloads().some((message) => message.k === "start")).toBe(false);
    expect(h.started).toHaveLength(0);

    h.socket.receive(gameFrame({ k: "start", v: MATCH_PROTOCOL_VERSION, seed: 777, game: "caro" }));
    expect(h.started).toHaveLength(1);
    expect(h.started[0]).toMatchObject({ role: "guest", seat: 2, seed: 777, peerNick: "Bob" });
  });

  it("relays local moves and delivers remote moves in sequence order", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "caro", nick: "Bob" }),
    );

    const bridge = h.started[0]!;
    const received: unknown[] = [];
    bridge.onMove((payload) => received.push(payload));

    bridge.sendMove({ index: 5 });
    bridge.sendMove({ index: 6 });
    const moves = h.socket.gamePayloads().filter((message) => message.k === "move");
    expect(moves).toEqual([
      { k: "move", seq: 1, payload: { index: 5 } },
      { k: "move", seq: 2, payload: { index: 6 } },
    ]);

    h.socket.receive(gameFrame({ k: "move", seq: 1, payload: { index: 9 } }));
    h.socket.receive(gameFrame({ k: "move", seq: 1, payload: { index: 9 } }));
    h.socket.receive(gameFrame({ k: "move", seq: 2, payload: { index: 10 } }));
    expect(received).toEqual([{ index: 9 }, { index: 10 }]);
  });

  it("reports the peer leaving through the bridge", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "caro", nick: "Bob" }),
    );

    const bridge = h.started[0]!;
    const left = vi.fn();
    bridge.onPeerLeft(left);
    h.socket.receive(gameFrame({ k: "bye" }));

    expect(left).toHaveBeenCalledTimes(1);
    expect(h.match.currentPhase).toBe("peer-left");
  });

  it("treats a presence drop as the peer leaving", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "caro", nick: "Bob" }),
    );

    const left = vi.fn();
    h.started[0]!.onPeerLeft(left);
    h.socket.receive({ t: "presence", online: 1 });
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("re-announces itself when the peer joined after its hello was dropped", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);

    const before = h.socket.gamePayloads().filter((message) => message.k === "hello").length;
    // The peer's socket is now in the room, but our first hello was relayed to
    // nobody; presence is the moment both sides must re-announce.
    h.socket.receive({ t: "presence", online: 2 });

    const after = h.socket.gamePayloads().filter((message) => message.k === "hello").length;
    expect(after).toBe(before + 1);
  });
  it("refuses an opponent who picked another game", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "chess", nick: "Bob" }),
    );

    expect(h.errors.join(" ")).toContain("chess");
    expect(h.started).toHaveLength(0);
  });

  it("maps transport errors to readable text", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive({ t: "error", code: "BAD_PASS" });
    expect(h.errors.join(" ")).toContain("password");
  });

  it("leaves the room and reports the closed phase", () => {
    const h = makeMatch("aaa");
    h.match.start();
    h.socket.open();
    h.socket.receive(WELCOME);
    h.socket.receive(
      gameFrame({ k: "hello", v: MATCH_PROTOCOL_VERSION, id: "zzz", game: "caro", nick: "Bob" }),
    );

    h.match.leave();
    expect(h.socket.gamePayloads().some((message) => message.k === "bye")).toBe(true);
    expect(h.match.currentPhase).toBe("closed");
  });
});
