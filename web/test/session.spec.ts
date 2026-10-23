// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OnlineGameSession } from "../src/game/session";
import { serializeTttMessage, type BoardState, type GameScore, type PlayerMark } from "../src/game/tictactoe";

describe("OnlineGameSession", () => {
  it("initializes and handles incoming messages correctly", () => {
    const received = {
      move: null as { cell: number; player: PlayerMark } | null,
      reset: null as PlayerMark | null,
      join: null as { nick: string; role: PlayerMark } | null,
      sync: null as { board: BoardState; turn: PlayerMark; scores: GameScore } | null,
    };
    const statusLog: string[] = [];
    let isConnected = false;

    const session = new OnlineGameSession({
      roomCode: "TEST",
      asHost: true,
      wsUrl: "wss://fake/ws",
      apiBase: "https://fake",
      identity: { nick: "HostPlayer", color: "hsl(0 0% 50%)" },
      onConnectedChange: (c) => {
        isConnected = c;
      },
      onStatusText: (t) => {
        statusLog.push(t);
      },
      onPeerJoin: (nick, role) => {
        received.join = { nick, role };
      },
      onRemoteMove: (cell, player) => {
        received.move = { cell, player };
      },
      onRemoteReset: (starter) => {
        received.reset = starter;
      },
      onRemoteSync: (board, turn, scores) => {
        received.sync = { board, turn, scores };
      },
    });

    // Simulate incoming messages via private handleMessage
    const anySession = session as unknown as { handleMessage: (msg: unknown) => void };

    anySession.handleMessage({ type: "join", nick: "GuestPlayer", role: "O" });
    expect(received.join).toEqual({ nick: "GuestPlayer", role: "O" });

    anySession.handleMessage({ type: "move", cell: 4, player: "O" });
    expect(received.move).toEqual({ cell: 4, player: "O" });

    anySession.handleMessage({ type: "reset", starter: "X" });
    expect(received.reset).toBe("X");

    const fakeBoard: BoardState = ["X", "O", null, null, null, null, null, null, null];
    anySession.handleMessage({ type: "sync", board: fakeBoard, turn: "X", scores: { x: 1, o: 0, draws: 0 } });
    expect(received.sync?.board).toEqual(fakeBoard);
    expect(received.sync?.scores.x).toBe(1);

    session.close();
    expect(isConnected).toBe(false);
  });
});
