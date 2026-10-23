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
    expect(shown[0]?.title).toBe("#chung");
    expect(shown[0]?.body).toBe("1 tin nhắn mới");
    expect(shown[0]?.tag).toBe("room:chung");
  });

  it("carries no message text or nickname at all", () => {
    const { notifier, shown } = harness();
    for (let i = 0; i < 3; i += 1) notifier.incoming("chung");

    for (const notification of shown) {
      expect(notification.body).toMatch(/^\d+ tin nhắn mới$/);
      expect(Object.keys(notification)).toEqual(["title", "body", "tag"]);
    }
  });

  it("counts unread even while the tab is visible", () => {
    const { notifier, shown } = harness({ hidden: false });
    notifier.incoming("chung");
    notifier.incoming("chung");

    expect(shown).toHaveLength(0);
    expect(notifier.unread).toBe(2);
  });

  it("throttles notifications and reports the accumulated count", () => {
    const { notifier, shown, clock } = harness();
    notifier.incoming("chung");
    notifier.incoming("chung");
    expect(shown).toHaveLength(1);

    clock.now += 5_000;
    notifier.incoming("chung");
    expect(shown).toHaveLength(2);
    expect(shown[1]?.body).toBe("3 tin nhắn mới");
  });

  it("stays quiet when disabled but still tracks unread", () => {
    const { notifier, shown } = harness({ enabled: false });
    notifier.incoming("chung");
    notifier.incoming("chung");

    expect(shown).toHaveLength(0);
    expect(notifier.unread).toBe(2);
  });

  it("clears unread on reset and reports what it cleared", () => {
    const { notifier } = harness({ hidden: false });
    notifier.incoming("a");
    notifier.incoming("a");

    expect(notifier.reset()).toBe(2);
    expect(notifier.unread).toBe(0);
  });
});
