/**
 * @file lobby.ts
 * @brief Match.cs document: create or join an online room, with the room list.
 * @details Two panes, like a solution explorer next to an editor: the left pane
 * creates a room (game, code, password) or joins one by code, and the right pane
 * lists the rooms the Worker currently knows, newest first. The lobby never owns
 * game rules; the match protocol does.
 */

import { createRoom, listRooms } from "@/api";
import { roomSocketUrl } from "@/env";
import type { GameDefinition } from "@/features/games/registry";
import { formatAge } from "@/shared/lib/format";
import type { OnlineBridge, OnlinePhase } from "./bridge";
import { OnlineMatch, type OnlineMatchOptions } from "./match";

/** DOM hosts owned by the lobby document. */
export interface MatchElements {
  panel: HTMLElement;
  gameSelect: HTMLSelectElement;
  /** Room code typed in the create block. */
  createCode: HTMLInputElement;
  /** Optional password typed in the create block. */
  createPass: HTMLInputElement;
  createButton: HTMLButtonElement;
  /** Room code typed in the join block. */
  joinCode: HTMLInputElement;
  /** Password typed in the join block. */
  joinPass: HTMLInputElement;
  joinButton: HTMLButtonElement;
  leaveButton: HTMLButtonElement;
  status: HTMLElement;
  roster: HTMLElement;
  /** Right pane that receives the room rows. */
  roomList: HTMLElement;
  refreshButton: HTMLButtonElement;
}

/** Collaborators the lobby needs from the app shell. */
export interface MatchDeps {
  /** Worker socket base URL, e.g. `wss://…/ws`. */
  wsUrl: string;
  /** Worker HTTP base URL, for the room API. */
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
  /** Room listing seam; tests replace it. */
  listRooms?: (
    apiBase: string,
    fetchImpl: typeof fetch,
  ) => Promise<Array<{ slug: string; locked: boolean; lastSeen: number }>>;
}

