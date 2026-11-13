import { describe, expect, it } from "vitest";
import {
  INDEX_KEYS,
  MAX_SYMBOLS,
  parseIndex,
  parseIndices,
  parseLevel,
  parseQuote,
  parseQuotes,
  parseSymbolList,
} from "../src/market";

/** One realistic VPS quote row: numeric reference, string order-book slots. */
const FPT_ROW = {
  sym: "FPT",
  symCode: "FPT",
  r: 131.3,
  c: 140.4,
  f: 122.2,
  lastPrice: 132.5,
  avePrice: 132.1,
  highPrice: 133.2,
  lowPrice: 130.9,
  lot: 1_234_500,
  fBVol: 210_300,
  fRoom: 4_567_800,
  side: "BUY",
  g1: "132.4|12300",
  g2: "132.3|8100",
  g3: "132.2|3400",
  g4: "132.5|9900",
  g5: "132.6|5200",
  g6: "132.7|1800",
};

describe("parseLevel", () => {
  it("splits the price|volume slot", () => {
    expect(parseLevel("132.4|12300")).toEqual({ price: 132.4, volume: 12300 });
  });

  it("zeroes a missing or malformed slot so the shape stays three-tier", () => {
    expect(parseLevel(undefined)).toEqual({ price: 0, volume: 0 });
    expect(parseLevel("")).toEqual({ price: 0, volume: 0 });
    expect(parseLevel("---")).toEqual({ price: 0, volume: 0 });
    expect(parseLevel("132.4")).toEqual({ price: 132.4, volume: 0 });
  });
});

describe("parseQuote", () => {
  it("normalizes a VPS row into the wire quote", () => {
    expect(parseQuote(FPT_ROW)).toEqual({
      symbol: "FPT",
      ref: 131.3,
      ceiling: 140.4,
      floor: 122.2,
      last: 132.5,
      avg: 132.1,
      high: 133.2,
      low: 130.9,
      change: 1.2,
      changePercent: 0.91,
      volume: 1_234_500,
      foreignBuy: 210_300,
      foreignRoom: 4_567_800,
      side: "BUY",
      bids: [
        { price: 132.4, volume: 12300 },
        { price: 132.3, volume: 8100 },
        { price: 132.2, volume: 3400 },
      ],
      asks: [
        { price: 132.5, volume: 9900 },
        { price: 132.6, volume: 5200 },
        { price: 132.7, volume: 1800 },
      ],
    });
  });

  it("falls back to the reference price before the first match", () => {
    const quote = parseQuote({ ...FPT_ROW, lastPrice: 0 });
    expect(quote?.last).toBe(131.3);
    expect(quote?.change).toBe(0);
    expect(quote?.changePercent).toBe(0);
  });

  it("upper-cases the ticker and accepts the symbol alias", () => {
    expect(parseQuote({ symbol: "hpg" })?.symbol).toBe("HPG");
  });

  it("rejects rows without a usable ticker", () => {
    expect(parseQuote(null)).toBeNull();
    expect(parseQuote({})).toBeNull();
    expect(parseQuote({ sym: "FPT!" })).toBeNull();
    expect(parseQuote({ sym: "X".repeat(13) })).toBeNull();
  });

  it("survives numeric strings and unparsable values", () => {
    const quote = parseQuote({ sym: "SSI", r: "30.5", lastPrice: "31.2", lot: "---", fBVol: "12" });
    expect(quote?.ref).toBe(30.5);
    expect(quote?.last).toBe(31.2);
    expect(quote?.volume).toBe(0);
    expect(quote?.foreignBuy).toBe(12);
  });
});

describe("parseQuotes", () => {
  it("keeps the valid rows and drops the junk", () => {
    const quotes = parseQuotes([FPT_ROW, null, { sym: "" }, { ...FPT_ROW, sym: "HPG" }]);
    expect(quotes.map((quote) => quote.symbol)).toEqual(["FPT", "HPG"]);
  });

  it("returns an empty list for a non-array payload", () => {
    expect(parseQuotes({ quotes: [] })).toEqual([]);
    expect(parseQuotes(undefined)).toEqual([]);
  });
});

describe("parseIndex", () => {
  it("uses the published delta instead of recomputing it", () => {
    const index = parseIndex({ hashValue: "10", cIndex: "1287.45", oIndex: "1284.33", ot: "3.12|0.24%" });
    expect(index).toEqual({ key: "10", name: "VN-INDEX", value: 1287.45, change: 3.12, changePercent: 0.24 });
  });

  it("falls back to the open when the delta is missing", () => {
    const index = parseIndex({ mc: "11", cIndex: 1320, oIndex: 1300 });
    expect(index).toMatchObject({ name: "VN30", value: 1320, change: 20, changePercent: 1.54 });
  });

  it("ignores indices the UI does not show", () => {
    expect(parseIndex({ hashValue: "99", cIndex: 1 })).toBeNull();
    expect(parseIndex(null)).toBeNull();
  });
});

describe("parseIndices", () => {
  it("returns known indices in display order regardless of payload order", () => {
    const indices = parseIndices([
      { hashValue: "03", cIndex: 100, oIndex: 100 },
      { hashValue: "99", cIndex: 1 },
      { hashValue: "10", cIndex: 1287.45, oIndex: 1284.33, ot: "3.12|0.24%" },
      { hashValue: "02", cIndex: 240, oIndex: 241 },
    ]);
    expect(indices.map((index) => index.name)).toEqual(["VN-INDEX", "HNX", "UPCOM"]);
    expect(INDEX_KEYS).toEqual(["10", "11", "02", "03"]);
  });
});

describe("parseSymbolList", () => {
  it("upper-cases, trims, and deduplicates", () => {
    expect(parseSymbolList(" fpt, HPG ,fpt,, SSI ")).toEqual(["FPT", "HPG", "SSI"]);
  });

  it("rejects an empty or missing list", () => {
    expect(parseSymbolList(null)).toBeNull();
    expect(parseSymbolList("")).toBeNull();
    expect(parseSymbolList(" , ,")).toBeNull();
  });

  it("rejects the whole list when one ticker is invalid", () => {
    expect(parseSymbolList("FPT,BAD!")).toBeNull();
    expect(parseSymbolList("FPT,HPG,TOOLONGTICKER1")).toBeNull();
  });

  it("rejects batches over the proxy limit", () => {
    const symbols = Array.from({ length: MAX_SYMBOLS + 1 }, (_unused, index) => `S${index}`);
    expect(parseSymbolList(symbols.join(","))).toBeNull();
    expect(parseSymbolList(symbols.slice(0, MAX_SYMBOLS).join(","))).toHaveLength(MAX_SYMBOLS);
  });
});
