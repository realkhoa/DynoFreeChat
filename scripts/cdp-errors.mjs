/**
 * Prints page console errors and uncaught exceptions while loading a URL.
 *
 *   node scripts/cdp-errors.mjs <url>
 */
import WebSocket from "ws";

const url = process.argv[2];
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
  if (payload.method === "Runtime.exceptionThrown") {
    const details = payload.params.exceptionDetails;
    console.log("EXCEPTION:", details.exception?.description ?? details.text);
  }
  if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
    console.log("CONSOLE.ERROR:", payload.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  }
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

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(3500);

const state = await send("Runtime.evaluate", {
  expression: "JSON.stringify({ mode: document.querySelector('#editor')?.dataset.mode, rooms: document.querySelectorAll('.tree-row').length })",
  returnByValue: true,
});
console.log("STATE:", state.result?.value);

socket.close();
process.exit(0);