/** Room code shape accepted by the Worker lobby. */
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

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
    elements.refreshButton.addEventListener("click", () => void this.refreshRooms());
    elements.gameSelect.addEventListener("change", () => this.syncSelection());
    elements.joinCode.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.join();
    });
    elements.joinPass.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.join();
    });
    elements.roomList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest<HTMLElement>("[data-room]");
      const code = row?.dataset.room;
      if (code !== undefined) this.pickRoom(code, row?.dataset.locked === "true");
    });
  }

  /** Game currently selected in the lobby, if any. */
  get currentGame(): GameDefinition | null {
    return this.selected;
  }

  /** Whether a match socket is live. */
  get isConnected(): boolean {
    return this.match !== null;
  }

  /** @brief Fills the game list, then loads the room list. */
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
      games.length === 0 ? "// no online games in this build" : "// create a room or join one by code",
    );
    this.paintRoster([]);
    void this.refreshRooms();
  }

  /** @brief Loads and paints the room list in the right pane. */
  async refreshRooms(): Promise<void> {
    const list = this.elements.roomList;
    this.elements.refreshButton.disabled = true;
    this.setStatus("// loading rooms…");

    try {
      const listRoomsImpl = this.deps.listRooms ?? listRooms;
      const fetchImpl = this.deps.fetchImpl ?? ((input, init) => fetch(input, init));
      const rooms = await listRoomsImpl(this.deps.apiBase, fetchImpl);
      this.paintRooms(rooms);
      this.setStatus(
        rooms.length === 0 ? "// no rooms yet - create the first one" : `// ${rooms.length} room(s)`,
      );
    } catch {
      list.replaceChildren();
      const error = document.createElement("div");
      error.className = "match-room-empty";
      error.textContent = "// cannot list rooms";
      list.append(error);
      this.setStatus("// cannot list rooms - worker unreachable");
    } finally {
      this.elements.refreshButton.disabled = false;
    }
  }

  /**
   * @brief Creates a room from the create block and joins it.
   * @return Resolves when the socket started connecting.
   */
  async createAndJoin(): Promise<void> {
    if (this.busy) return;
    const game = this.requireGame();
    if (game === null) return;

    this.busy = true;
    this.setStatus("// creating room…");
    try {
      const code = this.createCode(game);
      const pass = this.elements.createPass.value.trim();
      const body: { slug: string; pass?: string } = { slug: code };
      if (pass.length > 0) body.pass = pass;

      const fetchImpl = this.deps.fetchImpl ?? ((input, init) => fetch(input, init));
      const result = await createRoom(this.deps.apiBase, body, fetchImpl);
      if (!result.ok) {
        this.setStatus(`// cannot create room (${result.code})`);
        return;
      }

      this.elements.joinCode.value = code;
      this.elements.joinPass.value = pass;
      this.connect(game, code, pass);
      void this.refreshRooms();
    } catch {
      this.setStatus("// cannot create room - worker unreachable");
    } finally {
      this.busy = false;
    }
  }

  /** @brief Joins the room code typed in the join block. */
  join(): void {
    const game = this.requireGame();
    if (game === null) return;

    const code = this.elements.joinCode.value.trim().toLowerCase();
    if (!CODE_PATTERN.test(code)) {
      this.setStatus("// room code must be 2-24 chars: a-z, 0-9, dash");
      return;
    }
    this.connect(game, code, this.elements.joinPass.value.trim());
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
   * @brief Picks one room from the list: joins it, or asks for its password.
   * @param code Room code.
   * @param locked Whether the room is password protected.
   */
  private pickRoom(code: string, locked: boolean): void {
    this.elements.joinCode.value = code;
    if (locked) {
      this.setStatus(`// ${code} is locked - type its password, then Join`);
      this.elements.joinPass.focus();
      return;
    }
    this.elements.joinPass.value = "";
    this.join();
  }

  /**
   * @brief Opens the socket and wires the match callbacks.
   * @param game Selected game.
   * @param code Room code.
   * @param pass Room password, empty when open.
   */
  private connect(game: GameDefinition, code: string, pass: string): void {
    this.match?.leave();

    const options: OnlineMatchOptions = {
      url: roomSocketUrl(this.deps.wsUrl, code),
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
    this.setStatus(`// joining ${code} as ${game.name}…`);
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
   * @brief Derives the room code to create.
   * @param game Selected game.
   * @return The typed code when valid, otherwise a generated one.
   */
  private createCode(game: GameDefinition): string {
    const typed = this.elements.createCode.value.trim().toLowerCase();
    if (CODE_PATTERN.test(typed)) return typed;
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${game.id}-${suffix}`.slice(0, 24);
  }

  /** @brief Keeps the selected game in sync with the select box. */
  private syncSelection(): void {
    const id = this.elements.gameSelect.value;
    this.selected = this.deps.games.find((entry) => entry.id === id) ?? null;
  }

  /**
   * @brief Paints the room rows, newest first.
   * @param rooms Room summaries from the Worker.
   */
  private paintRooms(rooms: Array<{ slug: string; locked: boolean; lastSeen: number }>): void {
    const list = this.elements.roomList;
    list.replaceChildren();

    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "match-room-empty";
      empty.textContent = "// no rooms yet - create the first one";
      list.append(empty);
      return;
    }

    const sorted = [...rooms].sort((left, right) => right.lastSeen - left.lastSeen);
    for (const room of sorted) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "match-room";
      row.dataset.room = room.slug;
      row.dataset.locked = String(room.locked);
      row.setAttribute("role", "listitem");

      const lock = document.createElement("span");
      lock.className = "match-room-lock";
      lock.textContent = room.locked ? "🔒" : "·";

      const code = document.createElement("span");
      code.className = "match-room-code";
      code.textContent = room.slug;

      const meta = document.createElement("span");
      meta.className = "match-room-meta";
      meta.textContent = formatAge(room.lastSeen);

      row.append(lock, code, meta);
      list.append(row);
    }
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
