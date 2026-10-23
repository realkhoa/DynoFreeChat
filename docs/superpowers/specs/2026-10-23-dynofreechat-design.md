# DynoFreeChat — Design Spec

**Ngày:** 2026-10-23
**Trạng thái:** approved (design chốt, chờ triển khai)

## 1. Mục tiêu

Nhiều chat room do người dùng tạo, mỗi room có thể đặt mật khẩu (xem §13), giao diện giả lập **Visual Studio 2022 dark**, mỗi tin nhắn hiển thị như một dòng log. Frontend tĩnh deploy trên **GitHub Pages**, realtime trên **Cloudflare Worker + Durable Object**. Không tài khoản, không database ngoài, **không phát sinh hoá đơn**.

### Không làm (YAGNI)

Nhiều phòng, DM, đăng nhập, upload file/ảnh, edit/delete tin, emoji picker, mention, thread, ghi âm, thông báo push, PWA offline.

## 2. Ràng buộc cứng về chi phí

Đây là ràng buộc ngang hàng với tính năng: vi phạm = bug.

Nguyên tắc gốc: **Workers Free plan không có overage.** Vượt hạn mức → request fail bằng lỗi, không phát sinh tiền. Hoá đơn chỉ xuất hiện khi account ở Workers Paid. Do đó:

- **C1.** Không nâng plan, không bật auto-recharge, không thêm sản phẩm tính tiền (R2, Stream, Images, Queues, Containers, Workers AI). Chỉ Workers + Pages + Durable Objects SQLite-backed.
- **C2.** **Bắt buộc WebSocket Hibernation API** (`state.acceptWebSocket`). Dùng `ws.accept()` thường sẽ tính duration cả thời gian socket mở: `86400s × 0,128 GB ≈ 11.059 GB-s/ngày`, đốt sạch 13.000 GB-s/ngày của free tier trong ~1,2 ngày.
- **C3.** Rate limit token bucket **5 token, nạp 1 token / 1,5s**, lưu trong `ws.serializeAttachment()` để sống qua hibernation.
- **C4.** Cap **100 kết nối** / DO (trả 503 khi vượt).
- **C5.** Trim history amortized: chỉ DELETE khi vượt 500 dòng, xoá một lần 50 dòng. DELETE từng tin làm nhân đôi row writes (delete cũng tính là row write).
- **C6.** Không `setAlarm` định kỳ (mỗi lần = 1 row write).
- **C7.** Không `COUNT(*)` mỗi tin nhắn — đếm bằng biến in-memory, chỉ `COUNT(*)` khi DO thức dậy (sau hibernation).
- **C8.** Suy giảm êm: write vào storage fail → bật `degraded`, vẫn broadcast từ memory, gửi 1 frame `error: DEGRADED`. Chat không chết.
- **C9.** Repo public → GH Actions minutes không giới hạn, CI $0.
- **C10.** Không dùng domain Cloudflare Registrar; chỉ `*.pages.dev` + `*.workers.dev`.
- **C11.** Deploy xong phải kiểm tra plan (`wrangler whoami`, trang Plans) và ghi lại con số thực tế vào README.

Ước tính tải (50 người, 1000 tin/ngày): DO requests 0,3% · duration 0,02% · row writes ~1% · row reads ~1% · storage ~0%.

## 3. Kiến trúc

```
GitHub Pages (static)                     Cloudflare (Free)
┌────────────────────────┐   wss://    ┌───────────────────────────────┐
│ web/  Vite + TS        │ ──────────► │ worker/  index.ts             │
│  · IDE chrome (DOM)    │             │  · GET /ws → DO stub          │
│  · net/socket.ts       │             │  · Origin allowlist           │
│  · model/store.ts      │             │  · GET /health                │
│  · styles/*.css        │             │         │                     │
└────────────────────────┘             │         ▼                     │
                                       │  ChatRoom (Durable Object)    │
shared/src/protocol.ts ◄───────────────┤  · idFromName("global")       │
  types + validators (FE+BE)           │  · Hibernation WS API         │
                                       │  · SQLite: bảng messages      │
                                       │  · token bucket / connection  │
                                       └───────────────────────────────┘
```

