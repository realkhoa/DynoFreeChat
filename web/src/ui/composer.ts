import { MAX_TEXT } from "@dyno/shared/protocol";

export interface ComposerDeps {
  root: HTMLElement;
  input: HTMLInputElement;
  meter: HTMLElement;
  onSend: (text: string) => void;
}

/**
 * The single-line prompt at the bottom of the log. Enter sends. `Ctrl+L` is
 * handled once, globally, in `main.ts`, so it is deliberately absent here.
 */
export class Composer {
  constructor(private readonly deps: ComposerDeps) {
    const { input } = deps;

    input.addEventListener("input", () => this.updateMeter());

    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      this.submit();
    });
  }

  setEnabled(enabled: boolean): void {
    this.deps.root.dataset.disabled = String(!enabled);
    this.deps.input.disabled = !enabled;
    this.deps.input.placeholder = enabled ? "nhập tin nhắn rồi Enter…" : "chọn hoặc tạo một room để bắt đầu…";
  }

  focus(): void {
    if (!this.deps.input.disabled) this.deps.input.focus();
  }

  clear(): void {
    this.deps.input.value = "";
    this.updateMeter();
  }

  private submit(): void {
    const text = this.deps.input.value.trim();
    if (text.length === 0 || this.deps.input.disabled) return;
    this.deps.onSend(text);
    this.clear();
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
