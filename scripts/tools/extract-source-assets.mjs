/**
 * Extracts the VinaBIM workspace data and game fixtures from an unpacked copy of
 * `vn_stock_monitor_clean.7z` into this repository.
 *
 * Only data is copied: the fake workspace tree, its file contents, the build log and
 * the saved game states used as test fixtures. No source code from the archive is
 * reused (its `server.py` is not part of this migration).
 *
 *   node scripts/tools/extract-source-assets.mjs --from <unpacked-dir> [--out web/public/workspace]
 *
 * The unpacked directory must contain `vinabim_tree.json` and `vinabim_workspace/`,
 * which is what you get by extracting the 7z, then the zip inside it.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const outIndex = args.indexOf("--out");
const from = fromIndex >= 0 ? path.resolve(args[fromIndex + 1] ?? "") : null;
const outRoot = path.resolve(outIndex >= 0 ? (args[outIndex + 1] ?? "") : "web/public/workspace");

if (from === null || !existsSync(from)) {
  console.error("usage: node scripts/tools/extract-source-assets.mjs --from <unpacked-dir> [--out <dir>]");
  console.error(`source directory not found: ${from ?? "(missing --from)"}`);
  process.exit(1);
}

const treeFile = path.join(from, "vinabim_tree.json");
const workspaceDir = path.join(from, "vinabim_workspace");
if (!existsSync(treeFile) || !existsSync(workspaceDir)) {
  console.error(`expected vinabim_tree.json and vinabim_workspace/ inside ${from}`);
  process.exit(1);
}

const filesOut = path.join(outRoot, "files");
const extrasOut = path.join(outRoot, "files-extra");
mkdirSync(filesOut, { recursive: true });
mkdirSync(extrasOut, { recursive: true });

/**
 * Joins `relative` under `root`, refusing to escape it.
 * @param {string} root Absolute root directory.
 * @param {string} relative Relative path from the tree.
 * @returns {string} Absolute target path.
 */
function safeJoin(root, relative) {
  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error(`refusing to copy outside the workspace: ${relative}`);
  }
  return target;
}

const tree = JSON.parse(readFileSync(treeFile, "utf8"));

/** File nodes collected from the tree. */
const fileNodes = [];
/** @param {{ name: string, type: string, path: string, children?: unknown[] }} node Tree node. */
const walk = (node) => {
  if (node.type === "file") fileNodes.push(node);
  for (const child of node.children ?? []) walk(child);
};
walk(tree);

const copied = [];
const missing = [];
for (const node of fileNodes) {
  const source = safeJoin(workspaceDir, node.path);
  if (!existsSync(source) || !statSync(source).isFile()) {
    missing.push(node.path);
    continue;
  }
  const target = safeJoin(filesOut, node.path);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied.push(node.path);
}

// Files the source app opened directly (not part of the VinaBIM tree).
const extraDir = path.join(from, "workspace_files");
let extras = 0;
if (existsSync(extraDir)) {
  for (const name of readdirSync(extraDir)) {
    const source = path.join(extraDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, path.join(extrasOut, name));
    extras += 1;
  }
}

// The tree drives the workspace browser; it is data, so it ships verbatim.
copyFileSync(treeFile, path.join(outRoot, "tree.json"));

// Saved game states double as fixtures for the engine tests.
const fixturesDir = path.resolve("web/test/fixtures/games");
mkdirSync(fixturesDir, { recursive: true });
const fixtureMap = {
  "caro_state_backup.json": "caro.json",
  "chess_state_backup.json": "chess.json",
  "gunny_saved_state.json": "gunny.json",
};
const fixtures = [];
for (const [sourceName, targetName] of Object.entries(fixtureMap)) {
  const source = path.join(from, sourceName);
  if (!existsSync(source)) continue;
  copyFileSync(source, path.join(fixturesDir, targetName));
  fixtures.push(targetName);
}

const totalBytes = copied.reduce((sum, relative) => sum + statSync(safeJoin(filesOut, relative)).size, 0);

const report = {
  source: from,
  output: outRoot,
  treeFiles: fileNodes.length,
  copied: copied.length,
  missing,
  extras,
  fixtures,
  bytes: totalBytes,
};
writeFileSync(path.join(outRoot, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...report, missing: missing.slice(0, 5) }, null, 2));
if (missing.length > 0) {
  console.error(`\n${missing.length} tree entries had no file in the archive:`);
  for (const relative of missing.slice(0, 20)) console.error(`  - ${relative}`);
  process.exitCode = 1;
}
if (copied.length === 0) {
  console.error("nothing copied");
  process.exitCode = 1;
}
