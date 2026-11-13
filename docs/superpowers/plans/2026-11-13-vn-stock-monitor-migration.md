# Migrate VN Stock Monitor into DynoFreeChat — Program Plan

> **Status:** proposal, awaiting approval. No code written yet.
> **Source:** `vn_stock_monitor_clean.7z` (extracted read-only to a temp folder; archive stays untouched in the repo root).

**Goal:** bring every user-facing feature of the VN Stock Monitor app into DynoFreeChat, re-implemented on DynoFreeChat's stack (static Vite app + Cloudflare Worker/Durable Objects), without copying its Python server.

**Architecture:** the market data server becomes Worker proxy routes with caching; games become TypeScript engines rendered as DynoFreeChat documents (the existing `DocTabs` + `features/games/registry.ts` contract); the fake workspace becomes bundled static data read/written client-side. Nothing from `server.py` is reused.

**Tech stack:** TypeScript 7, Vite 7, Vitest 4, Cloudflare Workers + Durable Objects (existing), Canvas 2D for the arcade games, `Cache API` for market responses.

## What the source app actually contains

Extracted inventory (temp folder, not committed):

| Area | Content | Size |
|---|---|---|
| Frontend app | `app.js` 8.001 dòng, `index.html` 33 KB, `style.css` 24 KB | — |
| Server (to be discarded) | `server.py` 2.236 dòng, Python `http.server`, polling state + proxy + auth | — |
| Games (13) | queens, tango, sudoku, 2048, minesweeper, sokoban, pinpoint (client-side) · caro, battleship, chess, shooter, gunny, tienlen (server-polled PvP) | — |
| Market suite | price board (ref/ceil/floor, 3 bid levels, 3 ask levels, match price, %, volume, foreign buy/sell), indices, order-book depth, chart, community feed, watchlist + presets (VN30/Bank/Steel+Securities/Tech+RealEstate), live search, 3 s polling | — |
| Terminal | `check <SYM>` (market + depth), `cmt <SYM>` (discussion feed), `play <game>` | — |
| Fake workspace | VinaBIM C++ tree (155 file, 1,4 MB) + file read/save + editor + `build_errors.log` | 1,4 MB |
| Output tabs | Terminal, Chart, Developer Feed, Build Output, Error List, Immediate Window | — |
| Auth gate | secret token + developer PIN, cookie/sessionStorage, localhost bypass | — |

Market upstreams (public, unofficial): `bgapidatafeed.vps.com.vn` (quotes + depth), `services.entrade.com.vn` (OHLC chart), `restv2.fireant.vn` + `f247.com` (community/search). They have no CORS headers — that is exactly why the source app needed a server; we replace it with a Worker proxy.

## Global constraints

1. **No reuse of `server.py`** — not its state model, not its endpoints, not its auth. Rules and proxies are re-implemented in TypeScript.
2. **All surfaces are documents** in the existing tab strip, following the code-disguise style: market board as `Market.cs`, order book as `OrderBook.cpp`, games as `<Game>.cs`. Real feature names stay readable (user requirement from the games work).
3. **No new runtime dependency without a decision** — canvas games are hand-written Canvas 2D; no chart library unless approved.
4. **Worker stays thin** — market proxy only (fetch + cache + CORS + limits). No game logic in the Worker; games are client engines, multiplayer via the existing `game` frame channel.
5. **Third-party failures degrade gracefully** — the UI must show "market closed / data unavailable" instead of an empty screen.
6. Every subproject ships with tests (unit for engines, CDP e2e for documents) and a green `npm run verify` before deploy.

## Target architecture mapping

```
Source (Python)                        → DynoFreeChat
---------------------------------------------------------------
server.py /api/stocks, /indices        → worker /api/market/quotes      (Cache API, 3 s)
server.py /api/price-depth             → worker /api/market/depth       (Cache API, 3 s)
server.py /api/chart                   → worker /api/market/chart       (Cache API, 60 s)
server.py /api/community, search       → worker /api/market/feed        (fireant only, 60 s)
server.py /api/tree, /api/file/*       → bundled static workspace + client storage
server.py game state/actions (6 games) → TS engines under features/games/engine/
server.py /api/auth/verify             → client-side workspace lock (no server secret)
app.js tab/panel/DOM code              → existing DocTabs + document components
```

Market documents: `Market.cs` (quotes grid), `OrderBook.cpp` (depth), `Chart.cs`, `Feed.cs`, `Terminal` (output dock tab). Games register in `features/games/registry.ts` (already the single source of truth with `id`, `name`, `className`, `documentTitle`, `summary`, `hotkey`, `icon`) + one entry in `GAME_OPENERS`.

Storage: watchlist, presets, game saves → `localStorage` under `dyno.*` keys; workspace edits → `localStorage` (per-file overlay) so nothing needs a server.

## Subprojects (each gets its own task-by-task plan after approval)

Dependencies: S0 first (extraction); S1 → S2; S3, S4, S5, S6 independent of each other; S7 last.

