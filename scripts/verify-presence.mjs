/**
 * Verifies production presence events and the heartbeat sweep against the
 * deployed Worker. Run: node scripts/verify-presence.mjs
 */
import WebSocket from "ws";

const BASE = "https://dynofreechat-api.nbk2124-z.workers.dev";
const ORIGIN = "https://realkhoa.github.io";
const slug = `presence-${Math.random().toString(36).slice(2, 8)}`;

const log = (...args) => console.log(new Date().toISOString(), ...args);

const created = await fetch(`${BASE}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ slug, kind: "game" }),
});
log("create", created.status, await created.text());
if (created.status !== 201) process.exit(1);

function connect(nick) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace("https", "wss")}/ws?r=${slug}`, {
      headers: { origin: ORIGIN },
    });
    const frames = [];
    const waiters = [];
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      for (const waiter of [...waiters]) {
        if (waiter.match(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(frame);
        }
      }
    });
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "join", nick, color: "hsl(200 60% 60%)" }));
      resolve({
        ws,
        frames,
        waitFor: (match, ms = 5000) =>
          new Promise((res, rej) => {
            const found = frames.find(match);
            if (found !== undefined) return res(found);
            const waiter = { match, resolve: res };
            waiters.push(waiter);
            setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              rej(new Error(`timeout; frames=${JSON.stringify(frames)}`));
            }, ms);
          }),
      });
    });
  });
}

const alice = await connect("alice");
const aliceWelcome = await alice.waitFor((frame) => frame.t === "welcome");
log("alice welcome users", JSON.stringify(aliceWelcome.users));

const bob = await connect("bob");
const bobWelcome = await bob.waitFor((frame) => frame.t === "welcome");
log("bob welcome users", JSON.stringify(bobWelcome.users));

bob.ws.send(JSON.stringify({ t: "ping", state: "away", unfocus: true }));
const presence = await alice.waitFor(
  (frame) =>
    frame.t === "presence" && frame.users.some((user) => user.nick === "bob" && user.state === "away"),
);
log("presence after bob ping", JSON.stringify(presence));

const bobState = presence.users.find((user) => user.nick === "bob");
if (!bobState?.unfocus) {
  console.error("FAIL: bob presence did not carry unfocus=true");
  process.exit(1);
}

// Bob keeps the connection alive; alice never pings again and must be swept.
const bobKeepAlive = setInterval(() => bob.ws.send(JSON.stringify({ t: "ping" })), 5000);
const aliceClosed = new Promise((resolve) =>
  alice.ws.on("close", (code, reason) => resolve({ code, reason })),
);
const started = Date.now();
const outcome = await Promise.race([
  aliceClosed,
  new Promise((resolve) => setTimeout(() => resolve(null), 50_000)),
]);
clearInterval(bobKeepAlive);

if (outcome === null) {
  console.error("FAIL: silent socket was not closed within 50s");
  process.exit(1);
}
log("silent socket closed", JSON.stringify(outcome), `after ${Date.now() - started}ms`);
if (outcome.code !== 4408) {
  console.error("FAIL: expected close code 4408");
  process.exit(1);
}

bob.ws.close();
log("OK: presence events and heartbeat sweep verified");
