// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsView,
  type SettingsViewElements,
  type SettingsViewHandlers,
} from "@/features/settings/settings-view";

interface Harness {
  view: SettingsView;
  elements: SettingsViewElements;
  handlers: SettingsViewHandlers;
}

function makeHarness(): Harness {
  const root = document.createElement("section");
  root.id = "settings-view";
  root.innerHTML = `
    <span id="settings-nick-desc"></span>
    <input id="settings-nick-input" />
    <button id="settings-nick-save"></button>
    <span id="settings-zoom-label"></span>
    <button id="settings-toggle-theme"></button>
    <button id="settings-toggle-minimal"></button>
    <button id="settings-toggle-sidebar"></button>
    <button id="settings-toggle-dock"></button>
    <button id="settings-toggle-sound"></button>
    <button id="settings-toggle-notify"></button>
    <button id="settings-zoom-in"></button>
    <button id="settings-zoom-out"></button>
  `;
  document.body.replaceChildren(root);

  const q = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const elements: SettingsViewElements = {
    toggleTheme: q("settings-toggle-theme"),
    toggleMinimal: q("settings-toggle-minimal"),
    toggleSidebar: q("settings-toggle-sidebar"),
    toggleDock: q("settings-toggle-dock"),
    toggleSound: q("settings-toggle-sound"),
    toggleNotify: q("settings-toggle-notify"),
    zoomIn: q("settings-zoom-in"),
    zoomOut: q("settings-zoom-out"),
    zoomLabel: q("settings-zoom-label"),
    nickInput: q("settings-nick-input"),
    nickSave: q("settings-nick-save"),
    nickDesc: q("settings-nick-desc"),
  };

  const handlers: SettingsViewHandlers = {
    onToggleTheme: vi.fn(),
    onToggleMinimal: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleDock: vi.fn(),
    onToggleSound: vi.fn(),
    onToggleNotify: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onChangeNick: vi.fn(),
  };

  return { view: new SettingsView(root, elements, handlers), elements, handlers };
}

describe("SettingsView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("renders the current state into the document", () => {
    h.view.update({ theme: "dark", soundEnabled: false, nick: "khoan", zoomPercent: 120 });

    expect(h.elements.nickDesc.textContent).toBe("Nickname hiện tại: khoan");
    expect(h.elements.nickInput.value).toBe("khoan");
    expect(h.elements.zoomLabel.textContent).toBe("Cỡ log hiện tại: 120%");
    expect(h.elements.toggleTheme.textContent).toBe("Chuyển sang Light");
    expect(h.elements.toggleSound.textContent).toBe("Bật âm thanh");
  });

  it("flips the theme and sound labels for the opposite state", () => {
    h.view.update({ theme: "light", soundEnabled: true, nick: "a", zoomPercent: 100 });
    expect(h.elements.toggleTheme.textContent).toBe("Chuyển sang Dark");
    expect(h.elements.toggleSound.textContent).toBe("Tắt âm thanh");
  });

  it("routes every toggle to its handler", () => {
    h.elements.toggleTheme.click();
    h.elements.toggleMinimal.click();
    h.elements.toggleSidebar.click();
    h.elements.toggleDock.click();
    h.elements.toggleSound.click();
    h.elements.toggleNotify.click();
    h.elements.zoomIn.click();
    h.elements.zoomOut.click();

    expect(h.handlers.onToggleTheme).toHaveBeenCalledOnce();
    expect(h.handlers.onToggleMinimal).toHaveBeenCalledOnce();
    expect(h.handlers.onToggleSidebar).toHaveBeenCalledOnce();
    expect(h.handlers.onToggleDock).toHaveBeenCalledOnce();
    expect(h.handlers.onToggleSound).toHaveBeenCalledOnce();
    expect(h.handlers.onToggleNotify).toHaveBeenCalledOnce();
    expect(h.handlers.onZoomIn).toHaveBeenCalledOnce();
    expect(h.handlers.onZoomOut).toHaveBeenCalledOnce();
  });

  it("saves the nickname typed in the inline field", () => {
    h.elements.nickInput.value = "  MinhDuc  ";
    h.elements.nickSave.click();
    expect(h.handlers.onChangeNick).toHaveBeenCalledWith("MinhDuc");
  });

  it("saves the nickname on Enter and ignores a blank value", () => {
    h.elements.nickInput.value = "Khoa";
    h.elements.nickInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.handlers.onChangeNick).toHaveBeenCalledWith("Khoa");

    h.elements.nickInput.value = "   ";
    h.elements.nickSave.click();
    expect(h.handlers.onChangeNick).toHaveBeenCalledTimes(1);
  });

  it("focuses and selects the nickname field for the profile shortcut", () => {
    h.elements.nickInput.value = "khoan";
    h.view.focusNick();
    expect(document.activeElement).toBe(h.elements.nickInput);
  });
});
