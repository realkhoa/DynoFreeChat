import type { RoomInfo } from "@dyno/shared/protocol";
import { formatAge } from "../lib/format";
import { icon, type IconName } from "./icons";

export interface ExplorerItem {
  label: string;
  kind: "room" | "file";
  /** Room slug, for rooms only. */
  slug?: string;
  locked?: boolean;
  lastSeen?: number;
  /** Fake tree entries say so in their tooltip. */
  placeholder?: string;
}

export interface ExplorerGroup {
  label: string;
  items: ExplorerItem[];
}

export interface ExplorerSolution {
  id: string;
  label: string;
  meta?: string;
  placeholder?: string;
  groups: ExplorerGroup[];
}

/**
 * Filler solutions. A project browser with a single node is what made the panel
 * look empty; these give it the shape of a real workspace without pretending to
 * hold data — clicking them says so.
 */
export const PLACEHOLDER_SOLUTIONS: ExplorerSolution[] = [
  {
    id: "collab",
    label: "Collab",
    placeholder: "solution mẫu, chưa nối dữ liệu",
    groups: [
      {
        label: "Web",
        items: [
          { label: "chat-ui", kind: "file", placeholder: "placeholder" },
          { label: "design-system", kind: "file", placeholder: "placeholder" },
          { label: "api-gateway", kind: "file", placeholder: "placeholder" },
        ],
      },
      {
        label: "Services",
        items: [
          { label: "presence", kind: "file", placeholder: "placeholder" },
          { label: "notifications", kind: "file", placeholder: "placeholder" },
        ],
      },
    ],
  },
  {
    id: "vinabim",
    label: "VinaBIM",
    placeholder: "solution mẫu, chưa nối dữ liệu",
    groups: [
      {
        label: "Models",
        items: [
          { label: "ifc-import", kind: "file", placeholder: "placeholder" },
          { label: "clash-detect", kind: "file", placeholder: "placeholder" },
          { label: "4d-schedule", kind: "file", placeholder: "placeholder" },
        ],
      },
      {
        label: "Reports",
        items: [{ label: "pdf-export", kind: "file", placeholder: "placeholder" }],
      },
    ],
  },
];

/** The project browser: solutions → groups → rooms (plus placeholder trees). */
export class Sidebar {
  private rooms: RoomInfo[] = [];
  private current: string | null = null;
  private onPick: ((room: RoomInfo) => void) | null = null;
  private onNotice: ((message: string) => void) | null = null;
  private query = "";
  private readonly closedSolutions = new Set<string>();
  private readonly closedGroups = new Set<string>();

  constructor(
    private readonly tree: HTMLElement,
    private readonly foot: HTMLElement,
  ) {}

  render(
    rooms: RoomInfo[],
    current: string | null,
    onPick: (room: RoomInfo) => void,
    onNotice?: (message: string) => void,
  ): void {
    this.rooms = rooms;
    this.current = current;
    this.onPick = onPick;
    this.onNotice = onNotice ?? null;
    this.paint();
  }

  setFoot(text: string): void {
    this.foot.textContent = text;
  }

  /** Filters rooms by name, the way Solution Explorer search does. */
  setQuery(query: string): void {
    const next = query.trim().toLowerCase();
    if (next === this.query) return;
    this.query = next;
    this.paint();
  }

  get filtering(): boolean {
    return this.query.length > 0;
  }

  collapseAll(): void {
    for (const solution of this.solutions()) this.closedSolutions.add(solution.id);
    this.paint();
  }

  expandAll(): void {
    this.closedSolutions.clear();
    this.closedGroups.clear();
    this.paint();
  }

  private visibleRooms(): RoomInfo[] {
    if (this.query.length === 0) return this.rooms;
    return this.rooms.filter((room) => room.slug.toLowerCase().includes(this.query));
  }

  private solutions(): ExplorerSolution[] {
    const locked = this.rooms.filter((room) => room.locked).length;
    const real: ExplorerSolution = {
      id: "dynofreechat",
      label: "DynoFreeChat",
      meta: `${this.visibleRooms().length} room${locked > 0 ? ` · ${locked} khoá` : ""}`,
      groups: [
        {
          label: "Rooms",
          items: this.visibleRooms().map((room) => ({
            label: room.slug,
            kind: "room" as const,
            slug: room.slug,
            locked: room.locked,
            lastSeen: room.lastSeen,
          })),
        },
      ],
    };

    // While searching, hide the placeholder solutions so results stay readable.
    return this.filtering ? [real] : [real, ...PLACEHOLDER_SOLUTIONS];
  }