Vì sao Durable Object: một phòng duy nhất cần một điểm hội tụ có thứ tự; DO cho broadcast đồng bộ, strongly consistent, không cần polling, không cần D1.

Vì sao không D1/KV: 500 dòng history nằm gọn trong storage của DO, không thêm binding và không thêm round-trip.

## 4. Cấu trúc repo (npm workspaces)

```
DynoFreeChat/
├─ package.json                 # workspaces: shared, worker, web
├─ .gitignore  .nvmrc  README.md
├─ shared/
│  ├─ package.json  tsconfig.json
│  ├─ src/protocol.ts           # ChatMessage, frame types, validators, hằng số
│  ├─ src/ratelimit.ts          # TokenBucket thuần
│  └─ test/{protocol,ratelimit}.spec.ts
├─ worker/
│  ├─ package.json  tsconfig.json  wrangler.jsonc
│  ├─ src/index.ts              # fetch router, allowlist, 426/403/503
│  ├─ src/room.ts               # ChatRoom DO
│  └─ test/{router,room}.spec.ts
├─ web/
│  ├─ package.json  tsconfig.json  vite.config.ts  index.html
│  ├─ src/main.ts
│  ├─ src/env.ts
│  ├─ src/lib/{identity,format}.ts
│  ├─ src/net/{backoff,socket}.ts
│  ├─ src/model/store.ts
│  ├─ src/ui/{log-view,composer,statusbar,menubar,findbar}.ts
│  ├─ src/styles/{tokens,ide,log}.css
│  └─ test/*.spec.ts
├─ .github/workflows/deploy-web.yml
└─ docs/superpowers/{specs,plans}/
```

Quy ước phụ thuộc một chiều: `web → shared`, `worker → shared`, `shared → ∅`. `web` không import gì từ `worker`.

## 5. Protocol

`shared/src/protocol.ts` là nguồn duy nhất cho cả hai phía.

```ts
export const MAX_TEXT = 500;
export const MAX_NICK = 24;
export const HISTORY_LIMIT = 500;
export const HISTORY_TRIM_TO = 450;
export const MAX_CONNECTIONS = 100;
export const RATE_CAPACITY = 5;
export const RATE_REFILL_MS = 1500;

export type ChatMessage = {
  id: string;    // `${ts.toString(36)}-${seq.toString(36)}` — server sinh
  ts: number;    // ms epoch, đồng hồ server
  nick: string;
  color: string; // hex HSL hue đã chọn ở client: "hsl(<h> 65% 60%)"
  text: string;
};

export type ClientFrame =
  | { t: "join"; nick: string; color: string }
  | { t: "msg"; cid: string; text: string };

export type ErrorCode =
  | "BAD_NICK" | "EMPTY" | "TOO_LONG" | "RATE_LIMIT"
  | "NOT_JOINED" | "FULL" | "DEGRADED" | "BAD_FRAME";

export type ServerFrame =
  | { t: "welcome"; you: { nick: string; color: string }; history: ChatMessage[]; online: number; serverTs: number }
  | { t: "append"; m: ChatMessage; cid?: string }
  | { t: "presence"; online: number }
  | { t: "error"; code: ErrorCode; cid?: string; detail?: string };
```

Quy tắc:
- `id` và `ts` **chỉ server sinh**; client không bao giờ được tin.
- `cid` là id tạm client sinh cho optimistic echo; server echo lại đúng `cid` cho **riêng** người gửi, người khác nhận `append` không có `cid`.
- `join` phải là frame đầu tiên; trước đó mọi `msg` bị trả `NOT_JOINED`.
- Frame hỏng (không parse được / sai shape) → `BAD_FRAME`, **không** đóng socket (tránh tự DoS).

