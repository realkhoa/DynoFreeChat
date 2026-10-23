export interface NickDialogFields {
  form: HTMLFormElement;
  input: HTMLInputElement;
  error: HTMLElement;
  cancel: HTMLButtonElement;
}

const MAX_NICK = 24;

/** "Đổi nickname" as a proper VS dialog instead of `window.prompt`. */
export class NickDialog {
  private settle: ((value: string | null) => void) | null = null;

  constructor(
    private readonly root: HTMLDialogElement,
    private readonly fields: NickDialogFields,
  ) {
    fields.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.confirm();
    });
    fields.cancel.addEventListener("click", () => this.dismiss());
    root.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.dismiss();
    });
  }

  get isOpen(): boolean {
    return this.root.open;
  }

  open(current: string): Promise<string | null> {
    this.fields.error.textContent = "";
    this.fields.input.value = current;
    if (!this.root.open) this.root.showModal();
    this.fields.input.focus();
    this.fields.input.select();

    return new Promise<string | null>((resolve) => {
      this.settle = resolve;
    });
  }

  private confirm(): void {
    const nick = this.fields.input.value.replace(/\s+/g, " ").trim();
    if (nick.length === 0 || Array.from(nick).length > MAX_NICK) {
      this.fields.error.textContent = `Nickname phải 1–${MAX_NICK} ký tự.`;
      return;
    }

    const resolve = this.settle;
    this.settle = null;
    this.root.close();
    resolve?.(nick);
  }

  private dismiss(): void {
    const resolve = this.settle;
    this.settle = null;
    this.root.close();
    resolve?.(null);
  }
}
