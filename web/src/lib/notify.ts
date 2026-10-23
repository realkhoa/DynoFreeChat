/**
 * New-message notifications.
 *
 * Deliberate product rule: a notification says *that* there is new activity and
 * *where*, never what was said. No message text, no nickname — the same reason
 * chat apps hide content on the lock screen.
 */
export interface NotifierDeps {
  /** True when the tab is in the background. */
  isHidden: () => boolean;
  /** Delivers one notification. Receives only a room label and a count. */
  show: (title: string, body: string, tag: string) => void;
  now?: () => number;
  minIntervalMs?: number;
}

export class Notifier {
  private count = 0;
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private enabled = true;

  constructor(private readonly deps: NotifierDeps) {}

  get unread(): number {
    return this.count;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Someone else posted in `room`. The message text is never passed in. */
  incoming(room: string): void {
    this.count += 1;
    if (!this.enabled) return;
    if (!this.deps.isHidden()) return;

    const now = this.deps.now?.() ?? Date.now();
    const interval = this.deps.minIntervalMs ?? 5_000;
    if (now - this.lastShownAt < interval) return;

    this.lastShownAt = now;
    this.deps.show(`#${room}`, `${this.count} tin nhắn mới`, `room:${room}`);
  }

  /** Called when the tab becomes visible again. Returns the count it cleared. */
  reset(): number {
    const previous = this.count;
    this.count = 0;
    return previous;
  }
}
