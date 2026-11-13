/**
 * Screenshots the Match.cs lobby (left form, right room list).
 *
 *   node scripts/cdp/cdp-match-shot.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9479;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `match-shot-${Date.now()}`);
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
    const page = list.find((target) => target.type === "page");
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
await sleep(1400);

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.text } : r.result.value;
};
const click = (selector) =>
  evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "ok"; })()`,
  );

await click("#btn-hub-collab");
await sleep(400);
await click('[data-feature-id="match"]');
await sleep(1800);

const report = await evaluate(`(() => ({
  left: document.querySelectorAll(".match-block").length,
  games: document.querySelectorAll("#match-game option").length,
  rooms: document.querySelectorAll(".match-room").length,
  status: document.querySelector("#match-status")?.textContent ?? null,
}))()`);

await click("#btn-hub-chat");
await sleep(1000);
report.chatPicker = await evaluate(`(() => ({
  text: (document.querySelector("#picker-list")?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 220),
  rows: document.querySelectorAll("#picker-list .picker-row, #picker-list li, #picker-list button").length,
}))()`);

const { data } = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(OUT, "match-lobby.png"), Buffer.from(data, "base64"));
console.log(JSON.stringify(report, null, 2));

ws.close();
proc.kill();
