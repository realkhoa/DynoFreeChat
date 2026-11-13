/**
 * @file lobby.ts
 * @brief Match.cs document: create or join a room, then start the online game.
 * @details The lobby lists the games that advertise online play, lets the player
 * create a room (the Worker lobby API) or join an existing slug, and hands the
 * ready bridge to the host so the game stage can open the board. It never owns
 * game rules; the match protocol does.
 */

import { roomSocketUrl } from "@/env";
import type { GameDefinition } from "@/features/games/registry";
import type { OnlineBridge, OnlinePhase } from "./bridge";
import { OnlineMatch, type OnlineMatchOptions } from "./match";

/** DOM hosts owned by the lobby document. */
export interface MatchElements {
  panel: HTMLElement;
  gameSelect: HTMLSelectElement;
  slug: HTMLInputElement;
  pass: HTMLInputElement;
  createButton: HTMLButtonElement;
  joinButton: HTMLButtonElement;
  leaveButton: HTMLButtonElement;
  status: HTMLElement;
  roster: HTMLElement;
}

/** Collaborators the lobby needs from the app shell. */
export interface MatchDeps {
  /** Worker socket base URL, e.g. `wss://…/ws`. */
  wsUrl: string;
  /** Worker HTTP base URL, for creating rooms. */
  apiBase: string;
  /** Current nickname. */
  nick: () => string;
  /** Current avatar colour. */
  color: () => string;
  /** Games to list; only entries with `online` are offered. */
  games: readonly GameDefinition[];
  /** Called once the match is ready; opens the game stage with the bridge. */
  onMatch: (game: GameDefinition, bridge: OnlineBridge) => void;
  /** Fetch implementation; tests replace it. */
  fetchImpl?: typeof fetch;
  /** Match factory; tests replace it. */
  createMatch?: (options: OnlineMatchOptions) => OnlineMatch;
}

/** Room slug shape accepted by the Worker lobby. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

/**
 * @brief Owns the Match.cs document.
 */
export class MatchView {
  private match: OnlineMatch | null = null;
  private selected: GameDefinition | null = null;
  private busy = false;

  /**
   * @param elements DOM hosts.
   * @param deps Shell collaborators.
   */
  constructor(
    private readonly elements: MatchElements,
    private readonly deps: MatchDeps,
  ) {
    elements.createButton.addEventListener("click", () => void this.createAndJoin());
    elements.joinButton.addEventListener("click", () => this.join());
    elements.leaveButton.addEventListener("click", () => this.leave());
    elements.gameSelect.addEventListener("change", () => this.syncSelection());
  }

  /** Game currently selected in the lobby, if any. */
  get currentGame(): GameDefinition | null {
    return this.selected;
  }

  /** Whether a match socket is live. */
  get isConnected(): boolean {
    return this.match !== null;
  }

  /** @brief Fills the game list and paints the idle state. */
  start(): void {
    const games = this.deps.games.filter((game) => game.online === true);
    this.elements.gameSelect.replaceChildren();
    for (const game of games) {
      const option = document.createElement("option");
      option.value = game.id;
      option.textContent = `${game.name} — ${game.summary}`;
      this.elements.gameSelect.append(option);
    }
    this.selected = games[0] ?? null;
    this.elements.createButton.disabled = games.length === 0;
    this.elements.joinButton.disabled = games.length === 0;
    this.elements.leaveButton.disabled = this.match === null;
    this.setStatus(
      games.length === 0 ? "// no online games in this build" : "// pick a game, then create or join a room",
    );
    this.paintRoster([]);
  }

  /**
   * @brief Creates a room through the Worker lobby API and joins it.
   * @return Resolves when the socket started connecting.
   */
  async createAndJoin(): Promise<void> {
    if (this.busy) return;
    const game = this.requireGame();
    if (game === null) return;

    this.busy = true;
    this.setStatus("// creating room…");
    try {
      const slug = this.roomSlug(game);
      const pass = this.elements.pass.value.trim();
      const body: Record<string, string> = { slug };
      if (pass.length > 0) body.pass = pass;

      const fetchImpl = this.deps.fetchImpl ?? ((input, init) => fetch(input, init));
      const response = await fetchImpl(`${this.deps.apiBase}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.setStatus(`// cannot create room (${response.status})`);
        return;
      }

      this.elements.slug.value = slug;
      this.connect(game, slug, pass);
    } catch {
      this.setStatus("// cannot create room - worker unreachable");
    } finally {
      this.busy = false;
    }
  }

