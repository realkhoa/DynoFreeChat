/**
 * @file view.ts
 * @brief Access document: unlocks the market gate from a normal editor tab.
 * @details Deliberately not a modal: the unlock form is just another document,
 * which keeps the work-IDE illusion and gives the user a place to paste the
 * access token without a popup interrupting the chat.
 */

import type { LockClient } from "./lock";

/** DOM hosts the access document paints into. */
export interface LockElements {
  panel: HTMLElement;
  token: HTMLInputElement;
  pin: HTMLInputElement;
  submit: HTMLButtonElement;
  clear: HTMLButtonElement;
  status: HTMLElement;
}

/** Callbacks the document needs from the host. */
export interface LockHandlers {
  /** Called after a successful unlock, e.g. to reopen the market hub. */
  onUnlocked: () => void;
}

/**
 * @brief Owns the access document.
 */
export class LockView {
  private inFlight = false;

  /**
   * @param elements DOM hosts.
   * @param client Session client.
   * @param handlers Host callbacks.
   */
  constructor(
    private readonly elements: LockElements,
    private readonly client: LockClient,
    private readonly handlers: LockHandlers,
  ) {
    elements.submit.addEventListener("click", () => void this.submit());
    elements.clear.addEventListener("click", () => this.signOut());
    for (const input of [elements.token, elements.pin]) {
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void this.submit();
      });
    }
  }

  /** @brief Paints the current gate state. */
  start(): void {
    this.elements.status.textContent =
      this.client.token === null ? "// locked - paste the access token" : "// session token stored";
    void this.client.state().then((state) => {
      if (!state.required) {
        this.elements.status.textContent = "// gate disabled on this worker - nothing to unlock";
        return;
      }
      this.elements.status.textContent = state.unlocked
        ? "// session active"
        : "// locked - paste the access token or the PIN";
    });
  }

  /** @brief Moves focus to the token box. */
  focus(): void {
    this.elements.token.focus();
    this.elements.token.select();
  }

  /** @brief Submits whichever credential the user filled in. */
  private async submit(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.elements.status.textContent = "// verifying...";

    const token = this.elements.token.value.trim();
    const pin = this.elements.pin.value.trim();
    const credential = token.length > 0 ? { token } : pin.length > 0 ? { pin } : null;

    if (credential === null) {
      this.elements.status.textContent = "// enter the access token or the PIN";
      this.inFlight = false;
      return;
    }

    const unlocked = await this.client.unlock(credential);
    this.inFlight = false;

    if (!unlocked) {
      this.elements.status.textContent = "// refused - wrong credential or too many attempts";
      return;
    }

    this.elements.token.value = "";
    this.elements.pin.value = "";
    this.elements.status.textContent = "// unlocked - session token stored for this browser";
    this.handlers.onUnlocked();
  }

  /** @brief Drops the stored session token. */
  private signOut(): void {
    this.client.clear();
    this.elements.status.textContent = "// signed out - the next market request will be refused";
  }
}
