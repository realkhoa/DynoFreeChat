export type RoomDialogMode = "create" | "join";

export interface RoomDialogResult {
  slug: string;
  pass: string;
}

export interface RoomDialogFields {
  form: HTMLFormElement;
  slug: HTMLInputElement;
  pass: HTMLInputElement;
  title: HTMLElement;
  passLabel: HTMLElement;
  slugHint: HTMLElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  error: HTMLElement;
}

/**
 * Called on submit. Return `null` to accept and close the dialog, or a message
 * to keep it open with that error shown.
 */
export type RoomDialogHandler = (result: RoomDialogResult) => Promise<string | null>;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

/** VS-style modal used for both "new room" and "this room needs a password". */
export class RoomDialog {
  private mode: RoomDialogMode = "create";
  private handler: RoomDialogHandler | null = null;

  constructor(
    private readonly root: HTMLDialogElement,
    private readonly fields: RoomDialogFields,
  ) {
    fields.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });

    fields.cancel.addEventListener("click", () => this.close());

    root.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.open;
  }

  open(
    mode: RoomDialogMode,
    options: { slug?: string; locked?: boolean; message?: string },
    handler: RoomDialogHandler,
  ): void {
    this.mode = mode;
    this.handler = handler;

    const { title, submit, passLabel, slug, slugHint } = this.fields;
    if (mode === "create") {
      title.textContent = "Room mới";
      submit.textContent = "Tạo room";
      passLabel.textContent = "Mật khẩu (để trống = phòng mở)";
      slug.readOnly = false;
      slug.value = "";
      slugHint.hidden = false;
    } else {
      title.textContent = `Vào #${options.slug ?? ""}`;
      submit.textContent = "Vào room";
      passLabel.textContent = "Mật khẩu room";
      slug.readOnly = true;
      slug.value = options.slug ?? "";
      slugHint.hidden = true;
    }

    this.fields.pass.value = "";
    this.fields.error.textContent = options.message ?? "";
    if (!this.root.open) this.root.showModal();
    if (mode === "create") slug.focus();
    else this.fields.pass.focus();
  }

  showError(message: string): void {
    this.fields.error.textContent = message;
  }

  setBusy(busy: boolean): void {
    this.fields.submit.disabled = busy;
    this.fields.slug.disabled = busy;
    this.fields.pass.disabled = busy;
  }

  close(): void {
    if (this.root.open) this.root.close();
    this.handler = null;
    this.setBusy(false);
  }

  private async submit(): Promise<void> {
    const handler = this.handler;
    if (handler === null) return;

    const slug = this.fields.slug.value.trim().toLowerCase();
    const pass = this.fields.pass.value;

    if (this.mode === "create" && !SLUG_PATTERN.test(slug)) {
      this.showError("Tên room phải 2–24 ký tự: a-z, 0-9, dấu gạch ngang.");
      return;
    }

    this.fields.error.textContent = "";
    this.setBusy(true);
    try {
      const error = await handler({ slug, pass });
      if (error === null) this.close();
      else this.showError(error);
    } catch (cause) {
      this.showError(cause instanceof Error ? cause.message : "lỗi không xác định");
    } finally {
      this.setBusy(false);
    }
  }
}
