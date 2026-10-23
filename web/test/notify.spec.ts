import { describe, expect, it } from "vitest";
import { Notifier } from "../src/lib/notify";

interface Shown {
  title: string;
  body: string;
  tag: string;
}

function harness(options: { hidden?: boolean; enabled?: boolean } = {}) {
  const shown: Shown[] = [];
  const clock = { now: 1_000 };
  const notifier = new Notifier({
    isHidden: () => options.hidden ?? true,
    show: (title, body, tag) => shown.push({ title, body, tag }),
    now: () => clock.now,
    minIntervalMs: 5_000,
  });
  if (options.enabled === false) notifier.setEnabled(false);
  return { notifier, shown, clock };
}

describe("Notifier", () => {
  it("announces the room and a count, never the message", () => {
    const { notifier, shown } = harness();
    notifier.incoming("chung");

    expect(shown).toHaveLength(1);
    expect(shown[0]).toEqual({ title: "#chung", body: "1 tin nhắn mới", tag: "room:chung" });
  });

  it("carries no message text or nickname at all", () => {
    const { notifier, shown } = harness();
    for (let i = 0; i < 3; i += 1) notifier.incoming("chung");

    for (const notification of shown) {
      expect(notification.body).toMatch(/^\d+ tin nhắn mới$/);
      expect(Object.keys(notification)).toEqual(["title", "body", "tag"]);
    }
  });

  it("stays quiet while the tab is being watched", () => {
    const { notifier, shown } = harness({ hidden: false });
    notifier.incoming("chung");
    notifier.incoming("chung");

    expect(shown).toHaveLength(0);
    expect(notifier.unread).toBe(0);
    expect(notifier.entries()).toEqual([]);
  });

  it("groups unread counts per room, newest first", () => {
    const { notifier, clock } = harness();
    notifier.incoming("a");
    clock.now += 10;
    notifier.incoming("b");
    clock.now += 10;
    notifier.incoming("b");

    expect(notifier.unread).toBe(3);
    expect(notifier.entries()).toEqual([
      { room: "b", count: 2, at: 1_020 },
      { room: "a", count: 1, at: 1_000 },
    ]);
  });

  it("throttles OS notifications but keeps counting", () => {
    const { notifier, shown, clock } = harness();
    notifier.incoming("chung");
    notifier.incoming("chung");
    expect(shown).toHaveLength(1);

    clock.now += 5_000;
    notifier.incoming("chung");
    expect(shown).toHaveLength(2);
    expect(shown[1]?.body).toBe("3 tin nhắn mới");
  });

  it("keeps unread while disabled but shows nothing", () => {
    const { notifier, shown } = harness({ enabled: false });
    notifier.incoming("chung");

    expect(shown).toHaveLength(0);
    expect(notifier.unread).toBe(1);
  });

  it("clears one room without touching the others", () => {
    const { notifier } = harness();
    notifier.incoming("a");
    notifier.incoming("b");
    notifier.incoming("b");

    notifier.resetRoom("b");
    expect(notifier.entries()).toEqual([{ room: "a", count: 1, at: 1_000 }]);
    expect(notifier.unread).toBe(1);
  });

  it("clears everything on reset and reports the count", () => {
    const { notifier } = harness();
    notifier.incoming("a");
    notifier.incoming("b");

    expect(notifier.reset()).toBe(2);
    expect(notifier.unread).toBe(0);
    expect(notifier.entries()).toEqual([]);
  });
});
