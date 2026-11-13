/**
 * @file doc-tabs.ts
 * @brief Document tabs for tool views (settings, rooms), styled like the chat tab.
 * @details Each tool renders as a document in the editor area instead of a modal, so
 * only one view is visible at a time and closing a tab is the same gesture everywhere.
 */

import { icon, setIconButton, type IconName } from "./icons";

/** One document tab and the panel it shows. */
export interface DocTabSpec {
  /** Stable id; opening the same id again focuses the existing tab. */
  id: string;
  /** Tab label, e.g. "Settings". */
  label: string;
  /** Panel element appended to the editor host. */
  panel: HTMLElement;
  /** Optional icon name from the shared icon set. */
  icon?: IconName;
}

/** Coordination callbacks so the host can hide its own views. */
export interface DocTabsHandlers {
  /** A document tab was activated; the host must hide the chat/collab views. */
  onActivate: (id: string, label: string) => void;
  /** The last document tab was deactivated; nothing needs hiding. */
  onDeactivate: () => void;
  /** The active document tab closed; the host picks the next view. */
  onClose: (id: string) => void;
}

/** Applies the `hidden` state through the `hidden` attribute (no CSS override). */
function setHidden(element: HTMLElement, hidden: boolean): void {
  if (hidden) element.setAttribute("hidden", "");
  else element.removeAttribute("hidden");
}

/**
 * @brief Owns the tool document tabs: creation, activation and teardown.
 */
export class DocTabs {
  private readonly entries = new Map<string, { tab: HTMLElement; panel: HTMLElement }>();
  private active: string | null = null;

  /**
   * @brief Stores the DOM hosts and handlers.
   * @param strip Tab strip that receives the tab buttons.
   * @param host Editor area that receives the panels.
   * @param newTabButton The "+" button; tabs are inserted before it.
   * @param handlers Host coordination callbacks.
   */
  constructor(
    private readonly strip: HTMLElement,
    private readonly host: HTMLElement,
    private readonly newTabButton: HTMLElement,
    private readonly handlers: DocTabsHandlers,
  ) {}

  /**
   * @brief Opens a document tab, reusing it when it already exists.
   * @param spec Tab description and panel.
   */
  open(spec: DocTabSpec): void {
    let entry = this.entries.get(spec.id);
    if (entry === undefined) {
      entry = this.create(spec);
      this.entries.set(spec.id, entry);
    }
    this.activate(spec.id);
  }

  /**
   * @brief Brings one document tab to the front.
   * @param id Tab id.
   */
  activate(id: string): void {
    const target = this.entries.get(id);
    if (target === undefined) return;

    for (const [key, entry] of this.entries) {
      const selected = key === id;
      entry.tab.setAttribute("aria-selected", String(selected));
      setHidden(entry.panel, !selected);
    }

    this.active = id;
    this.handlers.onActivate(id, target.tab.dataset.label ?? id);
  }

  /**
   * @brief Hides every document tab, for when the chat or collab tab takes over.
   */
  deactivate(): void {
    if (this.active === null) return;
    for (const entry of this.entries.values()) {
      entry.tab.setAttribute("aria-selected", "false");
      setHidden(entry.panel, true);
    }
    this.active = null;
    this.handlers.onDeactivate();
  }

  /**
   * @brief Closes a document tab and drops its panel.
   * @param id Tab id.
   */
  close(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;

    entry.tab.remove();
    entry.panel.remove();
    this.entries.delete(id);

    if (this.active !== id) return;
    this.active = null;
    this.handlers.onClose(id);
  }

  /**
   * @brief Id of the visible document tab, if any.
   * @return Active id or null.
   */
  get activeId(): string | null {
    return this.active;
  }

  /**
   * @brief Label of the visible document tab, if any.
   * @return Active label or null.
   */
  get activeLabel(): string | null {
    if (this.active === null) return null;
    return this.entries.get(this.active)?.tab.dataset.label ?? this.active;
  }

  /**
   * @brief Builds the tab button and wires its close control.
   * @param spec Tab description.
   * @return The created entry.
   */
  private create(spec: DocTabSpec): { tab: HTMLElement; panel: HTMLElement } {
    const tab = document.createElement("div");
    tab.className = "tab tab--doc";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("tabindex", "0");
    tab.dataset.docId = spec.id;
    tab.dataset.label = spec.label;

    const iconSpan = document.createElement("span");
    iconSpan.className = "tab-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.append(icon(spec.icon ?? "file", 14));

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = spec.label;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tab-close";
    closeButton.setAttribute("aria-label", `Đóng ${spec.label}`);
    closeButton.title = `Đóng ${spec.label}`;
    setIconButton(closeButton, "close", `Đóng ${spec.label}`);

    tab.append(iconSpan, label, closeButton);
    this.strip.insertBefore(tab, this.newTabButton);

    tab.addEventListener("click", (event) => {
      if (event.target === closeButton) return;
      this.activate(spec.id);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.activate(spec.id);
      } else if (event.key === "Delete") {
        event.preventDefault();
        this.close(spec.id);
      }
    });
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.close(spec.id);
    });

    spec.panel.hidden = true;
    spec.panel.dataset.docId = spec.id;
    this.host.append(spec.panel);

    return { tab, panel: spec.panel };
  }
}
