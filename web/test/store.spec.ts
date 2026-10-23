import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@dyno/shared/protocol";
import { Store } from "../src/model/store";

function message(id: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, ts: 1_700_000_000_000, nick: "alice", color: "hsl(10 60% 60%)", text, ...overrides };
}

describe("Store", () => {
  it("appends a message once and reports duplicates", () => {
    const store = new Store();
    expect(store.addMessage(message("a", "một"))).toBe("appended");
    expect(store.addMessage(message("a", "một"))).toBe("duplicate");
    expect(store.rows).toHaveLength(1);
  });

  it("resolves a pending row in place when the server echoes the cid", () => {
    const store = new Store();
    store.addPending("cid1", "hello", "bob", "hsl(1 2% 3%)");
    expect(store.pendingCount).toBe(1);

    expect(store.addMessage(message("a", "hello", { nick: "bob" }), "cid1")).toBe("resolved");
    expect(store.pendingCount).toBe(0);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.state).toBe("ok");
    expect(store.rows[0]?.id).toBe("a");
  });

  it("keeps a pending row failing without duplicating it", () => {
    const store = new Store();
    store.addPending("cid1", "hello", "bob", "hsl(1 2% 3%)");
    store.failPending("cid1", "mất kết nối");

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.state).toBe("failed");
    expect(store.rows[0]?.text).toContain("mất kết nối");
    expect(store.pendingCount).toBe(0);
  });

  it("expires pending rows past their ttl", () => {
    const store = new Store();
    store.addPending("old", "cũ", "bob", "hsl(1 2% 3%)");
    store.rows[0]!.ts = 1_000;

    expect(store.expirePending(5_000, 2_000)).toEqual(["old"]);
    expect(store.rows[0]?.state).toBe("failed");
    expect(store.expirePending(5_000, 2_000)).toEqual([]);
  });

  it("counts only newly replayed history rows", () => {
    const store = new Store();
    expect(store.addHistory([message("a", "1"), message("b", "2")])).toBe(2);
    expect(store.addHistory([message("b", "2"), message("c", "3")])).toBe(1);
    expect(store.rows).toHaveLength(3);
  });

  it("keeps the dedupe set after clearing the view", () => {
    const store = new Store();
    store.addMessage(message("a", "một"));
    store.clearLocal();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.kind).toBe("system");
    expect(store.addMessage(message("a", "một"))).toBe("duplicate");
  });

  it("filters by kind", () => {
    const store = new Store();
    store.addMessage(message("a", "chat row"));
    store.addSystem("system row");

    store.setFilter("", "chat");
    expect(store.rows.filter((row) => store.matches(row))).toHaveLength(1);

    store.setFilter("", "system");
    expect(store.rows.filter((row) => store.matches(row))).toHaveLength(1);

    store.setFilter("", "all");
    expect(store.rows.filter((row) => store.matches(row))).toHaveLength(2);
  });

  it("matches text and nick case insensitively", () => {
    const store = new Store();
    store.addMessage(message("a", "Xin CHÀO thế giới", { nick: "Khoan" }));

    store.setFilter("chào");
    expect(store.matches(store.rows[0]!)).toBe(true);

    store.setFilter("khoan");
    expect(store.matches(store.rows[0]!)).toBe(true);

    store.setFilter("khong-co-gi");
    expect(store.matches(store.rows[0]!)).toBe(false);
  });
});