Chuẩn hoá phía server:
- `sanitizeNick`: bỏ ký tự điều khiển (`\u0000-\u001F\u007F`), gộp whitespace, trim, cắt 24, rỗng → `BAD_NICK`.
- `sanitizeText`: bỏ `\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F`, giữ `\n` (nhưng UI render 1 dòng), trim, rỗng → `EMPTY`, > 500 → `TOO_LONG`.
- `color`: chỉ nhận chuỗi khớp `/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/`, sai thì server gán `hsl(210 40% 70%)`.

## 6. Durable Object — `ChatRoom`

Trạng thái in-memory (mất khi hibernation, tự phục hồi):
`seq: number` · `count: number` (số dòng trong bảng) · `degraded: boolean` · `ready: boolean`.

### Bảng

```sql
CREATE TABLE IF NOT EXISTS messages (
  id    TEXT PRIMARY KEY,
  ts    INTEGER NOT NULL,
  nick  TEXT NOT NULL,
  color TEXT NOT NULL,
  text  TEXT NOT NULL
);
```

### Handler

- `fetch(request)` — nếu `getWebSockets().length >= 100` → 503. Ngược lại tạo `WebSocketPair`, `ctx.acceptWebSocket(server)`, trả 101. Đảm bảo schema (`ready`) và đếm `count` một lần mỗi lần thức dậy.
- `webSocketMessage(ws, raw)` — parse → nếu `join`: lưu attachment `{nick,color,tokens,last}`, gửi `welcome` (history 200 dòng mới nhất + online), broadcast `presence`. Nếu `msg`: kiểm tra `NOT_JOINED` → sanitize → rate limit → tạo `ChatMessage` (`seq++`) → ghi storage (bọc try/catch, bật `degraded`) → trim nếu cần → broadcast `append` cho tất cả, kèm `cid` cho người gửi.
- `webSocketClose(ws, code, reason)` — `ws.close(code, reason)`, broadcast `presence` với `getWebSockets().filter(s => s !== ws).length`.
- `webSocketError(ws)` — broadcast `presence`, không ném.

Chi phí: mỗi tin nhắn = **1 insert** (+ ~1 row write amortized cho trim). Không COUNT, không alarm, không List.

### Degraded mode

Khi insert ném lỗi (hết quota row writes): `degraded = true`, gửi 1 frame `error DEGRADED` cho tất cả (chỉ 1 lần), tiếp tục broadcast từ memory. Tin nhắn vẫn tới mọi người; chỉ history ngừng ghi.

## 7. Worker — `index.ts`

- `GET /health` → `{ok:true, ts}` (200, text/plain hoặc JSON).
- `GET /ws` + header `Upgrade: websocket` → kiểm tra Origin rồi forward stub `env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("global"))`.
- Origin: nếu header **có** mà không nằm trong `ALLOWED_ORIGINS` (comma-separated, mặc định `http://localhost:5173,https://realkhoa.github.io`) → 403. Không có Origin (CLI test) → cho qua.
- Không phải `/ws` → 404. `/ws` thiếu `Upgrade` → 426.
- Không có secret nào ở frontend.

## 8. Web app

### Cấu trúc UI

```
┌────────────────────────────────────────────────────────────┐
│ DynoFreeChat — Microsoft Visual Studio            _ □ ✕    │ title 28px #3C3C3C
├────────────────────────────────────────────────────────────┤
│ File  Edit  View  Help                                     │ menu 24px #2D2D30
├────────────────────────────────────────────────────────────┤
│ ▸ Output · #general  ✕                                     │ tab 30px, active #1E1E1E + gạch dưới #007ACC
├────────────────────────────────────────────────────────────┤
│ 🔍 filter…   [All][Chat][System]   Follow ●    Clear       │ toolbar 32px
├────────────────────────────────────────────────────────────┤
│ 10:42:01  khoan    ›  ae vào chưa                         │ log rows #1E1E1E
│ 10:42:03  dyno     ›  rồi, đang xem log                    │
│ 10:42:09  system   ·  dyno joined (7 online)               │
│ › nhập tin nhắn…                                           │ composer, dính đáy
├────────────────────────────────────────────────────────────┤
│ ● Connected  ws://…  UTF-8  7 online  12 msgs              │ status 22px #007ACC
└────────────────────────────────────────────────────────────┘
```

