// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { RoomInfo } from "@dyno/shared/protocol";
import { Sidebar } from "../src/ui/sidebar";

function room(slug: string, locked = false): RoomInfo {
  return { slug, locked, createdAt: 1_700_000_000_000, lastSeen: Date.now() };
}

let tree: HTMLElement;
let foot: HTMLElement;
let sidebar: Sidebar;
let picked: string[];
let notices: string[];

beforeEach(() => {
  document.body.replaceChildren();
  tree = document.createElement("ul");
  foot = document.createElement("div");
  document.body.append(tree, foot);
  sidebar = new Sidebar(tree, foot);
  picked = [];
  notices = [];
});

function render(rooms: RoomInfo[], current: string | null = null): void {
  sidebar.render(
    rooms,
    current,
    (pickedRoom) => picked.push(pickedRoom.slug),
    (notice) => notices.push(notice),
  );
}

const labels = (): string[] =>
  Array.from(tree.querySelectorAll(".tree-label")).map((node) => node.textContent ?? "");

describe("project browser", () => {
  it("shows the real solution with its rooms", () => {
    render([room("chung"), room("team", true)]);

    expect(labels().slice(0, 4)).toEqual(["DynoFreeChat", "Rooms", "chung", "team"]);
    const depths = Array.from(tree.querySelectorAll<HTMLElement>(".tree-row")).map(
      (row) => row.dataset.depth,
    );
    expect(depths.slice(0, 4)).toEqual(["0", "1", "2", "2"]);
  });

  it("adds the placeholder solutions Collab and VinaBIM", () => {
    render([room("chung")]);

    const names = labels();
    expect(names).toContain("Collab");
    expect(names).toContain("VinaBIM");
    expect(names).toContain("chat-ui");
    expect(names).toContain("ifc-import");
    expect(tree.querySelectorAll(".tree-row--placeholder").length).toBeGreaterThan(3);
  });

  it("hides the placeholder solutions while searching", () => {
    render([room("chung"), room("team")]);
    sidebar.setQuery("te");

    const names = labels();
    expect(names).toContain("team");
    expect(names).not.toContain("Collab");
  });

  it("marks the open room as selected", () => {
    render([room("chung"), room("team")], "team");

    const selected = tree.querySelectorAll('.tree-row[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("team");
  });

  it("picks a room on click", () => {
    render([room("chung")]);
    tree.querySelector<HTMLButtonElement>(".tree-row--room .tree-hit")?.click();

    expect(picked).toEqual(["chung"]);
  });

  it("explains that a placeholder entry has no data", () => {
    render([room("chung")]);
    const file = tree.querySelector<HTMLButtonElement>(".tree-row--file .tree-hit");
    file?.click();

    expect(picked).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("placeholder");
  });

  it("distinguishes a locked room with a lock glyph", () => {
    render([room("chung"), room("team", true)]);

    const glyphs = Array.from(tree.querySelectorAll<HTMLElement>(".tree-row--room .tree-icon")).map(
      (node) => node.dataset.icon,
    );
    expect(glyphs).toEqual(["hash", "lock"]);
  });

  it("collapses every solution at once", () => {
    render([room("a"), room("b")]);
    sidebar.collapseAll();

    expect(tree.querySelectorAll(".tree-row")).toHaveLength(3);
    for (const root of tree.querySelectorAll(".tree-row--root")) {
      expect(root.getAttribute("aria-expanded")).toBe("false");
    }

    sidebar.expandAll();
    expect(tree.querySelectorAll(".tree-row").length).toBeGreaterThan(10);
  });

  it("says so when the real solution has no rooms yet", () => {
    render([]);
    expect(tree.querySelector(".tree-empty")?.textContent).toBe("chưa có room nào");
  });

  it("summarises the list in the footer", () => {
    sidebar.setFoot("3 room · 1 có mật khẩu · 2 solution mẫu");
    expect(foot.textContent).toBe("3 room · 1 có mật khẩu · 2 solution mẫu");
  });
});
