# UX Modernization & Visual Studio 2022 Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform DynoFreeChat into a sleek, authentic Visual Studio 2022 dark/light experience by removing the bloated Office Ribbon, eliminating duplicate search boxes and buttons, implementing a floating Find Bar (`Ctrl+F`), and reclaiming >60% of top vertical screen real estate for the chat log.

**Architecture:**
- Modern 3-tier chrome: Titlebar (with global search) -> Menubar + Compact Standard Toolbar -> Unified Document Tabstrip & Breadcrumb.
- Floating Find Bar inside the editor log viewport (`Ctrl+F`) replacing the permanent breadcrumb search row.
- Reusable `StandardToolbar` component replacing `Ribbon`, retaining full compatibility with existing `MenuAction` callbacks.
- Centralized Room actions in Solution Explorer and keyboard shortcuts (`Ctrl+N`, `F5`).

**Tech Stack:**
- TypeScript 5+ / 7, Vite, Native DOM APIs, CSS Grid & Flexbox, Vitest for unit testing.

## Global Constraints
- All source code, docstrings, comments, tests, and commit messages MUST be written strictly in English (Rule 7).
- 100% Doxygen / TSDoc coverage (`@brief`, `@param`, `@return`) on all new or modified functions and classes (Rule 5).
- Zero broken existing tests: `npm test` across all workspaces (`shared`, `worker`, `web`) must pass cleanly (Rule 2).
- Strict build verification: `npm run build` must complete cleanly with exit code 0 before task completion.

---

### Task 1: Refactor DOM Structure in `web/index.html`

**Files:**
- Modify: `web/index.html`

**Interfaces:**
- Consumes: Existing IDs (`#titlebar-title`, `#notify-bell`, `#room-search`, `#menubar`, `#tabstrip`, `#log`, `#composer`).
- Produces: Cleaned DOM structure without `#ribbon`, adding `#toolbar-standard` inside `#menubar`, and floating `#editor-find-bar` inside `.logwrap`.

- [ ] **Step 1: Update Titlebar & Menubar structure**
  - In `web/index.html`, center the global search box (`#room-search`) in the titlebar with placeholder `Search rooms (Ctrl+K)`.
  - Add `<div class="toolbar-standard" id="toolbar-standard" aria-label="Standard toolbar"></div>` directly adjacent to or inside the menubar container.
  - Remove redundant `#menubar-solution` and `#menubar-ribbon-toggle`.
  - Remove `<div class="ribbon" id="ribbon" aria-label="Ribbon"></div>`.

- [ ] **Step 2: Update Tabstrip, Breadcrumb, and Editor DOM**
  - Merge breadcrumb into the tabstrip row (`.tabstrip`) or keep as a minimal 24px secondary header without the static search input and dropdown filter.
  - Add floating `#editor-find-bar` within `.logwrap`:
    ```html
    <div class="editor-find-bar" id="editor-find-bar" hidden>
      <input id="find-input" type="search" placeholder="Find in log (Ctrl+F)" autocomplete="off" spellcheck="false" />
      <span class="find-count" id="find-count"></span>
      <button type="button" class="find-btn" id="find-close" title="Close (Esc)">✕</button>
    </div>
    ```
  - Clean up `#startview`: remove duplicate primary buttons (`#start-new`, `#start-refresh`) and replace with an elegant quick-start card and keyboard shortcuts list.

- [ ] **Step 3: Verify HTML syntax and build**
  Run: `npm run build`
  Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**
  ```bash
  git add web/index.html
  git commit -m "refactor(web): streamline DOM structure and remove office ribbon"
  ```

---

### Task 2: Modern Visual Studio 2022 Stylesheet Updates

**Files:**
- Modify: `web/src/styles/ide.css`
- Modify: `web/src/styles/tokens.css`

**Interfaces:**
- Consumes: CSS variables in `tokens.css` (`--bg`, `--surface`, `--accent`, `--border`, etc.).
- Produces: CSS rules for `.toolbar-standard`, `.editor-find-bar`, compact titlebar, and unified tabstrip.

- [ ] **Step 1: Write CSS for `.toolbar-standard`**
  - Implement 28px height compact button group with 16x16 icon sizing.
  - Subtle hover background, active focus ring, and vertical separator divider (`.toolbar-sep`).

- [ ] **Step 2: Write CSS for `.editor-find-bar`**
  - Position: `absolute; top: 8px; right: 24px; z-index: 20;`.
  - Styled as a sleek VS Find dialog: 1px border, background matching `--surface`, subtle shadow, integrated input and close button.

- [ ] **Step 3: Remove legacy Ribbon CSS and tighten chrome spacing**
  - Delete all `.ribbon`, `.ribbon-tabs`, `.ribbon-group`, `.ribbon-button` selectors.
  - Adjust `.content` grid to reclaim vertical height (from ~250px top chrome down to ~86px).