### Token

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--bg` | `#1E1E1E` | vùng log, composer |
| `--panel` | `#252526` | tab strip, toolbar |
| `--chrome` | `#2D2D30` | menu bar |
| `--titlebar` | `#3C3C3C` | title bar |
| `--border` | `#3F3F46` | mọi đường kẻ 1px |
| `--fg` | `#F1F1F1` | text chính |
| `--fg-dim` | `#A0A0A0` | timestamp, metadata |
| `--accent` | `#007ACC` | focus, tab active, status bar |
| `--vs-purple` | `#68217A` | chi tiết trang trí |
| `--ok` `--warn` `--err` | `#4EC9B0` `#DCDCAA` `#F14C4C` | trạng thái kết nối, lỗi |
| `--sel` | `#264F78` | selection, hover row `#2A2D2E` |

Font: `"Cascadia Mono", Consolas, ui-monospace, monospace` 13px/1.5 cho log; `"Segoe UI", system-ui` 12px cho chrome. Bo góc 2px, border 1px cứng, **không gradient, không shadow mềm**. Scrollbar 10px, thumb `#686868` → `#9E9E9E` khi hover.

### Cột log

Dòng chat: `<time>  <nick>  ›  <text>` với `time` `--fg-dim` `tabular-nums`, `nick` màu của user căn theo `ch`, `›` `--fg-dim`. Tin của mình: nick in đậm + `--accent`.
Dòng system: `time  system  ·  <text>` in nghiêng `--fg-dim`.
Dòng pending: opacity .55, có `▍` nhấp nháy; fail thì `✕` `--err` + `title` lý do.

### Hành vi

- `Enter` gửi · `Shift+Enter` không gửi (giữ nguyên, không multiline) · `Ctrl+L` clear view · `Ctrl+F` focus filter · `Esc` bỏ focus filter.
- `Follow` bật: auto-scroll xuống cuối. User scroll lên → tự tắt, hiện chip `↓ tin mới (n)`; bấm để xuống + bật lại.
- Filter: substring không phân biệt hoa thường trên `nick + text`; chip `All/Chat/System` lọc theo loại. Filter áp bằng cách thêm/bỏ class, **không** rebuild DOM.
- `Clear` chỉ xoá view cục bộ (giữ history server, hiện dòng system "log cleared locally").
- Nick/color: lần đầu mở sinh `guest-XXXX` + hue ngẫu nhiên, lưu `localStorage["dyno.identity"]`; đổi được qua menu Edit → Set nickname… (dùng `prompt`).
- Menu bar: `File → Reload`, `Edit → Set nickname… / Clear log`, `View → Follow tail / Filter`, `Help → Protocol`. Không làm gì nếu chưa cài.

### A11y

`role="log" aria-live="polite" aria-relevant="additions"` trên vùng log; label cho filter/composer; focus ring `outline: 1px solid var(--accent); outline-offset: -1px`; `prefers-reduced-motion` tắt mọi animation (con trỏ pending, chip).

### Reconnect

Backoff `min(30000, 1000 * 2^attempt)` + jitter ±20%. Attempt reset về 0 khi `welcome` nhận được. Trạng thái hiển thị ở status bar: `● Connected` / `◌ Connecting…` / `▲ Reconnecting… (n)` / `✕ Offline — bấm để thử lại`. Dedupe bằng `Set<id>`; `welcome.history` được merge trước, bỏ id đã có. Pending quá 10s không được ack → đánh dấu fail.

## 9. Test

