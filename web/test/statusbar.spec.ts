// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { StatusBar } from "../src/ui/statusbar";

describe("StatusBar component", () => {
  it("safely handles null or missing dependencies without throwing", () => {
    const bar = new StatusBar({});
    expect(() => {
      bar.setConnection("connecting", 1);
      bar.setUrl("wss://example.com/chat");
      bar.setOnline(5);
      bar.setCount(42);
      bar.setCountVisible(true);
      bar.setNick("Alice");
      bar.setLocked(true);
      bar.setLocked(false);
    }).not.toThrow();
  });

  it("updates DOM elements when dependencies are provided", () => {
    const root = document.createElement("footer");
    const conn = document.createElement("span");
    const url = document.createElement("span");
    const online = document.createElement("span");
    const count = document.createElement("span");
    const nick = document.createElement("button");
    const lock = document.createElement("span");

    const bar = new StatusBar({
      root,
      conn,
      url,
      online,
      count,
      nick,
      lock,
    });

    bar.setConnection("open");
    expect(root.dataset.connection).toBe("open");
    expect(conn.textContent).toBe("Connected");

    bar.setConnection("reconnecting", 2);
    expect(conn.textContent).toBe("Reconnecting (2)");

    bar.setUrl("wss://chat.dyno.internal/room");
    expect(url.textContent).toBe("chat.dyno.internal/room");
    expect(url.title).toBe("wss://chat.dyno.internal/room");

    bar.setOnline(10);
    expect(online.textContent).toBe("10 online");

    bar.setCount(123);
    expect(count.textContent).toBe("123 dòng");

    bar.setCountVisible(false);
    expect(count.hidden).toBe(true);

    bar.setNick("Bob");
    expect(nick.textContent).toBe("Bob");

    bar.setLocked(true);
    expect(lock.hidden).toBe(false);
    expect(lock.title).toBe("room có mật khẩu");

    bar.setLocked(false);
    expect(lock.hidden).toBe(true);
  });
});
