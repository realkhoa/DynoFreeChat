import type { RoomInfo } from "@dyno/shared/protocol";
import { formatAge } from "../lib/format";

/** Solution-Explorer-style room list. */
export class Sidebar {
  constructor(
    private readonly list: HTMLElement,
    private readonly foot: HTMLElement,
  ) {}

  render(rooms: RoomInfo[], current: string | null, onPick: (room: RoomInfo) => void): void {
    const fragment = document.createDocumentFragment();

    for (const room of rooms) {
      const item = document.createElement("li");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "room-item";
      button.dataset.slug = room.slug;
      button.title = room.locked ? `#${room.slug} — có mật khẩu` : `#${room.slug}`;
      if (room.slug === current) button.setAttribute("aria-current", "true");

      const glyph = document.createElement("span");
      glyph.className = room.locked ? "room-lock" : "room-age";
      glyph.textContent = room.locked ? "🔒" : "#";
      glyph.setAttribute("aria-hidden", "true");

      const slug = document.createElement("span");
      slug.className = "room-slug";
      slug.textContent = room.slug;

      const age = document.createElement("span");
      age.className = "room-age";
      age.textContent = formatAge(room.lastSeen);

      button.append(glyph, slug, age);
      button.addEventListener("click", () => onPick(room));
      item.append(button);
      fragment.append(item);
    }

    if (rooms.length === 0) {
      const item = document.createElement("li");
      item.className = "room-item";
      item.style.color = "var(--fg-faint)";
      item.textContent = "chưa có room nào";
      fragment.append(item);
    }

    this.list.replaceChildren(fragment);
  }

  setFoot(text: string): void {
    this.foot.textContent = text;
  }
}
