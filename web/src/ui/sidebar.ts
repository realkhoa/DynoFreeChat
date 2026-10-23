import type { RoomInfo } from "@dyno/shared/protocol";
import { formatAge } from "../lib/format";
import { icon } from "./icons";

/**
 * The project browser: solution → project → rooms, the same three levels a
 * Solution Explorer shows. Collapse state lives here, not in the caller.
 */
export class Sidebar {
  private rooms: RoomInfo[] = [];
  private current: string | null = null;
  private onPick: ((room: RoomInfo) => void) | null = null;
  private query = "";
  private solutionOpen = true;
  private groupOpen = true;

  constructor(
    private readonly tree: HTMLElement,
    private readonly foot: HTMLElement,
  ) {}

  render(rooms: RoomInfo[], current: string | null, onPick: (room: RoomInfo) => void): void {
    this.rooms = rooms;
    this.current = current;
    this.onPick = onPick;
    this.paint();
  }

  setFoot(text: string): void {
    this.foot.textContent = text;
  }

  /** Filters the tree by room name, the way Solution Explorer search does. */
  setQuery(query: string): void {
    const next = query.trim().toLowerCase();
    if (next === this.query) return;
    this.query = next;
    this.paint();
  }

  get filtering(): boolean {
    return this.query.length > 0;
  }

  private visibleRooms(): RoomInfo[] {
    if (this.query.length === 0) return this.rooms;
    return this.rooms.filter((room) => room.slug.toLowerCase().includes(this.query));
  }

  collapseAll(): void {
    this.solutionOpen = false;
    this.groupOpen = false;
    this.paint();
  }

  expandAll(): void {
    this.solutionOpen = true;
    this.groupOpen = true;
    this.paint();
  }

  private paint(): void {
    const fragment = document.createDocumentFragment();
    fragment.append(this.solutionRow());

    if (this.solutionOpen) {
      fragment.append(this.groupRow());
      if (this.groupOpen) {
        const rooms = this.visibleRooms();
        if (rooms.length === 0) {
          const empty = document.createElement("li");
          empty.className = "tree-empty";
          empty.textContent = this.filtering ? "không khớp room nào" : "chưa có room nào";
          fragment.append(empty);
        } else {
          for (const room of rooms) fragment.append(this.roomRow(room));
        }
      }
    }

    this.tree.replaceChildren(fragment);
  }

  private node(
    depth: number,
    expandable: boolean,
    open: boolean,
    onToggle: (() => void) | null,
  ): { row: HTMLLIElement; hit: HTMLButtonElement } {
    const row = document.createElement("li");
    row.className = "tree-row";
    row.dataset.depth = String(depth);
    row.setAttribute("role", "treeitem");
    if (expandable) row.setAttribute("aria-expanded", String(open));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    if (expandable) {
      toggle.append(icon(open ? "chevron-down" : "chevron-right"));
      toggle.setAttribute("aria-label", open ? "Thu gọn" : "Mở rộng");
      toggle.addEventListener("click", () => onToggle?.());
    } else {
      toggle.disabled = true;
      toggle.tabIndex = -1;
      toggle.setAttribute("aria-hidden", "true");
    }

    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "tree-hit";

    row.append(toggle, hit);
    return { row, hit };
  }

  private solutionRow(): HTMLLIElement {
    const { row, hit } = this.node(0, true, this.solutionOpen, () => {
      this.solutionOpen = !this.solutionOpen;
      this.paint();
    });
    row.classList.add("tree-row--root");

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    glyph.append(icon("solution"));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = "DynoFreeChat";

    const meta = document.createElement("span");
    meta.className = "tree-meta";
    meta.textContent = `${this.visibleRooms().length} room`;

    hit.append(glyph, label, meta);
    hit.addEventListener("click", () => {
      this.solutionOpen = !this.solutionOpen;
      this.paint();
    });
    return row;
  }

  private groupRow(): HTMLLIElement {
    const { row, hit } = this.node(1, true, this.groupOpen, () => {
      this.groupOpen = !this.groupOpen;
      this.paint();
    });

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    glyph.append(icon("room"));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = "Rooms";

    hit.append(glyph, label);
    hit.addEventListener("click", () => {
      this.groupOpen = !this.groupOpen;
      this.paint();
    });
    return row;
  }

  private roomRow(room: RoomInfo): HTMLLIElement {
    const { row, hit } = this.node(2, false, true, null);
    row.classList.add("tree-row--room");
    if (room.slug === this.current) row.setAttribute("aria-selected", "true");

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    glyph.dataset.icon = room.locked ? "lock" : "hash";
    glyph.append(icon(room.locked ? "lock" : "hash"));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = room.slug;
    label.title = room.locked ? `#${room.slug} — có mật khẩu` : `#${room.slug}`;

    const age = document.createElement("span");
    age.className = "tree-meta";
    age.textContent = formatAge(room.lastSeen);

    hit.append(glyph, label, age);
    hit.addEventListener("click", () => this.onPick?.(room));
    return row;
  }
}
