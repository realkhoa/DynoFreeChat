/**
 * Production check for the presence chip and online list.
 *
 *   node scripts/cdp/cdp-presence-shot.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "https://realkhoa.github.io/DynoFreeChat/";
const API = "https://dynofreechat-api.nbk2124-z.workers.dev";
const ORIGIN = "https://realkhoa.github.io";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9487;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });

const slug = `presence-${Math.random().toString(36).slice(2, 8)}`;
const created = await fetch(`${API}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ slug }),
});
if (created.status !== 201) throw new Error(`create failed: ${created.status} ${await created.text()}`);

const profile = path.join(tmpdir(), `presence-shot-${Date.now()}`);
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
if (wsUrl === null) throw new Error("chrome did not expose a debugging target");

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

const pending = new Map();
const events = new Map();
const consoleErrors = [];
let nextId = 1;
ws.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (entry) {
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails?.text ?? "exception");
  }
  for (const handler of events.get(message.method) ?? []) handler(message.params);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) =>
  new Promise((resolve) => {
    const handler = (params) => {
      events.set(
        method,
        (events.get(method) ?? []).filter((fn) => fn !== handler),
      );
      resolve(params);
    };
    events.set(method, [...(events.get(method) ?? []), handler]);
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
await send("Page.navigate", { url: `${APP_URL}?r=${slug}` });
await loaded;
await sleep(2500);

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result.exceptionDetails ? { error: result.exceptionDetails.text } : result.result.value;
};
const click = (selector) =>
  evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "ok"; })()`,
  );

const welcome = await evaluate(`(() => ({
  room: document.querySelector("#titlebar-room")?.textContent ?? null,
  chipHidden: document.querySelector("#presence-chip")?.hidden ?? null,
  chipCount: document.querySelector("#presence-count")?.textContent ?? null,
}))()`);

// A second user joins from Node and announces away + unfocus.
const bob = new WebSocket(`${API.replace("https", "wss")}/ws?r=${slug}`, {
  headers: { origin: ORIGIN },
});
const bobFrames = [];
bob.on("message", (raw) => bobFrames.push(JSON.parse(String(raw))));
await new Promise((resolve, reject) => {
  bob.once("open", resolve);
  bob.once("error", reject);
});
bob.send(JSON.stringify({ t: "join", nick: "bob", color: "hsl(120 60% 55%)" }));
await sleep(400);
bob.send(JSON.stringify({ t: "ping", state: "away", unfocus: true }));
const keepAlive = setInterval(
  () => bob.send(JSON.stringify({ t: "ping", state: "away", unfocus: true })),
  5000,
);
await sleep(700);

const chip = await evaluate(`(() => ({
  hidden: document.querySelector("#presence-chip")?.hidden ?? null,
  count: document.querySelector("#presence-count")?.textContent ?? null,
  away: document.querySelector("#presence-chip")?.dataset.away ?? null,
  title: document.querySelector("#presence-chip")?.title ?? null,
}))()`);

const fullShot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(OUT, "presence-chip.png"), Buffer.from(fullShot.data, "base64"));

await click("#presence-chip");
await sleep(300);
const panel = await evaluate(`(() => ({
  open: !(document.querySelector("#presence-panel")?.hidden ?? true),
  hint: document.querySelector("#presence-hint")?.textContent ?? null,
  rows: [...document.querySelectorAll(".presence-row")].map((row) => ({
    name: row.querySelector(".presence-name")?.textContent ?? null,
    tag: row.querySelector(".presence-tag")?.textContent ?? null,
    state: row.dataset.state ?? null,
    unfocus: row.dataset.unfocus ?? null,
  })),
}))()`);
const panelShot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(OUT, "presence-panel.png"), Buffer.from(panelShot.data, "base64"));

const bobSeen = bobFrames.find(
  (frame) =>
    frame.t === "presence" && frame.users.some((user) => user.nick === "bob" && user.state === "away"),
);

clearInterval(keepAlive);
bob.close();
ws.close();
proc.kill();

const report = { slug, welcome, chip, panel, bobSawOwnState: bobSeen !== undefined, consoleErrors };
console.log(JSON.stringify(report, null, 2));

const ok =
  chip.hidden === false &&
  chip.count === "2" &&
  panel.open === true &&
  panel.rows.some((row) => row.name === "bob" && row.state === "away" && row.unfocus === "true") &&
  panel.rows.some((row) => row.name?.includes("(you)")) &&
  bobSeen !== undefined &&
  consoleErrors.length === 0;
console.log(ok ? "OK: presence UI verified" : "FAIL: presence UI check failed");
process.exit(ok ? 0 : 1);