### S0 — Extraction + fixtures (0,5 ngày)

- Copy what is data, not code: VinaBIM tree + 155 files, `build_errors.log`, the three `*_backup.json` game states (as test
  fixtures), and trimmed voz/FireAnt samples for the feed tests.
- Add `scripts/tools/extract-source-assets.mjs` so extraction is repeatable from the archive.
- The archive stays in the repo root untouched until the migration is accepted.
- Deliverable: assets under `web/public/workspace/`, fixtures under `web/test/fixtures/`.

### S1 — Market data proxy + price board (2–3 ngày)

- Worker: `GET /api/market/quotes?symbols=...`, `/api/market/indices` — proxy VPS datafeed, 3 s Cache API TTL, CORS for our origins, per-IP token bucket, timeout + stale-cache fallback, lock-gated (D2).
- Client: `features/market/api.ts` (typed fetch, retry), `features/market/board.ts` (renderer), `Market.cs` document: ref/ceil/floor, 3 bid + 3 ask levels, match price, ±%, day volume, foreign buy/sell; 3 s polling with pause/resume, manual refresh.
- Watchlist add/remove, presets (VN30, Bank, Steel+Securities, Tech+RealEstate), live filter.
- Tests: worker route tests (mock upstream), board renderer unit tests, CDP e2e (document opens, rows render, polling ticks).

### S2 — Depth, chart, feed, terminal (2,5 ngày; includes the D1 voz scrape)

- Depth document `OrderBook.cpp`: bid/ask ladder as a C++ struct block (visual style already exists in the game document).
- Chart document `Chart.cs`: Canvas 2D OHLC candles from entrade; range switch; no library.
- Feed document `Feed.cs`: **FireAnt REST + voz scraping** through the Worker (D1), per-symbol, 60 s cache, explicit
  "voz unavailable" state when the scrape fails.
- Terminal commands in the output dock: `check <SYM>`, `cmt <SYM>`, `play <game>` mapping to documents.
- Tests: proxy cache/fallbacks, voz fixture parsing, chart scale math (pure function), terminal parser unit tests.

### S3 — Puzzle games (7) (3–4 ngày)

queens, tango, sudoku, 2048, minesweeper, sokoban, pinpoint. Each: pure engine module + document renderer + registry entry + tests. Puzzle generation/solvers ported to TS (sudoku/tango uniqueness checks exist in source and must be reimplemented, not copied).
Acceptance per game: playable with keyboard+mouse, win/lose detection, reset, state saved in `localStorage`.

### S4 — Board games, online from v1 (5–6 ngày; includes the D3 channel)

- caro: fold into the existing tic-tac-toe engine (extend board size/rules as the source does) — one game entry, not two.
- battleship: placement UI, hidden ships, shot resolution.
- chess: full legal-move rules (castling, en passant, promotion, check/checkmate).
- All three: local hotseat + simple minimax/randomized AI + **online via the generic channel (D3)**, with room create/join UI
  shared with the games hub.
- Acceptance: legal-move test suite (perft-style counts for the chess start position), AI determinism with a seeded RNG,
  online round-trip test with two headless clients, CDP e2e per game.

### S5 — Arcade games, online from v1 (4–5 ngày)

- tienlen: card game rules + bot opponents + online turns.
- gunny: canvas terrain + projectile physics + wind + turn timer; terrain/craters/wind fixtures come from the source's
  `gunny_saved_state.json`.
- shooter: 2D canvas loop with physics update, online input relay.
- Acceptance: deterministic simulation tests with fixed timestep and the saved-state fixtures, frame budget check (no long
  tasks) in CDP, online play verified with two clients for tienlen at minimum.

### S6 — Workspace explorer + editor + build output (2 ngày)

- Bundle the VinaBIM tree (`vinabim_tree.json`) and its 155 files as static assets under `web/public/workspace/` (1,4 MB gzipped much smaller), read lazily.
- `Workspace.cs` document: tree navigation, code view with line numbers, edit + save to `localStorage` overlay, unsaved indicator.
- Build Output panel fed by the bundled `build_errors.log`; Error List tab counts; Immediate window (echo + `check`/`play` hooks shared with S2).
- Tests: tree search/filter, path resolution, overlay save/load.

### S7 — Workspace lock (PIN), polish, deploy (1–2 ngày)

- Client-side lock (see decision D2), auto-lock on idle option, wrong-PIN throttling.
- Final polish: status bar fields per document, keyboard shortcuts, README, screenshots.
- Full e2e sweep of every migrated feature, then deploy worker + Pages.

## Decisions needed before starting

Approved by the owner on 2026-11-13:

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | Community feed upstream | **FireAnt + scrape voz.vn** | Worker gains an HTML scrape path (`HTMLRewriter`), fixture tests, and a selector config so a voz layout change degrades instead of crashing |
| D2 | PIN gate | **Worker-verified gate** | Real auth: Worker secrets, signed cookie, rate-limited verify, gated market/workspace routes |
| D3 | Multiplayer for board games | **Online from v1** | A generic online game channel on top of the existing `game` frame, not just tic-tac-toe's protocol |
| D4 | Build order | market first, then games | default, unchanged |
| D5 | Chart | hand-written Canvas candles | default, no dependency |

