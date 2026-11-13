/**
 * Verifies the Collab games hub: entries are big, clearly titled, and each opens its
 * own game tab.
 *
 *   node scripts/cdp/cdp-games-hub.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4319/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9461;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `games-hub-${Date.now()}`);
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
  const message = JSON.parse(String(raw));
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (entry)
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
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
await sleep(900);

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
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
};

const report = {};

report.collabClick = await click("#btn-hub-collab");
await sleep(500);

report.hub = await evaluate(`(() => {
  const panel = document.querySelector("#games-view");
  const cards = [...document.querySelectorAll(".game-card")];
  const first = cards[0]?.getBoundingClientRect();
  return {
    tabSelected: document.querySelector('[data-doc-id="games"]')?.getAttribute("aria-selected"),
    panelVisible: panel !== null && panel.offsetHeight > 0,
    crumb: document.querySelector("#crumb-room")?.textContent,
    cardCount: cards.length,
    firstTitle: cards[0]?.querySelector(".game-card-title")?.textContent,
    firstSubtitle: cards[0]?.querySelector(".game-card-subtitle")?.textContent,
    firstAria: cards[0]?.getAttribute("aria-label"),
    hitW: first === undefined ? null : Math.round(first.width),
    hitH: first === undefined ? null : Math.round(first.height),
    opensModal: [...document.querySelectorAll("dialog[open]")].length > 0,
  };
})()`);
report.hubShot = await shot("hub-01-games");

report.openGame = await click('[data-game-id="tictactoe"]');
await sleep(600);

report.afterOpen = await evaluate(`(() => ({
  gamesTabSelected: document.querySelector('[data-doc-id="games"]')?.getAttribute("aria-selected"),
  gameTabSelected: document.querySelector("#tab-game")?.getAttribute("aria-selected"),
  gameTabHidden: document.querySelector("#tab-game")?.hidden,
  gamePanelVisible: (document.querySelector("#game-editor-panel")?.offsetHeight ?? 0) > 0,
  crumb: document.querySelector("#crumb-room")?.textContent,
}))()`);
report.gameShot = await shot("hub-02-game-open");

report.backToHub = await click('[data-doc-id="games"]');
await sleep(400);
report.afterBack = await evaluate(`(() => ({
  gamesTabSelected: document.querySelector('[data-doc-id="games"]')?.getAttribute("aria-selected"),
  hubVisible: (document.querySelector("#games-view")?.offsetHeight ?? 0) > 0,
  gamePanelVisible: (document.querySelector("#game-editor-panel")?.offsetHeight ?? 0) > 0,
  crumb: document.querySelector("#crumb-room")?.textContent,
}))()`);
report.backShot = await shot("hub-03-back-to-hub");

console.log(JSON.stringify(report, null, 2));
ws.close();
proc.kill();
await sleep(200);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // disposable
}
