/**
 * Two-client end-to-end verification for Tic-Tac-Toe multiplayer.
 *
 * Runs two independent headless Chrome instances against the built app and the
 * local worker, then plays a full online round across them and reads the result
 * out of both DOMs. Proves the handshake, the sync and the move relay for real
 * rather than through a fake socket.
 *
 * Usage: node scripts/cdp-ttt-online.mjs [appUrl]
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const APP_URL = process.argv[2] ?? "http://localhost:4319/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = path.resolve(".shots");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Browser {
  constructor(port) {
    this.port = port;
    this.profile = path.join(tmpdir(), `ttt-e2e-${port}-${Date.now()}`);
    this.pending = new Map();
    this.nextId = 1;
    this.events = new Map();
    this.trace = [];
  }

  async launch() {
    this.proc = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${this.profile}`,
        "--window-size=1280,860",
        "about:blank",
      ],
      { stdio: "ignore" },
    );

    let wsUrl = null;
    for (let attempt = 0; attempt < 120 && wsUrl === null; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page !== undefined) wsUrl = page.webSocketDebuggerUrl;
      } catch {
        // still starting
      }
      if (wsUrl === null) await sleep(100);
    }
    if (wsUrl === null) throw new Error(`no devtools endpoint on ${this.port}`);

    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => this.dispatch(JSON.parse(String(raw))));

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
  }

  dispatch(message) {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (entry === undefined) return;
      if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return;
    }

    const params = message.params ?? {};
    switch (message.method) {
      case "Network.webSocketCreated":
        this.trace.push({ wsCreated: params.url });
        break;
      case "Network.webSocketHandshakeResponseReceived":
        this.trace.push({ wsHandshake: params.response?.status });
        break;
      case "Network.webSocketFrameReceived": {
        let kind = null;
        try {
          kind = JSON.parse(params.response?.payloadData ?? "{}").t ?? null;
        } catch {
          kind = null;
        }
        this.trace.push({ frame: kind });
        break;
      }
      case "Network.webSocketFrameSent": {
        let kind = null;
        try {
          kind = JSON.parse(params.response?.payloadData ?? "{}").t ?? null;
        } catch {
          kind = null;
        }
        this.trace.push({ sent: kind });
        break;
      }
      case "Network.loadingFailed":
        this.trace.push({ error: `${params.errorText} ${params.type ?? ""}` });
        break;
      case "Runtime.exceptionThrown":
        this.trace.push({ exception: params.exceptionDetails?.exception?.description?.slice(0, 200) });
        break;
    }

    for (const handler of this.events.get(message.method) ?? []) handler(params);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.events.set(method, (this.events.get(method) ?? []).filter((fn) => fn !== handler));
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) ?? []), handler]);
    });
  }

  async goto(url) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    await sleep(500);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }

  click(selector) {
    return this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return "missing";
      el.click();
      return "ok";
    })()`);
  }

  async shot(name) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  /**
   * Returns the transport trace, so a run that never becomes live shows whether
   * the socket opened and whether game frames actually arrived.
   */
  probeSockets() {
    return {
      wsUrls: this.trace.filter((entry) => entry.wsCreated !== undefined).map((entry) => entry.wsCreated),
      wsHandshake: this.trace.filter((entry) => entry.wsHandshake !== undefined).map((entry) => entry.wsHandshake),
      received: this.trace.filter((entry) => entry.frame !== undefined).map((entry) => entry.frame),
      sent: this.trace.filter((entry) => entry.sent !== undefined).map((entry) => entry.sent),
      errors: this.trace.filter((entry) => entry.error !== undefined),
      exceptions: this.trace.filter((entry) => entry.exception !== undefined).slice(-3),
    };
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.proc?.kill();
    await sleep(150);
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      // temp profile, disposable
    }
  }
}

const boardState = `(() => {
  const cells = [...document.querySelectorAll("#editor-cell-0,#editor-cell-1,#editor-cell-2,#editor-cell-3,#editor-cell-4,#editor-cell-5,#editor-cell-6,#editor-cell-7,#editor-cell-8")];
  return {
    board: cells.map((cell) => (cell.textContent === "·" ? "." : cell.textContent)).join(""),
    enabled: cells.filter((cell) => !cell.disabled).length,
    turn: document.querySelector("#game-turn-indicator")?.textContent,
    badge: document.querySelector("#game-code-room-badge")?.textContent,
    status: document.querySelector("#game-code-status-line")?.textContent,
    score: document.querySelector("#game-code-score-line")?.textContent,
    legacyRows: document.querySelectorAll('.log-row[data-legacy="1"]').length,
    chatRows: document.querySelectorAll(".log-row").length,
  };
})()`;

async function openGame(browser) {
  await browser.click('[data-action="tictactoe"]');
  await sleep(400);
  await browser.click("#game-code-lobby-btn");
  await sleep(300);
}

/**
 * Polls until the board is live (connected, opponent present). Fixed sleeps were
 * unreliable against a cold Cloudflare Durable Object.
 */
async function waitForLive(browser, label, timeoutMs = 25000) {
  const started = Date.now();
  for (;;) {
    const state = await browser.evaluate(boardState);
    const status = state.status ?? "";
    const settled =
      !status.includes("Đang kết nối") && !status.includes("chờ đối thủ") && !status.includes("Không ");
    if (settled) return { label, waitedMs: Date.now() - started, ...state };
    if (Date.now() - started > timeoutMs) return { label, waitedMs: -1, ...state };
    await sleep(250);
  }
}