- [ ] **Step 4: Verify styles by running typecheck & build**
  Run: `npm run build`
  Expected: Clean build without CSS errors.

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/styles/ide.css web/src/styles/tokens.css
  git commit -m "style(web): add compact VS2022 toolbar and floating find bar styles"
  ```

---

### Task 3: Replace Ribbon with StandardToolbar Component

**Files:**
- Create: `web/src/ui/toolbar.ts`
- Delete: `web/src/ui/ribbon.ts`
- Create: `web/test/toolbar.spec.ts`
- Delete: `web/test/ribbon.spec.ts`

**Interfaces:**
- Consumes: `MenuAction` from `menubar.ts`, `icon()` from `icons.ts`.
- Produces: `StandardToolbar` class with methods `setEnabled(action, boolean)` and `setChecked(action, boolean)`.

- [ ] **Step 1: Write failing unit test for `StandardToolbar` in `web/test/toolbar.spec.ts`**
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { StandardToolbar } from "../src/ui/toolbar";

  describe("StandardToolbar", () => {
    it("renders compact action buttons and dispatches clicks", () => {
      const root = document.createElement("div");
      const onAction = vi.fn();
      const toolbar = new StandardToolbar(root, [
        { action: "new-room", label: "New Room", icon: "plus" },
        { action: "reload", label: "Refresh", icon: "refresh" },
      ], onAction);

      const buttons = root.querySelectorAll<HTMLButtonElement>("button");
      expect(buttons.length).toBe(2);
      buttons[0].click();
      expect(onAction).toHaveBeenCalledWith("new-room");
    });
  });
  ```

- [ ] **Step 2: Verify test fails**
  Run: `npx vitest run web/test/toolbar.spec.ts`
  Expected: FAIL (Cannot find module `../src/ui/toolbar`).

- [ ] **Step 3: Implement `StandardToolbar` in `web/src/ui/toolbar.ts`**
  - Fully documented with Doxygen docstrings per Rule 5.
  - Implements compact button rendering, keyboard accessibility (`aria-label`, `title`), and state management (`setEnabled`, `setChecked`).

- [ ] **Step 4: Verify test passes**
  Run: `npx vitest run web/test/toolbar.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Clean up old ribbon spec and files**
  - Delete `web/test/ribbon.spec.ts`.
  - Delete `web/src/ui/ribbon.ts`.

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/ui/toolbar.ts web/test/toolbar.spec.ts
  git rm web/src/ui/ribbon.ts web/test/ribbon.spec.ts
  git commit -m "feat(web): replace ribbon with compact StandardToolbar component"
  ```

---

### Task 4: Integrate Floating Find Bar into `LogView` & Update Keybindings

**Files:**
- Modify: `web/src/ui/log-view.ts`
- Modify: `web/src/main.ts`
- Modify: `web/test/log-view.spec.ts`

**Interfaces:**
- Consumes: `#editor-find-bar`, `#find-input`, `#find-count`, `#find-close`.
- Produces: `openFind()`, `closeFind()`, and live text filtering without permanent breadcrumb inputs.

- [ ] **Step 1: Write test for floating find bar in `web/test/log-view.spec.ts`**
  - Test showing find bar on `openFind()`.
  - Test filtering log lines by matching substring.
  - Test hiding find bar on `closeFind()` and resetting filter.

- [ ] **Step 2: Verify test fails**
  Run: `npx vitest run web/test/log-view.spec.ts`
  Expected: FAIL on new find bar assertions.

- [ ] **Step 3: Implement Find Bar wiring in `LogView` and `main.ts`**
  - Handle `Ctrl+F` by calling `logView.openFind()`.
  - Handle `Escape` or `✕` click by calling `logView.closeFind()`.
  - Wire `Ctrl+K` and `Ctrl+Q` to focus `#room-search` in Titlebar.
  - Replace ribbon wiring in `main.ts` with `StandardToolbar`.

- [ ] **Step 4: Verify test passes**
  Run: `npx vitest run web/test/log-view.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/ui/log-view.ts web/src/main.ts web/test/log-view.spec.ts
  git commit -m "feat(web): wire floating find bar and VS2022 shortcut navigation"
  ```

---

### Task 5: Full Test Suite, Build Verification & Quality Gate

**Files:**
- Modify: Any files with lingering ribbon references (e.g. `web/src/lib/ribbonpref.ts` or its consumers).

- [ ] **Step 1: Run complete unit test suite across workspaces**
  Run: `npm test`
  Expected: 100% tests pass (all workspaces: `shared`, `worker`, `web`).

- [ ] **Step 2: Run typecheck**
  Run: `npm run typecheck`
  Expected: Exit code 0, 0 TypeScript errors.

- [ ] **Step 3: Run production build**
  Run: `npm run build`
  Expected: Exit code 0, clean Vite output in `web/dist`.

- [ ] **Step 4: Commit**
  ```bash
  git add -A
  git commit -m "refactor(web): clean up ribbon preferences and finalize VS2022 chrome"
  ```

---

### Task 6: Visual Regression Snapshots & UX Comparison

**Files:**
- Output: `.shots/snapshot-modern-dark.png`, `.shots/snapshot-modern-light.png`

- [ ] **Step 1: Run snapshot tool on newly built application**
  Run: `bun run scripts/scratch/take-snapshot.ts --out=.shots/snapshot-modern`
  Expected: Two new snapshots generated successfully.

- [ ] **Step 2: Copy snapshots to conversation artifact directory**
  Run: `Copy-Item .shots/snapshot-modern-*.png <artifact-dir>`

- [ ] **Step 3: Inspect snapshots to verify UX improvements**
  - Confirm vertical space is reclaimed.
  - Confirm duplicate search boxes and buttons are gone.
  - Confirm clean Visual Studio 2022 aesthetics.
