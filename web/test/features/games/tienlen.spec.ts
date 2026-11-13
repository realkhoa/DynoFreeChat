// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiChoose,
  applyPass,
  applyPlay,
  canBeat,
  classify,
  createDeck,
  createTienLenGame,
  createTienLenState,
  deal,
  findPlays,
  shuffle,
  type TienLenCard,
  type TienLenHands,
  type TienLenSeat,
  type TienLenState,
  type TienLenSuit,
} from "@/features/games/tienlen/game";

function card(rank: number, suit: TienLenSuit = "spade"): TienLenCard {
  return { id: `${suit}-${rank}`, rank, suit };
}

function stateWith(
  hands: TienLenHands,
  turn: TienLenSeat = 0,
  previous: TienLenState["previous"] = null,
  previousSeat: TienLenSeat | null = null,
): TienLenState {
  return {
    hands,
    turn,
    previous,
    previousSeat,
    passes: 0,
    trick: 1,
    status: "playing",
    winner: null,
    lastAction: "",
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("tienlen deck", () => {
  it("builds 52 unique cards with the 2 as the highest single", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((entry) => entry.id)).size).toBe(52);
    expect(deck.filter((entry) => entry.suit === "heart")).toHaveLength(13);
    expect(Math.max(...deck.map((entry) => entry.rank))).toBe(15);
    expect(Math.min(...deck.map((entry) => entry.rank))).toBe(3);
  });

  it("deals 13 sorted cards per seat without repeating a card", () => {
    const deck = createDeck();
    const hands = deal(deck);
    expect(hands[0]).toHaveLength(13);
    expect(hands[1]).toHaveLength(13);
    expect(hands[2]).toHaveLength(13);
    const dealt = [...hands[0], ...hands[1], ...hands[2]];
    expect(new Set(dealt.map((entry) => entry.id)).size).toBe(39);
    expect(hands[0][0]?.id).toBe(deck[0]?.id);
    expect(hands[2].some((entry) => entry.id === deck[26]?.id)).toBe(true);
    for (const hand of hands) {
      for (let index = 1; index < hand.length; index += 1) {
        expect(hand[index]?.rank ?? 0).toBeGreaterThanOrEqual(hand[index - 1]?.rank ?? 0);
      }
    }
  });

  it("shuffles deterministically and keeps every card", () => {
    const first = shuffle(createDeck(), mulberry32(7));
    const second = shuffle(createDeck(), mulberry32(7));
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    expect(new Set(first.map((entry) => entry.id)).size).toBe(52);
    expect(first.map((entry) => entry.id)).not.toEqual(createDeck().map((entry) => entry.id));
  });
});

describe("tienlen classification", () => {
  it("recognises singles, pairs, triples and quads", () => {
    expect(classify([card(3)])?.kind).toBe("single");
    expect(classify([card(7, "club"), card(7, "diamond")])?.kind).toBe("pair");
    expect(classify([card(7, "club"), card(7, "diamond")])?.highSuit).toBe("diamond");
    expect(classify([card(9), card(9, "club"), card(9, "heart")])?.kind).toBe("triple");
    expect(classify([card(11), card(11, "club"), card(11, "diamond"), card(11, "heart")])?.kind).toBe("quad");
    expect(classify([])).toBeNull();
  });

  it("accepts only consecutive straights of three or more without a 2", () => {
    expect(classify([card(3), card(4), card(5)])?.kind).toBe("straight");
    expect(classify([card(10), card(11), card(12), card(13), card(14)])?.size).toBe(5);
    expect(classify([card(3), card(4)])).toBeNull();
    expect(classify([card(3), card(4), card(6)])).toBeNull();
    expect(classify([card(3), card(4), card(4, "heart"), card(5)])).toBeNull();
    expect(classify([card(13), card(14), card(15)])).toBeNull();
  });

  it("compares only combinations of the same shape and length", () => {
    const pairOfFours = classify([card(4), card(4, "club")]);
    const lowStraight = classify([card(3), card(4), card(5)]);
    expect(canBeat([card(4)], null)).toBe(true);
    expect(canBeat([card(4), card(5)], null)).toBe(false);
    expect(canBeat([card(15)], classify([card(14)]))).toBe(true);
    expect(canBeat([card(14)], classify([card(14)]))).toBe(false);
    expect(canBeat([card(5), card(5, "heart")], pairOfFours)).toBe(true);
    expect(canBeat([card(3), card(3, "heart")], pairOfFours)).toBe(false);
    expect(canBeat([card(5), card(5, "heart")], classify([card(4)]))).toBe(false);
    expect(canBeat([card(4), card(5), card(6)], lowStraight)).toBe(true);
    expect(canBeat([card(3), card(4), card(5, "heart")], lowStraight)).toBe(false);
  });
});

