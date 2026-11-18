# Tic-Tac-Toe Game Engine & Real-Time Multiplayer Protocol

## 1. Overview & Purpose
The `web/src/game` module provides a pure TypeScript implementation of 3x3 Tic-Tac-Toe game mechanics, an unbeatable Minimax AI player with alpha-beta heuristic evaluation, and a real-time multiplayer network session coordinator running over Cloudflare Worker Durable Objects.

This module powers the collaborative game feature in the **Collab** tab of DynoFreeChat, styled with the Visual Studio 2022 IDE aesthetic and responsive down to ultra-compact WebViews.

## 2. Prerequisites & Dependencies
- **Runtime**: Modern browser environment supporting WebSockets and `HTMLDialogElement`.
- **Node/TypeScript**: Node.js 18+ or Bun, TypeScript 5.0+.
- **Zero Heavy External Dependencies**: Written in pure TypeScript with zero third-party UI or gaming frameworks.

## 3. Architecture & Protocol Reference

```
┌─────────────────────────────────────────────────────────┐
│                      GameDialog                         │
│   (Modal Controller, VS 2022 Window & Input Handlers)    │
└──────────────────────────┬──────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│     GameBoardView       │ │   OnlineGameSession     │
│ (Scoreboard & 3x3 Grid) │ │ (WebSocket Coordinator) │
└─────────────────────────┘ └────────────┬────────────┘
                                         │ JSON Frames
                                         ▼
                             Cloudflare Durable Object
```

### Network Protocol (`TttProtocolMessage`)
Real-time messages exchanged across WebSocket connections use JSON frames formatted as:
- `join`: Sent upon entering a room: `{ ttt: "join", player: "X" | "O", nick: string }`
- `move`: Broadcasts cell placement: `{ ttt: "move", cell: 0..8, player: "X" | "O" }`
- `reset`: Triggers a rematch: `{ ttt: "reset", starter: "X" | "O" }`
- `sync`: Synchronizes game state to newly joined players: `{ ttt: "sync", board: BoardState, turn: "X" | "O", scores: GameScore }`

## 4. Usage Examples

### Starting a Local or AI Game
```ts
import { computeBestMove, evaluateBoard, createEmptyBoard } from "./tictactoe";

const board = createEmptyBoard();
board[0] = "X";

// Compute AI counter-move (Minimax)
const aiMove = computeBestMove(board, "O");
board[aiMove] = "O";

// Evaluate state
const outcome = evaluateBoard(board);
if (outcome.winner) {
  console.log("Winner:", outcome.winner);
}
```

### Joining a Multiplayer Room
```ts
import { OnlineGameSession } from "./session";

const session = new OnlineGameSession({
  roomCode: "9B2X",
  asHost: false,
  wsUrl: "wss://dynofreechat-api.nbk2124-z.workers.dev",
  apiBase: "https://dynofreechat-api.nbk2124-z.workers.dev",
  identity: { nick: "Guest", color: "#007acc" },
  onConnectedChange: (connected) => console.log("Connected:", connected),
  onRemoteMove: (cell, player) => console.log("Peer moved:", cell, player),
  onStatusText: (text) => console.log("Status:", text),
});

await session.connect();
```

## 5. Output Structure & Schema
- `web/src/game/tictactoe.ts`: Core game state definitions, win detection, board evaluation, Minimax AI, room code generators (`generateRoomCode`, `roomSlugFromCode`).
- `web/src/game/session.ts`: `OnlineGameSession` class managing WebSocket connection, reconnect logic, message serialization/deserialization, and dispatching events to UI.
- `web/src/game/coordinator.ts`: `GameCoordinator` decoupling game loop, AI moves, and network handlers from DOM views.
- `web/src/game/stealth-pref.ts`: Persistence helper for stealth blur, C# code disguise mode, and opacity levels.

## 6. Stealth Mode, C# Code Camouflage & Tab Integration
- **Document Tab Integration (`DiagnosticMatrix.cs`)**: Opens right inside the IDE tabstrip as a C# file with syntax highlighting and line numbers.
- **Stealth Blur on Idle**: Automatically blurs (`filter: blur(2px); opacity: 0.35`) when the mouse is outside the board, rendering it unreadable to observers. Unblurs smoothly upon hovering.
- **C# Matrix Disguise (`game-code-mode`)**: Formats 3x3 board as a C# pointer array (`[ · ]`, `[ X ]`, `[ O ]`) with code comments and test assertions.
- **Boss Key**: `Ctrl+B` or `Esc` immediately toggles back to the active chat room.

## 7. Troubleshooting & Edge Cases
- **Duplicate Connections**: The session coordinator ignores echo events originated by the local client.
- **Out-of-order Moves**: Moves targeting occupied cells or submitted out of turn are rejected client-side.
- **Network Latency / Disconnections**: When host disconnects or reconnects, `sync` messages restore the authoritative board state and score counter.
- **Direct Hash Link Join**: Users navigating to `index.html#ttt=ABCD` immediately connect and launch the game modal.
