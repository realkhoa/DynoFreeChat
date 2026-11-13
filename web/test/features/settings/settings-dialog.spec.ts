// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog, type SettingsDialogElements } from "@/features/settings/settings-dialog";

let dialog: HTMLDialogElement;
let elements: SettingsDialogElements;

beforeEach(() => {
  document.body.replaceChildren();
  dialog = document.createElement("dialog");
  document.body.append(dialog);

  elements = {
    toggleTheme: document.createElement("button"),
    toggleMinimal: document.createElement("button"),
    toggleSidebar: document.createElement("button"),
    toggleDock: document.createElement("button"),
    toggleSound: document.createElement("button"),
    toggleNotify: document.createElement("button"),
    zoomIn: document.createElement("button"),
    zoomOut: document.createElement("button"),
    zoomLabel: document.createElement("span"),
    changeNick: document.createElement("button"),
    nickDesc: document.createElement("span"),
    closeBtn: document.createElement("button"),
    closeX: document.createElement("button"),
  };

  for (const el of Object.values(elements)) {
    dialog.append(el);
  }
});

describe("SettingsDialog", () => {
  it("opens modal and triggers callbacks on button clicks", () => {
    const onToggleTheme = vi.fn();
    const onToggleSound = vi.fn();

    const settings = new SettingsDialog(dialog, elements, {
      onToggleTheme,
      onToggleMinimal: vi.fn(),
      onToggleSidebar: vi.fn(),
      onToggleDock: vi.fn(),
      onToggleSound,
      onToggleNotify: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onChangeNick: vi.fn(),
    });

    // Mock HTMLDialogElement methods in jsdom
    dialog.showModal = vi.fn(() => {
      dialog.open = true;
    });
    dialog.close = vi.fn(() => {
      dialog.open = false;
    });

    settings.open({
      theme: "dark",
      soundEnabled: true,
      nick: "Tester",
      zoomPercent: 100,
    });

    expect(dialog.showModal).toHaveBeenCalled();
    expect(elements.nickDesc.textContent).toContain("Tester");
    expect(elements.zoomLabel.textContent).toContain("100%");

    elements.toggleTheme.click();
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    elements.toggleSound.click();
    expect(onToggleSound).toHaveBeenCalledTimes(1);

    elements.closeBtn.click();
    expect(dialog.close).toHaveBeenCalled();
  });
});