  private paint(): void {
    const fragment = document.createDocumentFragment();

    for (const solution of this.solutions()) {
      const solutionOpen = !this.closedSolutions.has(solution.id);
      fragment.append(this.solutionRow(solution, solutionOpen));
      if (!solutionOpen) continue;

      for (const group of solution.groups) {
        const groupKey = `${solution.id}/${group.label}`;
        const groupOpen = !this.closedGroups.has(groupKey);
        fragment.append(this.groupRow(solution, group, groupOpen));
        if (!groupOpen) continue;

        if (group.items.length === 0) {
          const empty = document.createElement("li");
          empty.className = "tree-empty";
          empty.textContent = this.filtering ? "không khớp room nào" : "chưa có room nào";
          fragment.append(empty);
          continue;
        }

        for (const item of group.items) fragment.append(this.itemRow(solution, item));
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

  private solutionRow(solution: ExplorerSolution, open: boolean): HTMLLIElement {
    const toggleSolution = (): void => {
      if (this.closedSolutions.has(solution.id)) this.closedSolutions.delete(solution.id);
      else this.closedSolutions.add(solution.id);
      this.paint();
    };

    const { row, hit } = this.node(0, true, open, toggleSolution);
    row.classList.add("tree-row--root");
    if (solution.placeholder !== undefined) row.classList.add("tree-row--placeholder");

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    glyph.dataset.icon = solution.placeholder === undefined ? "solution" : "file";
    glyph.append(icon(solution.placeholder === undefined ? "solution" : "file"));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = solution.label;
    if (solution.placeholder !== undefined) label.title = `${solution.label} — ${solution.placeholder}`;

    const meta = document.createElement("span");
    meta.className = "tree-meta";
    meta.textContent = solution.meta ?? "";

    hit.append(glyph, label, meta);
    hit.addEventListener("click", toggleSolution);
    return row;
  }

  private groupRow(solution: ExplorerSolution, group: ExplorerGroup, open: boolean): HTMLLIElement {
    const key = `${solution.id}/${group.label}`;
    const toggleGroup = (): void => {
      if (this.closedGroups.has(key)) this.closedGroups.delete(key);
      else this.closedGroups.add(key);
      this.paint();
    };

    const { row, hit } = this.node(1, true, open, toggleGroup);
    row.classList.add("tree-row--group");
    if (solution.placeholder !== undefined) row.classList.add("tree-row--placeholder");

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    glyph.append(icon("folder"));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = group.label;

    hit.append(glyph, label);
    hit.addEventListener("click", toggleGroup);
    return row;
  }

  private itemRow(solution: ExplorerSolution, item: ExplorerItem): HTMLLIElement {
    const { row, hit } = this.node(2, false, true, null);

    if (item.kind === "room") {
      row.classList.add("tree-row--room");
      if (item.slug === this.current) row.setAttribute("aria-selected", "true");
    } else {
      row.classList.add("tree-row--file");
      if (item.placeholder !== undefined) row.classList.add("tree-row--placeholder");
    }

    const glyph = document.createElement("span");
    glyph.className = "tree-icon";
    const iconName: IconName = item.kind === "room" ? (item.locked === true ? "lock" : "hash") : "file";
    glyph.dataset.icon = iconName;
    glyph.append(icon(iconName));

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = item.label;

    const meta = document.createElement("span");
    meta.className = "tree-meta";
    if (item.kind === "room" && item.lastSeen !== undefined) meta.textContent = formatAge(item.lastSeen);

    hit.append(glyph, label, meta);
    hit.title = item.placeholder === undefined ? `#${item.label}` : `${item.label} — ${item.placeholder}`;
    hit.addEventListener("click", () => {
      if (item.placeholder !== undefined || item.slug === undefined) {
        this.onNotice?.(`${solution.label} / ${item.label} là placeholder — chưa nối dữ liệu`);
        return;
      }
      const room = this.rooms.find((candidate) => candidate.slug === item.slug);
      if (room !== undefined) this.onPick?.(room);
    });

    return row;
  }
}
