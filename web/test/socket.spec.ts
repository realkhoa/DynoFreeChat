import { describe, expect, it } from "vitest";
import type { ServerFrame } from "@dyno/shared/protocol";
import { ChatSocket, type SocketState } from "../src/net/socket";

type Listener = (event: unknown) => void;

class FakeSocket {
  static latest: FakeSocket | null = null;

  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.latest = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(frame: ServerFrame): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

interface Harness {
  socket: ChatSocket;
  fakes: FakeSocket[];
  timers: Array<{ run: () => void; ms: number }>;
  states: SocketState[];
}

function harness(): Harness {
  const fakes: FakeSocket[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const states: SocketState[] = [];

  const socket = new ChatSocket({
    url: "ws://test.local/ws",
    factory: (url) => {
      const fake = new FakeSocket(url);
      fakes.push(fake);
      return fake as unknown as WebSocket;
    },
    rand: () => 0.5,
    setTimeoutImpl: (handler, ms) => {
      timers.push({ run: handler, ms });
      return timers.length;
    },
    clearTimeoutImpl: () => {},
  });

  socket.onState((state) => states.push(state));
  return { socket, fakes, timers, states };
}

describe("ChatSocket", () => {
  it("opens a socket and reports connecting then open", () => {
    const { socket, fakes, states } = harness();
    socket.connect();

    expect(fakes).toHaveLength(1);
    expect(socket.state).toBe("connecting");

    fakes[0]!.open();
    expect(socket.state).toBe("open");
    expect(states).toEqual(["connecting", "open"]);
  });

  it("only sends while open", () => {
    const { socket, fakes } = harness();
    socket.connect();

    expect(socket.send({ t: "msg", cid: "1", text: "hi" })).toBe(false);

    fakes[0]!.open();
    expect(socket.send({ t: "msg", cid: "1", text: "hi" })).toBe(true);
    expect(JSON.parse(fakes[0]!.sent[0]!)).toEqual({ t: "msg", cid: "1", text: "hi" });
  });

  it("reconnects with backoff after an abnormal close", () => {
    const { socket, fakes, timers } = harness();
    socket.connect();
    fakes[0]!.open();

    fakes[0]!.serverClose(1006, "network down");
    expect(socket.state).toBe("reconnecting");
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(1000);

    timers[0]!.run();
    expect(fakes).toHaveLength(2);
  });

  it("grows the delay while attempts keep failing", () => {
    const { socket, fakes, timers } = harness();
    socket.connect();

    fakes[0]!.serverClose(1006);
    timers[0]!.run();
    fakes[1]!.serverClose(1006);
    timers[1]!.run();
    fakes[2]!.serverClose(1006);

    expect(timers.map((timer) => timer.ms)).toEqual([1000, 2000, 4000]);
  });

  it("resets the delay once the server acknowledges the session", () => {
    const { socket, fakes, timers } = harness();
    socket.connect();
    fakes[0]!.serverClose(1006);
    timers[0]!.run();
    fakes[1]!.open();
    socket.acknowledge();

    fakes[1]!.serverClose(1006);
    expect(timers[1]!.ms).toBe(1000);
  });

  it("does not retry after a fatal close code", () => {
    const { socket, fakes, timers } = harness();
    socket.connect();

    fakes[0]!.serverClose(4403, "BAD_PASS");
    expect(socket.state).toBe("closed");
    expect(timers).toHaveLength(0);
  });

  it("delivers parsed frames to handlers", () => {
    const { socket, fakes } = harness();
    const received: ServerFrame[] = [];
    socket.onFrame((frame) => received.push(frame));
    socket.connect();
    fakes[0]!.receive({ t: "presence", online: 3 });

    expect(received).toEqual([{ t: "presence", online: 3 }]);
  });

  it("ignores unparseable frames", () => {
    const { socket, fakes } = harness();
    const received: ServerFrame[] = [];
    socket.onFrame((frame) => received.push(frame));
    socket.connect();
    fakes[0]!.serverClose.toString(); // keep the fake warm
    (fakes[0] as unknown as { emit: (type: string, event: unknown) => void }).emit("message", { data: "<<<" });

    expect(received).toHaveLength(0);
  });

  it("stops retrying after a manual close", () => {
    const { socket, fakes, timers } = harness();
    socket.connect();
    fakes[0]!.open();

    socket.close("bye");
    expect(socket.state).toBe("closed");
    expect(timers).toHaveLength(0);
  });

  it("reports closed exactly once when the manual close event lands later", () => {
    const { socket, fakes, states } = harness();
    socket.connect();
    fakes[0]!.open();

    socket.close("auth failed");
    const afterClose = states.length;

    // The browser delivers the close event asynchronously.
    (fakes[0] as unknown as { emit: (type: string, event: unknown) => void }).emit("close", {
      code: 1000,
      reason: "",
    });

    expect(states).toHaveLength(afterClose);
    expect(states.at(-1)).toBe("closed");
  });
});
