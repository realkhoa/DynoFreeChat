/**
 * @file toolbar.ts
 * @brief Standard compact IDE toolbar for DynoFreeChat, styled after Visual Studio 2022.
 * @details Replaces the bloated Office Ribbon with a streamlined 28px standard action bar.
 */

import type { MenuAction } from "./menubar";
import { icon, type IconName } from "./icons";

/**
 * @brief Specification for a single compact toolbar button or separator item.
 */
export interface ToolbarItemSpec {
  /** MenuAction triggered when the button is clicked. Omit for separators. */
  action?: MenuAction;
  /** Visible label or tooltip text for accessibility. */
  label?: string;
  /** Icon name rendered inside the button. */
  icon?: IconName;
  /** Whether the item is a visual separator line. */
  separator?: boolean;
  /** Whether the button behaves as a toggle switch with aria-pressed. */
  toggle?: boolean;
  /** Whether the button is disabled upon initial rendering. */
  disabled?: boolean;
  /** Optional extended tooltip text. */
  title?: string;
}

/**
 * @brief Compact Standard Toolbar component matching Visual Studio 2022 aesthetics.
 * @details Renders action buttons directly within the top chrome and forwards clicks
 *          to a unified action handler.
 */
export class StandardToolbar {
  private readonly buttons = new Map<MenuAction, HTMLButtonElement[]>();

  /**
   * @brief Initializes and mounts the StandardToolbar to the root container.
   * @param root Container DOM element where toolbar items are rendered.
   * @param items Array of item specifications defining buttons and separators.
   * @param onAction Callback invoked when an action button is clicked.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly items: ToolbarItemSpec[],
    private readonly onAction: (action: MenuAction) => void,
  ) {
    this.paint();
  }

  /**
   * @brief Renders all toolbar items into the root container.
   * @return void
   */
  paint(): void {
    this.buttons.clear();
    const fragment = document.createDocumentFragment();

    for (const item of this.items) {
      if (item.separator) {
        const sep = document.createElement("span");
        sep.className = "toolbar-sep";
        sep.setAttribute("aria-hidden", "true");
        fragment.append(sep);
        continue;
      }

      if (!item.action) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.dataset.action = item.action;
      btn.title = item.title ?? item.label ?? item.action;
      btn.setAttribute("aria-label", item.title ?? item.label ?? item.action);
      btn.disabled = item.disabled === true;

      if (item.toggle) {
        btn.setAttribute("aria-pressed", "false");
      }

      if (item.icon) {
        btn.append(icon(item.icon, 14));
      }

      const action = item.action;
      btn.addEventListener("click", () => this.onAction(action));

      const list = this.buttons.get(action) ?? [];
      list.push(btn);
      this.buttons.set(action, list);

      fragment.append(btn);
    }

    this.root.replaceChildren(fragment);
  }

  /**
   * @brief Updates the enabled state of all buttons matching the specified action.
   * @param action Target MenuAction identifier.
   * @param enabled True to enable the button; false to disable.
   * @return void
   */
  setEnabled(action: MenuAction, enabled: boolean): void {
    const list = this.buttons.get(action);
    if (!list) return;
    for (const btn of list) {
      btn.disabled = !enabled;
    }
  }

  /**
   * @brief Updates the toggle checked state (aria-pressed) for a specific action.
   * @param action Target MenuAction identifier.
   * @param checked True to set aria-pressed="true", false for "false".
   * @return void
   */
  setChecked(action: MenuAction, checked: boolean): void {
    const list = this.buttons.get(action);
    if (!list) return;
    for (const btn of list) {
      btn.setAttribute("aria-pressed", String(checked));
    }
  }
}

/**
 * @brief Constructs the default configuration items for the Visual Studio standard toolbar.
 * @return Array of toolbar item specifications.
 */
export function defaultToolbarSpec(): ToolbarItemSpec[] {
  return [
    { action: "new-room", icon: "plus", title: "Tạo room mới (Ctrl+N)" },
    { action: "reload", icon: "refresh", title: "Nạp lại danh sách (F5)" },
    { separator: true },
    { action: "find", icon: "search", title: "Tìm trong log (Ctrl+F)" },
    { action: "follow", icon: "follow", title: "Bám đuôi log (Ctrl+End)", toggle: true },
    { action: "clear", icon: "trash", title: "Xoá log hiển thị (Ctrl+L)" },
    { separator: true },
    { action: "zoom-out", icon: "chevron-down", title: "Thu nhỏ cỡ chữ (Ctrl+Shift+,)" },
    { action: "zoom-in", icon: "chevron-right", title: "Phóng to cỡ chữ (Ctrl+Shift+.)" },
    { separator: true },
    { action: "nickname", icon: "person", title: "Đổi nickname…" },
    { action: "theme", icon: "theme", title: "Giao diện Dark / Light (Ctrl+Shift+D)", toggle: true },
    { action: "minimal", icon: "solution", title: "Chế độ tối giản (Ctrl+Shift+M)", toggle: true },
  ];
}
