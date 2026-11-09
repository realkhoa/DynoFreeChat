# Scratch Tools Registry (`scripts/scratch/`)

## 1. Overview & Purpose
This directory hosts developer tools, exploratory scripts, diagnostic utilities, and automated visual regression helpers for the DynoFreeChat codebase. These tools assist with taking automated browser screenshots via Chrome DevTools Protocol (CDP), testing WebSocket communication, analyzing UI metrics, and validating layout responsiveness.

## 2. Prerequisites & Dependencies
- **Runtime**: [Bun](https://bun.sh) (v1.3.13+) or Node.js (v22+)
- **Browser**: Microsoft Edge or Google Chrome installed in standard Windows program directories.
- **Packages**: `ws` for WebSocket communication, built-in Bun HTTP server.
- **Build Artifacts**: Run `npm run build` so `web/dist/` is populated before running snapshot scripts.

## 3. CLI Options & Arguments Reference
### `take-snapshot.ts`
| Option / Arg | Type | Default | Description |
|---|---|---|---|
| `--port` | number | `5188` | Port for the local static HTTP server serving `web/dist`. |
| `--theme` | string | `dark` | Target theme (`dark`, `light`, or `both`). |
| `--size` | string | `1440x900` | Viewport dimensions (`<width>x<height>`). |
| `--out` | string | `.shots/snapshot-current` | Prefix or path for output PNG files. |
| `--click` | string | `""` | Optional CSS selector to click before taking screenshot (e.g. modal triggers). |

## 4. Usage Examples
```bash
# Build the web bundle first
npm run build

# Take snapshots in both dark and light modes
bun run scripts/scratch/take-snapshot.ts --theme=both

# Take custom resolution snapshot
bun run scripts/scratch/take-snapshot.ts --theme=dark --size=1920x1080 --out=.shots/full-hd.png

# Take snapshot of a modal popover
bun run scripts/scratch/take-snapshot.ts --out=.shots/snapshot-modal-settings --click="#btn-hub-setting"
```

## 5. Output Structure & Schema
Outputs are written to `.shots/`:
- `.shots/snapshot-current-dark.png`
- `.shots/snapshot-current-light.png`
Format: Standard Portable Network Graphics (PNG) at full DPR 1 or 2.

## 6. Troubleshooting & Edge Cases
- **Port In Use**: If port 5188 or 9222 is in use, supply a different `--port` flag or ensure no orphan headless browser processes are lingering.
- **Missing web/dist**: Run `npm run build` prior to snapshotting to ensure modern transpiled bundles exist.
- **Process Cleanup**: The script automatically registers exit handlers (`SIGINT`, `exit`) to kill spawned headless browser processes.
