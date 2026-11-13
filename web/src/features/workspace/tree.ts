/**
 * @file tree.ts
 * @brief Pure helpers for the VinaBIM workspace explorer.
 * @details The workspace ships as static JSON (a nested tree plus one file per
 * node) generated from the source archive, so the browser needs no backend. The
 * helpers here are DOM-free and unit-tested: normalize the tree, filter it for
 * the search box, flatten the file list, and parse the MSBuild log into the
 * diagnostic list the Errors pane shows.
 */

/** One node of the workspace tree. */
export interface WorkspaceNode {
  /** Display name, e.g. `VinaBIM.sln`. */
  name: string;
  /** Whether the node is a folder or a file. */
  type: "folder" | "file";
  /** Workspace-relative path, e.g. `VinaBIM/Core/contracts/foo.h`. */
  path: string;
  /** Lower-case extension including the dot, for files. */
  ext?: string;
  /** Child nodes, for folders. */
  children?: WorkspaceNode[];
}

/** One build diagnostic parsed from the MSBuild log. */
export interface BuildDiagnostic {
  /** Severity of the diagnostic. */
  severity: "error" | "warning";
  /** Source file path as printed by the compiler. */
  file: string;
  /** 1-based line number, or 0 when the log did not include one. */
  line: number;
  /** Diagnostic message without the file prefix. */
  message: string;
  /** Full original log line. */
  raw: string;
}

/**
 * @brief Normalizes a raw tree payload into the workspace node type.
 * @param raw Parsed JSON payload.
 * @return The root node, or `null` when the payload is not a tree.
 */
export function normalizeTree(raw: unknown): WorkspaceNode | null {
  if (typeof raw !== "object" || raw === null) return null;
  return normalizeNode(raw as Record<string, unknown>);
}

/**
 * @brief Normalizes one node, dropping malformed children.
 * @param record Raw node record.
 * @return The node, or `null` when it has no usable name.
 */
function normalizeNode(record: Record<string, unknown>): WorkspaceNode | null {
  const name = typeof record.name === "string" ? record.name : "";
  if (name.length === 0) return null;

  const path = typeof record.path === "string" && record.path.length > 0 ? record.path : name;
  const type = record.type === "folder" ? "folder" : "file";
  const node: WorkspaceNode = { name, type, path };

  if (type === "file") {
    node.ext = typeof record.ext === "string" ? record.ext.toLowerCase() : extensionOf(name);
    return node;
  }

  const children: WorkspaceNode[] = [];
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      if (typeof child !== "object" || child === null) continue;
      const normalized = normalizeNode(child as Record<string, unknown>);
      if (normalized !== null) children.push(normalized);
    }
  }
  node.children = children;
  return node;
}

/**
 * @brief Reads the lower-case extension of a file name.
 * @param name File name.
 * @return The extension including the dot, or an empty string.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * @brief Counts the files in a subtree.
 * @param node Subtree root.
 * @return Number of file nodes.
 */
export function countFiles(node: WorkspaceNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce((total, child) => total + countFiles(child), 0);
}

/**
 * @brief Flattens a subtree into its file nodes.
 * @param node Subtree root.
 * @return Every file node in document order.
 */
export function flattenFiles(node: WorkspaceNode): WorkspaceNode[] {
  if (node.type === "file") return [node];

  const files: WorkspaceNode[] = [];
  for (const child of node.children ?? []) files.push(...flattenFiles(child));
  return files;
}

/**
 * @brief Filters the tree for the search box.
 * @details A folder survives when its own path matches or when one of its
 * descendants matches, so the result keeps the path context visible.
 * @param node Subtree root.
 * @param query Case-insensitive substring; empty returns the tree unchanged.
 * @return The filtered tree, or `null` when nothing matches.
 */
export function filterTree(node: WorkspaceNode, query: string): WorkspaceNode | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return node;
  if (node.path.toLowerCase().includes(needle)) return node;
  if (node.type === "file") return null;

  const children = (node.children ?? [])
    .map((child) => filterTree(child, needle))
    .filter((child): child is WorkspaceNode => child !== null);
  return children.length > 0 ? { ...node, children } : null;
}

/**
 * @brief Parses MSBuild compiler diagnostics out of a build log.
 * @details MSBuild prints diagnostics as `path(line,col): error CODE: message`
 * or `path : warning CODE: message`; everything else is noise for the Errors
 * pane.
 * @param log Raw build log text.
 * @return The diagnostics, in log order.
 */
export function parseBuildErrors(log: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  const pattern = /^(.*?)(?:\((\d+)(?:,\d+)?\))?\s*:\s*(error|warning)\s+([A-Z]+\d+)?\s*:?\s*(.*)$/i;

  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes(" error ") && !line.includes(" warning ")) continue;

    const match = pattern.exec(line);
    if (match === null) continue;

    const file = (match[1] ?? "").trim();
    if (file.length === 0) continue;

    diagnostics.push({
      severity: (match[3] ?? "error").toLowerCase() === "warning" ? "warning" : "error",
      file,
      line: match[2] !== undefined ? Number(match[2]) : 0,
      message: (match[5] ?? "").trim(),
      raw: line,
    });
  }
  return diagnostics;
}

/**
 * @brief Builds the error/warning summary line the Build pane ends with.
 * @param diagnostics Parsed diagnostics.
 * @return A one-line summary, e.g. `0 Warning(s) 12 Error(s)`.
 */
export function buildSummary(diagnostics: BuildDiagnostic[]): string {
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return `${warnings} Warning(s)  ${errors} Error(s)`;
}
