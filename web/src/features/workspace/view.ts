/**
 * @file view.ts
 * @brief Workspace explorer document: solution tree, file viewer, build output.
 * @details Mirrors the original VinaBIM monitor surface inside the chat app: a
 * solution tree on the left, the selected file in the editor, and an output
 * pane with Build / Errors / Immediate tabs. Everything loads from the static
 * `workspace/` assets, so the document needs no backend. The immediate window
 * also carries the `check` / `cmt` / `play` commands the source app had.
 */

import type { MarketClient } from "@/features/market/board";
import {
  buildSummary,
  countFiles,
  filterTree,
  flattenFiles,
  normalizeTree,
  parseBuildErrors,
  type BuildDiagnostic,
  type WorkspaceNode,
} from "./tree";

/** Output tabs of the bottom pane. */
export type OutputTab = "build" | "errors" | "immediate";

/** Lines rendered for one file before truncation. */
const MAX_FILE_LINES = 4000;

/** DOM hosts the explorer paints into. */
export interface WorkspaceElements {
  panel: HTMLElement;
  tree: HTMLElement;
  filter: HTMLInputElement;
  fileLabel: HTMLElement;
  gutter: HTMLElement;
  content: HTMLElement;
  outputTabs: HTMLElement;
  output: HTMLElement;
  immediate: HTMLInputElement;
  chip: HTMLElement;
  state: HTMLElement;
  buildButton: HTMLButtonElement;
}

/** Collaborators the explorer cannot build itself. */
export interface WorkspaceDeps {
  /** Base URL of the static workspace assets, ending with a slash. */
  baseUrl: string;
  /** Market client used by the `check` and `cmt` immediate commands. */
  market: MarketClient;
  /** Opens the games hub for the `play` command. */
  onPlay: () => void;
  /** Fetch implementation; tests replace it. */
  fetchImpl?: typeof fetch;
}

/**
 * @brief Owns the workspace explorer document.
 */
export class WorkspaceView {
  private root: WorkspaceNode | null = null;
  private files: WorkspaceNode[] = [];
  private openPath: string | null = null;
  private collapsed = new Set<string>();
  private diagnostics: BuildDiagnostic[] = [];
  private outputTab: OutputTab = "build";
  private outputLines: Record<OutputTab, string[]> = { build: [], errors: [], immediate: [] };
  private fileCache = new Map<string, string>();
  private loaded = false;
  private building = false;

