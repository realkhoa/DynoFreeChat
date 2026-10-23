import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@dyno/shared/protocol";
import { clampNick, formatAge, formatChatLine, formatTime } from "../src/lib/format";

const local = (hour: number, minute: number, second: number): number =>
  new Date(2026, 0, 1, hour, minute, second).getTime();

describe("formatTime", () => {
  it("renders zero padded local time", () => {
    expect(formatTime(local(9, 5, 3))).toBe("09:05:03");
    expect(formatTime(local(23, 59, 59))).toBe("23:59:59");
  });
});

describe("formatAge", () => {
  const now = local(12, 0, 0);

  it("describes recent timestamps", () => {
    expect(formatAge(now - 5_000, now)).toBe("vừa xong");
    expect(formatAge(now - 3 * 60_000, now)).toBe("3 phút");
    expect(formatAge(now - 2 * 3_600_000, now)).toBe("2 giờ");
    expect(formatAge(now - 5 * 86_400_000, now)).toBe("5 ngày");
    expect(formatAge(now - 90 * 86_400_000, now)).toBe("3 tháng");
  });

  it("never reports negative age", () => {
    expect(formatAge(now + 10_000, now)).toBe("vừa xong");
  });
});

describe("formatChatLine", () => {
  it("builds one line with time, nick and text", () => {
    const message: ChatMessage = {
      id: "a",
      ts: local(8, 0, 0),
      nick: "alice",
      color: "hsl(1 2% 3%)",
      text: "xin chào",
    };
    expect(formatChatLine(message)).toBe("08:00:00  alice  ›  xin chào");
  });
});

describe("clampNick", () => {
  it("leaves short nicks alone", () => {
    expect(clampNick("khoan")).toBe("khoan");
  });

  it("truncates with an ellipsis", () => {
    const clamped = clampNick("a".repeat(40), 10);
    expect(Array.from(clamped)).toHaveLength(10);
    expect(clamped.endsWith("…")).toBe(true);
  });
});
