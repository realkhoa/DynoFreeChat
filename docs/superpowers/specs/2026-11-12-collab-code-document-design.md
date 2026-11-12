# Collab session as an open C# document

Date: 2026-11-12
Status: approved
Scope: `web/index.html`, `web/src/ui/game-dialog.ts`, `web/src/ui/game-board-view.ts`,
`web/src/game/{coordinator,session}.ts`, `web/src/main.ts`, `web/src/styles/ide.css`

## Problem

The collab session was a game window in disguise: opening `Collab` showed a lobby
with a scoreboard, the float dialog was unmistakably a game, and the docked code
view leaked the game through Vietnamese turn copy ("Lượt người chơi X"), a 3x3 grid
of bordered chips and emoji toolbar buttons. A colleague walking past saw a game.

The user's requirement: play during work hours, so the session has to read as a
code file being edited — including editor status chrome — and never as a game.

## Design

### One surface: the document

The session lives in `#game-editor-panel` inside the editor area. `Collab`
(`#btn-hub-collab`) and `Ctrl+B` open that document tab directly; there is no lobby
and no modal in the normal path. `Detach` moves that same element into the modal
frame (`#game-detach-body`) without ending the session, and `Dock` moves it back —
one element, so the buffer, scroll position and socket survive the move. The frame
is cancelled with Escape, which docks instead of hiding a live session.

`Ctrl+B` is the boss key: it opens the document, or flips straight back to the room
tab when the document is already selected.

### Buffer as data

`MatrixBuffer` is a `char[9]` initializer. Each slot is a `char` literal:
`'X'`, `'O'` or `'·'` for empty. Slots are inline text with no box, border or
background, so the rows read `/* row 0 */ 'X', '·', 'O',` like code. A decided
pattern highlights the matching literals (find-match style) and nothing animates.

The file carries plausible C# around the buffer (namespace, `DispatchPointer`,
`Validate`, a pattern cache) so the buffer is not the only content. The gutter is
generated from the rendered `.code-line` elements, so line numbers can never drift
from the code.

### Status is editor chrome, not game copy

- Status bar: `Ln/Col` (follows the hovered slot), `Spaces: 4`, `UTF-8`, `CRLF`,
  diagnostics (`0 errors` / `0 errors, 1 assert`), current thread, session id, and
  run state (`Ready`, `Running`, `Assertion passed`).
- Comments replace game copy: `// thread X active - dispatch pointer`,
  `// Trace.Assert passed - pattern matched (thread X)`,
  `// awaiting remote dispatch (thread O)`, `// remote session attached`.
- The session id is edited in place as a string literal:
  `const string Session = "____";` (Enter attaches). Targets read as editor
  commands: `[ F8 Attach session ]`, `[ F9 New session ]`, `[ F5 Local dual-thread ]`,
  `[ F6 Run simulation ]`, `[ F7 Reset buffer ]`, `[ copy link ]`.
- The toolbar shows `// session: 9B2X (thread x)` so the player knows which thread
  they drive, phrased as a comment rather than "you are X".

### Idle disguise

While no session runs the document may dim (`is-stealth`); a running session is
never dimmed or blurred, because a disguised board cannot be read or hit. Detaching
also keeps the frame crisp.

## Non-goals

- No new game rules, protocol or worker changes.
- No skin for the chat log; only the collab document changes.
- `Hide` keeps its existing meaning (toggle the idle dim) and does not end a session.

## Testing

- Unit: `GameBoardView` renders literals and no boxes, generates a gutter equal to
  the line count, writes the session badge with the thread marker, exposes the
  status bar fields, follows the caret readout, and still skips redundant paints.
- Unit: `GameDialog` opens into the tab (not a modal), detaches and docks the same
  element while keeping the session, docks on cancel, tears down once, and releases
  the session on close.
- Coordinator/session suites updated to the technical comment copy.
- Browser: `scripts/cdp-ttt-shots.mjs` captures idle/running/won/detached/docked and
  asserts gutter count == line count, no Vietnamese game words, and that detach/dock
  preserves the buffer.
- Browser: `scripts/cdp-ttt-online.mjs` plays a full online round through the new
  document UI: both buffers identical at every step, occupied slot refused, rematch
  resetting both sides.
