/**
 * Screenshots the app in a chosen theme.
 *
 *   node scripts/cdp-theme-shot.mjs <url> <dark|light> <out.png> [width]x[height]
 */
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const [url, theme = "dark", out = "shot.png", size = "1440x900"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((target) => target.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const payload = JSON.parse(String(raw));
  const resolver = pending.get(payload.id);
  if (resolver) {
    pending.delete(payload.id);
    resolver(payload);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, (payload) =>
      payload.error ? reject(new Error(JSON.stringify(payload.error))) : resolve(payload.result),
    );
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

// Same-origin visit first so localStorage is writable.
await send("Page.navigate", { url });
await sleep(1200);
await evaluate(`localStorage.setItem("dyno.theme", ${JSON.stringify(theme)})`);

await send("Page.navigate", { url });
await sleep(3500);

const state = await evaluate(
  `JSON.stringify({ theme: document.documentElement.dataset.theme, mode: document.querySelector("#editor")?.dataset.mode, rows: document.querySelectorAll(".log-row").length })`,
);
console.log("STATE:", state);

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("SHOT:", out);

socket.close();
process.exit(0);
