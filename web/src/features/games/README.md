# Games Feature Module

## 1. Overview & Purpose
The `web/src/features/games` directory contains the embedded minigame ecosystem for DynoFreeChat. Each game is disguised as a generated source document (e.g., C# / C++ code) that blends directly into the editor view with code syntax framing, code comments for HUD and status output, and array initializers for the game boards.

The generic `GameStage` host manages document chrome, mounting, focus mode toggles, and cell size normalization, while individual game factories (`caro`, `chess`, `2048`, `minesweeper`, `sudoku`, `sokoban`, `queens`, `tango`, `battleship`, `pinpoint`, `gunny`, `shooter`, `tienlen`) implement local engines and DOM bindings.

## 2. Prerequisites & Dependencies
- **Runtime**: Node.js >= 22 (or Bun >= 1.2)
- **Framework/Bundler**: Vite 7, TypeScript 7
- **Dependencies**: `@dyno/shared` for online bridges and protocol definitions; standard browser DOM / HTML5 Canvas APIs
- **Target Environment**: Modern evergreen web browsers (Chromium, Firefox, Safari, Edge)

## 3. CLI Options & Arguments Reference
While this is a frontend web module rather than a standalone CLI binary, the games integrate into Vite npm scripts:

| Script / Command | Default Value | Purpose |
|---|---|---|
| `npm run dev -w web` | `http://localhost:5173` | Start Vite development server for the web application |
| `npm run build -w web` | `dist/` | Produce production bundle including game assets and styling |
| `npm run test -w web` | `vitest` | Run unit and component test suites across game modules |
| `npm run typecheck -w web` | `tsc --noEmit` | Validate TypeScript types across all game implementations |

Key Configuration & Style Tokens:
- `--stage-cell-size`: CSS custom property controlling square cell dimensions (defaults to `32px`, adapted up to `64px` for 2048, `52px` for pinpoint, `44px` for chess, etc.).
- `--font-mono`: Monospace font family utilized for authentic code syntax appearance.
- `data-game`: Dataset attribute attached to `.stage-game-host` allowing per-game responsive sizing and scaling.

## 4. Usage Examples
Mounting a game through `GameStage`:
```typescript
import { GameStage } from "./stage";
import { GAME_FACTORIES } from "./factories";

const stage = new GameStage(elements, GAME_FACTORIES, window.localStorage);
// Opens Caro with code framing titled Caro.cs
stage.open("caro", "Caro.cs", "// generated · read-only");
```

Launching the web application in dev mode:
```bash
npm run dev -w web
```

Running game module tests:
```bash
npm test -- web/test/features/games
```

## 5. Output Structure & Schema
- `stage.ts`: Orchestrates the code frame, header lines, footer guards, and DOM lifecycle.
- `stage.css`: Shared styling ensuring enlarged, legible, and comfortable board sizes while strictly preserving the IDE code syntax appearance.
- `registry.ts`: Declares all playable game metadata, class names, hotkeys, and summaries.
- `factories.ts`: Maps game identifiers to lazy game factory instances.
- `<game>/game.ts`: Pure game simulation logic and UI mount implementation.
- `online/`: Matchmaking lobby, WebSocket protocol bridges, and multiplayer session management.

## 6. Troubleshooting & Edge Cases
- **Display Scaling & High-DPI**: The stage cell size uses CSS custom properties `--stage-cell-size` with font sizing tuned for crisp text rendering at all DPI settings.
- **Focus Mode**: Pressing `Ctrl+Shift+H` or the Focus button toggles `data-focus="on"` on the host, hiding HUD comments to display only raw array literals.
- **Unmount Failures**: `GameStage` catches exceptions during module teardown so faulty subcomponents never freeze document tab swapping.
