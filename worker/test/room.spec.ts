import { describe, expect, it } from "vitest";
import { MAX_GAME_PAYLOAD, RATE_CAPACITY, type ServerFrame } from "@dyno/shared/protocol";
import { connect, makeRoom } from "./helpers";

describe("chat room", () => {
  it("welcomes a joiner with the room identity and empty history", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.join("khoan");

    const welcome = await client.welcome();
    expect(welcome.you.nick).toBe("khoan");
    expect(welcome.room).toEqual({ slug, locked: false });
    expect(welcome.history).toEqual([]);
    expect(welcome.online).toBeGreaterThanOrEqual(1);
    client.close();
  });

  it("broadcasts a message and echoes the cid only to the sender", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();

    const bob = await connect(slug);
    bob.join("bob");
    await bob.welcome();

    const cid = alice.say("chào bob");

    const onAlice = await alice.waitFor((frame) => frame.t === "append");
    const onBob = await bob.waitFor((frame) => frame.t === "append");

    expect(onAlice.t === "append" && onAlice.cid).toBe(cid);
    expect(onBob.t === "append" && onBob.cid).toBeUndefined();
    expect(onAlice.t === "append" && onAlice.m.text).toBe("chào bob");
    expect(onBob.t === "append" && onBob.m.nick).toBe("alice");

    alice.close();
    bob.close();
  });

  it("refuses a message before join", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.say("sớm quá");
    await client.waitError("NOT_JOINED");
    client.close();
  });

  it("rejects empty text", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.join("khoan");
    await client.welcome();
    client.say("   ");
    await client.waitError("EMPTY");
    client.close();
  });

  it("rate limits the sixth message of a burst", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.join("khoan");
    await client.welcome();

    for (let i = 1; i <= 5; i += 1) client.say(`tin ${i}`);
    await client.waitFor((frame) => frame.t === "append" && frame.m.text === "tin 5");

    client.say("tin 6");
    const error = await client.waitError("RATE_LIMIT");
    expect(error.code).toBe("RATE_LIMIT");
    client.close();
  });

  it("rejects a wrong password, then accepts the right one on the same connection", async () => {
    const slug = await makeRoom("mật-khẩu-đúng");
    const client = await connect(slug);

    client.join("khoan", "sai");
    await client.waitError("BAD_PASS");

    client.join("khoan", "mật-khẩu-đúng");
    const welcome = await client.welcome();
    expect(welcome.room).toEqual({ slug, locked: true });
    client.close();
  });

  it("closes the connection after five wrong passwords", async () => {
    const slug = await makeRoom("bí-mật");
    const client = await connect(slug);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      client.join("khoan", `sai-${attempt}`);
      const error = await client.waitError("BAD_PASS");
      expect(error.code).toBe("BAD_PASS");
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const closed = await new Promise<CloseEvent>((resolve) => {
      client.ws.addEventListener("close", (event) => resolve(event as CloseEvent));
    });
    expect(closed.code).toBe(4403);
  });

  it("replays history to a client that joins later", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();
    alice.say("một");
    alice.say("hai");
    await alice.waitFor((frame) => frame.t === "append" && frame.m.text === "hai");
    alice.close();

    const bob = await connect(slug);
    bob.join("bob");
    const welcome = await bob.welcome();
    expect(welcome.history.map((message) => message.text)).toEqual(["một", "hai"]);
    expect(welcome.history[0]?.nick).toBe("alice");
    bob.close();
  });

  it("refuses to join a room that does not exist", async () => {
    const client = await connect("khongcophongnay");
    client.join("khoan");
    await client.waitError("ROOM_NOT_FOUND");
    client.close();
  });
});

