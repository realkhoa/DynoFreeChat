# Tic-Tac-Toe: lag, multiplayer, and board layout fixes

Date: 2026-10-23
Status: approved
Scope: `shared/src/protocol.ts`, `worker/src/room.ts`, `web/src/game/*`, `web/src/ui/{game-board-view,log-view}.ts`, `web/src/styles/ide.css`

## Problem

Three independent defects make the Collab tab's Tic-Tac-Toe unplayable.

1. **Sustained jank.** `.game-cell.cell-win` runs `animation: cellPulse 1.2s infinite
   alternate` over `filter: brightness()` (`ide.css`). Both containing elements carry
   `.is-stealth`, which applies `filter: blur(2px)`. An animation inside a filtered layer
   forces the blur to be recomputed every frame, forever, including after the game ended.
2. **Multiplayer never completes a game.**
   - Nothing ever sends a game `join` message, so `OnlineGameSession.onPeerJoin` never
     fires and `GameCoordinator.handlePeerJoin` therefore never sends `sync`. A joiner
     always starts from an empty board while the host may be several moves ahead.
   - Moves travel as chat messages (`t: "msg"`, text `[TTT]{...}`). They share the chat
     token bucket (`RATE_CAPACITY = 5`, `RATE_REFILL_MS = 1500`). A nine-move game exceeds
     it, the server answers `RATE_LIMIT`, and `OnlineGameSession` ignores every `error`
     frame, so the move disappears and the two boards diverge permanently.
   - Moves are persisted in room history, replayed to later joiners as chat, rendered in
     the log as raw JSON, and counted as chat notifications.
   - A remote `move` is applied with no turn or ownership check; `cell: 99` grows the
     board array instead of being rejected.
3. **The board does not fit.** `--ttt-cell` is derived from `20vw` with a 76px cap, so the
   dialog grows taller than the viewport on short windows and the grid has to be scrolled
   into view. `.game-code-mode .game-cell` (32x24px, meant for the docked code view) also
   applies to the float dialog, shrinking the click target.
4. **The float dialog cannot open at all.** `GameDialog.close()` calls `onTabClose`, and
   `main.ts closeGameTab()` calls `gameDialog.close()`, so the two recurse with no base
   case. Every close path — the dialog's ✕, the tab's ✕, and "⧉ Cửa sổ rời" — throws
   `RangeError` part-way through, which is why "float" left the view blank.

## Non-goals

- No host migration, no spectating, no reconnection grace period beyond re-hello.
- No change to the chat transport, room registry, or password flow.
- No new game variants.

## Design

### 1. Ephemeral game channel

Game traffic stops using chat messages and gets its own wire frame.

```ts
// shared/src/protocol.ts
export const MAX_GAME_PAYLOAD = 2048;

ClientFrame  = ... | { t: "game"; data: string };
ServerFrame  = ... | { t: "game"; data: string; nick: string };
```

Worker (`worker/src/room.ts`):
- `game` requires an authenticated connection, else `NOT_JOINED`.
- `data` must be a non-empty string of at most `MAX_GAME_PAYLOAD` code points, else
  `BAD_FRAME`.
- Uses a dedicated token bucket stored on the connection (`gameBucket`, `GAME_CAPACITY = 20`,
  `GAME_REFILL_MS = 200`) so a game never competes with real chat. Exceeding it answers
  `RATE_LIMIT` with no `cid`.
- Broadcasts `{ t: "game", data, nick }` to every peer **except the sender**. Nothing is
  persisted, nothing enters `welcome.history`, no presence change, no notification.
- The sender already applied its own move locally, so no echo is needed; ordering is
  guaranteed by the single WebSocket. `seq` below covers the reconnect gap case.

### 2. Game protocol (`web/src/game/protocol.ts`)

`data` carries a JSON object discriminated by `k`. Parsing is total: unknown or malformed
payloads return `null` and are ignored.

