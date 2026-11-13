/**
 * Tiny inline icon set: 16px grid, one stroke weight, `currentColor`.
 *
 * Visual Studio draws its own 16px monochrome glyphs; emoji from the system
 * font is what makes a UI read as "web page" instead of "IDE".
 */
export type IconName =
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "lock"
  | "hash"
  | "plus"
  | "close"
  | "follow"
  | "clear"
  | "solution"
  | "room"
  | "refresh"
  | "trash"
  | "collapse"
  | "folder"
  | "file"
  | "pin"
  | "undo"
  | "redo"
  | "save"
  | "bell"
  | "reply"
  | "copy"
  | "person"
  | "play"
  | "sound"
  | "theme"
  | "info"
  | "dot";

const PATHS: Record<IconName, string> = {
  search: '<circle cx="7.2" cy="7.2" r="4.1"/><path d="M10.3 10.3 13.4 13.4"/>',
  "chevron-down": '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  "chevron-right": '<path d="M6.5 4.5 10 8l-3.5 3.5"/>',
  lock: '<rect x="4.2" y="7.2" width="7.6" height="5.4" rx="0.8"/><path d="M6 7.2V5.6a2 2 0 0 1 4 0v1.6"/>',
  hash: '<path d="M6.4 3.4 5.2 12.6M10.8 3.4 9.6 12.6M3.6 6.2h9M3 9.8h9"/>',
  plus: '<path d="M8 3.6v8.8M3.6 8h8.8"/>',
  close: '<path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"/>',
  follow: '<path d="M8 3.2v7.2M5 7.6 8 10.8l3-3.2M3.4 12.6h9.2"/>',
  clear: '<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1"/><path d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4"/>',
  solution: '<rect x="3" y="3.4" width="7.2" height="9.2" rx="0.8"/><path d="M12.4 4.6v7.2"/><path d="M10.2 6.2v3.6"/>',
  room: '<path d="M2.6 5.4h4.3l1.2 1.6h5.3v5c0 .5-.4.9-.9.9H3.5a.9.9 0 0 1-.9-.9V5.4Z"/>',
  refresh: '<path d="M12.6 8a4.6 4.6 0 1 1-1.5-3.4"/><path d="M12.8 3.4v2.4h-2.4"/>',
  trash:
    '<path d="M3.4 4.8h9.2M6.4 4.8V3.6h3.2v1.2M4.6 4.8l.6 8h5.6l.6-8"/><path d="M6.8 7v3.4M9.2 7v3.4"/>',
  collapse: '<path d="M10.6 3.4v9.2"/><path d="M8 8H3.6"/><path d="M5.6 6 3.6 8l2 2"/>',
  folder: '<path d="M2.4 4.9h4.2l1.2 1.5h5.8v5.6c0 .5-.4.9-.9.9H3.3a.9.9 0 0 1-.9-.9V4.9Z"/>',
  file: '<path d="M4.2 2.6h5l3 3v7.8H4.2Z"/><path d="M9 2.6v3.2h3.2"/>',
  pin: '<path d="M6.2 2.8h3.6l-.7 3 2.1 2.1H4.8l2.1-2.1-.7-3Z"/><path d="M8 7.9v4.9"/>',
  undo: '<path d="M5.6 5.2 3 7.4l2.6 2.2"/><path d="M3 7.4h6a3 3 0 0 1 0 6H6.6"/>',
  redo: '<path d="M10.4 5.2 13 7.4l-2.6 2.2"/><path d="M13 7.4H7a3 3 0 0 0 0 6h2.4"/>',
  save: '<path d="M3 3h8.2L13 4.8V13H3Z"/><path d="M5.4 3v3.4h5.2V3"/><path d="M5.4 13v-3.6h5.2V13"/>',
  bell: '<path d="M4.3 6.7a3.7 3.7 0 0 1 7.4 0c0 2.3.5 3.3 1.1 4H3.2c.6-.7 1.1-1.7 1.1-4Z"/><path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0"/>',
  reply: '<path d="M6.2 4.4 3 7.5l3.2 3.1"/><path d="M3 7.5h6a3.4 3.4 0 0 1 0 6.8H6.4"/>',
  copy: '<rect x="5.4" y="5.4" width="7.2" height="7.2" rx="1"/><path d="M10.6 5.4V4.2a1 1 0 0 0-1-1H4.2a1 1 0 0 0-1 1v5.4a1 1 0 0 0 1 1h1.2"/>',
  person: '<circle cx="8" cy="5.6" r="2.6"/><path d="M3.4 13.4c0-2.6 2.1-4.2 4.6-4.2s4.6 1.6 4.6 4.2"/>',
  play: '<path d="M5.2 3.6 12.4 8l-7.2 4.4Z"/>',
  sound: '<path d="M4.4 6.4h2.2L10 4v8L6.6 9.6H4.4Z"/><path d="M12 6.4a2.4 2.4 0 0 1 0 3.2"/>',
  theme: '<circle cx="8" cy="8" r="4.8"/><path d="M8 3.2v9.6" /><path d="M8 3.2a4.8 4.8 0 0 1 0 9.6Z" fill="currentColor" stroke="none"/>',
  info: '<circle cx="8" cy="8" r="5"/><path d="M8 7.2v3.4"/><circle cx="8" cy="5.4" r="0.6" fill="currentColor" stroke="none"/>',
  dot: '<circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none"/>',
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("ico");
  svg.innerHTML = PATHS[name];
  svg.setAttribute("shape-rendering", "geometricPrecision");
  return svg;
}

/** Replaces a button's content with one icon, keeping an accessible name. */
export function setIconButton(button: HTMLElement, name: IconName, label: string): void {
  button.replaceChildren(icon(name));
  button.setAttribute("aria-label", label);
  button.title = label;
}