- `shared`: validator (nick/text/color/frame), token bucket (fake time: 6 tin liên tiếp → tin thứ 6 RATE_LIMIT; sau 1,5s có lại 1 token).
- `worker` (`@cloudflare/vitest-pool-workers`): 403 sai origin, 426 thiếu Upgrade, 2 client join → broadcast, history replay đúng thứ tự + giới hạn 200, rate limit, `NOT_JOINED`, tin thứ 501 → trim còn 450.
- `web` (vitest + jsdom cho phần DOM): `format` (thời gian, escape HTML), `store` (dedupe, pending resolve, filter), `backoff` (dãy giá trị, cap 30s).
- Smoke tay: 2 tab chat qua lại, kill mạng → reconnect, refresh → history còn, filter + follow hoạt động.

## 10. Deploy

1. `gh repo create DynoFreeChat --public --source . --push` (cần scope `workflow` để push workflow file).
2. `npx wrangler login` → `npm run deploy:worker` → `https://dynofreechat-api.<subdomain>.workers.dev`.
3. Đặt `VITE_WS_URL=wss://dynofreechat-api.<subdomain>.workers.dev/ws` (biến repo hoặc `.env.production`).
4. `vite.config.ts`: `base: '/DynoFreeChat/'`.
5. `.github/workflows/deploy-web.yml`: build + `upload-pages-artifact` + `deploy-pages` trên push `main`. Worker deploy thủ công (giữ số lần deploy thấp, tránh vòng lặp CI).

## 11. Mốc

| M | Nội dung | Điều kiện xong |
|---|---|---|
| M0 | Workspace, tsconfig, gitignore, git init | `npm run typecheck` xanh |
| M1 | `shared` protocol + ratelimit + test | test xanh |
| M2 | `ChatRoom` DO + Worker router + test | test pool-workers xanh, `wrangler dev` chat được bằng 2 tab |
| M3 | UI tĩnh đúng skin VS (mock data) | nhìn đúng, responsive, a11y pass |
| M4 | Nối socket, optimistic echo, reconnect | 2 tab chat thật, kill mạng vẫn hồi |
| M5 | Deploy Pages + Worker, README, smoke | URL công khai chat được |

## 12. Rủi ro đã biết

| Rủi ro | Giảm thiểu |
|---|---|
| Không có auth → spam | rate limit 5/1,5s, 500 ký tự, cap 100 kết nối, origin allowlist. Flood làm hỏng availability chứ không làm phát sinh tiền. |
| Hết quota row writes (100k/ngày) | degraded mode C8, trim amortized C5 |
| Token OAuth wrangler hết hạn | `npx wrangler login` trước khi deploy |
| `gh` thiếu scope `workflow` | `gh auth refresh -s workflow` trước khi push CI |
| Hibernation API bị bỏ sót khi refactor | test M2 khẳng định dùng `ctx.acceptWebSocket`, comment `C2` ngay tại chỗ gọi |

## 13. v2 — Room do người dùng tạo, có mật khẩu

Mục §1 và §3 (một phòng duy nhất) bị thay bằng mục này.

### 13.1 Mô hình

- **Lobby công khai** (`GET /api/rooms`) liệt kê mọi room: `slug`, `locked`, `createdAt`, `lastSeen`. Không liệt kê số người online trong lobby (tránh 1 row write mỗi tin nhắn); số online chỉ hiện khi đã vào room.
- **Tạo room** (`POST /api/rooms {slug, pass?}`) — slug khớp `^[a-z0-9][a-z0-9-]{1,23}$`, `pass` tuỳ chọn (rỗng = room mở, tối đa 64 ký tự).
- **Vào room**: `wss://…/ws?r=<slug>`, frame đầu tiên `join {nick, color, pass?}`.
- Mỗi room = 1 `Room` Durable Object (`idFromName(slug)`). Toàn bộ danh mục + hash mật khẩu = 1 `Registry` Durable Object (`idFromName("registry")`).

### 13.2 Mật khẩu