| k         | Sender   | Payload |
|-----------|----------|---------|
| `hello`   | both     | `clientId`, `role`, `nick` |
| `state`   | host     | `board`, `turn`, `scores`, `starter`, `seq` |
| `move`    | both     | `cell`, `player`, `seq` |
| `rematch` | both     | `starter` |
| `resync`  | peer     | — |

Validation rules, enforced on receipt, never on trust:
- `board` must be exactly nine entries of `"X" | "O" | null`; `scores` three
  non-negative finite integers; `turn`/`player`/`starter` of type `PlayerMark`;
  `cell` an integer `0..8`; `seq` a non-negative integer.
- A `move` is rejected when the sender is not the player it claims, when the sender's mark
  is not the current turn, when the cell is occupied, or when the game is over.

### 3. Session lifecycle (`web/src/game/session.ts`)

- On every socket `open`: send `hello`.
- `presence.online >= 2` means the opponent is in the room. The coordinator gates the
  board on it and shows "Đang chờ đối thủ…" otherwise.
- Host (`asHost`) is authoritative: it answers any `hello` and any `resync` with `state`,
  and it is the only side that calls `sendState`.
- Role resolution: creator `X`, joiner `O`. When a received `hello` claims the local role,
  both sides recompute deterministically — the lexicographically smaller `clientId` keeps
  `X` — which converges in one round trip and also covers the "both typed the same code
  into Vào phòng" case.
- `seq` increments once per applied move on both sides. A gap triggers `resync`; the host
  answers `state`, which replaces board, turn, scores, starter and seq.

### 4. Coordinator correctness (`web/src/game/coordinator.ts`)

- AI mode applies the human move as `X` only when `turn === "X"`; a double click can no
  longer place two X marks. The AI reply runs on a tracked timer that `rematch`, `cleanup`,
  and mode changes cancel, so a stale AI move cannot land on a fresh board.
- The AI no longer chooses a random corner; the choice uses the minimax score so play is
  deterministic and testable.
- `starter` becomes explicit state. `rematch` alternates it instead of deriving it from
  `turn`, which previously let the same player start again after a win.
- Online moves are ignored until the opponent is present, and remote `move` payloads go
  through the same validation as local ones.

### 5. Layout and animation (`web/src/styles/ide.css`)

- `--ttt-cell: clamp(44px, min(18vw, 11.5dvh), 72px)`. Cell size is bounded by viewport
  height, which is what overflows today.
- `.game-dialog { max-height: calc(100dvh - 12px); overflow: hidden }` and
  `.game-body { min-height: 0; overflow: hidden }`; the grid is the anchor and the
  scoreboard/toolbar absorb the squeeze. `@media (max-height: 640px)` hides score labels.
- `.game-code-mode .game-cell` (32x24) is scoped to `.game-editor-panel.game-code-mode`
  only, so the float dialog keeps a >=44px target.
- The infinite `cellPulse` filter animation is deleted. A won cell gets a static highlight
  plus a single one-shot `opacity` fade-in on `::after`.
- `.is-stealth` splits into opacity (always) and blur (only when no round is in progress).
  `GameDialog.applyStealthDom` toggles `is-stealth--blur` from board visibility, so a live
  board is never blurred.

### 6. Log hygiene (`web/src/ui/log-view.ts`)

Rows whose text starts with `[TTT]` were written by the old transport and are still in
some rooms' history. `LogView` skips them so the upgrade hides the pollution without a
data migration.

### 7. Dialog lifecycle (`web/src/ui/game-dialog.ts`)

`close()` performs the teardown unconditionally but notifies `onTabClose` only on the
outermost call, so the host handler may call back in without looping. `openFloating()`
closes first and raises the modal second, because the host's tab handler would otherwise
shut the dialog immediately after it opened.

## Testing

Test-first, existing harness (`vitest`, jsdom for web, workers pool for the worker).

