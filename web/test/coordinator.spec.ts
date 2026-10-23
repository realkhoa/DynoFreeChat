// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameCoordinator } from "../src/game/coordinator";
import { FakeSocket } from "./fake-socket";
import type { GameMessage } from "../src/game/protocol";
import type { BoardState, GameMode, GameOutcome, GameScore, PlayerMark } from "../src/game/tictactoe";

interface Recorder {
  board: BoardState | null;
  turn: PlayerMark | null;
  role: PlayerMark | null;
  outcome: GameOutcome;
  scores: GameScore;
  mode: GameMode;
  canPlay: boolean;
  status: string;
}

function makeCoordinator(clientId = "client-1"): { coordinator: GameCoordinator; socket: FakeSocket; state: Recorder } {
  const socket = new FakeSocket("wss://fake/ws");
  const state: Recorder = {
    board: null,
    turn: null,
    role: null,
    outcome: { winner: null },
    scores: { x: 0, o: 0, draws: 0 },
    mode: "local",
    canPlay: true,
    status: "",
  };

  const coordinator = new GameCoordinator({
    wsUrl: "wss://fake/ws",
    apiBase: "https://fake",
    clientId,
    socketFactory: () => socket as unknown as WebSocket,
    getIdentity: () => ({ nick: "khoan", color: "hsl(0 0% 50%)" }),
    createRoomImpl: async () => ({ ok: true }),
    callbacks: {
      onUpdate: (board, turn, role, outcome, scores, mode, canPlay) => {
        state.board = [...board] as BoardState;
        state.turn = turn;
        state.role = role;
        state.outcome = outcome;
        state.scores = { ...scores };
        state.mode = mode;
        state.canPlay = canPlay;
      },
      onStatus: (text) => {
        state.status = text;
      },
      onRoomBadge: () => {},
    },
  });

  return { coordinator, socket, state };
}

const welcome = (online: number): unknown => ({
  t: "welcome",
  you: { nick: "khoan", color: "hsl(0 0% 50%)" },
  room: { slug: "ttt-abcd", locked: false },
  history: [],
  online,
  serverTs: 1,
});

/** Simulates one payload arriving from the peer. */
function relay(socket: FakeSocket, message: GameMessage): void {
  socket.receive({ t: "game", data: JSON.stringify(message), nick: "peer" });
}

/** Payloads the coordinator sent on the game channel, newest last. */
function sent(socket: FakeSocket): GameMessage[] {
  return socket.gamePayloads<GameMessage>();
}

/** Brings an online game to the point where the peer is present and the roles are settled. */
async function onlineRoom(
  asHost: boolean,
  clientId = "client-1",
  peerRole: PlayerMark = asHost ? "O" : "X",
): Promise<{ coordinator: GameCoordinator; socket: FakeSocket; state: Recorder }> {
  const harness = makeCoordinator(clientId);
  await harness.coordinator.startOnlineGame("ABCD", asHost);
  harness.socket.open();
  harness.socket.receive(welcome(2));
  relay(harness.socket, { k: "hello", clientId: `peer-${asHost ? "o" : "x"}`, role: peerRole, nick: "bob" });
  return harness;
}

describe("GameCoordinator local and AI", () => {
  it("alternates turn and applies local moves", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startLocalGame();
    expect(state.turn).toBe("X");
    expect(state.status).toBe("Lượt người chơi X");

    coordinator.handleCellClick(0);
    expect(state.board?.[0]).toBe("X");
    expect(state.turn).toBe("O");

    coordinator.handleCellClick(4);
    expect(state.board?.[4]).toBe("O");
    expect(state.turn).toBe("X");
  });

  it("ignores a click on an occupied cell", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startLocalGame();
    coordinator.handleCellClick(0);
    coordinator.handleCellClick(0);
    expect(state.board?.filter((cell) => cell !== null)).toHaveLength(1);
  });

  it("ignores an out-of-range cell", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startLocalGame();
    coordinator.handleCellClick(99);
    expect(state.board?.every((cell) => cell === null)).toBe(true);
  });

  it("alternates the starter on rematch instead of repeating it", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startLocalGame();
    expect(state.turn).toBe("X");

    coordinator.rematch();
    expect(state.turn).toBe("O");

    coordinator.rematch();
    expect(state.turn).toBe("X");
  });
});

