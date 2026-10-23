import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOR,
  MAX_NICK,
  MAX_TEXT,
  codePointLength,
  makeMessageId,
  parseClientFrame,
  sanitizeColor,
  sanitizeNick,
  sanitizeText,
} from "../src/protocol";

describe("sanitizeNick", () => {
  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeNick("  a\u0000b  ")).toEqual({ ok: true, nick: "ab" });
  });

  it("collapses inner runs of whitespace", () => {
    expect(sanitizeNick("tri   khoa")).toEqual({ ok: true, nick: "tri khoa" });
  });

  it("rejects a nick that is only whitespace", () => {
    expect(sanitizeNick("   ")).toEqual({ ok: false, code: "BAD_NICK" });
  });

  it("truncates to MAX_NICK code points without splitting a surrogate pair", () => {
    const result = sanitizeNick("x".repeat(40));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.nick).toHaveLength(MAX_NICK);
  });
});

describe("sanitizeText", () => {
  it("keeps newlines but drops other control characters", () => {
    expect(sanitizeText("a\u0007b\nc")).toEqual({ ok: true, text: "ab\nc" });
  });

  it("rejects empty text", () => {
    expect(sanitizeText(" \n\t ")).toEqual({ ok: false, code: "EMPTY" });
  });

  it("rejects text longer than MAX_TEXT", () => {
    expect(sanitizeText("a".repeat(MAX_TEXT + 1))).toEqual({ ok: false, code: "TOO_LONG" });
  });

  it("accepts exactly MAX_TEXT", () => {
    expect(sanitizeText("a".repeat(MAX_TEXT))).toEqual({ ok: true, text: "a".repeat(MAX_TEXT) });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("😀")).toBe(1);
    expect(sanitizeText("😀".repeat(MAX_TEXT + 1))).toEqual({ ok: false, code: "TOO_LONG" });
    expect(sanitizeText("😀".repeat(MAX_TEXT)).ok).toBe(true);
  });
});

describe("sanitizeColor", () => {
  it("keeps a well formed hsl colour", () => {
    expect(sanitizeColor("hsl(210 40% 70%)")).toBe("hsl(210 40% 70%)");
  });

  it("falls back for a named colour", () => {
    expect(sanitizeColor("red")).toBe(DEFAULT_COLOR);
  });

  it("falls back for out of range components", () => {
    expect(sanitizeColor("hsl(400 40% 70%)")).toBe(DEFAULT_COLOR);
    expect(sanitizeColor("hsl(210 40% 170%)")).toBe(DEFAULT_COLOR);
  });

  it("falls back for non strings", () => {
    expect(sanitizeColor(undefined)).toBe(DEFAULT_COLOR);
    expect(sanitizeColor(42)).toBe(DEFAULT_COLOR);
  });
});

describe("parseClientFrame", () => {
  it("parses a msg frame", () => {
    expect(parseClientFrame('{"t":"msg","cid":"1","text":"hi"}')).toEqual({
      ok: true,
      frame: { t: "msg", cid: "1", text: "hi" },
    });
  });

  it("parses a join frame", () => {
    expect(parseClientFrame('{"t":"join","nick":"khoan","color":"hsl(1 2% 3%)"}')).toEqual({
      ok: true,
      frame: { t: "join", nick: "khoan", color: "hsl(1 2% 3%)" },
    });
  });

  it("rejects an unknown frame type", () => {
    expect(parseClientFrame('{"t":"nope"}')).toEqual({ ok: false, code: "BAD_FRAME" });
  });

  it("rejects invalid json", () => {
    expect(parseClientFrame("không phải json")).toEqual({ ok: false, code: "BAD_FRAME" });
  });

  it("rejects a msg frame without cid", () => {
    expect(parseClientFrame('{"t":"msg","text":"hi"}')).toEqual({ ok: false, code: "BAD_FRAME" });
  });

  it("rejects non object json", () => {
    expect(parseClientFrame("null")).toEqual({ ok: false, code: "BAD_FRAME" });
    expect(parseClientFrame('"str"')).toEqual({ ok: false, code: "BAD_FRAME" });
  });
});

describe("makeMessageId", () => {
  it("uses base36 segments separated by a dash", () => {
    expect(makeMessageId(1700000000000, 7)).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });

  it("sorts increasing for increasing input", () => {
    expect(makeMessageId(2, 1) > makeMessageId(1, 99)).toBe(true);
  });
});
