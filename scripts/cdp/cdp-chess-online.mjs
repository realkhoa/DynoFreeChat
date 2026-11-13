/**
 * Two-client online check: both tabs create/join the same Caro room through the
 * Match.cs lobby and play one move each, then the script verifies both boards.
 *
 *   node scripts/cdp/cdp-caro-online.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9475;
const OUT = path.resolve(".shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = path.join(tmpdir(), `caro-online-${Date.now()}`);
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

/** Waits for the DevTools endpoint. */
async function waitForDevTools() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.some((target) => target.type === "page")) return;
    } catch {
      // still starting
    }
    await sleep(100);
  }
  throw new Error("devtools endpoint did not start");
}

/**
 * @brief Opens one new tab and returns a small driver for it.
 * @param name Label used for screenshots.
 * @return The tab driver.
 */
async function openTab(name) {
  const created = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });

  const pending = new Map();
  const events = new Map();
  const errors = [];
  let nextId = 1;
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (entry) {
        message.error
          ? entry.reject(new Error(JSON.stringify(message.error)))
          : entry.resolve(message.result);
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

  events.set("Runtime.exceptionThrown", [
    (params) => errors.push(params.exceptionDetails?.text ?? "exception"),
  ]);
  events.set("Runtime.consoleAPICalled", [
    (params) => {
      if (params.type === "error")
        errors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? "?").join(" "));
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

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.text };
    return r.result.value;
  };
  const click = (selector) =>
    evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.click(); return "ok"; })()`,
    );
  const setValue = (selector, value) =>
    evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; })()`,
    );
  const shot = async (label) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, `online-${name}-${label}.png`), Buffer.from(data, "base64"));
  };

  return { name, send, once, evaluate, click, setValue, shot, ws, errors };
}

/** Opens the lobby from the Collab hub. */
async function openLobby(tab) {
  await tab.click("#btn-hub-collab");
  await sleep(400);
  await tab.click('[data-feature-id="match"]');
  await sleep(600);
}

await waitForDevTools();
const report = {};

const a = await openTab("host");
const b = await openTab("guest");

const loadedA = a.once("Page.loadEventFired");
await a.send("Page.navigate", { url: APP_URL });
await loadedA;
await sleep(1200);

const loadedB = b.once("Page.loadEventFired");
await b.send("Page.navigate", { url: APP_URL });
await loadedB;
await sleep(1200);

const slug = `chess-e2e-${Date.now().toString(36).slice(-4)}`;
report.slug = slug;

// Create the room from Node with a unique client IP: the Worker rate-limits room
// creation per IP, and the browser tabs share one. Both tabs then only join.
const LOCAL = APP_URL.includes("localhost");
if (LOCAL) {
  const created = await fetch(`${APP_URL.replace(/\/$/, "")}`.replace(":4173", ":8787") + "/api/rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`,
    },
    body: JSON.stringify({ slug }),
  });
  report.createStatus = created.status;
}

await openLobby(a);
report.hostCreate = await a.evaluate(`(() => ({
  games: [...document.querySelectorAll("#match-game option")].map((option) => option.value),
  createVisible: document.querySelector("#match-create") !== null,
}))()`);
await a.setValue("#match-game", "chess");
await a.setValue("#match-slug", slug);
if (LOCAL) await a.click("#match-join");
else await a.click("#match-create");
await sleep(2500);
report.hostLobby = await a.evaluate(`document.querySelector("#match-status")?.textContent ?? null`);

await openLobby(b);
await b.setValue("#match-game", "chess");
await b.setValue("#match-slug", slug);
await b.click("#match-join");
await sleep(3000);
report.guestLobby = await b.evaluate(`(() => ({
  status: document.querySelector("#match-status")?.textContent ?? null,
  phase: document.querySelector("#match-view")?.dataset.phase ?? null,
  hostStatus: null,
}))()`);
report.hostPhase = await a.evaluate(`document.querySelector("#match-view")?.dataset.phase ?? null`);
report.hostStatus = await a.evaluate(`document.querySelector("#match-status")?.textContent ?? null`);
report.hostErrors = a.errors.slice(0, 5);
report.guestErrors = b.errors.slice(0, 5);

const boardState = (tab) =>
  tab.evaluate(`(() => ({
    tab: document.querySelector(".tab[data-doc-id='game-stage']")?.dataset.label ?? null,
    status: document.querySelector(".stage-status")?.textContent ?? null,
    cells: document.querySelectorAll("#game-stage-host .stage-cell").length,
    marks: [...document.querySelectorAll("#game-stage-host .stage-cell")].map((cell) => cell.textContent),
  }))()`);

/** Waits until one tab has both the match running and the board mounted. */
async function waitReady(tab) {
  for (let i = 0; i < 40; i += 1) {
    const ready = await tab.evaluate(`(() => ({
      cells: document.querySelectorAll("#game-stage-host .stage-cell").length,
      phase: document.querySelector("#match-view")?.dataset.phase ?? null,
    }))()`);
    if (ready.cells === 64 && ready.phase === "playing") return true;
    await sleep(250);
  }
  return false;
}

report.ready = { host: await waitReady(a), guest: await waitReady(b) };
report.hostBoard = await boardState(a);
report.guestBoard = await boardState(b);

// Role election is by session id, so find out which tab owns seat 1 (X) instead
// of assuming the tab that created the room hosts.
const seatOf = (tab) =>
  tab.evaluate(
    `(() => (document.querySelector("#game-stage-host .stage-bar")?.textContent ?? "").includes("you are white") ? 1 : 2)()`,
  );
const seatA = await seatOf(a);
const seatB = await seatOf(b);
report.seats = { host: seatA, guest: seatB };
const first = seatA === 1 ? a : b;
const second = seatA === 1 ? b : a;

// White opens e2-e4 (indexes 52 -> 36 on an a8-first board), then Black answers
// e7-e5 (12 -> 28). A chess move is two clicks: source square, then target.
const playMove = async (tab, from, to) => {
  await tab.evaluate(
    `(() => { document.querySelectorAll("#game-stage-host .stage-cell")[${from}]?.click(); return "ok"; })()`,
  );
  await sleep(250);
  await tab.evaluate(
    `(() => { document.querySelectorAll("#game-stage-host .stage-cell")[${to}]?.click(); return "ok"; })()`,
  );
};
await playMove(first, 52, 36);
await sleep(1200);
report.afterHostMove = { host: await boardState(a), guest: await boardState(b) };

await playMove(second, 12, 28);
await sleep(1200);
report.afterGuestMove = { host: await boardState(a), guest: await boardState(b) };

await a.shot("board");
await b.shot("board");

report.ok =
  report.hostCreate?.games?.includes("chess") === true &&
  report.hostBoard?.cells === 64 &&
  report.guestBoard?.cells === 64 &&
  report.seats?.host !== report.seats?.guest &&
  report.afterHostMove?.host?.marks?.[36] === "♙" &&
  report.afterHostMove?.guest?.marks?.[36] === "♙" &&
  report.afterGuestMove?.host?.marks?.[28] === "♟" &&
  report.afterGuestMove?.guest?.marks?.[28] === "♟";

writeFileSync(path.join(OUT, "online-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

a.ws.close();
b.ws.close();
proc.kill();
process.exit(report.ok ? 0 : 1);
