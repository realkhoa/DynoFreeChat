/**
 * Drives a real Chromium over CDP: navigate, wait in real time, read the log
 * pane, optionally type and send a message, read the log again.
 *
 *   node scripts/cdp-check.mjs <url> [--send="text"] [--shot=out.png]
 *
 * Assumes Edge/Chrome is already listening on 127.0.0.1:9222.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const url = args[0];
const message = args.find((arg) => arg.startsWith("--send="))?.slice("--send=".length);
const shotPath = args.find((arg) => arg.startsWith("--shot="))?.slice("--shot=".length);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("no page target on 9222");

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

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, (payload) => {
      if (payload.error) reject(new Error(`${method}: ${JSON.stringify(payload.error)}`));
      else resolve(payload.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(4000);

console.log("STATUS:", await evaluate("document.querySelector('#statusbar')?.innerText.replace(/\\n/g, ' | ')"));
console.log("LOG:", JSON.stringify(await evaluate("document.querySelector('#log')?.innerText")));

if (message) {
  await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    input.value = ${JSON.stringify(message)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(1800);
  console.log("AFTER SEND:", JSON.stringify(await evaluate("document.querySelector('#log')?.innerText")));
}

if (shotPath) {
  const [width, height] = (args.find((arg) => arg.startsWith("--size="))?.slice("--size=".length) ?? "1440x900")
    .split("x")
    .map(Number);
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  console.log("SHOT:", shotPath);
}

socket.close();
process.exit(0);