describe("GameCoordinator AI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a second human mark while the AI is thinking", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startAiGame();

    coordinator.handleCellClick(0);
    expect(state.board?.[0]).toBe("X");
    expect(state.turn).toBe("O");

    coordinator.handleCellClick(1);
    expect(state.board?.[1]).toBeNull();

    vi.advanceTimersByTime(200);
    expect(state.board?.filter((cell) => cell === "O")).toHaveLength(1);
  });

  it("never lands a stale AI move on a board that was reset", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startAiGame();
    coordinator.handleCellClick(0);
    expect(state.board?.[0]).toBe("X");

    // Reset while the reply is still pending. The rematch alternates the starter,
    // so O (the AI) legitimately opens the new round — but the old X must be gone
    // and no second, stale move may land.
    coordinator.rematch();
    vi.advanceTimersByTime(500);

    expect(state.board?.[0]).toBeNull();
    expect(state.board?.filter((cell) => cell !== null).length).toBeLessThanOrEqual(1);
    expect(state.scores).toEqual({ x: 0, o: 0, draws: 0 });
  });

  it("counts a win exactly once", () => {
    const { coordinator, state } = makeCoordinator();
    coordinator.startLocalGame();

    // X: 0, 1, 2. O: 3, 4.
    coordinator.handleCellClick(0);
    coordinator.handleCellClick(3);
    coordinator.handleCellClick(1);
    coordinator.handleCellClick(4);
    coordinator.handleCellClick(2);

    expect(state.outcome.winner).toBe("X");
    expect(state.scores.x).toBe(1);
    expect(state.canPlay).toBe(true);

    coordinator.handleCellClick(5);
    expect(state.scores.x).toBe(1);
    expect(state.board?.[5]).toBeNull();
  });
});

