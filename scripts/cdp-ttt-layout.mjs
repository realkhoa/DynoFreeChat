/**
 * Headless visual verification for the Tic-Tac-Toe board.
 *
 * Drives Chrome through CDP instead of a UI session: the app is served by
 * `npm run preview -w web`, the game is opened the way the ribbon opens it, and
 * every claim about layout or animation is read back from the live DOM.
 *
 * Usage: node scripts/cdp-ttt-layout.mjs [url]
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4319/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9411;
const OUT_DIR = path.resolve(".shots");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error("chrome devtools endpoint never came up");
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const events = new Map();

  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (entry === undefined) return;
      if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return;
    }
    for (const handler of events.get(message.method) ?? []) handler(message.params);
  });

  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const once = (method) =>
    new Promise((resolve) => {
      const handler = (params) => {
        events.set(method, (events.get(method) ?? []).filter((fn) => fn !== handler));
        resolve(params);
      };
      events.set(method, [...(events.get(method) ?? []), handler]);
    });

  return { socket, ready, send, once };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const profile = path.join(tmpdir(), `ttt-verify-${Date.now()}`);

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const findings = [];
  let cdp;

  try {
    const wsUrl = await waitForEndpoint();
    cdp = connect(wsUrl);
    await cdp.ready;

    const { send } = cdp;
    await send("Page.enable");
    await send("Runtime.enable");

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails !== undefined) {
        throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
      }
      return result.result.value;
    };

    const shot = async (name) => {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT_DIR, `${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    };

    const click = (selector) =>
      evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el === null) return "missing";
        el.click();
        return "ok";
      })()`);

    const setViewport = (width, height) =>
      send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

    const load = async () => {
      const loaded = cdp.once("Page.loadEventFired");
      await send("Page.navigate", { url: URL_UNDER_TEST });
      await loaded;
      await sleep(400);
    };

    const measure = () =>
      evaluate(`(() => {
        const visible = (el) => el !== null && el.getBoundingClientRect().width > 0;
        const dialog = document.querySelector("#game-dialog");
        const dialogOpen = dialog !== null && dialog.open;
        const cells = [...document.querySelectorAll("#game-cell-4, #editor-cell-4")].filter(visible);
        const cell = cells[0] ?? null;
        const rect = cell === null ? null : cell.getBoundingClientRect();
        const grid = [...document.querySelectorAll(".game-grid")].filter(visible)[0] ?? null;
        const gridRect = grid === null ? null : grid.getBoundingClientRect();
        const panel = document.querySelector("#game-editor-panel");
        const panelVisible = panel !== null && panel.getBoundingClientRect().width > 0;
        const codeContent = document.querySelector(".game-code-content");
        const matrixRow = [...document.querySelectorAll(".matrix-row")].filter(visible)[0] ?? null;
        const matrixRect = matrixRow === null ? null : matrixRow.getBoundingClientRect();
        return {
          innerWidth,
          innerHeight,
          dialogOpen,
          panelVisible,
          cellWidth: rect === null ? null : Math.round(rect.width * 10) / 10,
          cellHeight: rect === null ? null : Math.round(rect.height * 10) / 10,
          gridBottom: gridRect === null ? null : Math.round(gridRect.bottom * 10) / 10,
          gridFitsViewport: gridRect === null ? null : gridRect.bottom <= innerHeight + 0.5,
          dialogOverflows: dialogOpen && dialog !== null ? dialog.scrollHeight > dialog.clientHeight + 1 : null,
          codeScrollWidth: codeContent === null ? null : codeContent.scrollWidth,
          codeClientWidth: codeContent === null ? null : codeContent.clientWidth,
          matrixRight: matrixRect === null ? null : Math.round(matrixRect.right * 10) / 10,
          matrixFits: matrixRect === null ? null : matrixRect.right <= innerWidth + 0.5,
          stealthBlur: dialog === null ? null : getComputedStyle(dialog).filter,
          cellWinAnimation:
            grid === null
              ? null
              : (() => {
                  const won = grid.querySelector(".cell-win");
                  if (won === null) return "no-win-cell";
                  const style = getComputedStyle(won);
                  const after = getComputedStyle(won, "::after");
                  return {
                    self: style.animationName,
                    after: after.animationName,
                    iterations: after.animationIterationCount,
                  };
                })(),
        };
      })()`);

    // ---------------------------------------------------------------- scenario 1: docked tab, wide
    await setViewport(1280, 720);
    await load();
    findings.push({ step: "ribbon tictactoe", click: await click('[data-action="tictactoe"]') });
    await sleep(300);
    findings.push({ step: "click local", click: await click("#game-code-local-btn") });
    await sleep(300);
    findings.push({ scenario: "docked 1280x720", ...(await measure()) });
    findings.push({ shot: await shot("docked-wide") });

    // ---------------------------------------------------------------- scenario 2: docked tab, short viewport
    await setViewport(430, 760);
    await sleep(200);
    findings.push({ scenario: "docked 430x760", ...(await measure()) });
    findings.push({ shot: await shot("docked-narrow") });

    // ---------------------------------------------------------------- scenario 3: float dialog
    findings.push({ step: "float dialog", click: await click("#game-code-float-btn") });
    await sleep(300);
    findings.push({ step: "dialog local", click: await click("#game-local-btn") });
    await sleep(300);
    findings.push({ scenario: "dialog 430x760", ...(await measure()) });
    findings.push({ shot: await shot("dialog-narrow") });

    // ---------------------------------------------------------------- scenario 4: play a full round to a win
    const play = async (cell) => {
      const result = await evaluate(`(() => {
        const el = document.querySelector("#game-cell-${cell}");
        if (el === null) return "missing";
        if (el.disabled) return "blocked";
        el.click();
        return el.textContent;
      })()`);
      await sleep(120);
      return result;
    };

    // Local pass-and-play, so the win is deterministic: X takes row 0-1-2
    // while O answers on 3 and 4.
    const moves = [];
    for (const cell of [0, 3, 1, 4, 2]) moves.push({ cell, result: await play(cell) });
    findings.push({ scenario: "local round", moves });
    findings.push({ scenario: "after win", ...(await measure()) });
    findings.push({
      scenario: "win highlight",
      detail: await evaluate(`(() => {
        const won = [...document.querySelectorAll("#game-cell-0, #game-cell-1, #game-cell-2")];
        return won.map((cell) => ({
          text: cell.textContent,
          win: cell.classList.contains("cell-win"),
          selfAnimation: getComputedStyle(cell).animationName,
          afterAnimation: getComputedStyle(cell, "::after").animationName,
          iterations: getComputedStyle(cell, "::after").animationIterationCount,
          duration: getComputedStyle(cell, "::after").animationDuration,
        }));
      })()`),
    });
    findings.push({
      scenario: "score",
      detail: await evaluate(`({
        x: document.querySelector("#game-score-x")?.textContent,
        o: document.querySelector("#game-score-o")?.textContent,
        status: document.querySelector("#game-code-status-line")?.textContent,
      })`),
    });
    findings.push({ shot: await shot("dialog-win") });

    // ---------------------------------------------------------------- scenario 5: desktop dialog
    await setViewport(1440, 900);
    await sleep(250);
    findings.push({ scenario: "dialog 1440x900", ...(await measure()) });
    findings.push({ shot: await shot("dialog-wide") });

    console.log(JSON.stringify(findings, null, 2));
  } finally {
    cdp?.socket.close();
    chrome.kill();
    await sleep(200);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a lock; the temp dir is disposable.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