describe("ephemeral game frames", () => {
  it("relays a game frame to the peer only, with the sender's nick", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();

    const bob = await connect(slug);
    bob.join("bob");
    await bob.welcome();

    alice.game('{"k":"hello"}');

    const relayed = (await bob.waitFor((frame) => frame.t === "game")) as Extract<
      ServerFrame,
      { t: "game" }
    >;
    expect(relayed.data).toBe('{"k":"hello"}');
    expect(relayed.nick).toBe("alice");

    // The sender never gets its own frame back: it already applied the move.
    expect(alice.frames.some((frame) => frame.t === "game")).toBe(false);

    alice.close();
    bob.close();
  });

  it("does not persist game frames or replay them as history", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();
    alice.game('{"k":"move","cell":4,"player":"X","seq":1}');
    alice.say("tin nhắn thật");
    await alice.waitFor((frame) => frame.t === "append" && frame.m.text === "tin nhắn thật");
    alice.close();

    const bob = await connect(slug);
    bob.join("bob");
    const welcome = await bob.welcome();
    expect(welcome.history.map((message) => message.text)).toEqual(["tin nhắn thật"]);
    bob.close();
  });

  it("refuses a game frame before join", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.game('{"k":"hello"}');
    await client.waitError("NOT_JOINED");
    client.close();
  });

  it("rejects an over-long game payload", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.join("khoan");
    await client.welcome();

    client.game("x".repeat(MAX_GAME_PAYLOAD + 1));
    await client.waitError("BAD_FRAME");
    client.close();
  });

  it("gives game frames their own allowance, far above the chat bucket", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();

    const bob = await connect(slug);
    bob.join("bob");
    await bob.welcome();

    // Well past RATE_CAPACITY: a real game must never be throttled like chat.
    for (let seq = 1; seq <= RATE_CAPACITY * 2; seq += 1) {
      alice.game(JSON.stringify({ k: "move", cell: 0, player: "X", seq }));
    }

    await bob.waitFor(
      (frame) => frame.t === "game" && frame.data.includes('"seq":' + String(RATE_CAPACITY * 2)),
    );
    expect(alice.frames.some((frame) => frame.t === "error")).toBe(false);

    alice.close();
    bob.close();
  });

  it("does not let game traffic consume the chat allowance", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();
    const bob = await connect(slug);
    bob.join("bob");
    await bob.welcome();

    for (let i = 0; i < 10; i += 1) alice.game('{"k":"hello"}');
    await bob.waitFor((frame) => frame.t === "game");

    alice.say("vẫn chat được");
    const appended = (await alice.waitFor(
      (frame) => frame.t === "append" && frame.m.text === "vẫn chat được",
    )) as Extract<ServerFrame, { t: "append" }>;
    expect(appended.m.text).toBe("vẫn chat được");

    alice.close();
    bob.close();
  });
});

describe("replies and mentions", () => {
  it("quotes the parent message when replying", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();
    alice.say("câu gốc");
    const original = (await alice.waitFor((frame) => frame.t === "append")) as Extract<
      ServerFrame,
      { t: "append" }
    >;

    alice.ws.send(JSON.stringify({ t: "msg", cid: "r1", text: "trả lời", replyTo: original.m.id }));
    const reply = (await alice.waitFor(
      (frame) => frame.t === "append" && frame.cid === "r1",
    )) as Extract<ServerFrame, { t: "append" }>;

    expect(reply.m.replyTo).toEqual({ id: original.m.id, nick: "alice", text: "câu gốc" });
    alice.close();
  });

  it("keeps the quote in history", async () => {
    const slug = await makeRoom();

    const alice = await connect(slug);
    alice.join("alice");
    await alice.welcome();
    alice.say("gốc");
    const original = (await alice.waitFor((frame) => frame.t === "append")) as Extract<
      ServerFrame,
      { t: "append" }
    >;
    alice.ws.send(JSON.stringify({ t: "msg", cid: "r1", text: "reply", replyTo: original.m.id }));
    await alice.waitFor((frame) => frame.t === "append" && frame.cid === "r1");
    alice.close();

    const bob = await connect(slug);
    bob.join("bob");
    const welcome = await bob.welcome();

    const quoted = welcome.history.find((message) => message.text === "reply");
    expect(quoted?.replyTo?.nick).toBe("alice");
    expect(quoted?.replyTo?.text).toBe("gốc");
    bob.close();
  });

  it("drops the quote when the parent is unknown", async () => {
    const slug = await makeRoom();
    const client = await connect(slug);
    client.join("khoan");
    await client.welcome();

    client.ws.send(
      JSON.stringify({ t: "msg", cid: "r1", text: "mồ côi", replyTo: "khongtontai" }),
    );
    const frame = (await client.waitFor(
      (candidate) => candidate.t === "append" && candidate.cid === "r1",
    )) as Extract<ServerFrame, { t: "append" }>;

    expect(frame.m.text).toBe("mồ côi");
    expect(frame.m.replyTo).toBeUndefined();
    client.close();
  });
});