import { describe, expect, it } from "vitest";
import { activeMentionToken, applyMention, matchNicks } from "../src/lib/mentions";

describe("activeMentionToken", () => {
  it("detects a mention being typed at the caret", () => {
    expect(activeMentionToken("chào @kh", 8)).toEqual({ start: 5, query: "kh" });
  });

  it("detects a bare @", () => {
    expect(activeMentionToken("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores an @ in the middle of a word", () => {
    expect(activeMentionToken("mail@host", 9)).toBeNull();
  });

  it("gives up once whitespace ends the token", () => {
    expect(activeMentionToken("@khoan xin chào", 15)).toBeNull();
  });

  it("returns null when there is no @ at all", () => {
    expect(activeMentionToken("không có gì", 5)).toBeNull();
  });
});

describe("matchNicks", () => {
  const nicks = ["khoan", "Khoan2", "dyno", "linh", "khang"];

  it("prefers prefix matches and ignores case", () => {
    expect(matchNicks(nicks, "kh")).toEqual(["khoan", "Khoan2", "khang"]);
  });

  it("falls back to substring matches", () => {
    expect(matchNicks(nicks, "yn")).toEqual(["dyno"]);
  });

  it("returns the head of the list for an empty query", () => {
    expect(matchNicks(nicks, "", 2)).toEqual(["khoan", "Khoan2"]);
  });

  it("de-duplicates and caps the result", () => {
    expect(matchNicks(["a", "a", "b", "c"], "", 2)).toEqual(["a", "b"]);
  });
});

describe("applyMention", () => {
  it("replaces the token and leaves a trailing space", () => {
    const value = "chào @kh nhé";
    const token = activeMentionToken(value, 8);
    expect(token).toEqual({ start: 5, query: "kh" });
    if (token === null) return;

    const result = applyMention(value, token, 8, "khoan");
    expect(result.text).toBe("chào @khoan nhé");
    expect(result.caret).toBe(12);
  });
});