async function clickCell(browser, cell) {
  const result = await browser.evaluate(`(() => {
    const el = document.querySelector("#editor-cell-${cell}");
    if (el === null) return "missing";
    if (el.disabled) return "blocked";
    el.click();
    return "clicked";
  })()`);
  await sleep(350);
  return result;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const findings = [];
  const alice = new Browser(9421);
  const bob = new Browser(9422);

  try {
    await alice.launch();
    await bob.launch();
    await alice.goto(APP_URL);
    await bob.goto(APP_URL);

    const beforeAlice = await alice.evaluate(boardState);
    const beforeBob = await bob.evaluate(boardState);
    findings.push({ step: "chat rows before game", alice: beforeAlice.chatRows, bob: beforeBob.chatRows });

    // Pass an existing 4-character code to skip room creation (the create API is
    // rate limited per IP, and two players typing the same code is a real case).
    const presetCode = process.argv[3] ?? null;
    let code = presetCode;

    if (code === null) {
      await openGame(alice);
      findings.push({ step: "create", click: await alice.click("#game-create-btn") });
      await sleep(1200);
      const hosted = await alice.evaluate(boardState);
      findings.push({ step: "hosted", hosted });
      code = /Session:\s*([A-Z0-9]{4})/.exec(hosted.badge ?? "")?.[1] ?? null;
      if (code === null) throw new Error(`could not read the room code from ${JSON.stringify(hosted.badge)}`);
      findings.push({ step: "room code", code });
    } else {
      findings.push({ step: "preset room code", code });
    }

    // ---- both players enter the room; the preset path also joins as host side
    const joinByCode = async (browser) => {
      await openGame(browser);
      await browser.evaluate(`(() => {
        const input = document.querySelector("#game-code-input");
        input.value = ${JSON.stringify(code)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      })()`);
      await browser.click("#game-join-btn");
    };

    if (code === presetCode) await joinByCode(alice);
    await joinByCode(bob);

    findings.push({ step: "alice live", ...(await waitForLive(alice, "alice")) });
    findings.push({ step: "bob live", ...(await waitForLive(bob, "bob")) });
    findings.push({ step: "after join", alice: await alice.evaluate(boardState), bob: await bob.evaluate(boardState) });

    // Diagnostics also ride on the room, so a stuck run still shows why.
    findings.push({ step: "socket probes", alice: await alice.probeSockets(), bob: await bob.probeSockets() });

    // Whoever ended up as X opens, which can be either browser when both typed
    // the same code and the role tiebreak switched one of them.
    const roleOf = (state) => (/(?:\(|\s)([XO])\)?\s*$/.exec(state.badge ?? "")?.[1] ?? null);
    const aliceRole = roleOf(await alice.evaluate(boardState));
    const bobRole = roleOf(await bob.evaluate(boardState));
    findings.push({ step: "roles", aliceRole, bobRole });

    if (aliceRole === bobRole) throw new Error(`roles did not settle: ${aliceRole}/${bobRole}`);
    const xName = aliceRole === "X" ? "alice" : "bob";
    const oName = xName === "alice" ? "bob" : "alice";
    const actor = (name) => (name === "alice" ? alice : bob);

    // ---- a full round: X wins on row 0-1-2, O answers on 4 and 5
    const moves = [];
    const steps = [
      [xName, 0],
      [oName, 0], // already taken by X: must be refused
      [oName, 4],
      [xName, 1],
      [oName, 5],
      [xName, 2],
    ];
    for (const [who, cell] of steps) {
      const result = await clickCell(actor(who), cell);
      moves.push({ who, cell, result });
      await sleep(300);
      findings.push({
        move: `${who}:${cell}`,
        alice: await alice.evaluate(boardState),
        bob: await bob.evaluate(boardState),
      });
    }
    findings.push({ step: "moves", moves });

    const finalAlice = await alice.evaluate(boardState);
    const finalBob = await bob.evaluate(boardState);
    findings.push({
      verdict: {
        boardsMatch: finalAlice.board === finalBob.board,
        aliceBoard: finalAlice.board,
        bobBoard: finalBob.board,
        aliceScore: finalAlice.score,
        bobScore: finalBob.score,
        aliceStatus: finalAlice.status,
        bobStatus: finalBob.status,
        chatRowsAfter: [finalAlice.chatRows, finalBob.chatRows],
        legacyRows: [finalAlice.legacyRows, finalBob.legacyRows],
      },
    });

    findings.push({ shot: await alice.shot("online-host") });
    findings.push({ shot: await bob.shot("online-peer") });

    // ---- rematch relayed, starter alternates to O on both sides
    findings.push({ step: "rematch", click: await actor(xName).click("#game-code-rematch-btn") });
    await sleep(1200);
    const rematchAlice = await alice.evaluate(boardState);
    const rematchBob = await bob.evaluate(boardState);
    findings.push({
      rematch: {
        aliceBoard: rematchAlice.board,
        bobBoard: rematchBob.board,
        aliceTurn: rematchAlice.turn,
        bobTurn: rematchBob.turn,
        aliceEnabled: rematchAlice.enabled,
        bobEnabled: rematchBob.enabled,
      },
    });
    findings.push({ shot: await alice.shot("online-rematch") });

    console.log(JSON.stringify(findings, null, 2));
  } catch (error) {
    // Print what was observed so a failed run explains itself.
    console.error(JSON.stringify(findings, null, 2));
    throw error;
  } finally {
    await alice.close();
    await bob.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
