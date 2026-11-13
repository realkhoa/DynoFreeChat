/**
 * @file game.ts
 * @brief Tiến Lên game module: a 52-card shedding game against two AI players.
 * @details Card rules, trick bookkeeping and the AI heuristic are pure functions,
 * so every rule is testable without a DOM. The factory renders the hand as
 * buttons and schedules the AI turns with cancellable timers.
 */

import type { GameMount } from "../mount";

/** @brief The four card suits, ordered spade < club < diamond < heart. */
export type TienLenSuit = "spade" | "club" | "diamond" | "heart";

/** @brief One card; ranks 3..14 are 3..Ace and 15 is the 2 (he). */
export interface TienLenCard {
  /** Stable identity, e.g. `heart-15`. */
  id: string;
  /** Ordering value: 3 (lowest) to 15 (the 2, highest). */
  rank: number;
  /** Suit, used only to break rank ties. */
  suit: TienLenSuit;
}

/** @brief Shape of a legal play. */
export type TienLenKind = "single" | "pair" | "triple" | "straight" | "quad";

/** @brief A classified combination of cards. */
export interface TienLenCombination {
  /** Combination shape. */
  kind: TienLenKind;
  /** Highest rank in the combination; the comparison key. */
  rank: number;
  /** Number of cards played. */
  size: number;
  /** The cards, sorted from the highest rank down. */
  cards: TienLenCard[];
  /** Suit of the highest card. */
  highSuit: TienLenSuit;
}

/** @brief Seat in the deal: 0 is the human, 1 and 2 are the AI players. */
export type TienLenSeat = 0 | 1 | 2;

/** @brief Outcome of a deal. */
export type TienLenStatus = "playing" | "won" | "lost";

/** @brief The three hands, indexed by seat. */
export type TienLenHands = [TienLenCard[], TienLenCard[], TienLenCard[]];

/** @brief Complete state of one deal. */
export interface TienLenState {
  /** Cards left per seat. */
  hands: TienLenHands;
  /** Seat that must act next. */
  turn: TienLenSeat;
  /** Combination that must be beaten, or null on a free lead. */
  previous: TienLenCombination | null;
  /** Seat that played {@link previous}. */
  previousSeat: TienLenSeat | null;
  /** Consecutive passes since the last play. */
  passes: number;
  /** Trick counter, starting at 1. */
  trick: number;
  /** Deal outcome. */
  status: TienLenStatus;
  /** Seat that emptied its hand, once the deal is over. */
  winner: TienLenSeat | null;
  /** One line describing the last event. */
  lastAction: string;
}

const SUIT_ORDER: Record<TienLenSuit, number> = { spade: 0, club: 1, diamond: 2, heart: 3 };

const SUIT_GLYPHS: Record<TienLenSuit, string> = {
  spade: "♠",
  club: "♣",
  diamond: "♦",
  heart: "♥",
};

const RANK_LABELS: Record<number, string> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
};

const KIND_BY_SIZE: Record<number, TienLenKind | undefined> = {
  1: "single",
  2: "pair",
  3: "triple",
  4: "quad",
};

const SEAT_NAMES: Record<TienLenSeat, string> = { 0: "You", 1: "Bao", 2: "Linh" };

/** @brief Orders two cards ascending by rank, then by suit. */
function compareAscending(a: TienLenCard, b: TienLenCard): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
}

/** @brief Orders two cards descending by rank, then by suit. */
function compareDescending(a: TienLenCard, b: TienLenCard): number {
  return compareAscending(b, a);
}

/** @brief Groups a hand by rank, iterating in ascending rank order. */
function groupByRank(hand: readonly TienLenCard[]): Map<number, TienLenCard[]> {
  const groups = new Map<number, TienLenCard[]>();
  for (const card of [...hand].sort(compareAscending)) {
    const group = groups.get(card.rank);
    if (group === undefined) groups.set(card.rank, [card]);
    else group.push(card);
  }
  return groups;
}

/** @brief Next seat in turn order, wrapping 2 back to 0. */
function nextSeat(seat: TienLenSeat): TienLenSeat {
  return seat === 0 ? 1 : seat === 1 ? 2 : 0;
}

/** @brief Deterministic 32-bit PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @brief Renders a card as its rank plus suit glyph, e.g. `10♥`. */
function cardLabel(card: TienLenCard): string {
  return `${RANK_LABELS[card.rank] ?? "?"}${SUIT_GLYPHS[card.suit]}`;
}

