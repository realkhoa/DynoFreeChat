import { describe, expect, it } from "vitest";
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
