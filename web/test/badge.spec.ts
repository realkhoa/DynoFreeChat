import { describe, expect, it } from "vitest";
import { badgeLabel } from "../src/lib/badge";
import { toneSchedule } from "../src/lib/sound";

describe("badgeLabel", () => {
  it("is empty for zero or negative counts", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(-4)).toBe("");
  });

  it("shows small counts literally", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(42)).toBe("42");
    expect(badgeLabel(99)).toBe("99");
  });

  it("caps at 99+", () => {
    expect(badgeLabel(100)).toBe("99+");
    expect(badgeLabel(12_345)).toBe("99+");
  });

  it("tolerates junk input", () => {
    expect(badgeLabel(Number.NaN)).toBe("");
    expect(badgeLabel(Number.POSITIVE_INFINITY)).toBe("99+");
  });
});

describe("toneSchedule", () => {
  it("plays two rising blips for a message", () => {
    const tones = toneSchedule("message");
    expect(tones).toHaveLength(2);
    expect(tones[1]!.freq).toBeGreaterThan(tones[0]!.freq);
    expect(tones[0]!.start).toBe(0);
  });

  it("plays a longer, higher cue for a mention", () => {
    const mention = toneSchedule("mention");
    const message = toneSchedule("message");

    expect(mention.length).toBeGreaterThan(message.length);
    expect(mention.at(-1)!.freq).toBeGreaterThan(message.at(-1)!.freq);
    expect(mention.at(-1)!.duration).toBeGreaterThan(message.at(-1)!.duration);
  });

  it("keeps every cue short and quiet", () => {
    for (const kind of ["message", "mention"] as const) {
      for (const tone of toneSchedule(kind)) {
        expect(tone.duration).toBeLessThan(0.2);
        expect(tone.gain).toBeLessThanOrEqual(0.06);
        expect(tone.freq).toBeGreaterThan(400);
      }
    }
  });
});
