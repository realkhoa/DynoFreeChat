import type { SocketState } from "../net/socket";

export interface StatusBarDeps {
  root: HTMLElement;
  conn: HTMLElement;
  url: HTMLElement;
  online: HTMLElement;
  count: HTMLElement;
  nick: HTMLElement;
  lock: HTMLElement;
}

const CONNECTION_LABEL: Record<SocketState, string> = {
  idle: "Chưa kết nối",
  connecting: "Đang kết nối…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Offline",
};

export class StatusBar {
  constructor(private readonly deps: StatusBarDeps) {}

  setConnection(state: SocketState, attempt = 0): void {
    this.deps.root.dataset.connection = state;
    this.deps.conn.textContent =
      state === "reconnecting" && attempt > 0
        ? `${CONNECTION_LABEL[state]} (${attempt})`
        : CONNECTION_LABEL[state];
  }

  setUrl(url: string): void {
    this.deps.url.textContent = url.replace(/^wss?:\/\//, "");
  }

  setOnline(online: number): void {
    this.deps.online.textContent = `${online} online`;
  }

  setCount(count: number): void {
    this.deps.count.textContent = `${count} dòng`;
  }

  setNick(nick: string): void {
    this.deps.nick.textContent = nick;
  }

  setLocked(locked: boolean): void {
    this.deps.lock.hidden = !locked;
  }
}
