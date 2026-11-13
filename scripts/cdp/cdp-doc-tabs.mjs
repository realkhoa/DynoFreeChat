/**
 * Verifies that toolbar entries open document tabs instead of modals.
 *
 *   node scripts/cdp/cdp-doc-tabs.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4319/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9451;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `doc-tabs-${Date.now()}`);
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

/** Snapshot of the tab strip and panels. */
const state = () =>
  evaluate(`(() => {
    const tabs = [...document.querySelectorAll(".tab[data-doc-id]")].map((tab) => ({
      id: tab.dataset.docId,
      selected: tab.getAttribute("aria-selected"),
    }));
    const panel = (id) => {
      const el = document.querySelector("#" + id);
      return el === null ? null : { hidden: el.hidden, offsetHeight: el.offsetHeight };
    };
    return {
      tabs,
      settings: panel("settings-view"),
      rooms: panel("rooms-view"),
      collabPanelHidden: document.querySelector("#game-editor-panel")?.hidden,
      chatHidden: document.querySelector(".logwrap")?.hidden,
      crumb: document.querySelector("#crumb-room")?.textContent,
      modals: [...document.querySelectorAll("dialog")].map((d) => d.id),
      openModal: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
    };
  })()`);

const report = {};

report.before = await state();

report.clickSettings = await click("#btn-hub-setting");
await sleep(400);
report.afterSettings = await state();
report.settingsShot = await shot("tabs-01-settings");

report.clickNewTab = await click("#tab-new");
await sleep(400);
report.afterRooms = await state();
report.roomsShot = await shot("tabs-02-rooms");

report.backToSettings = await click('[data-doc-id="settings"]');
await sleep(300);
report.afterBack = await state();

report.clickCollab = await click("#btn-hub-collab");
await sleep(500);
report.afterCollab = await state();

report.backToSettings2 = await click('[data-doc-id="settings"]');
await sleep(300);
report.afterSettingsAgain = await state();

// Close the settings tab: the view must fall back to a real document.
report.closeSettings = await click('[data-doc-id="settings"] .tab-close');
await sleep(400);
report.afterClose = await state();
report.closeShot = await shot("tabs-03-after-close");

report.clickRoomsAgain = await click("#tab-new");
await sleep(300);
report.afterRoomsAgain = await state();

console.log(JSON.stringify(report, null, 2));
ws.close();
proc.kill();
await sleep(200);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // disposable
}