Worker:
- `game` frame reaches the other peer with the sender's nick and is not echoed to the sender.
- `game` frame is not persisted: a later joiner's `welcome.history` is empty.
- `game` frame before `join` answers `NOT_JOINED`.
- Over-long or non-string `data` answers `BAD_FRAME`.
- A burst of game frames well past the chat bucket limit is not rate limited; an abusive
  burst still is.

Web:
- Payload round-trip and rejection of malformed `board`, `cell`, `seq`, `role`.
- Session sends `hello` on open and on reconnect.
- Host answers `hello` with `state`; joiner adopts it (join mid-game converges).
- `seq` gap triggers `resync`; host answers with `state`.
- Role conflict converges to distinct roles.
- Coordinator rejects out-of-turn, occupied-cell and game-over moves.
- AI cannot double-place, and no AI move lands after `rematch`.
- `rematch` alternates the starter across two rounds.
- Board view renders a won cell without an animation class and keeps cells enabled only
  when it is the local player's turn.

## Risks

- The wire change requires redeploying the worker before the web bundle. Older clients
  cannot play with newer ones; they could not play before either.
- Dropping blur during a live round weakens the stealth disguise. A blurred board is
  unplayable, so the trade-off is deliberate: blur returns as soon as no round is active.
- `MAX_GAME_PAYLOAD` bounds abuse but each frame is still billed as a WebSocket message,
  not as storage. The dedicated bucket limits sustained cost.

## Verification

Unit and integration:

- `npm test -w shared -- --pool=threads` — 43 passed.
- `npm test -w web -- --pool=threads` — 219 passed.
- `npm test -w worker` — 31 passed, including the ephemeral-relay, no-persistence,
  separate-bucket and unauthenticated-socket cases against a real `ChatRoom` Durable
  Object.
- `npm run typecheck` — clean in all three workspaces.

Browser, through CDP (`scripts/cdp-ttt-layout.mjs`, `scripts/cdp-ttt-online.mjs`):

- Dialog at 430x760, 1440x900 and the docked panel at 430x760 / 1280x720: cells 72px in
  the dialog and 38x30 in the code view, `scrollHeight === clientHeight` (no scrolling to
  reach the board), grid bottom inside the viewport.
- A won cell reports `animation-name: none` on the element and a single 0.5s `cellWinFade`
  on `::after` — no infinite animation remains.
- Two headless clients against a real worker, fresh room: host creates `FJAG`, peer joins
  by code, five moves, both boards identical at every step (`XXX.OO...`), both announce
  the same winner with the same score, an occupied cell is refused, chat rows stay at 1 on
  both sides, and "Ván mới" resets both boards with the starter alternating to O.
- Same flow with a stale socket deliberately held open in the room: the handshake still
  converges (host X, guest O).

### Two defects only production exposed

Both were found by replaying the flow against the deployed worker, not by tests:

1. **Handshake before authentication.** The room broadcasts `presence` to every accepted
   socket, including one whose `join` is still being verified. A client that reacted to
   that presence sent `hello` early, the room dropped it as `NOT_JOINED`, and the client
   had already recorded the handshake as sent — so it never retried and both players sat
   on the same mark. Fixed on both sides: the room only counts, notifies and relays to
   sockets that finished joining, and the client refuses game frames until `welcome`.

2. **Presence is not a reliable "peer arrived" signal.** A room can look occupied by a
   socket the edge has dropped but the object has not evicted. The first real player then
   latches its handshake on that ghost and never speaks again, so the second player's hello
   goes unanswered. The handshake now answers any hello it has not answered before, once
   per peer id, which closes the loop without a storm.

Residual operational note: an abrupt browser kill leaves a socket the edge reports as
`1006` some time later, so a room used by repeated automated runs accumulates stale
sockets until the object notices. Real rooms start empty; a room reused by test harnesses
may look occupied while nobody is there.
