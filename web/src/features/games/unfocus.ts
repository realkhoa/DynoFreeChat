/**
 * @file unfocus.ts
 * @brief Random VinaBIM source view shown whenever the game is not being played.
 * @details The point of the disguise is that a resting game document looks like
 * any other source file from the solution: a random file, at a random offset,
 * with editor colours. Hovering swaps it for the real board, and leaving picks a
 * fresh file so the screen never looks the same twice.
 */

/** Base URL of the extracted VinaBIM workspace assets, with a trailing slash. */
const DEFAULT_BASE = `${import.meta.env.BASE_URL}workspace/`;

/** Lines rendered in the resting code view. */
const VISIBLE_LINES = 90;

/** One random code view: the file it came from plus its rendered lines. */
export interface CodeView {
  /** Workspace-relative path, shown nowhere but useful for tests. */
  path: string;
  /** Lines to render, already offset into the file. */
  lines: string[];
}

/** Tree node shape the workspace assets use. */
interface WorkspaceNode {
  name?: unknown;
  type?: unknown;
  path?: unknown;
  children?: unknown;
}

/** Dependencies so tests can avoid the network. */
export interface CodeFeedDeps {
  /** Base URL of the workspace assets. */
  baseUrl?: string;
  /** Fetch implementation. */
  fetchImpl?: typeof fetch;
  /** Random source, injected by tests. */
  random?: () => number;
}

/**
 * @brief Picks random source files out of the VinaBIM workspace.
 */
export class RandomCodeFeed {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly random: () => number;
  private paths: string[] | null = null;
  private readonly cache = new Map<string, string[]>();

  /**
   * @param deps Optional seams for the base URL, network and randomness.
   */
  constructor(deps: CodeFeedDeps = {}) {
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.random = deps.random ?? Math.random;
  }

  /**
   * @brief Loads one random file view.
   * @return The view, falling back to generated code when the assets are absent.
   */
  async next(): Promise<CodeView> {
    try {
      const paths = await this.loadPaths();
      if (paths.length === 0) return this.synthetic();

      const path = paths[Math.floor(this.random() * paths.length)] ?? paths[0]!;
      const lines = await this.loadFile(path);
      if (lines.length === 0) return this.synthetic();

      const maxStart = Math.max(0, lines.length - VISIBLE_LINES);
      const start = Math.floor(this.random() * (maxStart + 1));
      return { path, lines: lines.slice(start, start + VISIBLE_LINES) };
    } catch {
      return this.synthetic();
    }
  }

  /**
   * @brief Loads and flattens the workspace tree once.
   * @return Every file path in the workspace.
   */
  private async loadPaths(): Promise<string[]> {
    if (this.paths !== null) return this.paths;

    const response = await this.fetchImpl(`${this.baseUrl}tree.json`);
    if (!response.ok) throw new Error(`tree ${response.status}`);
    const root = (await response.json()) as WorkspaceNode;
    const paths: string[] = [];

    const walk = (node: WorkspaceNode): void => {
      if (node.type === "file" && typeof node.path === "string") {
        paths.push(node.path);
        return;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child as WorkspaceNode);
      }
    };
    walk(root);

    this.paths = paths;
    return paths;
  }

  /**
   * @brief Loads one workspace file, cached across switches.
   * @param path Workspace-relative path.
   * @return The file lines.
   */
  private async loadFile(path: string): Promise<string[]> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;

    const url = `${this.baseUrl}files/${path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`file ${response.status}`);
    const lines = (await response.text()).split(/\r?\n/);
    this.cache.set(path, lines);
    return lines;
  }

  /**
   * @brief Builds a plausible C++ file when the workspace assets are missing.
   * @return A generated code view.
   */
  private synthetic(): CodeView {
    const headers = [
      "// VinaBIM - federated clash workspace",
      '#include "VinaBIM/Core/contracts/clash/FederatedClashModels.h"',
      "#include <vector>",
      "",
      "namespace VinaBIM::Core {",
      "",
      "// Generated translation unit for the clash planner.",
      "static const std::vector<ClashPair> g_PendingPairs = {",
    ];
    const body: string[] = [];
    for (let index = 0; index < VISIBLE_LINES - headers.length; index += 1) {
      const row = Math.floor(index / 4);
      const pair = index % 4;
      body.push(
        `    { /* a */ ${row}, /* b */ ${pair}, /* state */ ClashState::Pending },  // pair ${row}.${pair}`,
      );
    }
    body.push("};", "", "} // namespace VinaBIM::Core");
    return { path: "VinaBIM/Core/clash/GeneratedClashPairs.cpp", lines: [...headers, ...body] };
  }
}

/** Token classes understood by the code view. */
type TokenKind = "comment" | "pre" | "string" | "keyword" | "number" | "plain";

/** Words coloured as C++ keywords. */
const KEYWORDS = new Set([
  "auto",
  "bool",
  "break",
  "case",
  "char",
  "class",
  "const",
  "constexpr",
  "continue",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "explicit",
  "extern",
  "false",
  "float",
  "for",
  "friend",
  "if",
  "inline",
  "int",
  "long",
  "namespace",
  "new",
  "noexcept",
  "nullptr",
  "override",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "signed",
  "static",
  "struct",
  "switch",
  "template",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "typename",
  "union",
  "unsigned",
  "using",
  "virtual",
  "void",
  "volatile",
  "while",
]);

/**
 * @brief Splits one source line into coloured tokens.
 * @param line Raw source line.
 * @return Token kind and text pairs, in order.
 */
export function tokenizeLine(line: string): Array<{ kind: TokenKind; text: string }> {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return [{ kind: "comment", text: line }];
  if (trimmed.startsWith("#")) return [{ kind: "pre", text: line }];

  const tokens: Array<{ kind: TokenKind; text: string }> = [];
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*$|[A-Za-z_]\w*|\d+(?:\.\d+)?|\s+|.)/g;
  for (const match of line.matchAll(pattern)) {
    const text = match[0];
    if (text.startsWith("//")) {
      tokens.push({ kind: "comment", text });
    } else if (text.startsWith('"') || text.startsWith("'")) {
      tokens.push({ kind: "string", text });
    } else if (/^[A-Za-z_]/.test(text) && KEYWORDS.has(text)) {
      tokens.push({ kind: "keyword", text });
    } else if (/^\d/.test(text)) {
      tokens.push({ kind: "number", text });
    } else {
      tokens.push({ kind: "plain", text });
    }
  }
  return tokens;
}

/**
 * @brief Renders one coloured source line into a container.
 * @param host Container receiving the spans.
 * @param line Raw source line.
 */
export function renderCodeLine(host: HTMLElement, line: string): void {
  const row = document.createElement("div");
  row.className = "unfocus-line";
  if (line.length === 0) {
    row.textContent = " ";
    host.append(row);
    return;
  }
  for (const token of tokenizeLine(line)) {
    const span = document.createElement("span");
    span.className = `unfocus-${token.kind}`;
    span.textContent = token.text;
    row.append(span);
  }
  host.append(row);
}
