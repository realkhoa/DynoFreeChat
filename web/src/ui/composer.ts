import { MAX_TEXT, type ReplyRef } from "@dyno/shared/protocol";
import { activeMentionToken, applyMention, matchNicks, type MentionToken } from "../lib/mentions";

export interface ComposerDeps {
  root: HTMLElement;
  input: HTMLInputElement;
  meter: HTMLElement;
  menu: HTMLElement;
  /** Candidate nicknames for @ completion. */
  nicks: () => string[];
  onSend: (text: string, replyTo?: string) => void;
  onReplyChange?: (reply: ReplyRef | null) => void;
}

/**
 * The single-line prompt in the Output dock: Enter sends, `@` opens mention
 * completion, and a reply target is shown until it is sent or cancelled.
 */
export class Composer {
  private reply: ReplyRef | null = null;
  private token: MentionToken | null = null;
  private candidates: string[] = [];
  private selected = 0;

  constructor(private readonly deps: ComposerDeps) {
    const { input } = deps;

    input.addEventListener("input", () => {
      this.updateMeter();
      this.refreshMenu();
    });
    input.addEventListener("blur", () => window.setTimeout(() => this.closeMenu(), 120));
    input.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  get replyTarget(): ReplyRef | null {
    return this.reply;
  }

  setReply(reply: ReplyRef | null): void {
    this.reply = reply;
    this.deps.onReplyChange?.(reply);
    if (reply !== null) this.focus();
  }

  setEnabled(enabled: boolean): void {
    this.deps.root.dataset.disabled = String(!enabled);
    this.deps.input.disabled = !enabled;
    this.deps.input.placeholder = enabled ? "nhập tin nhắn rồi Enter…" : "chọn một room để bắt đầu…";
    if (!enabled) {
      this.closeMenu();
      this.setReply(null);
    }
  }

  focus(): void {
    if (!this.deps.input.disabled) this.deps.input.focus();
  }

  clear(): void {
    this.deps.input.value = "";
    this.updateMeter();
    this.closeMenu();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.menuOpen()) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.move(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.move(-1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        this.accept();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeMenu();
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    this.submit();
  }

  private submit(): void {
    const text = this.deps.input.value.trim();
    if (text.length === 0 || this.deps.input.disabled) return;

    this.deps.onSend(text, this.reply?.id);
    this.clear();
    this.setReply(null);
  }

  private menuOpen(): boolean {
    return !this.deps.menu.hidden && this.candidates.length > 0;
  }

  private move(delta: number): void {
    const count = this.candidates.length;
    if (count === 0) return;
    this.selected = (this.selected + delta + count) % count;
    this.paintMenu();
  }

  private refreshMenu(): void {
    const { input } = this.deps;
    const caret = input.selectionStart ?? input.value.length;
    const token = activeMentionToken(input.value, caret);

    if (token === null) {
      this.closeMenu();
      return;
    }

    const candidates = matchNicks(this.deps.nicks(), token.query);
    if (candidates.length === 0) {
      this.closeMenu();
      return;
    }

    this.token = token;
    this.candidates = candidates;
    this.selected = 0;
    this.paintMenu();
  }

  private paintMenu(): void {
    const { menu } = this.deps;

    const items = this.candidates.map((nick, index) => {
      const item = document.createElement("li");
      item.className = "mention-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === this.selected));
      item.textContent = `@${nick}`;
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selected = index;
        this.accept();
      });
      return item;
    });

    menu.replaceChildren(...items);
    menu.hidden = false;
  }

  private accept(): void {
    const nick = this.candidates[this.selected];
    const token = this.token;
    if (nick === undefined || token === null) return;

    const { input } = this.deps;
    const caret = input.selectionStart ?? input.value.length;
    const result = applyMention(input.value, token, caret, nick);

    input.value = result.text;
    input.setSelectionRange(result.caret, result.caret);
    this.closeMenu();
    this.updateMeter();
  }

  private closeMenu(): void {
    this.deps.menu.hidden = true;
    this.deps.menu.replaceChildren();
    this.token = null;
    this.candidates = [];
    this.selected = 0;
  }

  private updateMeter(): void {
    const length = Array.from(this.deps.input.value).length;
    const { meter } = this.deps;

    if (length > MAX_TEXT) {
      meter.textContent = `${length}/${MAX_TEXT}`;
      meter.dataset.state = "over";
      return;
    }
    if (length > MAX_TEXT - 100) {
      meter.textContent = `${length}/${MAX_TEXT}`;
      meter.dataset.state = "warn";
      return;
    }
    meter.textContent = "";
    delete meter.dataset.state;
  }
}
