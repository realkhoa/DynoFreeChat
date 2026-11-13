// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuAction } from "@/shared/ui/menubar";
import { StandardToolbar, defaultToolbarSpec } from "@/shared/ui/toolbar";

let root: HTMLElement;
let fired: MenuAction[];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  fired = [];
});

describe("StandardToolbar", () => {
  it("renders compact action buttons and dispatches clicks", () => {
    const toolbar = new StandardToolbar(root, defaultToolbarSpec(), (action) => fired.push(action));

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".toolbar-btn"));
    expect(buttons.length).toBeGreaterThan(0);

    const newRoomBtn = root.querySelector<HTMLButtonElement>('.toolbar-btn[data-action="new-room"]');
    expect(newRoomBtn).not.toBeNull();
    newRoomBtn?.click();

    expect(fired).toContain("new-room");
  });

  it("can disable a specific action button", () => {
    const toolbar = new StandardToolbar(root, defaultToolbarSpec(), (action) => fired.push(action));
    toolbar.setEnabled("new-room", false);

    const newRoomBtn = root.querySelector<HTMLButtonElement>('.toolbar-btn[data-action="new-room"]');
    expect(newRoomBtn?.disabled).toBe(true);

    toolbar.setEnabled("new-room", true);
    expect(newRoomBtn?.disabled).toBe(false);
  });

  it("can update toggle checked state", () => {
    const toolbar = new StandardToolbar(root, defaultToolbarSpec(), (action) => fired.push(action));
    toolbar.setChecked("follow", true);

    const followBtn = root.querySelector<HTMLButtonElement>('.toolbar-btn[data-action="follow"]');
    expect(followBtn?.getAttribute("aria-pressed")).toBe("true");

    toolbar.setChecked("follow", false);
    expect(followBtn?.getAttribute("aria-pressed")).toBe("false");
  });
});
