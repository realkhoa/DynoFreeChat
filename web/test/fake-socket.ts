/**
 * @file fake-socket.ts
 * @brief Minimal WebSocket stand-in so the game session can be driven frame by frame.
 */

type Listener = (event: unknown) => void;

/**
 * @brief A scriptable WebSocket that records everything the client sent.
 */
export class FakeSocket {
  static readonly OPEN = 1;

  readyState = 0;
  /** Frames the client sent, already parsed. */
  readonly sent: unknown[] = [];

  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "closed" });
  }

  // ------------------------------------------------------------- test drivers

  /** Simulates the transport opening. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open", {});
  }

  /** Simulates one server frame. */
  receive(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  /** Frames the client sent with the given `t`. */
  framesOfType<T = unknown>(type: string): T[] {
    return this.sent.filter((frame): frame is T => {
      return typeof frame === "object" && frame !== null && (frame as { t?: string }).t === type;
    });
  }

  /** Payloads of the `game` frames the client sent, decoded. */
  gamePayloads<T = Record<string, unknown>>(): T[] {
    return this.framesOfType<{ t: string; data: string }>("game").map(
      (frame) => JSON.parse(frame.data) as T,
    );
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
