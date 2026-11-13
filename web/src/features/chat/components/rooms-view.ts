/**
 * @file rooms-view.ts
 * @brief "Chat Rooms" document: pick an existing room or create one, in a tab.
 * @details Replaces the picker and create-room modals; the create form lives inline so
 * opening the tab is the only way in, and closing the tab cancels the flow.
 */

import type { RoomInfo } from "@dyno/shared/protocol";
import { formatAge } from "@/shared/lib/format";
import { icon } from "@/shared/ui/icons";

/** DOM elements owned by the rooms document. */
export interface RoomsViewElements {
  /** Search field filtering the list. */
  search: HTMLInputElement;
  /** List container receiving room items. */
  list: HTMLElement;
  /** New room name field. */
  createSlug: HTMLInputElement;
  /** New room password field (empty means open room). */
  createPass: HTMLInputElement;
  /** Submits the create form. */
  createButton: HTMLButtonElement;
  /** Error line under the create form. */
  createError: HTMLElement;
}

/** Callbacks for picking or creating a room. */
export interface RoomsViewHandlers {
  /** A room was selected in the list. */
  onPick: (room: RoomInfo) => void;
  /**
   * Create a room with the given slug and optional password.
   * @return Error text to display, or null when the room was created.
   */
  onCreate: (slug: string, pass: string) => Promise<string | null>;
}

/**
 * @brief Renders the room list and the inline create form.
 */
export class RoomsView {
  private rooms: RoomInfo[] = [];
  private currentSlug: string | null = null;
  private selectedIndex = -1;

  /**
   * @brief Wires search, keyboard navigation and the create form.
   * @param root The rooms panel element.
   * @param elements Child elements.
   * @param handlers Action callbacks.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly elements: RoomsViewElements,
    private readonly handlers: RoomsViewHandlers,
  ) {
    elements.search.addEventListener("input", () => {
      this.selectedIndex = -1;
      this.renderList();
    });
    elements.search.addEventListener("keydown", (event) => this.handleSearchKey(event));

    elements.createButton.addEventListener("click", () => void this.submitCreate());
    elements.createSlug.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.submitCreate();
    });
    elements.createPass.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.submitCreate();
    });
  }

  /**
   * @brief Shows the list for the given rooms and current room.
   * @param rooms Rooms from the server.
   * @param currentSlug Room currently open, if any.
   */
  show(rooms: RoomInfo[], currentSlug: string | null): void {
    this.rooms = rooms;
    this.currentSlug = currentSlug;
    this.selectedIndex = -1;
    this.elements.createError.textContent = "";
    this.renderList();
  }

  /**
   * @brief Refreshes the list without resetting the search field.
   * @param rooms Updated rooms.
   * @param currentSlug Room currently open.
   */
  updateRooms(rooms: RoomInfo[], currentSlug: string | null): void {
    this.rooms = rooms;
    this.currentSlug = currentSlug;
    if (!this.root.hidden) this.renderList();
  }

  /**
   * @brief Focuses the create form, optionally prefilled.
   * @param slugPrefill Suggested slug.
   */
  focusCreate(slugPrefill?: string): void {
    this.elements.createSlug.value = slugPrefill ?? "";
    this.elements.createError.textContent = "";
    this.elements.createSlug.focus();
    this.elements.createSlug.select();
  }

  /**
   * @brief Applies the search query to the room list.
   * @return Filtered rooms.
   */
  private getFilteredRooms(): RoomInfo[] {
    const query = this.elements.search.value.trim().toLowerCase();
    if (query.length === 0) return this.rooms;
    return this.rooms.filter((room) => room.slug.toLowerCase().includes(query));
  }

  /**
   * @brief Renders the room items.
   */
  private renderList(): void {
    const list = this.elements.list;
    const filtered = this.getFilteredRooms();
    list.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "picker-empty";
      const query = this.elements.search.value.trim();
      empty.textContent =
        query.length > 0
          ? `Không tìm thấy room nào khớp với "${query}".`
          : "Chưa có room nào. Dùng ô bên dưới để tạo room!";
      list.append(empty);
      return;
    }

    filtered.forEach((room, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "picker-item";
      item.dataset.slug = room.slug;
      if (room.slug === this.currentSlug) item.classList.add("is-current");
      if (index === this.selectedIndex) item.setAttribute("aria-selected", "true");

      const iconSpan = document.createElement("span");
      iconSpan.className = "picker-item-icon";
      iconSpan.append(icon(room.locked ? "lock" : "hash", 14));

      const nameSpan = document.createElement("span");
      nameSpan.className = "picker-item-name";
      nameSpan.textContent = `#${room.slug}`;

      const metaSpan = document.createElement("span");
      metaSpan.className = "picker-item-meta";
      const parts: string[] = [];
      if (room.locked) parts.push("🔒 có mật khẩu");
      if (room.lastSeen !== undefined) parts.push(formatAge(room.lastSeen));
      metaSpan.textContent = parts.join(" · ");

      item.append(iconSpan, nameSpan, metaSpan);
      item.addEventListener("click", () => this.handlers.onPick(room));
      list.append(item);
    });
  }

  /**
   * @brief Arrow/Enter navigation inside the search field.
   * @param event Key event.
   */
  private handleSearchKey(event: KeyboardEvent): void {
    const filtered = this.getFilteredRooms();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) return;
      this.selectedIndex = (this.selectedIndex + 1) % filtered.length;
      this.renderList();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      this.selectedIndex = (this.selectedIndex - 1 + filtered.length) % filtered.length;
      this.renderList();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        this.selectedIndex >= 0 && this.selectedIndex < filtered.length
          ? filtered[this.selectedIndex]
          : filtered.length === 1
            ? filtered[0]
            : undefined;
      if (selected !== undefined) this.handlers.onPick(selected);
    }
  }

  /**
   * @brief Validates and submits the inline create form.
   */
  private async submitCreate(): Promise<void> {
    const slug = this.elements.createSlug.value.trim().toLowerCase();
    const pass = this.elements.createPass.value;

    if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(slug)) {
      this.elements.createError.textContent = "Tên room 2–24 ký tự: a-z, 0-9, dấu gạch ngang.";
      return;
    }

    this.elements.createError.textContent = "";
    const error = await this.handlers.onCreate(slug, pass);
    if (error !== null) {
      this.elements.createError.textContent = error;
      return;
    }

    this.elements.createSlug.value = "";
    this.elements.createPass.value = "";
  }

  /**
   * @brief The rooms panel element.
   * @return Root element.
   */
  get element(): HTMLElement {
    return this.root;
  }
}