### D2 design — Worker-verified workspace lock

- Env (Worker secrets): `LOCK_TOKEN` (random 32 hex) and `LOCK_PIN_HASH` (SHA-256 of `salt || pin`, hex).
- `POST /api/auth/verify` body `{ token?, pin }` → 200 + `Set-Cookie: dyno_lock=<payload>.<hmac>; HttpOnly; Secure; SameSite=Lax; Max-Age=30d`,
  where `payload = base64({exp})` and `hmac = HMAC-SHA256(LOCK_TOKEN, payload)`. Cookie is verified without storage.
- 401 on bad token/PIN; per-IP limit 5 attempts / 5 min (reuse the token bucket helper) then 429.
- `GET /api/auth/state` → `{ locked: boolean }` for the client gate.
- Scope: the lock guards **market and workspace routes** (`/api/market/*`, `/api/workspace/*`) and drives the client
  lock screen for the new surfaces. Chat rooms keep working without the lock, so normal chat use is unaffected.
  This differs from the source app (which gated everything); it is deliberate — DynoFreeChat is a chat app first.
- Dev bypass: `localhost`/`127.0.0.1` may skip the gate, mirroring the source; production never bypasses.
- `?token=` in URL is **not** supported (leaks in history/referrer); only the cookie and the PIN prompt.

### D1 design — feed with FireAnt REST + voz scraping

- `GET /api/market/feed?symbol=FPT&source=all|fireant|voz`.
- FireAnt: `restv2.fireant.vn/symbols/{sym}/posts?offset=0&limit=40` (token acquisition as the source does), JSON pass-through of
  title/time/url/author only — never render upstream HTML.
- voz: fetch the configured thread page(s), extract posts with `HTMLRewriter` using selectors in one config object
  (`feed/voz-selectors.ts`); strip HTML to text; cap 20 items.
- Cache API: 60 s per (symbol, source). If voz fails, return FireAnt items plus `voz: "unavailable"` so the UI can say so.
- Fixture tests: saved voz page sample (small, trimmed) + FireAnt sample; regex/selector changes are then caught by tests.

### D3 design — generic online game channel

- Worker is unchanged for games: it already relays opaque `game` frames between peers in a room.
- Room slugs generalize from `ttt-<code>` to `game-<code>` (`roomSlugFromCode` gains a game prefix), so every game uses the
  same transport.
- `features/games/online/channel.ts`: hello / state / action / resync envelope
  `{ v:1, game: <id>, k: "hello"|"state"|"action"|"resync", seq, payload }`, one implementation for all games.
- Each game provides two pure functions: `applyRemote(state, action) → state` (validates and applies) and
  `snapshot(state)`. The host validates and re-broadcasts authoritative snapshots; a receiver that gets an action it cannot
  validate requests `resync`.
- No server-side authority (the Worker stays a relay), so this is anti-accident, not anti-cheat — documented in the UI copy.
- Tic-tac-toe migrates onto the same channel so there is one online path, not two.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Public market APIs throttle/change (VPS, entrade, fireant) | board/chart/feed empty | Worker cache + stale fallback + explicit "unavailable" row; isolate upstream URL in one config file |
| Worker CPU/size limits with proxy + cache | 5xx | proxy only, no parsing beyond pass-through; Cache API keeps upstream calls low |
| Chess/tienlen rules ported incorrectly | wrong game outcomes | perft-style rule tests + fixtures; small AI, no engine library |
| 1,4 MB workspace assets in the repo | slow checkout/bundle | `web/public/workspace/`, lazy fetch, not bundled into JS |
| Canvas games CPU on weak machines | jank | fixed-timestep loop, cap entity count, pause when the tab is hidden |
| Scope is large (~20–26 ngày với online-from-v1 + auth) | half-finished features | subprojects ship independently; each is deployable on its own |

## Verification strategy

- Unit: engines (pure functions), parsers, cache/fallback logic, tree/path logic.
- Worker tests: proxied routes with a mocked upstream, TTL behaviour, CORS, rate limits.
- CDP browser checks per document (script per feature under `scripts/cdp/`), screenshots committed to `.shots/` only.
- Gate: `npm run verify` (typecheck + format + tests) and the Pages workflow stay the release gate; worker deploy verified with a production smoke script.

## Next step

Decisions D1–D3 are settled (FireAnt + voz scrape, Worker-verified lock, online from v1); D4/D5 take the defaults
(market first, hand-written canvas chart).

After you approve this plan:
1. write the task-by-task plan for **S0 (extraction)** and **S1 (market proxy + board)** and implement them — S1 is the
   first user-visible feature and exercises the Worker proxy + document + tests end to end,
2. then continue S2 → S3 → … in the agreed order, one subproject per plan and PR.

Total estimate: **≈ 20–26 ngày làm việc**, each subproject independently deployable.
