/**
 * Captures the collab document (code disguise) so a redesign can be judged
 * against what is actually rendered: idle, running, won, and detached.
 *
 *   node scripts/cdp-ttt-shots.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "https://realkhoa.github.io/DynoFreeChat/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9441;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `ttt-shots-${Date.now()}`);
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
for (let i = 0; i < 120 && wsUrl === null; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    // starting
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
  const m = JSON.parse(String(raw));
  if (m.id !== undefined) {
    const entry = pending.get(m.id);
    pending.delete(m.id);
    if (entry) (m.error ? entry.reject(new Error(JSON.stringify(m.error))) : entry.resolve(m.result));
    return;
  }
  for (const fn of events.get(m.method) ?? []) fn(m.params);
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
      events.set(method, (events.get(method) ?? []).filter((f) => f !== fn));
      resolve(params);
    };
    events.set(method, [...(events.get(method) ?? []), fn]);
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const loaded = once("Page.loadEventFired");
await send("Page.navigate", { url: APP_URL });
await loaded;
await sleep(900);

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result.value;
};
const click = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "ok"; })()`);
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
};

const report = {};

// 1. The collab button opens the document itself, no game window.
report.collabClick = await click("#btn-hub-collab");
await sleep(600);
report.idle = await shot("doc-01-idle");

// 2. Start a dual-thread session and play to a decided pattern.
report.startLocal = await click("#game-code-local-btn");
await sleep(400);
report.running = await shot("doc-02-running");

for (const cell of [0, 3, 1, 4, 2]) {
  await evaluate(`document.querySelector("#editor-cell-${cell}")?.click()`);
  await sleep(120);
}
report.won = await shot("doc-03-won");

report.buffer = await evaluate(`(() => {
  const cells = [...document.querySelectorAll("#editor-cell-0,#editor-cell-1,#editor-cell-2,#editor-cell-3,#editor-cell-4,#editor-cell-5,#editor-cell-6,#editor-cell-7,#editor-cell-8")];
  return {
    literals: cells.map((c) => c.textContent).join(" "),
    rowText: [...document.querySelectorAll(".matrix-row")].map((row) => row.textContent.trim()),
  };
})()`);

report.chrome = await evaluate(`(() => {
  const bar = document.querySelector(".game-code-statusbar");
  const gutter = document.querySelectorAll("#game-code-gutter span");
  const lines = document.querySelectorAll("#game-code-content .code-line");
  const cell = document.querySelector("#editor-cell-4");
  const r = cell?.getBoundingClientRect();
  return {
    statusbarText: bar?.innerText.replace(/\\n/g, " | "),
    gutterCount: gutter.length,
    lineCount: lines.length,
    cellW: r?.width,
    cellH: r?.height,
    cellBorder: cell ? getComputedStyle(cell).borderTopWidth : null,
    statusLine: document.querySelector("#game-code-status-line")?.textContent,
    scoreLine: document.querySelector("#game-code-score-line")?.textContent,
    vietnameseGameWords: /Lượt|chiến thắng|Ván|Người chơi|Đối thủ|Mã phòng|Hoà/.test(
      document.querySelector("#game-editor-panel")?.innerText ?? "",
    ),
  };
})()`);

// 3. Detach into the floating frame: the same document, same session.
report.detach = await click("#game-code-detach-btn");
await sleep(500);
report.detached = await shot("doc-04-detached");
report.detachState = await evaluate(`(() => {
  const panel = document.querySelector("#game-editor-panel");
  return {
    dialogOpen: document.querySelector("#game-dialog")?.open ?? false,
    panelParent: panel?.parentElement?.id,
    literals: document.querySelector("#editor-cell-0")?.textContent,
  };
})()`);

// 4. Dock back and confirm the session survived the move.
report.dock = await click("#game-dialog-dock-btn");
await sleep(400);
report.docked = await shot("doc-05-docked-back");
report.dockedState = await evaluate(`({
  dialogOpen: document.querySelector("#game-dialog")?.open ?? false,
  panelParent: document.querySelector("#game-editor-panel")?.parentElement?.id,
  literals: document.querySelector("#editor-cell-0")?.textContent,
})`);

console.log(JSON.stringify(report, null, 2));
ws.close();
proc.kill();
await sleep(200);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // disposable
}
