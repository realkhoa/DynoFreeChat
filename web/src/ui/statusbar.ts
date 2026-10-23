import type { SocketState } from "../net/socket";
import { icon } from "./icons";

/**
 * @brief Dependency container for the Status Bar UI components.
 * @details Elements are optional to allow the IDE layout to function without a rendered status bar footer.
 */
export interface StatusBarDeps {
  /** @brief Root status bar element or null if not rendered. */
  root?: HTMLElement | null;
  /** @brief Element displaying the current connection state. */
  conn?: HTMLElement | null;
  /** @brief Element displaying the active WebSocket URL. */
  url?: HTMLElement | null;
  /** @brief Element displaying the online user count. */
  online?: HTMLElement | null;
  /** @brief Element displaying the message/line count. */
  count?: HTMLElement | null;
  /** @brief Button or text element displaying the current user nickname. */
  nick?: HTMLElement | null;
  /** @brief Element indicating whether the room is password-protected. */
  lock?: HTMLElement | null;
}

/**
 * @brief Human-readable localized connection state labels.
 */
const CONNECTION_LABEL: Record<SocketState, string> = {
  idle: "Sẵn sàng",
  connecting: "Đang kết nối",
  open: "Connected",
  reconnecting: "Reconnecting",
  closed: "Offline",
};

/**
 * @brief Controller for the status bar indicator strip.
 * @details Safely updates status metrics and indicators without throwing if UI elements are absent.
 */
export class StatusBar {
  /**
   * @brief Initializes the status bar controller with optional DOM dependencies.
   * @param deps DOM elements referenced by the status bar.
   */
  constructor(private readonly deps: StatusBarDeps) {}

  /**
   * @brief Updates the connection state indicator.
   * @details Sets the data-connection attribute on root and updates textual state label.
   * @param state Current socket state.
   * @param attempt Current reconnect attempt counter, defaults to 0.
   * @return void
   */
  setConnection(state: SocketState, attempt = 0): void {
    if (this.deps.root) {
      this.deps.root.dataset.connection = state;
    }
    if (this.deps.conn) {
      this.deps.conn.textContent =
        state === "reconnecting" && attempt > 0
          ? `${CONNECTION_LABEL[state]} (${attempt})`
          : CONNECTION_LABEL[state];
    }
  }

  /**
   * @brief Updates the display of the active WebSocket endpoint.
   * @details Strips protocol prefixes (ws:// or wss://) for concise display.
   * @param url Full WebSocket URL string.
   * @return void
   */
  setUrl(url: string): void {
    if (this.deps.url) {
      this.deps.url.textContent = url.replace(/^wss?:\/\//, "");
      this.deps.url.title = url;
    }
  }

  /**
   * @brief Updates the count of online users in the room.
   * @param online Number of currently active users.
   * @return void
   */
  setOnline(online: number): void {
    if (this.deps.online) {
      this.deps.online.textContent = `${online} online`;
    }
  }

  /**
   * @brief Updates the message/line count display.
   * @param count Total visible lines in the current log view.
   * @return void
   */
  setCount(count: number): void {
    if (this.deps.count) {
      this.deps.count.textContent = `${count} dòng`;
    }
  }

  /**
   * @brief Toggles visibility of the message line counter.
   * @details The counter is typically hidden outside active chat rooms.
   * @param visible True to show the line counter, false to hide it.
   * @return void
   */
  setCountVisible(visible: boolean): void {
    if (this.deps.count) {
      this.deps.count.hidden = !visible;
    }
  }

  /**
   * @brief Sets the user nickname display.
   * @param nick User's active nickname string.
   * @return void
   */
  setNick(nick: string): void {
    if (this.deps.nick) {
      this.deps.nick.textContent = nick;
    }
  }

  /**
   * @brief Updates the locked status icon for the current room.
   * @param locked True if the room requires a password, false otherwise.
   * @return void
   */
  setLocked(locked: boolean): void {
    if (this.deps.lock) {
      this.deps.lock.hidden = !locked;
      if (locked) {
        this.deps.lock.replaceChildren(icon("lock", 12));
        this.deps.lock.title = "room có mật khẩu";
      }
    }
  }
}
