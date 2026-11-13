import { describe, expect, it } from "vitest";
import { MATCH_PROTOCOL_VERSION, decodeMessage, encodeMessage } from "@/features/games/online/protocol";

describe("match protocol", () => {
  it("round-trips a hello", () => {
    const message = { k: "hello" as const, v: MATCH_PROTOCOL_VERSION, id: "abc", game: "caro", nick: "An" };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it("round-trips a start with its seed", () => {
    const message = { k: "start" as const, v: MATCH_PROTOCOL_VERSION, seed: 12345, game: "caro" };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it("round-trips a move payload", () => {
    const message = { k: "move" as const, seq: 3, payload: { index: 42 } };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it("round-trips a bye", () => {
    expect(decodeMessage(encodeMessage({ k: "bye" }))).toEqual({ k: "bye" });
  });

  it("rejects junk and unknown kinds", () => {
    expect(decodeMessage("not json")).toBeNull();
    expect(decodeMessage("null")).toBeNull();
    expect(decodeMessage("[]")).toBeNull();
    expect(decodeMessage(JSON.stringify({ k: "nope" }))).toBeNull();
  });

  it("rejects malformed hello, start and move messages", () => {
    expect(decodeMessage(JSON.stringify({ k: "hello" }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ k: "hello", id: "a", game: "", nick: "x" }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ k: "start", seed: "x" }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ k: "move" }))).toBeNull();
  });
});
