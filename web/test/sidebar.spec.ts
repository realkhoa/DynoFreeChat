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

beforeEach(() => {
  document.body.replaceChildren();
  tree = document.createElement("ul");
  foot = document.createElement("div");
  document.body.append(tree, foot);
  sidebar = new Sidebar(tree, foot);
  picked = [];
});

function render(rooms: RoomInfo[], current: string | null = null): void {
  sidebar.render(rooms, current, (pickedRoom) => picked.push(pickedRoom.slug));
}

describe("project browser", () => {
  it("shows solution, project and room levels", () => {
    render([room("chung"), room("team", true)]);

    const labels = Array.from(tree.querySelectorAll(".tree-label")).map((node) => node.textContent);
    expect(labels).toEqual(["DynoFreeChat", "Rooms", "chung", "team"]);

    const depths = Array.from(tree.querySelectorAll<HTMLElement>(".tree-row")).map(
      (row) => row.dataset.depth,
    );
    expect(depths).toEqual(["0", "1", "2", "2"]);
  });

  it("marks the open room as selected", () => {
    render([room("chung"), room("team")], "team");

    const selected = tree.querySelectorAll('.tree-row[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("team");
  });

  it("picks a room on click", () => {
    render([room("chung")]);
    const hit = tree.querySelectorAll<HTMLButtonElement>(".tree-row--room .tree-hit")[0];
    hit?.click();

    expect(picked).toEqual(["chung"]);
  });

  it("distinguishes a locked room with a lock glyph", () => {
    render([room("chung"), room("team", true)]);

    const glyphs = Array.from(tree.querySelectorAll<HTMLElement>(".tree-row--room .tree-icon")).map(
      (node) => node.dataset.icon,
    );
    expect(glyphs).toEqual(["hash", "lock"]);
  });

  it("collapses the solution when its toggle is clicked", () => {
    render([room("chung")]);
    const toggle = tree.querySelector<HTMLButtonElement>(".tree-row--root .tree-toggle");
    toggle?.click();

    expect(tree.querySelectorAll(".tree-row")).toHaveLength(1);
    expect(tree.querySelector(".tree-row--root")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses everything at once", () => {
    render([room("a"), room("b")]);
    sidebar.collapseAll();
    expect(tree.querySelectorAll(".tree-row")).toHaveLength(1);

    sidebar.expandAll();
    expect(tree.querySelectorAll(".tree-row")).toHaveLength(4);
  });

  it("says so when there are no rooms yet", () => {
    render([]);
    expect(tree.querySelector(".tree-empty")?.textContent).toBe("chưa có room nào");
  });

  it("summarises the list in the footer", () => {
    sidebar.setFoot("3 room · 1 có mật khẩu");
    expect(foot.textContent).toBe("3 room · 1 có mật khẩu");
  });
});
