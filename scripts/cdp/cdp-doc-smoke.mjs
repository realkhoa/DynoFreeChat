/**
 * Smoke test for the migrated surfaces: market hub + quotes + chart, workspace
 * explorer, and one game opened in the shared game stage.
 *
 *   node scripts/cdp/cdp-doc-smoke.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9463;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `doc-smoke-${Date.now()}`);
const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let wsUrl = null;
for (let i = 0; i < 150 && wsUrl === null; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    // still starting
  }
  if (wsUrl === null) await sleep(100);
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.once("open", res);
  ws.once("error", rej);
});

const pending = new Map();
const events = new Map();
let nextId = 1;
ws.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (entry) {
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
    return;
  }
  for (const fn of events.get(message.method) ?? []) fn(message.params);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) =>
  new Promise((resolve) => {
    const fn = (params) => {
      events.set(
        method,
        (events.get(method) ?? []).filter((f) => f !== fn),
      );
      resolve(params);
    };
    events.set(method, [...(events.get(method) ?? []), fn]);
  });

const consoleErrors = [];
events.set("Runtime.exceptionThrown", [
  (params) => consoleErrors.push(params.exceptionDetails?.text ?? "exception"),
]);
events.set("Runtime.consoleAPICalled", [
  (params) => {
    if (params.type === "error") {
      consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? "?").join(" "));
    }
  },
]);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
const loaded = once("Page.loadEventFired");
await send("Page.navigate", { url: APP_URL });
await loaded;
await sleep(1200);

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result.value;
};
const click = (selector) =>
  evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "ok"; })()`,
  );
const pressKey = (key) =>
  evaluate(
    `(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true })); return "ok"; })()`,
  );
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
};
const text = (selector, limit = 400) =>
  evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : el.textContent.slice(0, ${limit}); })()`,
  );

const report = {};

// 1. Market hub.
report.marketRibbon = await click("#btn-hub-market");
await sleep(500);
report.marketHub = await evaluate(`(() => {
  const rows = [...document.querySelectorAll("#market-hub-list .module-row")];
  return {
    tab: document.querySelector(".tab[data-doc-id='market']")?.dataset.label ?? null,
    rows: rows.length,
    names: rows.map((row) => row.textContent.replace(/\\s+/g, " ").slice(0, 60)),
    gutter: document.querySelectorAll("#market-hub-gutter span").length,
  };
})()`);
await shot("smoke-01-market-hub");

// 2. Quotes document (F7) and chart document (F9).
await pressKey("F7");
await sleep(2500);
report.quotes = await evaluate(`(() => {
  const panel = document.querySelector("#market-view");
  const content = document.querySelector("#market-content");
  return {
    tab: document.querySelector(".tab[data-doc-id='market-quotes']")?.dataset.label ?? null,
    hidden: panel?.hidden,
    lines: content?.querySelectorAll(":scope > .code-line").length ?? 0,
    state: document.querySelector("#market-state")?.textContent ?? null,
    hasWatchlist: content?.textContent.includes("g_Watchlist") ?? false,
    hasQuoteStruct: content?.textContent.includes("_Quote") ?? false,
    head: content?.textContent.slice(0, 220) ?? null,
  };
})()`);
await shot("smoke-02-quotes");

await pressKey("F9");
await sleep(2500);
report.chart = await evaluate(`(() => {
  const canvas = document.querySelector("#chart-canvas");
  return {
    tab: document.querySelector(".tab[data-doc-id='market-chart']")?.dataset.label ?? null,
    hidden: document.querySelector("#chart-view")?.hidden,
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    state: document.querySelector("#chart-state")?.textContent ?? null,
  };
})()`);
await shot("smoke-03-chart");

// 3. Workspace explorer.
report.workspaceRibbon = await click("#btn-hub-workspace");
await sleep(2500);
report.workspace = await evaluate(`(() => ({
  tab: document.querySelector(".tab[data-doc-id='workspace']")?.dataset.label ?? null,
  chip: document.querySelector("#workspace-chip")?.textContent ?? null,
  treeRows: document.querySelectorAll("#workspace-tree .ws-row").length,
  file: document.querySelector("#workspace-file")?.textContent ?? null,
  lines: document.querySelectorAll("#workspace-content .ws-line").length,
  hasSolution: document.querySelector("#workspace-content")?.textContent.includes("Visual Studio Solution") ?? false,
}))()`);
report.workspaceBuild = await click("#workspace-build-btn");
await sleep(1500);
report.build = await evaluate(`(() => ({
  output: document.querySelector("#workspace-output")?.textContent.slice(0, 200) ?? null,
  state: document.querySelector("#workspace-state")?.textContent ?? null,
}))()`);
await shot("smoke-04-workspace");

// 4. Games hub and one staged game (2048).
await click("#btn-hub-collab");
await sleep(600);
report.gamesHub = await evaluate(`(() => {
  const rows = [...document.querySelectorAll("#games-list .module-row")];
  return {
    count: rows.length,
    ids: rows.map((row) => row.dataset.gameId),
    features: [...document.querySelectorAll("#games-feature-list .module-row")].map((row) => row.dataset.featureId),
  };
})()`);
report.open2048 = await click('[data-game-id="2048"]');
await sleep(800);
report.game2048 = await evaluate(`(() => ({
  tab: document.querySelector(".tab[data-doc-id='game-stage']")?.dataset.label ?? null,
  title: document.querySelector("#game-stage-title")?.textContent ?? null,
  hostChildren: document.querySelector("#game-stage-host")?.childElementCount ?? 0,
  cells: document.querySelectorAll("#game-stage-host .stage-cell").length,
  buttons: document.querySelectorAll("#game-stage-host .stage-btn").length,
  text: document.querySelector("#game-stage-host")?.textContent.slice(0, 120) ?? null,
}))()`);
await shot("smoke-05-game-2048");

report.consoleErrors = consoleErrors.slice(0, 10);
report.ok =
  report.marketHub?.rows === 4 &&
  report.quotes?.lines > 0 &&
  report.workspace?.hasSolution === true &&
  report.gamesHub?.count >= 14 &&
  report.gamesHub?.features?.length === 7 &&
  report.game2048?.cells > 0 &&
  report.consoleErrors.length === 0;

writeFileSync(path.join(OUT, "smoke-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

ws.close();
proc.kill();
process.exit(report.ok ? 0 : 1);
