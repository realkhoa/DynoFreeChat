import { clampNick, formatTime, mutedColor } from "../lib/format";
import type { Row, Store } from "../model/store";

interface Entry {
  el: HTMLElement;
  revision: number;
}

/**
 * Renders `Store.rows` as log lines. Appends only what is new and re-renders a
 * line only when its revision changed, so a busy room stays cheap.
 */
export class LogView {
  private readonly entries = new Map<Row, Entry>();
  private query = "";
  private atBottom = true;

  selfNick = "";
  /** When true, new rows scroll into view automatically. */
  follow = true;
  onFollowChange?: (following: boolean) => void;

  constructor(private readonly root: HTMLElement) {
    this.root.addEventListener(
      "scroll",
      () => {
        const bottom = this.isAtBottom();
        if (bottom === this.atBottom) return;
        this.atBottom = bottom;
        if (bottom && !this.follow) {
          this.follow = true;
          this.onFollowChange?.(true);
        } else if (!bottom && this.follow) {
          this.follow = false;
          this.onFollowChange?.(false);
        }
      },
      { passive: true },
    );
  }

  sync(store: Store): void {
    this.query = store.filter;
    const added: HTMLElement[] = [];

    for (const row of store.rows) {
      const visible = store.matches(row);
      const existing = this.entries.get(row);

      if (existing === undefined) {
        const el = this.render(row, visible);
        this.entries.set(row, { el, revision: row.revision });
        added.push(el);
        continue;
      }

      if (existing.revision !== row.revision) {
        const next = this.render(row, visible);
        existing.el.replaceWith(next);
        existing.el = next;
        existing.revision = row.revision;
        continue;
      }

      if (existing.el.hidden !== !visible) existing.el.hidden = !visible;
    }

    if (added.length > 0) this.root.append(...added);
    if (this.follow && added.length > 0) this.scrollToBottom();
  }

  isAtBottom(): boolean {
    return this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 8;
  }

  scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight;
    this.atBottom = true;
  }

  clearLocal(): void {
    this.entries.clear();
    this.root.replaceChildren();
    this.atBottom = true;
  }

  /** Number of rows currently visible, for the status bar. */
  get visibleCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (!entry.el.hidden) count += 1;
    return count;
  }

  private render(row: Row, visible: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "log-row";
    el.dataset.id = row.id;
    el.dataset.kind = row.kind;
    el.hidden = !visible;

    if (row.kind === "system") el.classList.add("is-system");
    if (row.kind === "error") el.classList.add("is-error");
    if (row.state === "pending") el.classList.add("is-pending");
    if (row.state === "failed") el.classList.add("is-failed");
    if (row.kind === "chat" && row.nick === this.selfNick) el.classList.add("is-self");

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatTime(row.ts);

    const nick = document.createElement("span");
    nick.className = "log-nick";
    nick.textContent = clampNick(row.nick);
    nick.title = row.nick;
    if (row.kind === "chat") {
      nick.style.color = row.nick === this.selfNick ? "var(--accent)" : mutedColor(row.color);
    }

    const mark = document.createElement("span");
    mark.className = "log-mark";
    mark.textContent =
      row.kind === "chat" ? (row.state === "pending" ? "▍" : row.state === "failed" ? "✕" : "›") : "·";

    const text = document.createElement("span");
    text.className = "log-text";
    this.fillText(text, row.text);

    el.append(time, nick, mark, text);
    return el;
  }

  /** Writes text as text nodes, wrapping filter hits in <mark>. No innerHTML. */
  private fillText(target: HTMLElement, text: string): void {
    if (this.query.length === 0) {
      target.textContent = text;
      return;
    }

    const haystack = text.toLowerCase();
    let cursor = 0;
    for (;;) {
      const at = haystack.indexOf(this.query, cursor);
      if (at === -1) {
        if (cursor < text.length) target.append(text.slice(cursor));
        return;
      }
      if (at > cursor) target.append(text.slice(cursor, at));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + this.query.length);
      target.append(mark);
      cursor = at + this.query.length;
    }
  }
}
