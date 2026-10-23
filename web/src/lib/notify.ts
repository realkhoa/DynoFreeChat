/**
 * New-message notifications.
 *
 * Deliberate product rule: a notification says *that* there is new activity and
 * *where*, never what was said. No message text, no nickname — the same reason
 * chat apps hide content on the lock screen.
 */
export interface NotifierDeps {
  /** True when the tab is not being looked at (hidden or unfocused). */
  isHidden: () => boolean;
  /** Delivers one OS notification. Receives only a room label and a count. */
  show: (title: string, body: string, tag: string) => void;
  now?: () => number;
  minIntervalMs?: number;
}

export interface NotificationEntry {
  room: string;
  count: number;
  /** How many of those messages mention the reader. */
  mentions: number;
  /** Timestamp of the newest message in this room. */
  at: number;
}

export class Notifier {
  private readonly rooms = new Map<string, NotificationEntry>();
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private unreadTotal = 0;
  private enabled = true;

  constructor(private readonly deps: NotifierDeps) {}

  get unread(): number {
    return this.unreadTotal;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Newest first. */
  entries(): NotificationEntry[] {
    return Array.from(this.rooms.values()).sort((left, right) => right.at - left.at);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Someone else posted in `room`. The message text is never passed in, so it
   * cannot leak into a notification by accident.
   */
  incoming(room: string, options: { mention?: boolean } = {}): void {
    if (!this.deps.isHidden()) return;

    const mention = options.mention === true;
    const now = this.deps.now?.() ?? Date.now();
    const entry = this.rooms.get(room);
    if (entry === undefined) {
      this.rooms.set(room, { room, count: 1, mentions: mention ? 1 : 0, at: now });
    } else {
      entry.count += 1;
      if (mention) entry.mentions += 1;
      entry.at = now;
    }
    this.unreadTotal += 1;

    if (!this.enabled) return;

    const interval = this.deps.minIntervalMs ?? 5_000;
    if (now - this.lastShownAt < interval) return;
    this.lastShownAt = now;
    const body = mention ? `${this.unreadTotal} tin nhắn mới · có nhắc bạn` : `${this.unreadTotal} tin nhắn mới`;
    this.deps.show(`#${room}`, body, `room:${room}`);
  }

  /** Marks one room read — call when the user opens it. */
  resetRoom(room: string): void {
    const entry = this.rooms.get(room);
    if (entry === undefined) return;
    this.unreadTotal = Math.max(0, this.unreadTotal - entry.count);
    this.rooms.delete(room);
  }

  /** Marks everything read and returns how many were cleared. */
  reset(): number {
    const previous = this.unreadTotal;
    this.rooms.clear();
    this.unreadTotal = 0;
    return previous;
  }
}
