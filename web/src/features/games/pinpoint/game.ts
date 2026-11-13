/**
 * @file game.ts
 * @brief Pinpoint: a six-try, five-letter word deduction game.
 * @details Scoring is a pure function so the duplicate-letter rules are covered by
 * tests without a DOM. The view keeps the round in the factory closure and owns the
 * physical plus on-screen keyboard.
 */

import type { GameMount } from "../mount";

/** Letters per guess. */
export const WORD_LENGTH = 5;

/** Guesses a round allows. */
export const MAX_TRIES = 6;

/** State of one scored letter. */
export type LetterState = "correct" | "misplaced" | "absent";

/** Deterministic pseudo random source returning numbers in `[0, 1)`. */
export type Rng = () => number;

/** Answer pool, all ASCII uppercase and five letters long. */
const WORD_SOURCE =
  "CRANE SLATE AUDIO HOUSE MOUNT PLANT STONE LIGHT WATER BRAVE " +
  "CHESS DRIVE FLAME GHOST HONEY IVORY JOKER KNIFE LEMON MAGIC " +
  "NOBLE OCEAN PIANO QUEEN RIVER SNAKE TIGER UNCLE VOICE WHALE " +
  "XENON YOUTH ZEBRA BREAD CLOUD DREAM EARTH FRUIT GRAPE HEART " +
  "IMAGE JUICE KNOWN LAUGH MONEY NIGHT ORDER PEACE QUICK RADIO " +
  "SMILE TABLE UPPER VISIT WORLD YIELD ZESTY CHAIR BLOOM CLOCK " +
  "DANCE FIELD GREEN HAPPY INPUT JOLLY KARMA LUCKY MERRY NURSE " +
  "OPERA PILOT QUOTE ROBOT SUGAR TRUST UNDER VIVID WHEAT PLUCK";

/** Answers the game can pick from. */
export const WORDS: readonly string[] = WORD_SOURCE.split(" ");

/** @brief Normalises user input to uppercase A-Z, cut to {@link WORD_LENGTH}. */
export function normalizeWord(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, WORD_LENGTH);
}

/**
 * @brief Scores one guess against the answer, Wordle style.
 * @details Correct positions are claimed first, so a repeated letter in the guess is
 * only marked misplaced while the answer still has an unused copy of it.
 */
export function scoreGuess(guess: string, answer: string): LetterState[] {
  const target = answer.toUpperCase();
  const letters = guess.toUpperCase();
  const states = new Array<LetterState>(target.length).fill("absent");
  const remaining = new Map<string, number>();

  for (let index = 0; index < target.length; index += 1) {
    const letter = target.charAt(index);
    if (letters.charAt(index) === letter) states[index] = "correct";
    else remaining.set(letter, (remaining.get(letter) ?? 0) + 1);
  }

  for (let index = 0; index < target.length; index += 1) {
    if (states[index] === "correct") continue;
    const letter = letters.charAt(index);
    const left = remaining.get(letter) ?? 0;
    if (left <= 0) continue;
    states[index] = "misplaced";
    remaining.set(letter, left - 1);
  }

  return states;
}

/** @brief Checks a normalised word against a pool that defaults to {@link WORDS}. */
export function isValidWord(word: string, words: readonly string[] = WORDS): boolean {
  const normalized = normalizeWord(word);
  return normalized.length === WORD_LENGTH && words.includes(normalized);
}

/** @brief Reports whether every letter of a scored guess is in the right spot. */
export function isWin(states: readonly LetterState[]): boolean {
  return states.length > 0 && states.every((state) => state === "correct");
}

/** @brief Picks a random answer; pass a seeded {@link Rng} for determinism. */
export function pickAnswer(rng: Rng = Math.random): string {
  const index = Math.min(WORDS.length - 1, Math.floor(rng() * WORDS.length));
  return WORDS[index] ?? "CRANE";
}

/** One teardown callback registered while the view is mounted. */
type Cleanup = () => void;

/** On-screen keyboard rows. */
const KEY_ROWS: readonly string[] = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/**
 * @brief Builds the pinpoint game module.
 * @param answerOverride Fixed answer, used by tests; a random word otherwise.
 * @return A mount whose state is fully released by `unmount`.
 */
