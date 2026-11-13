// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocTabs } from "@/shared/ui/doc-tabs";

interface Harness {
  tabs: DocTabs;
  strip: HTMLElement;
  host: HTMLElement;
  activated: string[];
  deactivated: number;
  closed: string[];
  settingsPanel: HTMLElement;
  roomsPanel: HTMLElement;
}

function makeHarness(): Harness {
  document.body.replaceChildren();

  const strip = document.createElement("div");
  strip.className = "tabstrip";
  const newTab = document.createElement("button");
  newTab.id = "tab-new";
  strip.append(newTab);

  const host = document.createElement("main");
  host.id = "editor";
  document.body.append(strip, host);

  const harness: Harness = {
    tabs: undefined as unknown as DocTabs,
    strip,
    host,
    activated: [],
    deactivated: 0,
    closed: [],
    settingsPanel: document.createElement("section"),
    roomsPanel: document.createElement("section"),
  };
  harness.settingsPanel.id = "settings-view";
  harness.roomsPanel.id = "rooms-view";

  harness.tabs = new DocTabs(strip, host, newTab, {
    onActivate: (id) => harness.activated.push(id),
    onDeactivate: () => {
      harness.deactivated += 1;
    },
    onClose: (id) => harness.closed.push(id),
  });

  return harness;
}

describe("DocTabs", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("opens a document as a tab with its panel visible", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });

    const tab = h.strip.querySelector<HTMLElement>('[data-doc-id="settings"]');
    expect(tab).not.toBeNull();
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(tab?.querySelector(".tab-label")?.textContent).toBe("Settings");
    expect(h.settingsPanel.parentElement).toBe(h.host);
    expect(h.settingsPanel.hidden).toBe(false);
    expect(h.activated).toEqual(["settings"]);
  });

  it("inserts the tab before the new-tab button", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    expect(h.strip.lastElementChild?.id).toBe("tab-new");
  });

  it("reuses the same tab instead of duplicating it", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    expect(h.strip.querySelectorAll('[data-doc-id="settings"]')).toHaveLength(1);
    expect(h.host.querySelectorAll("[data-doc-id]")).toHaveLength(1);
  });

  it("switches between two documents", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.open({ id: "rooms", label: "Chat Rooms", panel: h.roomsPanel });

    expect(h.settingsPanel.hidden).toBe(true);
    expect(h.roomsPanel.hidden).toBe(false);
    expect(h.tabs.activeId).toBe("rooms");
    expect(h.strip.querySelector('[data-doc-id="settings"]')?.getAttribute("aria-selected")).toBe("false");
  });

  it("deactivates every document when the chat tab takes over", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.deactivate();

    expect(h.settingsPanel.hidden).toBe(true);
    expect(h.tabs.activeId).toBeNull();
    expect(h.deactivated).toBe(1);
  });

  it("closes the active tab and asks the host what to show next", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.close("settings");

    expect(h.strip.querySelector('[data-doc-id="settings"]')).toBeNull();
    expect(h.host.querySelector("#settings-view")).toBeNull();
    expect(h.closed).toEqual(["settings"]);
    expect(h.tabs.activeId).toBeNull();
  });

  it("closes a background tab without notifying the host", () => {
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.open({ id: "rooms", label: "Chat Rooms", panel: h.roomsPanel });
    h.tabs.close("settings");

    expect(h.closed).toEqual([]);
    expect(h.tabs.activeId).toBe("rooms");
    expect(h.roomsPanel.hidden).toBe(false);
  });

  it("activates a tab from its close button target without closing", () => {
    const open = vi.fn();
    h.tabs.open({ id: "settings", label: "Settings", panel: h.settingsPanel });
    h.tabs.open({ id: "rooms", label: "Chat Rooms", panel: h.roomsPanel });
    open.mockImplementation(() => undefined);

    const settingsTab = h.strip.querySelector<HTMLElement>('[data-doc-id="settings"]');
    settingsTab?.click();
    expect(h.tabs.activeId).toBe("settings");
  });

  it("renames a tab and refreshes the active label for the host", () => {
    h.tabs.open({ id: "game-stage", label: "Game.cs", panel: h.settingsPanel });
    h.tabs.setLabel("game-stage", "Caro.cs");

    const tab = h.strip.querySelector<HTMLElement>('[data-doc-id="game-stage"]');
    expect(tab?.dataset.label).toBe("Caro.cs");
    expect(tab?.querySelector(".tab-label")?.textContent).toBe("Caro.cs");
    expect(h.tabs.activeLabel).toBe("Caro.cs");
    // The host re-renders the breadcrumb from the activation hook.
    expect(h.activated).toEqual(["game-stage", "game-stage"]);
  });

  it("ignores a rename for an unknown tab", () => {
    expect(() => h.tabs.setLabel("nope", "Nope.cs")).not.toThrow();
    expect(h.tabs.activeId).toBeNull();
  });
});
