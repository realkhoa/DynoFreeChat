// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { MenuAction } from "../src/ui/menubar";
import { Ribbon, defaultRibbonSpec, type RibbonTabSpec } from "../src/ui/ribbon";

let root: HTMLElement;
let fired: MenuAction[];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  fired = [];
});

function mount(spec: RibbonTabSpec[] = defaultRibbonSpec()): Ribbon {
  return new Ribbon(root, spec, (action) => fired.push(action));
}

describe("Ribbon", () => {
  it("renders one tab per spec and shows the first panel only", () => {
    mount();

    const tabs = Array.from(root.querySelectorAll(".ribbon-tab")).map((tab) => tab.textContent);
    expect(tabs).toEqual(["Home", "Room", "View", "Tools"]);

    const panels = Array.from(root.querySelectorAll<HTMLElement>(".ribbon-panel"));
    expect(panels).toHaveLength(4);
    expect(panels.filter((panel) => !panel.hidden)).toHaveLength(1);
  });

  it("labels every group", () => {
    mount();
    const groups = Array.from(root.querySelectorAll(".ribbon-group-label")).map(
      (label) => label.textContent,
    );
    expect(groups).toEqual(["Rooms", "Kết nối", "Cá nhân", "Tin nhắn", "Cỡ chữ", "Giao diện", "Cửa sổ", "Thông báo", "Liên kết"]);
  });

  it("switches panels", () => {
    const ribbon = mount();
    ribbon.showTab("view");

    const panels = Array.from(root.querySelectorAll<HTMLElement>(".ribbon-panel"));
    expect(panels.filter((panel) => !panel.hidden)).toHaveLength(1);
    const active = root.querySelector('.ribbon-tab[aria-selected="true"]');
    expect(active?.textContent).toBe("View");
  });

  it("forwards clicks to the action handler", () => {
    mount();
    const button = root.querySelector<HTMLButtonElement>('.ribbon-button[title="Room mới"]');
    button?.click();

    expect(fired).toEqual(["new-room"]);
  });

  it("can disable a command in every place it appears", () => {
    const ribbon = mount();
    ribbon.setEnabled("copy-url", false);

    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.ribbon-button[title="Copy link"]'),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.disabled).toBe(true);
  });

  it("reflects toggle state", () => {
    const ribbon = mount();
    ribbon.setChecked("follow", false);
    const follow = root.querySelector<HTMLButtonElement>('.ribbon-button[title="Bám đuôi"]');

    expect(follow?.getAttribute("aria-pressed")).toBe("false");
  });
});
