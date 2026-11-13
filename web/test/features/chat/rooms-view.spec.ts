// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomInfo } from "@dyno/shared/protocol";
import {
  RoomsView,
  type RoomsViewElements,
  type RoomsViewHandlers,
} from "@/features/chat/components/rooms-view";

interface Harness {
  view: RoomsView;
  elements: RoomsViewElements;
  handlers: RoomsViewHandlers;
  root: HTMLElement;
}

function makeHarness(): Harness {
  const root = document.createElement("section");
  root.id = "rooms-view";
  root.innerHTML = `
    <input id="picker-search" />
    <div id="picker-list"></div>
    <input id="rooms-create-slug" />
    <input id="rooms-create-pass" />
    <p id="rooms-create-error"></p>
    <button id="rooms-create-btn"></button>
  `;
  document.body.replaceChildren(root);

  const q = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const elements: RoomsViewElements = {
    search: q("picker-search"),
    list: q("picker-list"),
    createSlug: q("rooms-create-slug"),
    createPass: q("rooms-create-pass"),
    createButton: q("rooms-create-btn"),
    createError: q("rooms-create-error"),
  };

  const handlers: RoomsViewHandlers = {
    onPick: vi.fn(),
    onCreate: vi.fn(async () => null),
  };

  return { view: new RoomsView(root, elements, handlers), elements, handlers, root };
}

const ROOMS: RoomInfo[] = [
  { slug: "chung", locked: false, createdAt: 1, lastSeen: Date.now() - 60_000 },
  { slug: "team", locked: true, createdAt: 1, lastSeen: Date.now() - 3_600_000 },
];

describe("RoomsView", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.view.show(ROOMS, "team");
  });

  it("lists rooms and marks the current one", () => {
    const items = h.elements.list.querySelectorAll(".picker-item");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".picker-item-name")?.textContent).toBe("#chung");
    expect(items[1]?.classList.contains("is-current")).toBe(true);
  });

  it("filters the list as the user types", () => {
    h.elements.search.value = "chu";
    h.elements.search.dispatchEvent(new Event("input"));
    expect(h.elements.list.querySelectorAll(".picker-item")).toHaveLength(1);
    expect(h.elements.list.textContent).toContain("#chung");
  });

  it("shows an empty state when nothing matches", () => {
    h.elements.search.value = "khongco";
    h.elements.search.dispatchEvent(new Event("input"));
    expect(h.elements.list.querySelector(".picker-empty")).not.toBeNull();
  });

  it("picks a room on click", () => {
    h.elements.list.querySelector<HTMLButtonElement>(".picker-item")?.click();
    expect(h.handlers.onPick).toHaveBeenCalledWith(ROOMS[0]);
  });

  it("picks a room with Enter from the search field", () => {
    h.elements.search.value = "team";
    h.elements.search.dispatchEvent(new Event("input"));
    h.elements.search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.handlers.onPick).toHaveBeenCalledWith(ROOMS[1]);
  });

  it("validates the room name before creating", async () => {
    h.elements.createSlug.value = "A";
    h.elements.createButton.click();
    await Promise.resolve();

    expect(h.handlers.onCreate).not.toHaveBeenCalled();
    expect(h.elements.createError.textContent).toContain("2–24 ký tự");
  });

  it("creates a room and clears the form", async () => {
    h.elements.createSlug.value = "anh-em";
    h.elements.createPass.value = "matkhau";
    h.elements.createButton.click();
    await Promise.resolve();

    expect(h.handlers.onCreate).toHaveBeenCalledWith("anh-em", "matkhau");
    expect(h.elements.createSlug.value).toBe("");
    expect(h.elements.createPass.value).toBe("");
  });

  it("shows the server error and keeps the form filled", async () => {
    h.handlers.onCreate = vi.fn(async () => "tên room này có người dùng rồi");
    h.elements.createSlug.value = "chung";
    h.elements.createButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.elements.createError.textContent).toBe("tên room này có người dùng rồi");
    expect(h.elements.createSlug.value).toBe("chung");
  });

  it("prefills and focuses the create form", () => {
    h.view.focusCreate("demo");
    expect(h.elements.createSlug.value).toBe("demo");
    expect(document.activeElement).toBe(h.elements.createSlug);
  });

  it("refreshes the list only while the panel is visible", () => {
    h.root.hidden = true;
    h.view.updateRooms([], null);
    expect(h.elements.list.querySelectorAll(".picker-item")).toHaveLength(2);

    h.root.hidden = false;
    h.view.updateRooms([], null);
    expect(h.elements.list.querySelector(".picker-empty")).not.toBeNull();
  });
});