/** @brief Describes a combination for the status line. */
function describeCombination(combination: TienLenCombination | null): string {
  if (combination === null) return "nothing";
  const label = RANK_LABELS[combination.rank] ?? "?";
  if (combination.kind === "single") return `single ${label}`;
  if (combination.kind === "pair") return `pair of ${label}s`;
  if (combination.kind === "triple") return `triple of ${label}s`;
  if (combination.kind === "quad") return `quad of ${label}s`;
  const lowest = combination.cards[combination.cards.length - 1];
  return `straight ${lowest === undefined ? "?" : RANK_LABELS[lowest.rank]}-${label}`;
}

/**
 * @brief Creates the 52-card deck in a fixed order.
 * @return 13 cards per suit, one per rank from 3 to the 2.
 */
export function createDeck(): TienLenCard[] {
  const suits: readonly TienLenSuit[] = ["spade", "club", "diamond", "heart"];
  const deck: TienLenCard[] = [];
  for (const suit of suits) {
    for (let rank = 3; rank <= 15; rank += 1) {
      deck.push({ id: `${suit}-${rank}`, rank, suit });
    }
  }
  return deck;
}

/**
 * @brief Fisher-Yates shuffle driven by a seeded generator.
 * @param deck Cards to shuffle.
 * @param rng Deterministic random source in [0, 1).
 * @return A new shuffled array; the input is untouched.
 */
export function shuffle(deck: readonly TienLenCard[], rng: () => number): TienLenCard[] {
  const cards = [...deck];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const a = cards[index];
    const b = cards[swap];
    if (a === undefined || b === undefined) continue;
    cards[index] = b;
    cards[swap] = a;
  }
  return cards;
}

/**
 * @brief Deals 13 cards to each seat.
 * @details The first 13 cards go to the human, the next 13 to each AI; the last
 * 13 of the deck stay unused. Hands come back sorted ascending.
 * @param deck Shuffled deck.
 * @return The three hands, indexed by seat.
 */
export function deal(deck: readonly TienLenCard[]): TienLenHands {
  const hands: TienLenHands = [[], [], []];
  const take = Math.min(deck.length, 39);
  for (let index = 0; index < take; index += 1) {
    const card = deck[index];
    if (card === undefined) continue;
    const seat: TienLenSeat = index < 13 ? 0 : index < 26 ? 1 : 2;
    hands[seat].push(card);
  }
  for (const hand of hands) hand.sort(compareAscending);
  return hands;
}

/**
 * @brief Classifies a set of cards into a legal play.
 * @details Singles, pairs, triples and quads share a rank. Straights need three
 * or more distinct consecutive ranks and may not contain the 2 (rank 15).
 * @param cards Cards to classify.
 * @return The combination, or null when the cards are not a legal play.
 */
export function classify(cards: readonly TienLenCard[]): TienLenCombination | null {
  if (cards.length === 0) return null;
  const sorted = [...cards].sort(compareDescending);
  const first = sorted[0];
  if (first === undefined) return null;
  const ranks = new Set(sorted.map((card) => card.rank));

  if (ranks.size === 1) {
    const kind = KIND_BY_SIZE[cards.length];
    if (kind === undefined) return null;
    return { kind, rank: first.rank, size: cards.length, cards: sorted, highSuit: first.suit };
  }

  if (cards.length < 3 || ranks.size !== cards.length) return null;
  const ascending = [...ranks].sort((a, b) => a - b);
  const top = ascending[ascending.length - 1] ?? 0;
  if (top >= 15) return null;
  for (let index = 1; index < ascending.length; index += 1) {
    if ((ascending[index] ?? 0) !== (ascending[index - 1] ?? 0) + 1) return null;
  }
  const topCard = sorted.find((card) => card.rank === top) ?? first;
  return { kind: "straight", rank: top, size: cards.length, cards: sorted, highSuit: topCard.suit };
}

/**
 * @brief Decides whether a play beats the combination on the table.
 * @details Same shape and length, strictly higher rank; the 2 is the highest
 * single because it has rank 15.
 * @param candidate Cards the player wants to play.
 * @param previous Combination to beat, or null on a free lead.
 * @return True when the play is legal in this trick.
 */
export function canBeat(candidate: readonly TienLenCard[], previous: TienLenCombination | null): boolean {
  const combination = classify(candidate);
  if (combination === null) return false;
  if (previous === null) return true;
  return (
    combination.kind === previous.kind &&
    combination.size === previous.size &&
    combination.rank > previous.rank
  );
}

