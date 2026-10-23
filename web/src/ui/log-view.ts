import { segmentText } from "@dyno/shared/protocol";
import { clampNick, formatTime, mutedColor } from "../lib/format";
import type { Theme } from "../lib/theme";
import type { Row, Store } from "../model/store";
import { icon } from "./icons";

interface Entry {
  el: HTMLElement;
  revision: number;
}

export interface LogViewHandlers {
  onReply?: (row: Row) => void;
  onCopy?: (row: Row) => void;
}

/**
 * @brief Renders `Store.rows` as log lines with an editor-style gutter, hover actions,
 * quoted replies and @mention pills in a modern 2-line layout.
 */
export class LogView {
  private readonly entries = new Map<Row, Entry>();
  private query = "";
  private atBottom = true;
  private nextLine = 1;
  private theme: Theme = "dark";

  selfNick = "";
  follow = true;
  onFollowChange?: (following: boolean) => void;

  /**
   * @brief Initializes the log view container and scroll listener.
   * @param root The scrollable container DOM element.
   * @param handlers Callback handlers for user actions like reply and copy.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: LogViewHandlers = {},
  ) {
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

  /**
   * @brief Rebuilds rendered entries when theme changes to recalculate nick colours.
   * @param theme The new theme ("dark" or "light").
   */
  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.entries.clear();
    this.root.replaceChildren();
    this.nextLine = 1;
    this.atBottom = true;
  }

  /**
   * @brief Synchronizes log DOM entries with the given store.
   * @param store The state store containing messages and filter state.
   */
  sync(store: Store): void {
    this.query = store.filter;
    const added: HTMLElement[] = [];

    for (const row of store.rows) {
      const visible = store.matches(row);
      const existing = this.entries.get(row);

      if (existing === undefined) {
        const el = this.render(row, visible, this.nextLine);
        this.nextLine += 1;
        this.entries.set(row, { el, revision: row.revision });
        added.push(el);
        continue;
      }

      if (existing.revision !== row.revision) {
        const line = Number(existing.el.dataset.line ?? "0");
        const next = this.render(row, visible, line);
        existing.el.replaceWith(next);
        existing.el = next;
        existing.revision = row.revision;
        continue;
      }

      // Legacy `[TTT]` rows stay hidden forever, so a plain visibility sync must
      // not resurrect them.
      const hidden = !visible || existing.el.dataset.legacy === "1";
      if (existing.el.hidden !== hidden) existing.el.hidden = hidden;
    }

    if (added.length > 0) this.root.append(...added);
    if (this.follow && added.length > 0) this.scrollToBottom();
  }

  /**
   * @brief Checks if the log viewport is scrolled to the bottom.
   * @return True if scroll offset is within 8px of the bottom.
   */
  isAtBottom(): boolean {
    return this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 8;
  }

  /**
   * @brief Scrolls the log viewport all the way to the bottom.
   */
  scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight;
    this.atBottom = true;
  }

  /**
   * @brief Clears all rendered log rows and resets line counter.
   */
  clearLocal(): void {
    this.entries.clear();
    this.root.replaceChildren();
    this.nextLine = 1;
    this.atBottom = true;
  }

  /**
   * @brief Gets the number of currently visible log rows.
   * @return Count of visible rows matching current filter.
   */
  get visibleCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (!entry.el.hidden) count += 1;
    return count;
  }

  /**
   * @brief Scrolls the line for `rowId` into view and flashes it.
   * @param rowId The unique identifier of the row to reveal.
   */
  reveal(rowId: string): void {
    const entry = Array.from(this.entries.entries()).find(([row]) => row.id === rowId);
    if (entry === undefined) return;

    const el = entry[1].el;
    el.scrollIntoView({ block: "center" });
    el.classList.add("is-flash");
    window.setTimeout(() => el.classList.remove("is-flash"), 900);
  }

  /**
   * @brief Renders a single row element with an editor-style line gutter and a 2-line layout.
   * @details Line 1 displays metadata (nickname, timestamp, and status indicator mark).
   * Line 2 displays the chat content (with optional quoted parent message for replies).
   * @param row Store row model to render.
   * @param visible Whether the row matches the current filter and should be shown.
   * @param line Gutter line number.
   * @return The constructed HTML element for the log row.
   */
  private render(row: Row, visible: boolean, line: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "log-row";

    // Game traffic used to travel as chat messages prefixed with `[TTT]`. Those
    // rows are already stored in some rooms; hide them instead of migrating data.
    const legacyGame = row.kind === "chat" && row.text.startsWith("[TTT]");
    if (legacyGame) el.dataset.legacy = "1";

    el.dataset.id = row.id;
    el.dataset.kind = row.kind;
    el.dataset.line = String(line);
    el.hidden = legacyGame || !visible;

    if (row.kind === "system") el.classList.add("is-system");
    if (row.kind === "error") el.classList.add("is-error");
    if (row.state === "pending") el.classList.add("is-pending");
    if (row.state === "failed") el.classList.add("is-failed");
    if (row.kind === "chat" && row.nick === this.selfNick) el.classList.add("is-self");
    if (row.mentionsMe) el.classList.add("is-mention");
    if (row.replyTo !== undefined) el.classList.add("has-quote");

    const gutter = document.createElement("span");
    gutter.className = "log-num";
    gutter.textContent = String(line);
    gutter.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "log-body";

    const info = document.createElement("div");
    info.className = "log-info";

    const nick = document.createElement("span");
    nick.className = "log-nick";
    nick.textContent = clampNick(row.nick);
    nick.title = row.nick;
    if (row.kind === "chat") {
      nick.style.color = row.nick === this.selfNick ? "var(--accent)" : mutedColor(row.color, this.theme);
    }

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatTime(row.ts);

    const mark = document.createElement("span");
    mark.className = "log-mark";
    mark.textContent =
      row.kind === "chat" ? (row.state === "pending" ? "▍" : row.state === "failed" ? "✕" : "›") : "·";

    info.append(nick, time, mark);
    body.append(info);

    if (row.replyTo !== undefined) {
      const quote = document.createElement("div");
      quote.className = "log-quote";

      const arrow = document.createElement("span");
      arrow.className = "log-quote-arrow";
      arrow.textContent = "↳";

      const author = document.createElement("span");
      author.className = "log-quote-nick";
      author.textContent = row.replyTo.nick;

      const excerpt = document.createElement("span");
      excerpt.className = "log-quote-text";
      excerpt.textContent = row.replyTo.text;

      quote.append(arrow, author, excerpt);
      quote.title = `${row.replyTo.nick}: ${row.replyTo.text}`;
      body.append(quote);
    }

    const text = document.createElement("div");
    text.className = "log-text";
    this.fillRich(text, row.text);
    body.append(text);

    el.append(gutter, body);

    if (row.kind === "chat" && row.state !== "pending") {
      el.append(this.renderActions(row));
    }

    return el;
  }

  /**
   * @brief Renders the hover action toolbar for replying and copying.
   * @param row The row associated with the actions.
   * @return Action container element.
   */
  private renderActions(row: Row): HTMLElement {
    const actions = document.createElement("span");
    actions.className = "log-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "log-action";
    replyButton.title = "Trả lời tin này";
    replyButton.setAttribute("aria-label", "Trả lời tin này");
    replyButton.append(icon("reply", 14));
    replyButton.addEventListener("click", () => this.handlers.onReply?.(row));

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "log-action";
    copyButton.title = "Copy nội dung";
    copyButton.setAttribute("aria-label", "Copy nội dung");
    copyButton.append(icon("copy", 14));
    copyButton.addEventListener("click", () => this.handlers.onCopy?.(row));

    actions.append(replyButton, copyButton);
    return actions;
  }

  /**
   * @brief Writes text into target with @mention pills and search filter highlights.
   * @param target The container element to receive rich text nodes.
   * @param text Raw message text.
   */
  private fillRich(target: HTMLElement, text: string): void {
    for (const segment of segmentText(text)) {
      if (segment.kind === "mention") {
        const pill = document.createElement("span");
        pill.className = "mention";
        pill.textContent = segment.value;
        pill.dataset.nick = segment.nick;
        target.append(pill);
        continue;
      }
      this.appendWithHighlight(target, segment.value);
    }
  }

  /**
   * @brief Appends text while wrapping matches of current search query in `<mark>` tags.
   * @param target The container element to receive nodes.
   * @param text Text string to process.
   */
  private appendWithHighlight(target: HTMLElement, text: string): void {
    if (this.query.length === 0) {
      target.append(text);
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
