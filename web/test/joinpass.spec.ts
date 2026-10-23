import { describe, expect, it } from "vitest";
import { joinPassFor } from "../src/lib/joinpass";

const remembered = (slug: string): string | undefined => (slug === "team" ? "matkhau123" : undefined);

describe("joinPassFor", () => {
  it("uses the password typed for this attempt", () => {
    expect(joinPassFor("tu-vua-nhap", "team", remembered)).toBe("tu-vua-nhap");
  });

  it("falls back to the remembered password on a reconnect", () => {
    expect(joinPassFor(undefined, "team", remembered)).toBe("matkhau123");
  });

  it("treats an empty inflight password as absent", () => {
    expect(joinPassFor("", "team", remembered)).toBe("matkhau123");
  });

  it("returns nothing for an open room", () => {
    expect(joinPassFor(undefined, "chung", remembered)).toBeUndefined();
  });

  it("returns nothing when there is no room", () => {
    expect(joinPassFor(undefined, undefined, remembered)).toBeUndefined();
  });
});