/**
 * @brief Enumerates every combination in a hand that beats the table.
 * @details On a free lead the singles are returned, which is enough for both the
 * playable card hint and the AI lead.
 * @param hand Cards available to the seat.
 * @param previous Combination to beat, or null on a free lead.
 * @return Candidate plays, each an array of cards copied from the hand.
 */
export function findPlays(
  hand: readonly TienLenCard[],
  previous: TienLenCombination | null,
): TienLenCard[][] {
  const sorted = [...hand].sort(compareAscending);
  if (previous === null) return sorted.map((card) => [card]);

  if (previous.kind === "straight") {
    const groups = groupByRank(sorted);
    const ranks = [...groups.keys()].filter((rank) => rank < 15).sort((a, b) => a - b);
    const plays: TienLenCard[][] = [];
    for (let start = 0; start + previous.size <= ranks.length; start += 1) {
      const window = ranks.slice(start, start + previous.size);
      const consecutive = window.every(
        (rank, offset) => offset === 0 || rank === (window[offset - 1] ?? 0) + 1,
      );
      const top = window[window.length - 1] ?? 0;
      if (!consecutive || top <= previous.rank) continue;
      const combination: TienLenCard[] = [];
      for (const rank of window) {
        const card = (groups.get(rank) ?? [])[0];
        if (card !== undefined) combination.push(card);
      }
      if (combination.length === previous.size) plays.push(combination);
    }
    return plays;
  }

  const groups = groupByRank(sorted);
  const plays: TienLenCard[][] = [];
  for (const [rank, group] of groups) {
    if (rank <= previous.rank || group.length < previous.size) continue;
    plays.push(group.slice(0, previous.size));
  }
  return plays;
}

/**
 * @brief Picks a play for an AI seat.
 * @details Greedy: lead with the lowest card, otherwise answer with the cheapest
 * combination that beats the table, holding a lone 2 most of the time.
 * @param hand Cards the AI holds.
 * @param previous Combination to beat, or null on a free lead.
 * @param rng Deterministic random source in [0, 1).
 * @return Cards to play, or null to pass.
 */
export function aiChoose(
  hand: readonly TienLenCard[],
  previous: TienLenCombination | null,
  rng: () => number,
): TienLenCard[] | null {
  if (hand.length === 0) return null;
  const sorted = [...hand].sort(compareAscending);
  if (previous === null) {
    const lowest = sorted[0];
    return lowest === undefined ? null : [lowest];
  }
  const ranked = findPlays(sorted, previous)
    .map((cards) => ({ cards, combination: classify(cards) }))
    .filter(
      (entry): entry is { cards: TienLenCard[]; combination: TienLenCombination } =>
        entry.combination !== null,
    )
    .sort((a, b) => a.combination.rank - b.combination.rank);
  const best = ranked[0];
  if (best === undefined) return null;
  if (best.combination.rank === 15 && hand.length > 2 && rng() < 0.5) return null;
  return best.cards;
}

/**
 * @brief Creates a fresh deal with the human leading.
 * @param deck Shuffled deck to deal from.
 * @return A playing state with 13 cards per seat.
 */
export function createTienLenState(deck: readonly TienLenCard[]): TienLenState {
  return {
    hands: deal(deck),
    turn: 0,
    previous: null,
    previousSeat: null,
    passes: 0,
    trick: 1,
    status: "playing",
    winner: null,
    lastAction: "New deal — you lead.",
  };
}

/**
 * @brief Applies a play to the deal state.
 * @details Rejected (returning the same state) when it is not that seat's turn,
 * the cards are not in the hand, or the combination does not beat the table.
 * @param state Current deal.
 * @param seat Seat making the play.
 * @param cards Cards to play.
 * @return The next state, or the same state when the play is illegal.
 */
export function applyPlay(
  state: TienLenState,
  seat: TienLenSeat,
  cards: readonly TienLenCard[],
): TienLenState {
  if (state.status !== "playing" || state.turn !== seat || cards.length === 0) return state;
  const combination = classify(cards);
  if (combination === null || !canBeat(cards, state.previous)) return state;

  const hand = state.hands[seat];
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) return state;
  if (!cards.every((card) => hand.some((held) => held.id === card.id))) return state;

  const remaining = hand.filter((card) => !ids.has(card.id));
  const hands: TienLenHands = [state.hands[0], state.hands[1], state.hands[2]];
  hands[seat] = remaining;
  const played = `${SEAT_NAMES[seat]} played ${describeCombination(combination)}`;

  if (remaining.length === 0) {
    return {
      ...state,
      hands,
      previous: combination,
      previousSeat: seat,
      passes: 0,
      status: seat === 0 ? "won" : "lost",
      winner: seat,
      lastAction: `${played} and is out of cards.`,
    };
  }
  return {
    ...state,
    hands,
    turn: nextSeat(seat),
    previous: combination,
    previousSeat: seat,
    passes: 0,
    lastAction: `${played}.`,
  };
}

