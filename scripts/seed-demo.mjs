/**
 * Seeds a demo room so the UI can be inspected with realistic content.
 *
 *   node scripts/seed-demo.mjs [slug] [pass]
 *
 * Requires the worker to be running locally (`npm run dev:worker`).
 */
const API = process.env.API ?? "http://127.0.0.1:8787";
const WS = process.env.WS ?? "ws://127.0.0.1:8787/ws";

const slug = process.argv[2] ?? "demo";
const pass = process.argv[3] ?? "";

const created = await fetch(`${API}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug, pass }),
});

if (!created.ok && created.status !== 409) {
  throw new Error(`create room failed: ${created.status} ${await created.text()}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(nick, color) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS}?r=${slug}`);
    socket.addEventListener("open", () => {
      const frame = { t: "join", nick, color };
      if (pass.length > 0) frame.pass = pass;
      socket.send(JSON.stringify(frame));
    });
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data));
      if (frame.t === "welcome") resolve(socket);
      if (frame.t === "error") reject(new Error(`server refused: ${frame.code}`));
    });
    socket.addEventListener("error", () => reject(new Error("socket error")));
  });
}

/** Resolves with the id of the first `append` frame this socket sees. */
function firstAppendId(socket) {
  return new Promise((resolve) => {
    const listener = (event) => {
      const frame = JSON.parse(String(event.data));
      if (frame.t !== "append") return;
      socket.removeEventListener("message", listener);
      resolve(frame.m.id);
    };
    socket.addEventListener("message", listener);
  });
}

function say(socket, text) {
  socket.send(JSON.stringify({ t: "msg", cid: Math.random().toString(36).slice(2), text }));
}

const alice = await connect("khoan", "hsl(205 70% 62%)");
// Attach before sending so the first append (alice's own) is captured.
const rootIdPromise = firstAppendId(alice);
say(alice, "vừa deploy lên Pages, ae vào test thử");
await wait(150);

const bob = await connect("dyno", "hsl(275 60% 68%)");
say(bob, "log kiểu này đọc dễ hơn hẳn messenger");
await wait(150);

const carol = await connect("linh", "hsl(145 55% 58%)");
say(carol, "có room riêng + pass à? tiện phết");
await wait(150);

say(alice, "ừ, tạo room mới rồi đặt pass, share link là xong");
await wait(150);
say(bob, "mà bill cloudflare sao?");
await wait(150);
say(carol, "free tier, hibernation nên idle không tốn gì");
await wait(200);

// A quoted reply and an @mention, so the UI has something to show.
const rootId = await rootIdPromise;
await wait(150);
say(alice, "thêm reply với @khoan nữa là đủ dùng");
await wait(150);

if (rootId !== undefined) {
  const replier = await connect("linh", "hsl(145 55% 58%)");
  replier.send(JSON.stringify({ t: "msg", cid: "seed-reply", text: "ừ, reply được luôn", replyTo: rootId }));
  await wait(250);
  replier.close();
}

await wait(150);
alice.close();
bob.close();
carol.close();

console.log(`seeded #${slug} (${pass.length > 0 ? "locked" : "open"})`);