  /** @brief Joins the room slug typed in the box. */
  join(): void {
    const game = this.requireGame();
    if (game === null) return;

    const slug = this.elements.slug.value.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      this.setStatus("// room slug must be 2-24 chars: a-z, 0-9, dash");
      return;
    }
    this.connect(game, slug, this.elements.pass.value.trim());
  }

  /** @brief Leaves the current match, if any. */
  leave(): void {
    this.match?.leave();
    this.match = null;
    this.elements.leaveButton.disabled = true;
    this.setStatus("// left the match");
    this.paintRoster([]);
  }

  /**
   * @brief Opens the socket and wires the match callbacks.
   * @param game Selected game.
   * @param slug Room slug.
   * @param pass Room password, empty when open.
   */
  private connect(game: GameDefinition, slug: string, pass: string): void {
    this.match?.leave();

    const options: OnlineMatchOptions = {
      url: roomSocketUrl(this.deps.wsUrl, slug),
      nick: this.deps.nick(),
      color: this.deps.color(),
      game: game.id,
      ...(pass.length > 0 ? { pass } : {}),
      onStart: (bridge) => {
        this.elements.leaveButton.disabled = false;
        this.paintRoster([
          `you are ${bridge.role} (seat ${bridge.seat})`,
          `opponent: ${bridge.peerNick ?? "…"}`,
        ]);
        this.deps.onMatch(game, bridge);
      },
      onStatus: (text) => this.setStatus(`// ${text}`),
      onError: (text) => this.setStatus(`// error: ${text}`),
      onPhase: (phase) => this.paintPhase(phase),
    };

    const createMatch = this.deps.createMatch ?? ((matchOptions) => new OnlineMatch(matchOptions));
    this.match = createMatch(options);
    this.match.start();
    this.elements.leaveButton.disabled = false;
    this.setStatus(`// joining ${slug} as ${game.name}…`);
  }

  /**
   * @brief Reads the selected game, reporting when none is available.
   * @return The game, or `null`.
   */
  private requireGame(): GameDefinition | null {
    const id = this.elements.gameSelect.value;
    const game = this.deps.games.find((entry) => entry.id === id && entry.online === true) ?? null;
    this.selected = game;
    if (game === null) this.setStatus("// pick an online game first");
    return game;
  }

  /**
   * @brief Derives the room slug to create.
   * @param game Selected game.
   * @return The typed slug when valid, otherwise a generated one.
   */
  private roomSlug(game: GameDefinition): string {
    const typed = this.elements.slug.value.trim().toLowerCase();
    if (SLUG_PATTERN.test(typed)) return typed;
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${game.id}-${suffix}`.slice(0, 24);
  }

  /** @brief Keeps the selected game in sync with the select box. */
  private syncSelection(): void {
    const id = this.elements.gameSelect.value;
    this.selected = this.deps.games.find((entry) => entry.id === id) ?? null;
  }

  /**
   * @brief Writes one status line.
   * @param text Message to show.
   */
  private setStatus(text: string): void {
    this.elements.status.textContent = text;
  }

  /**
   * @brief Paints the connection phase as a short label.
   * @param phase Current phase.
   */
  private paintPhase(phase: OnlinePhase): void {
    const labels: Record<OnlinePhase, string> = {
      connecting: "connecting",
      waiting: "waiting for opponent",
      playing: "match running",
      "peer-left": "opponent left",
      closed: "closed",
    };
    this.elements.panel.dataset.phase = phase;
    this.setStatus(`// ${labels[phase]}`);
  }

  /**
   * @brief Paints the roster lines under the status.
   * @param lines Roster lines.
   */
  private paintRoster(lines: string[]): void {
    this.elements.roster.replaceChildren();
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "match-roster-line";
      row.textContent = `// ${line}`;
      this.elements.roster.append(row);
    }
  }
}