describe("GameCoordinator online", () => {
  it("locks the board until an opponent is present", async () => {
    const { coordinator, socket, state } = makeCoordinator();
    await coordinator.startOnlineGame("ABCD", true);

    expect(state.canPlay).toBe(false);
    expect(state.role).toBe("X");

    socket.open();
    socket.receive(welcome(1));
    expect(state.canPlay).toBe(false);

    socket.receive({ t: "presence", online: 2 });
    expect(state.canPlay).toBe(true);
  });

  it("sends the authoritative state when the peer says hello", async () => {
    const { socket } = await onlineRoom(true);

    const stateMessages = sent(socket).filter((message) => message.k === "state");
    expect(stateMessages).toHaveLength(1);
    expect(stateMessages[0]).toMatchObject({
      k: "state",
      turn: "X",
      starter: "X",
      seq: 0,
      scores: { x: 0, o: 0, draws: 0 },
    });
  });

  it("applies a valid peer move and echoes nothing back", async () => {
    const { coordinator, socket, state } = await onlineRoom(true);

    // X starts, so the host opens; the peer's answer arrives as seq 2.
    coordinator.handleCellClick(4);
    expect(state.board?.[4]).toBe("X");

    relay(socket, { k: "move", cell: 7, player: "O", seq: 2 });
    expect(state.board?.[7]).toBe("O");
    expect(state.turn).toBe("X");

    // The worker already excludes the sender; the client must not re-broadcast.
    expect(sent(socket).filter((message) => message.k === "move")).toEqual([
      { k: "move", cell: 4, player: "X", seq: 1 },
    ]);
  });

  it("rejects a peer move that is out of turn and resyncs", async () => {
    const { socket, state } = await onlineRoom(true);

    relay(socket, { k: "move", cell: 0, player: "O", seq: 1 });
    expect(state.board?.[0]).toBeNull();

    const states = sent(socket).filter((message) => message.k === "state");
    expect(states).toHaveLength(2);
  });

  it("rejects a duplicate move and asks for a resync on a gap", async () => {
    const joiner = await onlineRoom(false);
    expect(joiner.state.role).toBe("O");

    relay(joiner.socket, { k: "move", cell: 0, player: "X", seq: 1 });
    expect(joiner.state.board?.[0]).toBe("X");

    relay(joiner.socket, { k: "move", cell: 0, player: "X", seq: 1 });
    expect(joiner.state.board?.filter((cell) => cell !== null)).toHaveLength(1);

    relay(joiner.socket, { k: "move", cell: 5, player: "X", seq: 7 });
    expect(joiner.state.board?.[5]).toBeNull();
    expect(sent(joiner.socket).filter((message) => message.k === "resync")).toHaveLength(1);
  });

  it("adopts the host state as the joining player", async () => {
    const { socket, state } = await onlineRoom(false);

    expect(sent(socket).filter((message) => message.k === "state")).toHaveLength(0);

    relay(socket, {
      k: "state",
      board: ["X", null, null, null, "O", null, null, null, null],
      turn: "X",
      scores: { x: 2, o: 1, draws: 3 },
      starter: "X",
      seq: 2,
    });

    expect(state.board?.[0]).toBe("X");
    expect(state.board?.[4]).toBe("O");
    expect(state.scores).toEqual({ x: 2, o: 1, draws: 3 });
    expect(state.turn).toBe("X");
  });

  it("lets only the player on turn move", async () => {
    const { coordinator, socket, state } = await onlineRoom(false);

    // Joiner is O and X starts, so the board must ignore the click.
    coordinator.handleCellClick(0);
    expect(state.board?.[0]).toBeNull();

    relay(socket, { k: "move", cell: 4, player: "X", seq: 1 });
    expect(state.board?.[4]).toBe("X");
    expect(state.turn).toBe("O");

    coordinator.handleCellClick(0);
    expect(state.board?.[0]).toBe("O");
  });

  it("settles a role collision deterministically", async () => {
    // Both players joined as O: the smaller client id keeps X, so exactly one
    // side flips and the two roles end up distinct.
    const small = makeCoordinator("aaa");
    await small.coordinator.startOnlineGame("ABCD", false);
    small.socket.open();
    small.socket.receive(welcome(2));
    relay(small.socket, { k: "hello", clientId: "zzz", role: "O", nick: "bob" });
    expect(small.state.role).toBe("X");

    const large = makeCoordinator("zzz");
    await large.coordinator.startOnlineGame("ABCD", false);
    large.socket.open();
    large.socket.receive(welcome(2));
    relay(large.socket, { k: "hello", clientId: "aaa", role: "O", nick: "alice" });
    expect(large.state.role).toBe("O");
  });

  it("resets both sides on a rematch and alternates the starter", async () => {
    const { coordinator, socket, state } = await onlineRoom(true);

    coordinator.handleCellClick(4);
    relay(socket, { k: "move", cell: 0, player: "O", seq: 2 });
    expect(state.board?.filter((cell) => cell !== null)).toHaveLength(2);

    coordinator.rematch();
    expect(state.board?.every((cell) => cell === null)).toBe(true);
    expect(sent(socket).filter((message) => message.k === "rematch")).toEqual([
      { k: "rematch", starter: "O" },
    ]);
    expect(state.turn).toBe("O");

    relay(socket, { k: "rematch", starter: "O" });
    expect(state.turn).toBe("O");
  });

  it("stops accepting moves once the round is decided", async () => {
    const { coordinator, socket, state } = await onlineRoom(true);

    coordinator.handleCellClick(0);
    relay(socket, { k: "move", cell: 3, player: "O", seq: 2 });
    coordinator.handleCellClick(1);
    relay(socket, { k: "move", cell: 4, player: "O", seq: 4 });
    coordinator.handleCellClick(2);

    expect(state.outcome.winner).toBe("X");

    relay(socket, { k: "move", cell: 5, player: "O", seq: 6 });
    expect(state.board?.[5]).toBeNull();
    expect(state.scores.x).toBe(1);
  });
});