  /**
   * @param elements DOM hosts.
   * @param deps Static asset base URL and collaborators.
   */
  constructor(
    private readonly elements: WorkspaceElements,
    private readonly deps: WorkspaceDeps,
  ) {
    elements.filter.addEventListener("input", () => this.renderTree());
    elements.tree.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest<HTMLElement>("[data-path]");
      const path = row?.dataset.path;
      if (path === undefined) return;
      if (row?.dataset.type === "folder") this.toggleFolder(path);
      else void this.openFile(path);
    });
    elements.outputTabs.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-output-tab]");
      const tab = button?.dataset.outputTab as OutputTab | undefined;
      if (tab !== undefined) this.setOutputTab(tab);
    });
    elements.immediate.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const command = elements.immediate.value;
      elements.immediate.value = "";
      void this.runCommand(command);
    });
    elements.buildButton.addEventListener("click", () => void this.build());
  }

  /** Files in the loaded tree, in document order. */
  get fileCount(): number {
    return this.files.length;
  }

  /** Path of the file currently shown in the editor. */
  get currentFile(): string | null {
    return this.openPath;
  }

  /** Diagnostics from the last build. */
  get currentDiagnostics(): BuildDiagnostic[] {
    return [...this.diagnostics];
  }

  /** Output tab currently visible. */
  get currentOutputTab(): OutputTab {
    return this.outputTab;
  }

  /** @brief Loads the tree and shows the solution file. */
  start(): void {
    this.renderOutput();
    this.setOutputTab("build");
    if (this.loaded) return;
    this.loaded = true;
    void this.loadTree();
  }

  /** @brief No timers to clear; kept for symmetry with the other documents. */
  stop(): void {}

  /** @brief Focuses the tree filter. */
  focusFilter(): void {
    this.elements.filter.focus();
    this.elements.filter.select();
  }

  /**
   * @brief Opens one workspace file in the editor.
   * @param path Workspace-relative path.
   * @return Resolves when the file is painted.
   */
  async openFile(path: string): Promise<void> {
    this.elements.fileLabel.textContent = path;
    this.elements.state.textContent = "Loading";

    let text = this.fileCache.get(path);
    if (text === undefined) {
      try {
        text = await this.fetchText(`files/${encodePath(path)}`);
      } catch {
        this.elements.state.textContent = "Missing";
        this.elements.content.replaceChildren();
        this.elements.gutter.replaceChildren();
        this.appendImmediate(`[error] cannot open ${path}`);
        return;
      }
      this.fileCache.set(path, text);
    }

    this.openPath = path;
    this.renderFile(text);
    this.elements.state.textContent = `${text.split(/\r?\n/).length} lines`;
  }

  /**
   * @brief Runs one immediate-window command.
   * @param raw Command line typed by the user.
   * @return Resolves when the command output is painted.
   */
  async runCommand(raw: string): Promise<void> {
    const line = raw.trim();
    if (line.length === 0) return;
    this.appendImmediate(`1> ${line}`);

    const [command = "", ...rest] = line.split(/\s+/);
    const argument = rest.join(" ");
    const name = command.toLowerCase();

    if (name === "help") {
      this.appendImmediate("  help                  list commands");
      this.appendImmediate("  ls [path]             list workspace files");
      this.appendImmediate("  open <path>           open a file in the editor");
      this.appendImmediate("  find <text>           search file paths");
      this.appendImmediate("  check <SYM>           print a live quote");
      this.appendImmediate("  cmt <SYM>             print the newest FireAnt posts");
      this.appendImmediate("  play                  open the games hub");
      this.appendImmediate("  clear                 clear this pane");
      return;
    }

    if (name === "clear") {
      this.outputLines.immediate = [];
      this.renderOutput();
      return;
    }

    if (name === "play") {
      this.appendImmediate("  opening games hub...");
      this.deps.onPlay();
      return;
    }

    if (name === "ls") {
      const prefix = argument.toLowerCase();
      const matches = this.files
        .map((file) => file.path)
        .filter((path) => prefix.length === 0 || path.toLowerCase().startsWith(prefix))
        .slice(0, 40);
      if (matches.length === 0) this.appendImmediate("  no files matched");
      for (const path of matches) this.appendImmediate(`  ${path}`);
      return;
    }

    if (name === "open") {
      if (argument.length === 0) {
        this.appendImmediate("  usage: open <path>");
        return;
      }
      await this.openFile(argument);
      this.appendImmediate(`  opened ${argument}`);
      return;
    }

    if (name === "find") {
      const needle = argument.toLowerCase();
      const matches = this.files
        .map((file) => file.path)
        .filter((path) => path.toLowerCase().includes(needle))
        .slice(0, 20);
      if (matches.length === 0) this.appendImmediate("  no files matched");
      for (const path of matches) this.appendImmediate(`  ${path}`);
      return;
    }

    if (name === "check") {
      const symbol = argument.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
        this.appendImmediate("  usage: check <SYM>");
        return;
      }
      try {
        const payload = await this.deps.market.quotes([symbol]);
        const quote = payload.quotes[0];
        if (quote === undefined) {
          this.appendImmediate(`  ${symbol}: no data`);
          return;
        }
        const sign = quote.change >= 0 ? "+" : "";
        this.appendImmediate(
          `  [${quote.symbol}] last ${quote.last.toFixed(2)} (${sign}${quote.change.toFixed(2)} / ${sign}${quote.changePercent.toFixed(2)}%)`,
        );
        this.appendImmediate(
          `  ref ${quote.ref.toFixed(2)}  ceil ${quote.ceiling.toFixed(2)}  floor ${quote.floor.toFixed(2)}  vol ${Math.round(quote.volume)}`,
        );
        this.appendImmediate(
          `  bids ${quote.bids.map((level) => `${level.price.toFixed(2)}x${level.volume}`).join(" ")}`,
        );
        this.appendImmediate(
          `  asks ${quote.asks.map((level) => `${level.price.toFixed(2)}x${level.volume}`).join(" ")}`,
        );
      } catch {
        this.appendImmediate(`  ${symbol}: quote feed unavailable`);
      }
      return;
    }

    if (name === "cmt") {
      const symbol = argument.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
        this.appendImmediate("  usage: cmt <SYM>");
        return;
      }
      try {
        const payload = await this.deps.market.feed(symbol, "fireant");
        this.appendImmediate(`  ${payload.items.length} posts for ${symbol}`);
        for (const item of payload.items.slice(0, 3)) {
          this.appendImmediate(`  ${item.author}: ${item.text.slice(0, 96)}`);
        }
      } catch {
        this.appendImmediate(`  ${symbol}: community feed unavailable`);
      }
      return;
    }

    this.appendImmediate(`'${command}' is not recognized as an internal command. Type 'help'.`);
  }

  /**
   * @brief Runs the build transcript and fills the Errors pane.
   * @return Resolves when the output is painted.
   */
  async build(): Promise<void> {
    if (this.building) return;
    this.building = true;
    this.elements.state.textContent = "Building";

    try {
      const log = await this.fetchText("files/build_errors.log");
      this.diagnostics = parseBuildErrors(log);

      const lines = [
        "------ Build started: Project: VinaBIM, Configuration: Release_26 | x64 ------",
        "1>VinaBIM.vcxproj -> C:\\VinaBIM\\bin\\x64\\Release\\VinaBIM.exe",
        ...this.diagnostics.map((diagnostic) => diagnostic.raw),
        this.diagnostics.some((diagnostic) => diagnostic.severity === "error")
          ? "Build FAILED."
          : "Build succeeded.",
        buildSummary(this.diagnostics),
        "Time Elapsed 00:00:03.42",
      ];
      this.outputLines.build = lines;
      this.setOutputTab("build");
      this.elements.state.textContent = this.diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "Build failed"
        : "Build ok";
    } catch {
      this.outputLines.build = ["Build failed: cannot read the workspace build log."];
      this.setOutputTab("build");
      this.elements.state.textContent = "Build failed";
    } finally {
      this.building = false;
      this.renderOutput();
    }
  }

  /** @brief Loads and paints the workspace tree. */
  private async loadTree(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await this.fetchText("tree.json"));
      const root = normalizeTree(raw);
      if (root === null) throw new Error("malformed tree");
      this.root = root;
      this.files = flattenFiles(root);
      this.elements.chip.textContent = `// VinaBIM.sln | ${countFiles(root)} files`;
      this.renderTree();
      await this.openFile("VinaBIM.sln");
    } catch {
      this.elements.tree.replaceChildren();
      this.elements.state.textContent = "No workspace";
      this.appendImmediate("[error] workspace assets are missing");
    }
  }

  /**
   * @brief Fetches one static workspace asset.
   * @param relative Path relative to the workspace base URL.
   * @return The asset text.
   * @throws When the request fails.
   */
  private async fetchText(relative: string): Promise<string> {
    const fetchImpl = this.deps.fetchImpl ?? ((input, init) => fetch(input, init));
    const response = await fetchImpl(`${this.deps.baseUrl}${relative}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  /**
   * @brief Toggles a folder in the tree.
   * @param path Folder path.
   */
  private toggleFolder(path: string): void {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.renderTree();
  }

  /** @brief Repaints the tree with the current filter and collapse state. */
  private renderTree(): void {
    const tree = this.elements.tree;
    tree.replaceChildren();
    if (this.root === null) return;

    const filtered = filterTree(this.root, this.elements.filter.value);
    if (filtered === null) {
      const empty = document.createElement("div");
      empty.className = "ws-tree-empty";
      empty.textContent = "// no files match";
      tree.append(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "ws-tree-list";
    list.setAttribute("role", "tree");
    this.renderNode(filtered, 0, list);
    tree.append(list);
  }

  /**
   * @brief Paints one tree node and its visible children.
   * @param node Node to paint.
   * @param depth Indent depth.
   * @param host Container to append to.
   */
  private renderNode(node: WorkspaceNode, depth: number, host: HTMLElement): void {
    const isFolder = node.type === "folder";
    const isCollapsed = this.collapsed.has(node.path);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "ws-row";
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.style.paddingLeft = `${6 + depth * 12}px`;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-expanded", isFolder ? String(!isCollapsed) : "false");

    const marker = document.createElement("span");
    marker.className = "ws-marker";
    marker.textContent = isFolder ? (isCollapsed ? "▸" : "▾") : " ";

    const label = document.createElement("span");
    label.className = "ws-label";
    label.textContent = node.name;

    row.append(marker, label);
    host.append(row);

    if (!isFolder || isCollapsed) return;
    for (const child of node.children ?? []) this.renderNode(child, depth + 1, host);
  }

  /**
   * @brief Paints one file's text with line numbers.
   * @param text File contents.
   */
  private renderFile(text: string): void {
    const lines = text.split(/\r?\n/).slice(0, MAX_FILE_LINES);
    const gutter: HTMLSpanElement[] = [];
    const content = document.createDocumentFragment();

    lines.forEach((line, index) => {
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      gutter.push(number);

      const row = document.createElement("div");
      row.className = "ws-line";
      row.textContent = line.length > 0 ? line : " ";
      content.append(row);
    });

    this.elements.gutter.replaceChildren(...gutter);
    this.elements.content.replaceChildren(content);
  }

  /**
   * @brief Switches the bottom output tab.
   * @param tab Tab to show.
   */
  private setOutputTab(tab: OutputTab): void {
    this.outputTab = tab;
    for (const button of this.elements.outputTabs.querySelectorAll<HTMLButtonElement>("[data-output-tab]")) {
      button.classList.toggle("is-active", button.dataset.outputTab === tab);
    }
    this.renderOutput();
  }

  /** @brief Paints the active output tab. */
  private renderOutput(): void {
    const host = this.elements.output;
    host.replaceChildren();

    if (this.outputTab === "errors") {
      if (this.diagnostics.length === 0) {
        host.append(this.outputLine("// no build diagnostics - run Build first"));
        return;
      }
      for (const diagnostic of this.diagnostics) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ws-diagnostic";
        row.dataset.severity = diagnostic.severity;
        row.textContent = `${diagnostic.file}(${diagnostic.line}): ${diagnostic.severity}: ${diagnostic.message}`;
        row.addEventListener("click", () => {
          void this.openFile(
            resolveWorkspacePath(
              diagnostic.file,
              this.files.map((file) => file.path),
            ),
          );
        });
        host.append(row);
      }
      return;
    }

    const lines = this.outputLines[this.outputTab];
    if (lines.length === 0) {
      host.append(
        this.outputLine(
          this.outputTab === "build"
            ? "// press Build to compile the solution"
            : "// type 'help' for the command list",
        ),
      );
      return;
    }
    for (const line of lines) host.append(this.outputLine(line));
  }

  /**
   * @brief Creates one output line element.
   * @param text Line text.
   * @return The element.
   */
  private outputLine(text: string): HTMLElement {
    const line = document.createElement("div");
    line.className = "ws-output-line";
    line.textContent = text;
    return line;
  }

  /**
   * @brief Appends one line to the immediate pane.
   * @param text Line text.
   */
  private appendImmediate(text: string): void {
    this.outputLines.immediate.push(text);
    if (this.outputLines.immediate.length > 500) this.outputLines.immediate.shift();
    if (this.outputTab === "immediate") this.renderOutput();
  }
}

/**
 * @brief Percent-encodes each segment of a workspace path.
 * @param path Workspace-relative path.
 * @return The URL-safe path.
 */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * @brief Resolves an absolute compiler path against the workspace file list.
 * @details MSBuild logs carry absolute paths (`C:\VinaBIM\01_VinaBIM\VinaBIM\…`)
 * while the workspace assets use solution-relative paths. The longest suffix
 * that matches a known file wins.
 * @param absolute Path from the build log.
 * @param paths Every workspace file path.
 * @return The matching workspace path, or the input when nothing matches.
 */
export function resolveWorkspacePath(absolute: string, paths: string[]): string {
  const segments = absolute
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0);

  for (let take = segments.length; take > 0; take -= 1) {
    const candidate = segments.slice(segments.length - take).join("/");
    const match = paths.find((path) => path === candidate || path.endsWith(`/${candidate}`));
    if (match !== undefined) return match;
  }
  return absolute;
}