export function createPinpointGame(answerOverride?: string): GameMount {
  let host: HTMLElement | null = null;
  let cleanups: Cleanup[] = [];
  let cells: HTMLDivElement[] = [];
  let keyButtons: Map<string, HTMLButtonElement> = new Map();
  let hudLine: HTMLElement | null = null;
  let statusLine: HTMLElement | null = null;

  let answer = answerOverride === undefined ? "CRANE" : normalizeWord(answerOverride);
  let guesses: string[] = [];
  let scored: LetterState[][] = [];
  let draft = "";
  let over = false;
  let message = "";

  /** @brief Registers a listener that `unmount` removes again. */
  function listen(target: HTMLElement, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** @brief Builds a styled toolbar button wired to `onClick`. */
  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-btn";
    button.textContent = label;
    listen(button, "click", onClick);
    return button;
  }

  /** @brief Starts a fresh round. */
  function reset(): void {
    answer = answerOverride === undefined ? pickAnswer() : normalizeWord(answerOverride);
    guesses = [];
    scored = [];
    draft = "";
    over = false;
    message = `Guess 1 of ${MAX_TRIES}.`;
    render();
  }

  /** @brief Adds one letter to the draft. */
  function typeLetter(letter: string): void {
    if (over || draft.length >= WORD_LENGTH) return;
    draft += letter.toUpperCase();
    message = `Guess ${guesses.length + 1} of ${MAX_TRIES}.`;
    render();
  }

  /** @brief Removes the last drafted letter. */
  function backspace(): void {
    if (over || draft.length === 0) return;
    draft = draft.slice(0, -1);
    render();
  }

  /** @brief Scores the draft, or explains why it cannot be scored. */
  function submit(): void {
    if (over) return;
    if (draft.length !== WORD_LENGTH) {
      message = `Needs ${WORD_LENGTH} letters.`;
      render();
      return;
    }
    if (!isValidWord(draft)) {
      message = "Not in the word list — try another word.";
      render();
      return;
    }

    const states = scoreGuess(draft, answer);
    guesses = [...guesses, draft];
    scored = [...scored, states];
    draft = "";

    if (isWin(states)) {
      over = true;
      message = `Solved in ${guesses.length} tr${guesses.length === 1 ? "y" : "ies"}.`;
    } else if (guesses.length >= MAX_TRIES) {
      over = true;
      message = `Out of tries — the word was ${answer}.`;
    } else {
      message = `Guess ${guesses.length + 1} of ${MAX_TRIES}.`;
    }
    render();
  }

  /**
   * @brief Best known state for one letter across the scored guesses.
   * @return The strongest state, or `null` when the letter was never played.
   */
  function letterState(letter: string): LetterState | null {
    let best: LetterState | null = null;
    scored.forEach((states, row) => {
      const guess = guesses[row];
      if (guess === undefined) return;
      for (let column = 0; column < guess.length; column += 1) {
        if (guess.charAt(column) !== letter) continue;
        const state = states[column];
        if (state === undefined) continue;
        if (state === "correct" || best === null) best = state;
        else if (state === "misplaced" && best === "absent") best = state;
      }
    });
    return best;
  }

  /** @brief Paints the board, keyboard, HUD and status line. */
  function render(): void {
    if (hudLine !== null) {
      hudLine.textContent = `Word ${WORD_LENGTH} letters · ${MAX_TRIES} tries · ${guesses.length} used`;
    }
    if (statusLine !== null) statusLine.textContent = message;

    cells.forEach((cell, index) => {
      const row = Math.floor(index / WORD_LENGTH);
      const column = index % WORD_LENGTH;
      const guess = guesses[row];
      const states = scored[row];
      const isCurrent = row === guesses.length;
      const letter = guess === undefined ? (isCurrent ? draft.charAt(column) : "") : guess.charAt(column);
      const state = states === undefined ? undefined : states[column];

      cell.textContent = letter;
      if (state === "correct") cell.className = "stage-cell is-primary";
      else if (state === "misplaced") cell.className = "stage-cell is-good";
      else if (state === "absent") cell.className = "stage-cell is-dim";
      else cell.className = letter.length === 0 ? "stage-cell is-muted" : "stage-cell";
      cell.setAttribute(
        "aria-label",
        `Row ${row + 1} column ${column + 1}: ${letter.length === 0 ? "empty" : letter}`,
      );
    });

    keyButtons.forEach((button, letter) => {
      const state = letterState(letter);
      button.className = state === "correct" ? "stage-btn is-active" : "stage-btn";
      button.setAttribute("aria-pressed", state === "correct" ? "true" : "false");
    });
  }

  /** @brief Builds the guess grid. */
  function buildBoard(): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = `repeat(${WORD_LENGTH}, 52px)`;
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Pinpoint guesses");

    const fragment = document.createDocumentFragment();
    cells = [];
    for (let index = 0; index < WORD_LENGTH * MAX_TRIES; index += 1) {
      const cell = document.createElement("div");
      cell.className = "stage-cell is-muted";
      cell.setAttribute("role", "gridcell");
      fragment.append(cell);
      cells.push(cell);
    }
    grid.append(fragment);
    return grid;
  }

  /** @brief Builds the on-screen keyboard. */
  function buildKeyboard(): HTMLDivElement {
    const keyboard = document.createElement("div");
    keyboard.className = "stage-rows";
    keyButtons = new Map();

    KEY_ROWS.forEach((row, rowIndex) => {
      const line = document.createElement("div");
      line.className = "stage-row";
      for (const letter of row) {
        const button = makeButton(letter, () => typeLetter(letter));
        button.setAttribute("aria-label", `Letter ${letter}`);
        line.append(button);
        keyButtons.set(letter, button);
      }
      if (rowIndex === KEY_ROWS.length - 1) {
        const back = makeButton("Del", () => backspace());
        back.setAttribute("aria-label", "Backspace");
        line.append(
          makeButton("Enter", () => submit()),
          back,
        );
      }
      keyboard.append(line);
    });
    return keyboard;
  }

  /** @brief Handles the physical keyboard. */
  function onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      backspace();
      return;
    }
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      typeLetter(event.key);
    }
  }

  /** @brief Mounts the game into a host. */
  function mount(target: HTMLElement): void {
    unmount();
    host = target;
    target.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    bar.append(makeButton("New word", () => reset()));

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    hudLine = document.createElement("span");
    hud.append(hudLine);

    statusLine = document.createElement("p");
    statusLine.className = "stage-status";
    statusLine.setAttribute("aria-live", "polite");

    target.append(bar, hud, buildBoard(), statusLine, buildKeyboard());
    target.tabIndex = 0;
    target.setAttribute("aria-label", "Pinpoint game");
    listen(target, "keydown", onKeyDown);
    target.focus();
    reset();
  }

  /** @brief Releases listeners and the rendered DOM. */
  function unmount(): void {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (host !== null) {
      host.replaceChildren();
      host.removeAttribute("tabindex");
      host.removeAttribute("aria-label");
    }
    host = null;
    cells = [];
    keyButtons = new Map();
    hudLine = null;
    statusLine = null;
  }

  return { mount, unmount };
}
