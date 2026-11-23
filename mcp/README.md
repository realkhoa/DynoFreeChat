# DynoFreeChat MCP server

MCP server exposing **every DynoFreeChat garden feature** as MCP tools and
resources, so any MCP client (Claude Desktop, Claude Code, Cursor, DSH, ...) can
read and play the real garden through the public worker API.

The worker stays authoritative: the server is a thin authenticated client, never
a second rules engine. Every action goes through `POST /api/garden/act`, and the
current revision is fetched automatically when you omit `rev`.

## Setup

```bash
npm install
npm run build -w mcp        # compiles mcp/dist/index.js
```

Credentials (pick one):

| Env var | Meaning |
| --- | --- |
| `DYNO_GARDEN_AUTH` | `playerId.token` (preferred) |
| `DYNO_GARDEN_PLAYER_ID` + `DYNO_GARDEN_TOKEN` | same pair, split |
| `DYNO_RECOVERY` | recovery key; the server mints a token on startup |

Optional:

| Env var | Default | Meaning |
| --- | --- | --- |
| `DYNO_API_BASE` | `https://dynofreechat-api.nbk2124-z.workers.dev` | worker URL |
| `DYNO_READ_ONLY` | unset | when set, every write tool refuses |

Where to find the token: open the game, DevTools → Application → Local Storage →
`dyno.garden.credentials` (fields `playerId`, `token`), or use the recovery key
shown right after registering.

## Client config

Project-scoped clients (Claude Code, DSH, Cursor) can use the checked-in
`.mcp.json`:

```json
{
  "mcpServers": {
    "dynofreechat": {
      "command": "node",
      "args": ["mcp/dist/index.js"]
    }
  }
}
```

The child process inherits your shell environment, so export the credential
first (or add an `"env": { "DYNO_GARDEN_AUTH": "..." }` block).

Claude Desktop (`claude_desktop_config.json`) example:

```json
{
  "mcpServers": {
    "dynofreechat": {
      "command": "node",
      "args": ["E:/sourcecode/DynoFreeChat/mcp/dist/index.js"],
      "env": {
        "DYNO_GARDEN_AUTH": "<playerId>.<token>",
        "DYNO_API_BASE": "https://dynofreechat-api.nbk2124-z.workers.dev"
      }
    }
  }
}
```

## Tools

Read-only:

- `dyno_state` — full owner snapshot (plots, trees, bag, staff, trays, extras, rev).
- `dyno_market`, `dyno_season` — market board and season/shop/weather.
- `dyno_bots`, `dyno_leaderboard`, `dyno_sales`, `dyno_tournament` — social boards.
- `dyno_visit` — any garden by share code.
- `dyno_health`, `dyno_config`, `dyno_action_catalog` — diagnostics and docs.

Write:

- `dyno_act` — one action; auto-reads `rev` unless supplied.
- `dyno_act_batch` — up to 50 ordered actions with revision carried forward.
- `dyno_quick_plan` — the Quick Plan automation (best-ROI seeds, every empty slot).
- `dyno_staff_run` — assign a staff task or read the roster.
- `dyno_restore` — mint a fresh token from a recovery key.

### Action catalog

`dyno_action_catalog` lists all 86 wire actions with their required fields
(`plant {slot, seed}`, `buySeed {seed, qty}`, `setStaffRole {index, role}`,
`uprootBulk {priceBelow?, profit?, dead?}`, ...). Example:

```json
{ "kind": "quickPlan" }
{ "kind": "plant", "slot": 4, "seed": "tomato" }
{ "kind": "harvest", "slot": 4, "tree": false }
{ "kind": "sellAll" }
```

`POST /api/garden/act` already validated the payload on the worker, so an
invalid action returns the worker error code (e.g. `NOT_ENOUGH_COINS`,
`NEEDS_WATER`) as an MCP error result.

## Resources

`dyno://state`, `dyno://market`, `dyno://season`, `dyno://bots`,
`dyno://leaderboard`, `dyno://sales`, `dyno://actions`.

## Prompt

`garden-briefing` asks the model to read state/season, summarise harvests,
thirsty/dead plants and staff, then propose the next three actions.

## Safety

- The server never stores credentials; they live only in the environment.
- `DYNO_READ_ONLY=1` turns it into a pure observer.
- Actions are real: they spend coins, buy stock and change the live garden.