/**
 * @brief Applies a pass to the deal state.
 * @details Two consecutive passes end the trick: the table is cleared and the
 * last player to have played leads again.
 * @param state Current deal.
 * @param seat Seat that passes.
 * @return The next state, or the same state when passing is illegal.
 */
export function applyPass(state: TienLenState, seat: TienLenSeat): TienLenState {
  if (state.status !== "playing" || state.turn !== seat || state.previous === null) return state;
  const passes = state.passes + 1;
  if (passes >= 2) {
    const leader = state.previousSeat ?? nextSeat(seat);
    return {
      ...state,
      previous: null,
      previousSeat: null,
      passes: 0,
      trick: state.trick + 1,
      turn: leader,
      lastAction: `${SEAT_NAMES[seat]} passed — new trick, ${SEAT_NAMES[leader]} leads.`,
    };
  }
  return { ...state, passes, turn: nextSeat(seat), lastAction: `${SEAT_NAMES[seat]} passed.` };
}

/**
 * @brief Creates one Tiến Lên game instance.
 * @details State, timers and DOM references all live in this closure.
 * @return A mountable game module.
 */
export function createTienLenGame(): GameMount {
  let host: HTMLElement | null = null;
  let mounted = false;
  let timer: number | null = null;
  let rng = createRng(Date.now() >>> 0);
  let state: TienLenState = createTienLenState(createDeck());
  let selected = new Set<string>();
  let message = "New deal — you lead.";
  const cleanups: Array<() => void> = [];
  let countValues: HTMLElement[] = [];
  let trickValue: HTMLElement | null = null;
  let turnValue: HTMLElement | null = null;
  let lastRow: HTMLElement | null = null;
  let handRow: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;
  let playButton: HTMLButtonElement | null = null;
  let passButton: HTMLButtonElement | null = null;

  const addListener = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
  ): void => {
    const wrapped = (event: Event): void => handler(event as E);
    target.addEventListener(type, wrapped);
    cleanups.push(() => target.removeEventListener(type, wrapped));
  };

  const syncControls = (): void => {
    const mine = state.status === "playing" && state.turn === 0;
    if (playButton !== null) playButton.disabled = !mine;
    if (passButton !== null) passButton.disabled = !mine || state.previous === null;
    if (statusLine !== null) statusLine.textContent = message;
  };

  const chip = (card: TienLenCard): HTMLElement => {
    const span = document.createElement("span");
    span.className = "stage-card";
    span.textContent = cardLabel(card);
    return span;
  };

  const render = (): void => {
    if (lastRow === null || handRow === null) return;
    state.hands.forEach((hand, index) => {
      const value = countValues[index];
      if (value !== undefined) value.textContent = String(hand.length);
    });
    if (trickValue !== null) trickValue.textContent = String(state.trick);
    if (turnValue !== null) {
      turnValue.textContent = state.status === "playing" ? SEAT_NAMES[state.turn] : "—";
    }

    lastRow.replaceChildren();
    const lead = document.createElement("span");
    lead.textContent =
      state.previous === null
        ? "lead:"
        : `${SEAT_NAMES[state.previousSeat ?? 0]} played:${describeCombination(state.previous)}`;
    lastRow.append(lead);
    if (state.previous === null) {
      const free = document.createElement("span");
      free.textContent = "free trick — any valid combination";
      lastRow.append(free);
    } else {
      for (const card of state.previous.cards) lastRow.append(chip(card));
    }

    handRow.replaceChildren();
    const playable = new Set<string>();
    for (const play of findPlays(state.hands[0], state.previous)) {
      for (const card of play) playable.add(card.id);
    }
    for (const card of [...state.hands[0]].sort(compareAscending)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stage-card";
      button.textContent = cardLabel(card);
      button.dataset.cardId = card.id;
      button.setAttribute("aria-pressed", "false");
      if (playable.has(card.id)) button.classList.add("is-playable");
      button.addEventListener("click", () => {
        if (selected.has(card.id)) selected.delete(card.id);
        else selected.add(card.id);
        button.classList.toggle("is-selected", selected.has(card.id));
        button.classList.remove("is-playable");
        button.setAttribute("aria-pressed", selected.has(card.id) ? "true" : "false");
        syncControls();
      });
      handRow.append(button);
    }
    if (state.hands[0].length === 0) {
      const empty = document.createElement("span");
      empty.className = "stage-empty";
      empty.textContent = "hand empty";
      handRow.append(empty);
    }
    syncControls();
  };

  const scheduleNext = (): void => {
    if (!mounted || state.status !== "playing" || state.turn === 0 || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (!mounted || state.status !== "playing" || state.turn === 0) return;
      aiTurn(state.turn);
    }, 620);
  };

  const aiTurn = (seat: TienLenSeat): void => {
    const choice = aiChoose(state.hands[seat], state.previous, rng);
    let next = choice === null ? applyPass(state, seat) : applyPlay(state, seat, choice);
    if (next === state && state.previous === null) {
      const fallback = state.hands[seat][0];
      if (fallback !== undefined) next = applyPlay(state, seat, [fallback]);
    }
    if (next === state) {
      message = `${SEAT_NAMES[seat]} cannot move.`;
      render();
      return;
    }
    state = next;
    message = state.lastAction;
    if (state.status === "lost" && state.winner !== null) {
      message = `${state.lastAction} ${SEAT_NAMES[state.winner]} wins — you lose this deal.`;
    }
    render();
    scheduleNext();
  };

  const playSelected = (): void => {
    if (state.status !== "playing" || state.turn !== 0) return;
    const cards = state.hands[0].filter((card) => selected.has(card.id));
    if (cards.length === 0) {
      message = "Select at least one card first.";
      render();
      return;
    }
    const combination = classify(cards);
    if (combination === null) {
      message = "That is not a legal Tiến Lên combination.";
      render();
      return;
    }
    if (!canBeat(cards, state.previous)) {
      message = `${describeCombination(combination)} does not beat ${describeCombination(state.previous)}.`;
      render();
      return;
    }
    const next = applyPlay(state, 0, cards);
    if (next === state) {
      message = "That play is not allowed.";
      render();
      return;
    }
    state = next;
    selected = new Set<string>();
    message = state.status === "won" ? `${state.lastAction} You win the deal!` : state.lastAction;
    render();
    scheduleNext();
  };

  const passTurn = (): void => {
    if (state.status !== "playing" || state.turn !== 0) return;
    if (state.previous === null) {
      message = "You cannot pass while leading the trick.";
      render();
      return;
    }
    const next = applyPass(state, 0);
    if (next === state) return;
    state = next;
    message = state.lastAction;
    render();
    scheduleNext();
  };

  const startDeal = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    state = createTienLenState(shuffle(createDeck(), rng));
    selected = new Set<string>();
    message = "New deal — you lead.";
    render();
  };

  const buildDom = (target: HTMLElement): void => {
    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const addStat = (label: string): HTMLElement => {
      const wrapper = document.createElement("span");
      wrapper.append(`${label} `);
      const value = document.createElement("b");
      value.textContent = "0";
      wrapper.append(value);
      hud.append(wrapper);
      return value;
    };
    countValues = [addStat("you"), addStat("Bao"), addStat("Linh")];
    trickValue = addStat("trick");
    turnValue = addStat("turn");

    const rows = document.createElement("div");
    rows.className = "stage-rows";
    lastRow = document.createElement("div");
    lastRow.className = "stage-row";
    handRow = document.createElement("div");
    handRow.className = "stage-row";
    rows.append(lastRow, handRow);

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const makeButton = (text: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stage-btn";
      button.textContent = text;
      addListener<MouseEvent>(button, "click", onClick);
      return button;
    };
    const play = makeButton("Play", playSelected);
    playButton = play;
    const pass = makeButton("Pass", passTurn);
    passButton = pass;
    bar.append(play, pass, makeButton("New deal", startDeal));

    const status = document.createElement("p");
    status.className = "stage-status";
    statusLine = status;
    target.replaceChildren(hud, rows, bar, status);
  };

  const unmount = (): void => {
    mounted = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const dispose of cleanups) dispose();
    cleanups.length = 0;
    if (host !== null) host.replaceChildren();
    host = null;
    selected = new Set<string>();
    countValues = [];
    trickValue = null;
    turnValue = null;
    lastRow = null;
    handRow = null;
    statusLine = null;
    playButton = null;
    passButton = null;
  };

  const mount = (nextHost: HTMLElement): void => {
    unmount();
    mounted = true;
    host = nextHost;
    rng = createRng(Date.now() >>> 0);
    buildDom(nextHost);
    startDeal();
  };

  return { mount, unmount };
}