describe("tienlen trick bookkeeping", () => {
  it("moves the turn and records the combination on a play", () => {
    const hands: TienLenHands = [
      [card(3), card(6)],
      [card(4), card(7)],
      [card(5), card(8)],
    ];
    const state = applyPlay(stateWith(hands), 0, [card(3)]);
    expect(state.turn).toBe(1);
    expect(state.previous?.rank).toBe(3);
    expect(state.previousSeat).toBe(0);
    expect(state.hands[0].map((entry) => entry.rank)).toEqual([6]);
  });

  it("resets the trick after both opponents pass", () => {
    const hands: TienLenHands = [
      [card(3), card(6)],
      [card(4), card(7)],
      [card(5), card(8)],
    ];
    let state = applyPlay(stateWith(hands), 0, [card(3)]);
    state = applyPass(state, 1);
    expect(state.turn).toBe(2);
    expect(state.passes).toBe(1);
    state = applyPass(state, 2);
    expect(state.turn).toBe(0);
    expect(state.previous).toBeNull();
    expect(state.trick).toBe(2);
  });

  it("clears the pass counter when somebody plays again", () => {
    const hands: TienLenHands = [
      [card(3), card(9)],
      [card(4), card(10)],
      [card(5), card(11)],
    ];
    let state = applyPlay(stateWith(hands), 0, [card(3)]);
    state = applyPass(state, 1);
    state = applyPlay(state, 2, [card(11)]);
    expect(state.passes).toBe(0);
    expect(state.turn).toBe(0);
    expect(state.previousSeat).toBe(2);
  });

  it("rejects illegal plays and passes without mutating the state", () => {
    const state = stateWith([[card(5), card(7)], [card(3)], [card(4)]]);
    expect(applyPlay(state, 1, [card(3)])).toBe(state);
    expect(applyPlay(state, 0, [card(6)])).toBe(state);
    expect(applyPass(state, 0)).toBe(state);
    const blocked = { ...state, previous: classify([card(9)]), previousSeat: 2 as const };
    expect(applyPlay(blocked, 0, [card(7)])).toBe(blocked);
  });

  it("ends the deal when a hand is emptied", () => {
    const win = applyPlay(stateWith([[card(9)], [card(4), card(5)], [card(6), card(7)]]), 0, [card(9)]);
    expect(win.status).toBe("won");
    expect(win.winner).toBe(0);
    expect(win.hands[0]).toHaveLength(0);

    const lost = applyPlay(stateWith([[card(9), card(10)], [card(4)], [card(6), card(7)]], 1), 1, [card(4)]);
    expect(lost.status).toBe("lost");
    expect(lost.winner).toBe(1);
  });

  it("starts a deal with the human leading", () => {
    const deck = createDeck().slice(0, 39);
    const state = createTienLenState(deck);
    expect(state.turn).toBe(0);
    expect(state.previous).toBeNull();
    expect(state.hands[0]).toHaveLength(13);
    expect(state.status).toBe("playing");
  });
});

describe("tienlen AI", () => {
  it("leads with the lowest card and answers with the cheapest beating play", () => {
    const steady = (): number => 0.9;
    expect(aiChoose([card(9), card(4), card(12)], null, steady)).toEqual([card(4)]);
    const choice = aiChoose(
      [card(9), card(9, "club"), card(5), card(5, "club")],
      classify([card(4), card(4, "club")]),
      steady,
    );
    expect(choice?.map((entry) => entry.rank)).toEqual([5, 5]);
  });

  it("passes when nothing beats the table", () => {
    expect(aiChoose([card(3), card(4)], classify([card(9)]), () => 0.9)).toBeNull();
    expect(aiChoose([], null, () => 0.9)).toBeNull();
  });

  it("usually holds a lone 2 for later", () => {
    const hand = [card(15), card(3), card(4)];
    const ace = classify([card(14)]);
    expect(aiChoose(hand, ace, () => 0)).toBeNull();
    expect(aiChoose(hand, ace, () => 0.9)?.map((entry) => entry.rank)).toEqual([15]);
  });

  it("lists only legal beating plays", () => {
    const pairOfSixes = classify([card(6), card(6, "club")]);
    const plays = findPlays([card(4), card(4, "club"), card(9), card(9, "club"), card(10)], pairOfSixes);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.map((entry) => entry.rank)).toEqual([9, 9]);

    const lowStraight = classify([card(3), card(4), card(5)]);
    const straights = findPlays([card(3), card(4), card(5), card(6), card(7)], lowStraight);
    expect(straights.length).toBeGreaterThan(0);
    for (const play of straights) expect(canBeat(play, lowStraight)).toBe(true);
  });
});

describe("tienlen mount", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a full hand, plays a card and cancels its AI timer", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const game = createTienLenGame();
    game.mount(host);

    const hand = host.querySelectorAll<HTMLButtonElement>("button.stage-card");
    expect(hand).toHaveLength(13);
    const barButtons = host.querySelectorAll<HTMLButtonElement>("button.stage-btn");
    expect(barButtons).toHaveLength(3);
    expect(barButtons[1]?.disabled).toBe(true);

    const status = host.querySelector(".stage-status");
    const before = status?.textContent ?? "";
    hand[0]?.click();
    expect(hand[0]?.classList.contains("is-selected")).toBe(true);

    barButtons[0]?.click();
    expect(status?.textContent ?? "").not.toBe(before);
    expect(status?.textContent).toContain("You played");
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    barButtons[2]?.click();
    expect(host.querySelectorAll("button.stage-card")).toHaveLength(13);
    expect(vi.getTimerCount()).toBe(0);

    game.mount(host);
    expect(host.querySelectorAll("button.stage-card")).toHaveLength(13);

    game.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
