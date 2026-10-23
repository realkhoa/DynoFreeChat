/**
 * Exercises reply + mention completion in a real page.
 *
 *   node scripts/cdp-interact.mjs <url>
 */
import WebSocket from "ws";

const url = process.argv[2] ?? "http://localhost:5199/?r=chung";
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
await send("Page.navigate", { url });
await sleep(3000);

// 1. reply via the hover action on a chat row
console.log(
  "reply clicked:",
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.log-row[data-kind="chat"]')];
    const row = rows[rows.length - 1];
    const button = row?.querySelector('.log-action[aria-label="Trả lời tin này"]');
    if (!button) return "no action button";
    button.click();
    const banner = document.querySelector('#dock-reply');
    return JSON.stringify({
      hidden: banner?.hidden,
      nick: document.querySelector('#dock-reply-nick')?.textContent,
      excerpt: document.querySelector('#dock-reply-excerpt')?.textContent?.slice(0, 24),
    });
  })()`),
);

// 2. typing "@" opens mention completion
console.log(
  "mention menu:",
  await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    input.focus();
    input.value = 'chào @k';
    input.setSelectionRange(8, 8);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const menu = document.querySelector('#mention-menu');
    return JSON.stringify({ hidden: menu?.hidden, items: [...menu.querySelectorAll('.mention-item')].map(i => i.textContent) });
  })()`),
);

// 3. accepting the first suggestion rewrites the token
console.log(
  "accept suggestion:",
  await evaluate(`(() => {
    const item = document.querySelector('#mention-menu .mention-item');
    if (!item) return "no item";
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const input = document.querySelector('#composer-input');
    return JSON.stringify({ value: input.value, caret: input.selectionStart, menuHidden: document.querySelector('#mention-menu').hidden });
  })()`),
);

// 4. sending while a reply target is set carries the quote
console.log(
  "send with reply:",
  await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    input.value = 'kiểm tra reply';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return JSON.stringify({ bannerHidden: document.querySelector('#dock-reply').hidden, inputEmpty: input.value === "" });
  })()`),
);

await sleep(1500);
console.log(
  "last row has quote:",
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.log-row[data-kind="chat"]')];
    const row = rows[rows.length - 1];
    return JSON.stringify({ text: row?.querySelector('.log-text')?.textContent, quote: row?.querySelector('.log-quote-text')?.textContent });
  })()`),
);

socket.close();
process.exit(0);
