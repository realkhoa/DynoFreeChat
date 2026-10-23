import { SELF } from "cloudflare:test";
import type { ServerFrame } from "@dyno/shared/protocol";

export const BASE = "https://example.com";
export const ORIGIN = "https://realkhoa.github.io";

let counter = 0;

/** Unique, regex-valid slug: `^[a-z0-9][a-z0-9-]{1,23}$`. */
export function uniqueSlug(prefix = "t"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
}

/** Unique source IP so creation rate limiting never leaks between tests. */
export function uniqueIp(): string {
  counter += 1;
  return `10.0.${(counter >> 8) & 255}.${counter & 255}`;
}

export async function createRoom(body: { slug: string; pass?: string }): Promise<Response> {
  const payload: Record<string, string> = { slug: body.slug };
  if (body.pass !== undefined) payload.pass = body.pass;
  return SELF.fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": uniqueIp(), origin: ORIGIN },
    body: JSON.stringify(payload),
  });
}

export class Client {
  readonly frames: ServerFrame[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event: MessageEvent) => {
      this.frames.push(JSON.parse(String(event.data)) as ServerFrame);
    });
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }

  join(nick: string, pass?: string): void {
    const frame: Record<string, string> = { t: "join", nick, color: "hsl(200 60% 60%)" };
    if (pass !== undefined) frame.pass = pass;
    this.send(frame);
  }

  say(text: string, cid = `c${(counter += 1)}`): string {
    this.send({ t: "msg", cid, text });
    return cid;
  }

  /** Sends one ephemeral game frame. */
  game(data: string): void {
    this.send({ t: "game", data });
  }

  async waitFor(match: (frame: ServerFrame) => boolean, timeoutMs = 3000): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(match);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for a frame; received=${JSON.stringify(this.frames)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async waitError(code: string): Promise<Extract<ServerFrame, { t: "error" }>> {
    const frame = await this.waitFor((candidate) => candidate.t === "error" && candidate.code === code);
    return frame as Extract<ServerFrame, { t: "error" }>;
  }

  async welcome(): Promise<Extract<ServerFrame, { t: "welcome" }>> {
    const frame = await this.waitFor((candidate) => candidate.t === "welcome");
    return frame as Extract<ServerFrame, { t: "welcome" }>;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Already closed by the server (bad pass, full room).
    }
  }
}

export async function connect(slug: string): Promise<Client> {
  const response = await SELF.fetch(`${BASE}/ws?r=${slug}`, {
    headers: { upgrade: "websocket", origin: ORIGIN },
  });
  if (response.status !== 101) throw new Error(`expected 101, received ${response.status}`);
  const ws = response.webSocket;
  if (ws === null || ws === undefined) throw new Error("response carried no webSocket");
  ws.accept();
  return new Client(ws);
}

/** Creates a room and returns its slug. */
export async function makeRoom(pass?: string): Promise<string> {
  const slug = uniqueSlug();
  const response = await createRoom(pass === undefined ? { slug } : { slug, pass });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return slug;
}
