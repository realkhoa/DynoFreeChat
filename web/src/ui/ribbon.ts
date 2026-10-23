import type { MenuAction } from "./menubar";
import { icon, type IconName } from "./icons";

/**
 * @brief Configuration specification for a single ribbon button.
 */
export interface RibbonButtonSpec {
  /** The menu action triggered when the button is clicked. */
  action: MenuAction;
  /** Visible label displayed on the button. */
  label: string;
  /** Icon name to render on the button. */
  icon: IconName;
  /** Tall button with a caption underneath, like the VS/Office big buttons. */
  big?: boolean;
  /** Renders as a toggle (`aria-pressed`). */
  toggle?: boolean;
  /** Whether the button starts disabled. */
  disabled?: boolean;
  /** Optional tooltip title overriding label. */
  title?: string;
}

/**
 * @brief Configuration specification for a group of buttons within a ribbon tab.
 */
export interface RibbonGroupSpec {
  /** The caption label displayed at the bottom of the group. */
  label: string;
  /** Array of button configurations within this group. */
  buttons: RibbonButtonSpec[];
}

/**
 * @brief Configuration specification for a ribbon tab containing multiple button groups.
 */
export interface RibbonTabSpec {
  /** Unique identifier for the tab. */
  id: string;
  /** Display label shown in the ribbon tab strip. */
  label: string;
  /** Groups belonging to this tab. */
  groups: RibbonGroupSpec[];
}

/**
 * @brief An Office/Visual Studio style Ribbon built from a declarative specification.
 * @details Buttons forward to the same action handler the menu bar uses.
 */
export class Ribbon {
  private readonly tabs = new Map<string, { tab: HTMLElement; panel: HTMLElement }>();
  private readonly buttons = new Map<MenuAction, HTMLButtonElement[]>();
  private active: string;

  /**
   * @brief Initializes the Ribbon component and renders the tabs and panels.
   * @param root The container element for the ribbon.
   * @param spec Array of tab specifications.
   * @param onAction Callback invoked when a ribbon button is clicked.
   * @param onCollapse Optional callback invoked when the collapse button is clicked.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly spec: RibbonTabSpec[],
    private readonly onAction: (action: MenuAction) => void,
    private readonly onCollapse?: () => void,
  ) {
    this.active = spec[0]?.id ?? "";
    this.paint();
  }

  /**
   * @brief Switches the active ribbon tab to the tab with identifier `id`.
   * @param id The identifier of the tab to activate.
   */
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

  /**
   * @brief Enables or disables all buttons corresponding to a specific `MenuAction`.
   * @param action The action whose buttons should be updated.
   * @param enabled Whether the buttons should be enabled.
   */
  setEnabled(action: MenuAction, enabled: boolean): void {
    for (const button of this.buttons.get(action) ?? []) button.disabled = !enabled;
  }

  /**
   * @brief Sets the toggle state (`aria-pressed`) on all buttons for a `MenuAction`.
   * @param action The action whose buttons should be updated.
   * @param checked The toggle checked state.
   */
  setChecked(action: MenuAction, checked: boolean): void {
    for (const button of this.buttons.get(action) ?? []) {
      button.setAttribute("aria-pressed", String(checked));
    }
  }

  /**
   * @brief Renders the ribbon tabstrip, panels, and optional collapse toggle.
   */
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

  /**
   * @brief Renders a single ribbon button group with its buttons and caption.
   * @param spec Specification of the group.
   * @return The constructed HTML element for the group.
   */
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

  /**
   * @brief Renders a single ribbon button and registers it in the action map.
   * @param spec Specification of the button.
   * @return The constructed HTML button element.
   */
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

/**
 * @brief Constructs the specification for the primary Chat ribbon tab.
 * @return Tab specification for chat rooms, messages, fonts, identity, and connections.
 */
function buildChatTabSpec(): RibbonTabSpec {
  return {
    id: "chat",
    label: "Chat",
    groups: [
      {
        label: "Rooms",
        buttons: [
          { action: "new-room", label: "Room mới", icon: "plus", big: true },
          { action: "reload", label: "Nạp lại", icon: "refresh" },
        ],
      },
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
      {
        label: "Cá nhân",
        buttons: [
          { action: "nickname", label: "Nickname", icon: "person", big: true },
          { action: "forget-pass", label: "Quên pass", icon: "lock" },
        ],
      },
      {
        label: "Kết nối",
        buttons: [
          { action: "reconnect", label: "Connect", icon: "play", big: true },
          { action: "copy-url", label: "Copy link", icon: "copy" },
        ],
      },
    ],
  };
}

/**
 * @brief Constructs the specification for the Collab ribbon tab (TicTacToe games and collaboration).
 * @return Tab specification for collaborative games and rooms.
 */
function buildCollabTabSpec(): RibbonTabSpec {
  return {
    id: "collab",
    label: "Collab",
    groups: [
      {
        label: "Trò chơi",
        buttons: [
          { action: "tictactoe", label: "Tic-Tac-Toe", icon: "hash", big: true, title: "Mở game cờ Tic-Tac-Toe" },
          { action: "game-create", label: "Tạo phòng", icon: "plus", title: "Tạo mã phòng mới để mời bạn" },
          { action: "game-join", label: "Vào bằng mã", icon: "room", title: "Nhập mã phòng để chơi chung" },
        ],
      },
      {
        label: "Chế độ",
        buttons: [
          { action: "game-ai", label: "Đấu với máy", icon: "person", big: true, title: "Luyện tập đơn người với máy" },
        ],
      },
    ],
  };
}

/**
 * @brief Constructs the specification for the Setting ribbon tab.
 * @return Tab specification for workspaces, notifications, themes, and help.
 */
function buildSettingTabSpec(): RibbonTabSpec {
  return {
    id: "setting",
    label: "Setting",
    groups: [
      {
        label: "Không gian",
        buttons: [
          { action: "sidebar", label: "Solution", icon: "solution", big: true },
          { action: "copy-url", label: "Copy link", icon: "copy" },
        ],
      },
      {
        label: "Thông báo",
        buttons: [
          { action: "notify", label: "Browser", icon: "bell", big: true, toggle: true },
          { action: "sound", label: "Âm thanh", icon: "sound", toggle: true },
        ],
      },
      {
        label: "Giao diện",
        buttons: [
          { action: "theme", label: "Dark / Light", icon: "theme", big: true, toggle: true },
          { action: "reload", label: "Tải lại", icon: "refresh" },
        ],
      },
      {
        label: "Hỗ trợ",
        buttons: [
          { action: "about", label: "Giới thiệu", icon: "info", big: true },
        ],
      },
    ],
  };
}

/**
 * @brief Default ribbon configuration with three main tabs: Chat, Collab, and Setting.
 * @return Array of ribbon tab specifications.
 */
export function defaultRibbonSpec(): RibbonTabSpec[] {
  return [buildChatTabSpec(), buildCollabTabSpec(), buildSettingTabSpec()];
}
