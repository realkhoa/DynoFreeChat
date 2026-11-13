import { mentionsNick, type ChatMessage, type ReplyRef } from "@dyno/shared/protocol";

export type RowKind = "chat" | "system" | "error";
export type RowState = "ok" | "pending" | "failed";
export type KindFilter = "all" | "chat" | "system";

/** One rendered line. Mutated in place so the view can update just that line. */
export interface Row {
  id: string;
  ts: number;
  kind: RowKind;
  state: RowState;
  nick: string;
  color: string;
  text: string;
  /** Quoted parent, when this line answers another one. */
  replyTo?: ReplyRef;
  /** True when the text mentions the reader by name. */
  mentionsMe: boolean;
  /** Bumped on every mutation; the log view re-renders only when it changes. */
  revision: number;
}

/**
 * Application state for one room. Pure: no DOM, no timers, no network. The view
 * layer reads `rows` and the filter, nothing else.
 */
export class Store {
  rows: Row[] = [];
  filter = "";
  kindFilter: KindFilter = "all";
  /** The reader's own nickname, used to detect mentions. */
  selfNick = "";

  private readonly seen = new Set<string>();
  private readonly pendingByCid = new Map<string, Row>();
  private seq = 0;

  get length(): number {
    return this.rows.length;
  }

  get pendingCount(): number {
    return this.pendingByCid.size;
  }

  addSystem(text: string, kind: RowKind = "system"): Row {
    this.seq += 1;
    const row: Row = {
      id: `s${this.seq}`,
      ts: Date.now(),
      kind,
      state: "ok",
      nick: kind === "error" ? "error" : "system",
      color: "hsl(0 0% 62%)",
      text,
      mentionsMe: false,
      revision: 0,
    };
    this.rows.push(row);
    return row;
  }

  /** Optimistic echo: shown dimmed until the server acknowledges the message. */
  addPending(cid: string, text: string, nick: string, color: string, replyTo?: ReplyRef): Row {
    const row: Row = {
      id: `p:${cid}`,
      ts: Date.now(),
      kind: "chat",
      state: "pending",
      nick,
      color,
      text,
      replyTo,
      mentionsMe: mentionsNick(text, this.selfNick),
      revision: 0,
    };
    this.rows.push(row);
    this.pendingByCid.set(cid, row);
    return row;
  }

  addMessage(message: ChatMessage, cid?: string): "appended" | "resolved" | "duplicate" {
    if (this.seen.has(message.id)) return "duplicate";
    this.seen.add(message.id);

    const pending = cid === undefined ? undefined : this.pendingByCid.get(cid);
    if (pending !== undefined) {
      this.pendingByCid.delete(cid as string);
      pending.id = message.id;
      pending.ts = message.ts;
      pending.nick = message.nick;
      pending.color = message.color;
      pending.text = message.text;
      pending.replyTo = message.replyTo;
      pending.mentionsMe = mentionsNick(message.text, this.selfNick);
      pending.state = "ok";
      pending.revision += 1;
      return "resolved";
    }

    this.rows.push({
      id: message.id,
      ts: message.ts,
      kind: "chat",
      state: "ok",
      nick: message.nick,
      color: message.color,
      text: message.text,
      replyTo: message.replyTo,
      mentionsMe: mentionsNick(message.text, this.selfNick),
      revision: 0,
    });
    return "appended";
  }

  /** Replays a server snapshot, skipping anything already displayed. */
  addHistory(history: ChatMessage[]): number {
    let added = 0;
    for (const message of history) {
      if (this.addMessage(message) === "appended") added += 1;
    }
    return added;
  }

  /** Finds a row by message id, for replying or quoting. */
  find(id: string): Row | undefined {
    return this.rows.find((row) => row.id === id);
  }

  /** Distinct nicks seen in this room, newest first — the mention candidates. */
  nicks(): string[] {
    const seen = new Set<string>();
    const nicks: string[] = [];
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (row === undefined || row.kind !== "chat") continue;
      if (seen.has(row.nick)) continue;
      seen.add(row.nick);
      nicks.push(row.nick);
    }
    return nicks;
  }

  failPending(cid: string, reason: string): Row | undefined {
    const row = this.pendingByCid.get(cid);
    if (row === undefined) return undefined;
    this.pendingByCid.delete(cid);
    row.state = "failed";
    row.text = `${row.text} — ${reason}`;
    row.revision += 1;
    return row;
  }

  /** Marks pending messages older than `ttlMs` as failed. Returns their cids. */
  expirePending(now: number, ttlMs: number): string[] {
    const expired: string[] = [];
    for (const [cid, row] of this.pendingByCid) {
      if (now - row.ts <= ttlMs) continue;
      row.state = "failed";
      row.revision += 1;
      expired.push(cid);
    }
    for (const cid of expired) this.pendingByCid.delete(cid);
    return expired;
  }

  /** Clears the view only: server history and the dedupe set stay intact. */
  clearLocal(): void {
    this.rows = [];
    this.addSystem("log cleared locally");
  }

  setFilter(query: string, kind: KindFilter = this.kindFilter): void {
    this.filter = query.trim().toLowerCase();
    this.kindFilter = kind;
  }

  matches(row: Row): boolean {
    if (this.kindFilter === "chat" && row.kind !== "chat") return false;
    if (this.kindFilter === "system" && row.kind === "chat") return false;
    if (this.filter.length === 0) return true;
    return row.text.toLowerCase().includes(this.filter) || row.nick.toLowerCase().includes(this.filter);
  }
}
