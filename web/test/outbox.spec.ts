import { describe, expect, it } from "vitest";
import { Outbox } from "../src/lib/outbox";

describe("Outbox", () => {
  it("starts empty", () => {
    const outbox = new Outbox();
    expect(outbox.empty).toBe(true);
    expect(outbox.size).toBe(0);
  });

  it("keeps order and drains once", () => {
    const outbox = new Outbox();
    outbox.queue({ cid: "1", text: "một" });
    outbox.queue({ cid: "2", text: "hai", replyTo: "parent" });

    expect(outbox.size).toBe(2);
    expect(outbox.take()).toEqual([
      { cid: "1", text: "một" },
      { cid: "2", text: "hai", replyTo: "parent" },
    ]);
    expect(outbox.empty).toBe(true);
    expect(outbox.take()).toEqual([]);
  });

  it("can be cleared without sending", () => {
    const outbox = new Outbox();
    outbox.queue({ cid: "1", text: "một" });
    outbox.clear();

    expect(outbox.empty).toBe(true);
  });
});
