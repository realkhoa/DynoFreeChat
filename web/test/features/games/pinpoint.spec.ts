// @vitest-environment jsdom
/**
 * @file pinpoint.spec.ts
 * @brief Scoring rules and the win/lose flow of the pinpoint module.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_TRIES,
  WORD_LENGTH,
  WORDS,
  createPinpointGame,
  isValidWord,
  isWin,
  normalizeWord,
  pickAnswer,
  scoreGuess,
} from "@/features/games/pinpoint/game";

/**
 * @brief Types one word and submits it on the physical keyboard path.
 * @param host Mounted host element.
 * @param word Letters to press.
 */
function typeAndEnter(host: HTMLElement, word: string): void {
  for (const letter of word) {
    host.dispatchEvent(new KeyboardEvent("keydown", { key: letter, bubbles: true }));
  }
  host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

/**
 * @brief Reads the status line of a mounted game.
 * @param host Mounted host element.
 * @return Status text, or an empty string.
 */
function statusOf(host: HTMLElement): string {
  return host.querySelector(".stage-status")?.textContent ?? "";
}

describe("pinpoint word list", () => {
  it("offers at least forty usable five-letter words", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const word of WORDS) expect(word).toMatch(/^[A-Z]{5}$/);
  });

  it("normalises raw input to the accepted alphabet", () => {
    expect(normalizeWord("crane")).toBe("CRANE");
    expect(normalizeWord(" cr!a-n e ")).toBe("CRANE");
    expect(normalizeWord("abcdefgh")).toHaveLength(WORD_LENGTH);
  });

  it("validates words against the pool", () => {
    expect(isValidWord("crane")).toBe(true);
    expect(isValidWord("CRANE")).toBe(true);
    expect(isValidWord("CRAN")).toBe(false);
    expect(isValidWord("ZZZZZ")).toBe(false);
  });

  it("picks a deterministic answer from the pool", () => {
    const first = pickAnswer(() => 0.25);
    const second = pickAnswer(() => 0.25);
    expect(first).toBe(second);
    expect(WORDS).toContain(first);
  });
});

describe("pinpoint scoring", () => {
  it("marks a perfect guess as five correct letters", () => {
    expect(scoreGuess("CRANE", "CRANE")).toEqual(["correct", "correct", "correct", "correct", "correct"]);
  });

  it("separates correct spots, wrong spots and absent letters", () => {
    expect(scoreGuess("SNARE", "CRANE")).toEqual(["absent", "misplaced", "correct", "misplaced", "correct"]);
  });

  it("uses each answer letter at most once", () => {
    expect(scoreGuess("BABES", "ABBEY")).toEqual(["misplaced", "misplaced", "correct", "correct", "absent"]);
  });

  it("marks a duplicate guess letter absent once the answer copies are used", () => {
    expect(scoreGuess("LLAMA", "ALLOY")).toEqual(["misplaced", "correct", "misplaced", "absent", "absent"]);
  });

  it("reports a win only when every letter is in the right spot", () => {
    expect(isWin(["correct", "correct", "correct", "correct", "correct"])).toBe(true);
    expect(isWin(["correct", "misplaced", "correct", "correct", "correct"])).toBe(false);
    expect(isWin([])).toBe(false);
  });
});

describe("pinpoint view", () => {
  it("mounts, accepts a guess and shows its feedback", () => {
    const host = document.createElement("div");
    const game = createPinpointGame("CRANE");

    expect(() => game.mount(host)).not.toThrow();
    expect(host.children.length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[role=gridcell]")).toHaveLength(WORD_LENGTH * MAX_TRIES);
    expect(statusOf(host)).toContain("Guess 1 of 6");

    typeAndEnter(host, "SLATE");
    expect(statusOf(host)).toBe("Guess 2 of 6.");
    const cells = host.querySelectorAll("[role=gridcell]");
    expect(cells[0]?.textContent).toBe("S");
    expect(cells[1]?.textContent).toBe("L");

    expect(() => game.unmount()).not.toThrow();
    expect(host.children).toHaveLength(0);
  });

  it("reports a win as soon as the answer is guessed", () => {
    const host = document.createElement("div");
    const game = createPinpointGame("CRANE");
    game.mount(host);

    typeAndEnter(host, "CRANE");
    expect(statusOf(host)).toContain("Solved in 1 try");
    expect(host.querySelectorAll(".stage-cell.is-primary")).toHaveLength(WORD_LENGTH);

    game.unmount();
  });

  it("reports a loss after six misses and exposes the answer", () => {
    const host = document.createElement("div");
    const game = createPinpointGame("CRANE");
    game.mount(host);

    for (let round = 0; round < MAX_TRIES; round += 1) typeAndEnter(host, "SLATE");
    expect(statusOf(host)).toBe("Out of tries — the word was CRANE.");

    game.unmount();
  });

  it("rejects an unknown word without spending a try", () => {
    const host = document.createElement("div");
    const game = createPinpointGame("CRANE");
    game.mount(host);

    typeAndEnter(host, "ZZZZZ");
    expect(statusOf(host)).toContain("Not in the word list");
    expect(host.querySelector(".stage-hud")?.textContent).toContain("0 used");
    expect(host.querySelectorAll(".stage-cell.is-dim")).toHaveLength(0);

    game.unmount();
  });
});
