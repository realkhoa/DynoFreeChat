/**
 * Two Node clients in an existing production room, to tell a transport fault from
 * a browser-only one. Prints every frame each side receives.
 */

import WebSocket from "ws";

const WS = "wss://dynofreechat-api.nbk2124-z.workers.dev/ws";
const ORIGIN = "https://realkhoa.github.io";
const code = process.argv[2] ?? "ELCB";
const slug = `ttt-${code.toLowerCase()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?r=${slug}`, { headers: { Origin: ORIGIN } });
    const frames = [];
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      console.log(label, "recv", frame.t, frame.data ?? frame.code ?? frame.online);
    });
    ws.on("open", () => resolve({ ws, frames }));
    ws.on("close", (event) => console.log(label, "closed", event.code, event.reason));
    ws.on("error", (error) => reject(error));
  });
}

const a = await open("A");
a.ws.send(JSON.stringify({ t: "join", nick: "probe-a", color: "hsl(10 50% 50%)" }));
await sleep(600);

const b = await open("B");
b.ws.send(JSON.stringify({ t: "join", nick: "probe-b", color: "hsl(20 50% 50%)" }));
await sleep(600);

console.log("A hello out");
a.ws.send(JSON.stringify({ t: "game", data: '{"k":"hello","clientId":"probe-a","role":"X","nick":"probe-a"}' }));
await sleep(800);

console.log("B hello out");
b.ws.send(JSON.stringify({ t: "game", data: '{"k":"hello","clientId":"probe-b","role":"O","nick":"probe-b"}' }));
await sleep(800);

console.log(
  "SUMMARY",
  JSON.stringify({
    aTypes: a.frames.map((f) => f.t),
    bTypes: b.frames.map((f) => f.t),
    aGotGame: a.frames.filter((f) => f.t === "game").map((f) => f.data),
    bGotGame: b.frames.filter((f) => f.t === "game").map((f) => f.data),
  }),
);

a.ws.close();
b.ws.close();
