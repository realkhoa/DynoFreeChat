export type MenuAction =
  | "reload"
  | "copy-url"
  | "nickname"
  | "clear"
  | "find"
  | "follow"
  | "sidebar"
  | "about";

export interface Menubar {
  setEnabled(action: MenuAction, enabled: boolean): void;
  closeAll(): void;
}

/** Classic menu bar: click to open, click outside or Escape to close. */
export function mountMenubar(root: HTMLElement, onAction: (action: MenuAction) => void): Menubar {
  const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>(".menu-trigger"));

  const closeAll = (): void => {
    for (const trigger of triggers) {
      trigger.setAttribute("aria-expanded", "false");
      const list = document.getElementById(`menu-${trigger.dataset.menu ?? ""}`);
      if (list !== null) list.hidden = true;
    }
  };

  const toggle = (trigger: HTMLButtonElement): void => {
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    closeAll();
    if (wasOpen) return;
    trigger.setAttribute("aria-expanded", "true");
    const list = document.getElementById(`menu-${trigger.dataset.menu ?? ""}`);
    if (list !== null) list.hidden = false;
  };

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const trigger = target.closest<HTMLButtonElement>(".menu-trigger");
    if (trigger !== null) {
      toggle(trigger);
      return;
    }

    const entry = target.closest<HTMLButtonElement>(".menu-entry");
    if (entry !== null) {
      closeAll();
      const action = entry.dataset.action as MenuAction | undefined;
      if (action !== undefined) onAction(action);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (target !== null && !root.contains(target)) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  return {
    closeAll,
    setEnabled(action: MenuAction, enabled: boolean): void {
      const entry = root.querySelector<HTMLButtonElement>(`.menu-entry[data-action="${action}"]`);
      if (entry !== null) entry.disabled = !enabled;
    },
  };
}
