// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@dyno/shared/protocol";
import { Store } from "../src/model/store";
import { LogView } from "../src/ui/log-view";

function message(id: string, text: string, nick = "alice"): ChatMessage {
  return { id, ts: Date.UTC(2026, 0, 1, 12, 0, 0), nick, color: "hsl(10 60% 60%)", text };
}

let root: HTMLElement;
let view: LogView;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  view = new LogView(root);
});

describe("LogView", () => {
  it("renders one row per message and does not duplicate on re-sync", () => {
    const store = new Store();
    store.addMessage(message("a", "một"));
    store.addMessage(message("b", "hai"));

    view.sync(store);
    view.sync(store);

    expect(root.querySelectorAll(".log-row")).toHaveLength(2);
  });

  it("updates a pending row in place when the server acknowledges it", () => {
    const store = new Store();
    store.addPending("cid1", "nháp", "alice", "hsl(10 60% 60%)");
    view.sync(store);

    expect(root.querySelectorAll(".log-row")).toHaveLength(1);
    expect(root.querySelector(".is-pending")).not.toBeNull();

    store.addMessage(message("a", "đã gửi"), "cid1");
    view.sync(store);

    expect(root.querySelectorAll(".log-row")).toHaveLength(1);
    expect(root.querySelector(".is-pending")).toBeNull();
    expect(root.textContent).toContain("đã gửi");
  });

  it("hides filtered rows instead of removing them", () => {
    const store = new Store();
    store.addMessage(message("a", "xin chào"));
    store.addSystem("ai đó đã vào");
    view.sync(store);

    store.setFilter("chào", "all");
    view.sync(store);

    const rows = Array.from(root.querySelectorAll<HTMLElement>(".log-row"));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.hidden)).toHaveLength(1);
  });

  it("highlights filter matches with mark elements", () => {
    const store = new Store();
    store.addMessage(message("a", "xin chào thế giới"));
    store.setFilter("chào");
    view.sync(store);

    expect(root.querySelectorAll("mark")).toHaveLength(1);
    expect(root.querySelector("mark")?.textContent).toBe("chào");
  });

  it("clears everything on clearLocal", () => {
    const store = new Store();
    store.addMessage(message("a", "một"));
    view.sync(store);

    view.clearLocal();
    expect(root.querySelectorAll(".log-row")).toHaveLength(0);
  });

  it("marks the viewer's own lines", () => {
    const store = new Store();
    store.addMessage(message("a", "của tôi", "khoan"));
    view.selfNick = "khoan";
    view.sync(store);

    expect(root.querySelector(".is-self")).not.toBeNull();
  });

  it("counts only visible rows", () => {
    const store = new Store();
    store.addMessage(message("a", "một"));
    store.addMessage(message("b", "hai"));
    store.setFilter("một");
    view.sync(store);

    expect(view.visibleCount).toBe(1);
  });
});

describe("replies and mentions", () => {
  it("renders the quoted parent above the message", () => {
    const store = new Store();
    store.addMessage({
      ...message("a", "trả lời"),
      replyTo: { id: "x", nick: "khoan", text: "câu gốc" },
    });
    view.sync(store);

    const row = root.querySelector(".log-row");
    expect(row?.classList.contains("has-quote")).toBe(true);
    expect(root.querySelector(".log-quote-nick")?.textContent).toBe("khoan");
    expect(root.querySelector(".log-quote-text")?.textContent).toBe("câu gốc");
  });

  it("turns @nick into a pill", () => {
    const store = new Store();
    store.addMessage(message("a", "chào @khoan nhé"));
    view.sync(store);

    const pill = root.querySelector(".mention");
    expect(pill?.textContent).toBe("@khoan");
    expect(pill?.getAttribute("data-nick")).toBe("khoan");
  });

  it("marks rows that mention the reader", () => {
    const store = new Store();
    store.selfNick = "khoan";
    store.addMessage(message("a", "này @khoan", "dyno"));
    view.sync(store);

    expect(root.querySelector(".log-row.is-mention")).not.toBeNull();
  });

  it("does not mark rows that mention somebody else", () => {
    const store = new Store();
    store.selfNick = "khoan";
    store.addMessage(message("a", "này @linh", "dyno"));
    view.sync(store);

    expect(root.querySelector(".log-row.is-mention")).toBeNull();
  });

  it("offers a reply action that reports the row", () => {
    const store = new Store();
    store.addMessage(message("a", "gốc", "dyno"));

    const replies: string[] = [];
    const actionView = new LogView(root, { onReply: (row) => replies.push(row.id) });
    actionView.sync(store);

    const replyButton = root.querySelector<HTMLButtonElement>(".log-action[aria-label='Trả lời tin này']");
    expect(replyButton).not.toBeNull();
    replyButton?.click();
    expect(replies).toEqual(["a"]);
  });
});