/**
 * Messages typed while the socket is down are queued, not dropped: they are
 * flushed in order as soon as the room has welcomed us again.
 */
export interface QueuedMessage {
  cid: string;
  text: string;
  /** Id of the message this one answers, if any. */
  replyTo?: string;
}

export class Outbox {
  private items: QueuedMessage[] = [];

  get size(): number {
    return this.items.length;
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  queue(message: QueuedMessage): void {
    this.items.push(message);
  }

  /** Returns everything queued and empties the box. */
  take(): QueuedMessage[] {
    const items = this.items;
    this.items = [];
    return items;
  }

  clear(): void {
    this.items = [];
  }
}
