import type { MenuAction } from "./menubar";
import { icon, type IconName } from "./icons";

export interface RibbonButtonSpec {
  action: MenuAction;
  label: string;
  icon: IconName;
  /** Tall button with a caption underneath, like the VS/Office big buttons. */
  big?: boolean;
  /** Renders as a toggle (`aria-pressed`). */
  toggle?: boolean;
  disabled?: boolean;
  title?: string;
}

export interface RibbonGroupSpec {
  label: string;
  buttons: RibbonButtonSpec[];
}

export interface RibbonTabSpec {
  id: string;
  label: string;
  groups: RibbonGroupSpec[];
}

/**
 * A ribbon built from a declarative spec. Buttons forward to the same action
 * handler the menu bar uses, so there is one implementation per command.
 */
export class Ribbon {
  private readonly tabs = new Map<string, { tab: HTMLElement; panel: HTMLElement }>();
  private readonly buttons = new Map<MenuAction, HTMLButtonElement[]>();
  private active: string;

  constructor(
    private readonly root: HTMLElement,
    private readonly spec: RibbonTabSpec[],
    private readonly onAction: (action: MenuAction) => void,
    private readonly onCollapse?: () => void,
  ) {
    this.active = spec[0]?.id ?? "";
    this.paint();
  }

  showTab(id: string): void {
    if (!this.tabs.has(id)) return;
    this.active = id;
    for (const [tabId, entry] of this.tabs) {
      const selected = tabId === id;
      entry.tab.setAttribute("aria-selected", String(selected));
      entry.tab.classList.toggle("is-active", selected);
      entry.panel.hidden = !selected;
    }
  }

  setEnabled(action: MenuAction, enabled: boolean): void {
    for (const button of this.buttons.get(action) ?? []) button.disabled = !enabled;
  }

  setChecked(action: MenuAction, checked: boolean): void {
    for (const button of this.buttons.get(action) ?? []) {
      button.setAttribute("aria-pressed", String(checked));
    }
  }

  private paint(): void {
    const tabStrip = document.createElement("div");
    tabStrip.className = "ribbon-tabs";
    tabStrip.setAttribute("role", "tablist");

    const body = document.createElement("div");
    body.className = "ribbon-body";

    for (const tabSpec of this.spec) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "ribbon-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(tabSpec.id === this.active));
      tab.textContent = tabSpec.label;
      if (tabSpec.id === this.active) tab.classList.add("is-active");
      tab.addEventListener("click", () => this.showTab(tabSpec.id));
      tabStrip.append(tab);

      const panel = document.createElement("div");
      panel.className = "ribbon-panel";
      panel.hidden = tabSpec.id !== this.active;

      for (const groupSpec of tabSpec.groups) panel.append(this.renderGroup(groupSpec));

      body.append(panel);
      this.tabs.set(tabSpec.id, { tab, panel });
    }

    if (this.onCollapse !== undefined) {
      const spacer = document.createElement("span");
      spacer.className = "ribbon-tabs-spacer";
      const collapse = document.createElement("button");
      collapse.type = "button";
      collapse.className = "ribbon-collapse";
      collapse.title = "Ẩn ribbon (Ctrl+F1)";
      collapse.setAttribute("aria-label", "Ẩn ribbon");
      collapse.textContent = "⌃";
      collapse.addEventListener("click", () => this.onCollapse?.());
      tabStrip.append(spacer, collapse);
    }

    this.root.replaceChildren(tabStrip, body);
  }

  private renderGroup(spec: RibbonGroupSpec): HTMLElement {
    const group = document.createElement("div");
    group.className = "ribbon-group";

    const body = document.createElement("div");
    body.className = "ribbon-group-body";
    for (const buttonSpec of spec.buttons) body.append(this.renderButton(buttonSpec));

    const label = document.createElement("span");
    label.className = "ribbon-group-label";
    label.textContent = spec.label;

    group.append(body, label);
    return group;
  }

  private renderButton(spec: RibbonButtonSpec): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = spec.big === true ? "ribbon-button ribbon-button--big" : "ribbon-button";
    button.title = spec.title ?? spec.label;
    button.disabled = spec.disabled === true;
    if (spec.toggle === true) button.setAttribute("aria-pressed", "false");

    button.append(icon(spec.icon, spec.big === true ? 20 : 16));

    const caption = document.createElement("span");
    caption.className = "ribbon-button-label";
    caption.textContent = spec.label;
    button.append(caption);

    button.addEventListener("click", () => this.onAction(spec.action));

    const list = this.buttons.get(spec.action) ?? [];
    list.push(button);
    this.buttons.set(spec.action, list);
    return button;
  }
}

/** The ribbon as it ships: every button is a real command. */
export function defaultRibbonSpec(): RibbonTabSpec[] {
  return [
    {
      id: "home",
      label: "Home",
      groups: [
        {
          label: "Rooms",
          buttons: [
            { action: "new-room", label: "Room mới", icon: "plus", big: true },
            { action: "reload", label: "Nạp lại", icon: "refresh" },
          ],
        },
        {
          label: "Kết nối",
          buttons: [
            { action: "reconnect", label: "Connect", icon: "play", big: true },
            { action: "copy-url", label: "Copy link", icon: "copy" },
          ],
        },
        {
          label: "Cá nhân",
          buttons: [
            { action: "nickname", label: "Nickname", icon: "person", big: true },
            { action: "forget-pass", label: "Quên pass", icon: "lock" },
          ],
        },
      ],
    },
    {
      id: "room",
      label: "Room",
      groups: [
        {
          label: "Tin nhắn",
          buttons: [
            { action: "follow", label: "Bám đuôi", icon: "follow", toggle: true },
            { action: "clear", label: "Xoá log", icon: "trash" },
            { action: "find", label: "Tìm", icon: "search" },
          ],
        },
        {
          label: "Cỡ chữ",
          buttons: [
            { action: "zoom-out", label: "Nhỏ hơn", icon: "chevron-down" },
            { action: "zoom-in", label: "Lớn hơn", icon: "chevron-right" },
          ],
        },
      ],
    },
    {
      id: "view",
      label: "View",
      groups: [
        {
          label: "Giao diện",
          buttons: [
            { action: "theme", label: "Dark / Light", icon: "theme", big: true, toggle: true },
            { action: "sidebar", label: "Solution", icon: "solution" },
          ],
        },
        {
          label: "Cửa sổ",
          buttons: [
            { action: "reload", label: "Tải lại", icon: "refresh" },
            { action: "about", label: "Giới thiệu", icon: "info" },
          ],
        },
      ],
    },
    {
      id: "tools",
      label: "Tools",
      groups: [
        {
          label: "Thông báo",
          buttons: [
            { action: "notify", label: "Browser", icon: "bell", big: true, toggle: true },
            { action: "sound", label: "Âm thanh", icon: "sound", toggle: true },
          ],
        },
        {
          label: "Liên kết",
          buttons: [
            { action: "copy-url", label: "Copy link", icon: "copy" },
            { action: "find", label: "Tìm trong log", icon: "search" },
          ],
        },
      ],
    },
  ];
}
