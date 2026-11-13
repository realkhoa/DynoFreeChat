/**
 * Screenshots the shared game stage for several games, so the code-document look
 * can be checked visually.
 *
 *   node scripts/cdp/cdp-game-shots.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9471;
const OUT = path.resolve(".shots");
const GAMES = ["caro", "chess", "minesweeper", "sudoku", "2048", "tictactoe"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `game-shots-${Date.now()}`);
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
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
};

await click("#btn-hub-collab");
await sleep(500);

const report = {};
for (const id of GAMES) {
  const opened = await click(`[data-game-id="${id}"]`);
  await sleep(900);
  report[id] = {
    opened,
    tab: await evaluate(`document.querySelector(".tab[data-doc-id='game-stage']")?.dataset.label ?? null`),
    cells: await evaluate(`document.querySelectorAll("#game-stage-host .stage-cell").length`),
    text: await evaluate(`document.querySelector("#game-stage-host")?.textContent.slice(0, 90) ?? null`),
  };
  await shot(`game-${id}`);
}

console.log(JSON.stringify(report, null, 2));
ws.close();
proc.kill();
