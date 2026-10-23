// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomInfo } from "@dyno/shared/protocol";
import { ChatPicker, type ChatPickerElements } from "../src/ui/chat-picker";

describe("ChatPicker", () => {
  let dialog: HTMLDialogElement;
  let search: HTMLInputElement;
  let list: HTMLElement;
  let cancel: HTMLButtonElement;
  let closeX: HTMLButtonElement;
  let createButton: HTMLButtonElement;
  let elements: ChatPickerElements;

  const mockRooms: RoomInfo[] = [
    { slug: "chung", locked: false, lastSeen: Date.now() - 5000 },
    { slug: "du-an-a", locked: true, lastSeen: Date.now() - 3600000 },
    { slug: "dev-team", locked: false, lastSeen: Date.now() - 86400000 },
  ];

  beforeEach(() => {
    document.body.replaceChildren();

    dialog = document.createElement("dialog");
    // Mock HTMLDialogElement methods in jsdom if needed
    if (!dialog.showModal) {
      dialog.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
    }
    if (!dialog.close) {
      dialog.close = function (this: HTMLDialogElement) {
        this.open = false;
      };
    }

    search = document.createElement("input");
    search.type = "search";

    list = document.createElement("div");
    cancel = document.createElement("button");
    closeX = document.createElement("button");
    createButton = document.createElement("button");

    dialog.append(closeX, search, list, createButton, cancel);
    document.body.append(dialog);

    elements = { search, list, cancel, closeX, createButton };
  });

  it("renders room items when opened", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, "chung");

    expect(picker.isOpen).toBe(true);
    const items = list.querySelectorAll<HTMLButtonElement>(".picker-item");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("#chung");
    expect(items[0]?.classList.contains("is-current")).toBe(true);
    expect(items[1]?.textContent).toContain("#du-an-a");
    expect(items[1]?.textContent).toContain("có mật khẩu");
  });

  it("filters rooms based on search input", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);
    search.value = "dev";
    search.dispatchEvent(new Event("input"));

    const items = list.querySelectorAll<HTMLButtonElement>(".picker-item");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("#dev-team");
  });

  it("shows empty state when no rooms match", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);
    search.value = "nonexistent";
    search.dispatchEvent(new Event("input"));

    const items = list.querySelectorAll<HTMLButtonElement>(".picker-item");
    expect(items).toHaveLength(0);
    const empty = list.querySelector(".picker-empty");
    expect(empty?.textContent).toContain('Không tìm thấy room nào khớp với "nonexistent"');
  });

  it("invokes onPick and closes dialog when an item is clicked", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);
    const items = list.querySelectorAll<HTMLButtonElement>(".picker-item");
    items[1]?.click();

    expect(onPick).toHaveBeenCalledWith(mockRooms[1]);
    expect(picker.isOpen).toBe(false);
  });

  it("invokes onCreate with search query when create button is clicked", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);
    search.value = "new-project";
    createButton.click();

    expect(onCreate).toHaveBeenCalledWith("new-project");
    expect(picker.isOpen).toBe(false);
  });

  it("handles keyboard navigation with ArrowDown, ArrowUp, and Enter", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);

    // Arrow down to first item
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    let selected = list.querySelector("[aria-selected='true']");
    expect(selected?.textContent).toContain("#chung");

    // Arrow down to second item
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    selected = list.querySelector("[aria-selected='true']");
    expect(selected?.textContent).toContain("#du-an-a");

    // Enter to pick
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onPick).toHaveBeenCalledWith(mockRooms[1]);
    expect(picker.isOpen).toBe(false);
  });

  it("closes when cancel or closeX is clicked", () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    const picker = new ChatPicker(dialog, elements, { onPick, onCreate });

    picker.open(mockRooms, null);
    expect(picker.isOpen).toBe(true);

    cancel.click();
    expect(picker.isOpen).toBe(false);

    picker.open(mockRooms, null);
    expect(picker.isOpen).toBe(true);

    closeX.click();
    expect(picker.isOpen).toBe(false);
  });
});