- Sinh `salt` 16 byte ngẫu nhiên (`crypto.getRandomValues`) khi tạo room.
- Lưu `hash = SHA-256(salt ‖ slug ‖ pass)` dạng hex. **Không** lưu plaintext, không log pass, pass không bao giờ đi trong URL.
- So sánh constant-time (XOR tích luỹ trên toàn chuỗi hex).
- Không dùng PBKDF2/scrypt: Workers Free giới hạn 10 ms CPU/request, KDF đắt sẽ làm request fail. Đây là khoá cửa phòng chat, không phải bảo vệ bí mật thật — ghi rõ trong README.
- Sai 5 lần trên một connection → `error BAD_PASS` rồi đóng socket (`4403`).
- Pass đi trong frame `join` (JSON trong WebSocket), **không** trong query string.

### 13.3 Registry DO

Bảng `rooms (slug TEXT PRIMARY KEY, salt TEXT, hash TEXT, locked INTEGER, createdAt INTEGER, lastSeen INTEGER)`.
Bảng `creates (ip TEXT PRIMARY KEY, windowStart INTEGER, count INTEGER)` — chống spam tạo room: 3 room / giờ / IP (`CF-Connecting-IP`).

| Endpoint | Việc |
|---|---|
| `POST /create` | validate slug (§13.1) → `SELECT` trùng → đếm room (`count < 50`) → rate limit IP → `INSERT` |
| `POST /verify` | `SELECT` row → không có: `ROOM_NOT_FOUND`; sai pass: `BAD_PASS`; đúng/mở: cập nhật `lastSeen` → `{locked, ok}` |
| `GET /list` | dọn row có `lastSeen` cũ hơn 30 ngày (1 lần/load) → trả tối đa 50 row, mới nhất trước |

### 13.4 Room DO

Không biết gì về mật khẩu. Khi nhận frame `join`, gọi `Registry /verify` đúng một lần (1 row read + 1 row write `lastSeen`), cache kết quả vào `ws.serializeAttachment()`. Fail thì gửi `BAD_PASS`/`ROOM_NOT_FOUND` và đóng.

Luồng chi phí mỗi lần join: 1 Worker request + 1 Registry request + 1 Room request + 1 row read + 1 row write. Mỗi tin nhắn vẫn chỉ 1 row write như §6.

### 13.5 API

```ts
GET  /health                     → { ok: true, ts }
GET  /api/rooms                  → { rooms: RoomInfo[] }
POST /api/rooms {slug, pass?}    → 201 { slug } | 400 BAD_SLUG | 409 ROOM_EXISTS | 429 TRY_LATER | 507 TOO_MANY_ROOMS
GET  /ws?r=<slug>                → 101 (nâng cấp WebSocket), 404 nếu thiếu `r`
```

`RoomInfo = { slug, locked, createdAt, lastSeen }`.

### 13.6 UI

Hai màn, cùng một khung IDE:

- **Lobby** — tab `Start` thay cho tab room: danh sách row kiểu "Recent projects" (`slug · 🔒 · 2 ngày trước`), nút `+ New Room…` mở dialog (slug + pass + "Create"), double-click row hoặc Enter để vào; nếu locked thì hỏi pass trong dialog nhỏ.
- **Room** — khung log như §8, tab đổi thành `#<slug>`, status bar thêm `🔒` nếu locked. `Ctrl+Shift+O` về lobby. URL đổi thành `?r=<slug>` để share link (dùng `history.replaceState`, không reload).

### 13.7 Chi phí thêm

| Hạng mục | Ảnh hưởng |
|---|---|
| Registry DO | 1 object, hibernating, chỉ thức khi lobby load / join / create |
| Row writes | +1 mỗi lần join (`lastSeen`) |
| Row reads | +1 mỗi lần join (verify), +≤50 mỗi lần lobby load |
| Storage | ≤50 row room ≈ vài chục KB |

Vẫn dưới 1% hạn mức free ở tải dự kiến. Cap 50 room là chốt chặn storage + chống bot tạo room hàng loạt.
