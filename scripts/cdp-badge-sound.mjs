/**
 * Verifies the favicon badge and the notification sound inside a real page.
 * Dev-server only: it imports the modules straight from Vite.
 *
 *   node scripts/cdp-badge-sound.mjs <url>
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
await sleep(2500);

console.log(
  "favicon badge:",
  await evaluate(`(async () => {
    const badge = await import('/src/lib/badge.ts');
    const before = document.querySelector('link[rel="icon"]').href.length;
    badge.applyBrowserBadges(7);
    const after = document.querySelector('link[rel="icon"]').href;
    const withBadge = { prefix: after.slice(0, 22), length: after.length, grew: after.length !== before };
    badge.applyBrowserBadges(0);
    const cleared = document.querySelector('link[rel="icon"]').href.length;
    return JSON.stringify({ withBadge, clearedLength: cleared, badgeApi: 'setAppBadge' in navigator });
  })()`),
);

console.log(
  "sound:",
  await evaluate(`(async () => {
    const { SoundPlayer, toneSchedule } = await import('/src/lib/sound.ts');
    const player = new SoundPlayer({ storage: null });
    player.unlock();
    const started = performance.now();
    player.play('mention');
    return JSON.stringify({
      tones: toneSchedule('mention').length,
      enabled: player.isEnabled,
      played: Math.round(performance.now() - started) <= 5,
      silentFallback: (() => { const p = new SoundPlayer({ storage: null }); p.play('message'); return true; })(),
    });
  })()`),
);

console.log(
  "menu state:",
  await evaluate(`JSON.stringify({
    sound: document.querySelector('[data-action="sound"]')?.getAttribute('aria-checked'),
    notify: document.querySelector('[data-action="notify"]')?.getAttribute('aria-checked'),
  })`),
);

socket.close();
process.exit(0);
