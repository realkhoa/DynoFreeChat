/**
 * Production check: opens the deployed app, verifies the Collab hub links, then
 * unlocks the market gate with the PIN and confirms live quotes render.
 *
 *   node scripts/cdp/cdp-prod-unlock.mjs [url] [pin]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "https://realkhoa.github.io/DynoFreeChat/";
const PIN = process.argv[3] ?? process.env.DYNO_PIN ?? "";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9467;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `prod-unlock-${Date.now()}`);
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

const consoleErrors = [];
events.set("Runtime.exceptionThrown", [
  (params) => consoleErrors.push(params.exceptionDetails?.text ?? "exception"),
]);
events.set("Runtime.consoleAPICalled", [
  (params) => {
    if (params.type === "error") {
      consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? "?").join(" "));
    }
  },
]);

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
await sleep(1500);

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

const report = { appUrl: APP_URL };

// 1. Collab hub links.
report.openCollab = await click("#btn-hub-collab");
await sleep(600);
report.collab = await evaluate(`(() => ({
  features: [...document.querySelectorAll("#games-feature-list .module-row")].map((row) => row.dataset.featureId),
  games: [...document.querySelectorAll("#games-list .module-row")].map((row) => row.dataset.gameId),
  chip: document.querySelector("#games-code-chip")?.textContent ?? null,
}))()`);
await shot("prod-01-collab-hub");

// 2. Open the quotes document; the gate refuses and opens the access document.
report.openQuotes = await click('[data-feature-id="quotes"]');
await sleep(2000);
report.lockPrompt = await evaluate(`(() => ({
  lockTab: document.querySelector(".tab[data-doc-id='lock']")?.dataset.label ?? null,
  status: document.querySelector("#lock-status")?.textContent ?? null,
}))()`);

// 3. Unlock with the PIN.
report.fillPin = await evaluate(
  `(() => { const el = document.querySelector("#lock-pin"); if (!el) return "missing"; el.value = ${JSON.stringify(PIN)}; return "ok"; })()`,
);
report.submit = await click("#lock-submit");
await sleep(3000);
report.afterUnlock = await evaluate(`(() => ({
  lockStatus: document.querySelector("#lock-status")?.textContent ?? null,
  marketTab: document.querySelector(".tab[data-doc-id='market']")?.dataset.label ?? null,
  stored: localStorage.getItem("dyno.lock.session") !== null,
}))()`);

report.directFetch = await evaluate(`(async () => {
  const token = localStorage.getItem("dyno.lock.session");
  try {
    const res = await fetch("https://dynofreechat-api.nbk2124-z.workers.dev/api/market/quotes?symbols=FPT", {
      headers: { accept: "application/json", ...(token === null ? {} : { "x-dyno-lock": token }) },
    });
    return { status: res.status, body: (await res.text()).slice(0, 200), hasToken: token !== null };
  } catch (error) {
    return { error: String(error), hasToken: token !== null };
  }
})()`);

// 4. Quotes document with the session token.
await evaluate(
  `(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true })); return "ok"; })()`,
);
// The board refreshes on its own three second tick; poll instead of assuming
// one tick was enough, otherwise a slow upstream shows up as a false failure.
for (let attempt = 0; attempt < 20; attempt += 1) {
  const state = await evaluate(`document.querySelector("#market-state")?.textContent ?? null`);
  if (state === "Live") break;
  await sleep(600);
}
report.quotes = await evaluate(`(() => {
  const content = document.querySelector("#market-content");
  return {
    tab: document.querySelector(".tab[data-doc-id='market-quotes']")?.dataset.label ?? null,
    state: document.querySelector("#market-state")?.textContent ?? null,
    lines: content?.querySelectorAll(":scope > .code-line").length ?? 0,
    hasQuote: content?.textContent.includes("_Quote") ?? false,
  };
})()`);
await shot("prod-02-quotes-unlocked");

report.consoleErrors = consoleErrors.slice(0, 8);
report.ok =
  report.collab?.features?.length === 8 &&
  report.collab?.games?.length === 14 &&
  report.lockPrompt?.lockTab === "Access.cs" &&
  report.afterUnlock?.stored === true &&
  report.quotes?.state === "Live" &&
  report.quotes?.lines > 0 &&
  report.consoleErrors.length === 0;

writeFileSync(path.join(OUT, "prod-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

ws.close();
proc.kill();
process.exit(report.ok ? 0 : 1);
