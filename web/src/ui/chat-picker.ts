import type { RoomInfo } from "@dyno/shared/protocol";
import { formatAge } from "../lib/format";
import { icon } from "./icons";

/**
 * @brief DOM dependencies required to instantiate a ChatPicker.
 */
export interface ChatPickerElements {
  search: HTMLInputElement;
  list: HTMLElement;
  cancel: HTMLButtonElement;
  closeX: HTMLButtonElement;
  createButton: HTMLButtonElement;
}

/**
 * @brief Callbacks invoked when user selects or initiates room creation.
 */
export interface ChatPickerHandlers {
  onPick: (room: RoomInfo) => void;
  onCreate: (slugPrefill?: string) => void;
}

/**
 * @brief Modal dialog that allows users to search and select an existing chat room or create a new one.
 * @details Displays when the "+" button on the tabstrip is clicked. Supports real-time search filtering,
 * keyboard navigation, and direct room selection.
 */
export class ChatPicker {
  private rooms: RoomInfo[] = [];
  private currentSlug: string | null = null;
  private selectedIndex = -1;

  /**
   * @brief Initializes the ChatPicker dialog and attaches event listeners.
   * @param root The HTML dialog element container.
   * @param elements Child DOM elements for search input, list, and buttons.
   * @param handlers Callbacks for room selection and creation.
   */
  constructor(
    private readonly root: HTMLDialogElement,
    private readonly elements: ChatPickerElements,
    private readonly handlers: ChatPickerHandlers,
  ) {
    elements.search.addEventListener("input", () => {
      this.selectedIndex = -1;
      this.renderList();
    });

    elements.search.addEventListener("keydown", (event) => {
      this.handleSearchKey(event);
    });

    elements.cancel.addEventListener("click", () => this.close());
    elements.closeX.addEventListener("click", () => this.close());

    elements.createButton.addEventListener("click", () => {
      const query = this.elements.search.value.trim().toLowerCase();
      this.close();
      this.handlers.onCreate(query.length > 0 ? query : undefined);
    });

    root.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  /**
   * @brief Indicates whether the modal dialog is currently open.
   * @return True if dialog is visible.
   */
  get isOpen(): boolean {
    return this.root.open;
  }

  /**
   * @brief Opens the picker modal and displays the provided room list.
   * @param rooms List of active rooms from the server.
   * @param currentSlug The slug of the currently active room, if any.
   */
  open(rooms: RoomInfo[], currentSlug: string | null): void {
    this.rooms = rooms;
    this.currentSlug = currentSlug;
    this.selectedIndex = -1;
    this.elements.search.value = "";

    this.renderList();

    if (!this.root.open) {
      this.root.showModal();
    }
    this.elements.search.focus();
  }

  /**
   * @brief Updates the room list dynamically while the dialog is open.
   * @param rooms The updated list of rooms.
   * @param currentSlug The slug of the current room.
   */
  updateRooms(rooms: RoomInfo[], currentSlug: string | null): void {
    this.rooms = rooms;
    this.currentSlug = currentSlug;
    if (this.root.open) {
      this.renderList();
    }
  }

  /**
   * @brief Closes the modal dialog.
   */
  close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }

  /**
   * @brief Filters rooms according to current search query.
   * @return Filtered array of rooms.
   */
  private getFilteredRooms(): RoomInfo[] {
    const query = this.elements.search.value.trim().toLowerCase();
    if (query.length === 0) return this.rooms;
    return this.rooms.filter((room) => room.slug.toLowerCase().includes(query));
  }

  /**
   * @brief Renders room items in the picker list container.
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
          : "Chưa có room nào. Bấm nút bên dưới để tạo room!";
      list.append(empty);
      return;
    }

    filtered.forEach((room, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "picker-item";
      item.dataset.slug = room.slug;
      if (room.slug === this.currentSlug) {
        item.classList.add("is-current");
      }
      if (index === this.selectedIndex) {
        item.setAttribute("aria-selected", "true");
      }

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

      item.addEventListener("click", () => {
        this.close();
        this.handlers.onPick(room);
      });

      list.append(item);
    });
  }

  /**
   * @brief Handles keyboard navigation (ArrowUp, ArrowDown, Enter) within the search input.
   * @param event The keyboard event.
   */
  private handleSearchKey(event: KeyboardEvent): void {
    const filtered = this.getFilteredRooms();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % filtered.length;
        this.renderList();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) {
        this.selectedIndex = (this.selectedIndex - 1 + filtered.length) % filtered.length;
        this.renderList();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        this.selectedIndex >= 0 && this.selectedIndex < filtered.length
          ? filtered[this.selectedIndex]
          : filtered.length === 1
            ? filtered[0]
            : undefined;

      if (selected !== undefined) {
        this.close();
        this.handlers.onPick(selected);
      } else if (filtered.length === 0) {
        const query = this.elements.search.value.trim().toLowerCase();
        this.close();
        this.handlers.onCreate(query.length > 0 ? query : undefined);
      }
    }
  }
}
