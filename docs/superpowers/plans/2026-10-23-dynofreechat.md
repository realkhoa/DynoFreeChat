# DynoFreeChat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat room công khai một phòng, UI giả lập Visual Studio 2022 dark, mỗi tin là một dòng log, frontend trên GitHub Pages, realtime trên Cloudflare Worker + Durable Object, chi phí $0.

**Architecture:** `shared/` giữ protocol + validator dùng chung; `worker/` là một Worker định tuyến `/ws` vào một Durable Object duy nhất (`idFromName("global")`) dùng Hibernation WebSocket API và SQLite storage cho 500 tin gần nhất; `web/` là Vite + TypeScript thuần, không runtime dependency, tách `net/` (I/O) / `model/` (state) / `ui/` (DOM) / `styles/` (skin).

**Tech Stack:** Node 22, npm 10 workspaces, TypeScript 5.7, Vite 6, wrangler 4, vitest 3, `@cloudflare/vitest-pool-workers`, jsdom.

## Global Constraints

- Chi phí: Workers **Free** plan. Bắt buộc `ctx.acceptWebSocket` (Hibernation) — không dùng `ws.accept()`. Không `setAlarm` định kỳ. Không `COUNT(*)` mỗi tin. Không sản phẩm Cloudflare trả tiền.
- Giới hạn: `MAX_TEXT=500`, `MAX_NICK=24`, `HISTORY_LIMIT=500`, `HISTORY_TRIM_TO=450`, `MAX_CONNECTIONS=100`, `RATE_CAPACITY=5`, `RATE_REFILL_MS=1500`.
- Version floor: `node >= 22`, `typescript ^5.7`, `vite ^6`, `wrangler ^4`, `vitest ^3`.
- Frontend: **0 runtime dependency** (chỉ devDependencies). Không React/Vue/Svelte.
- `web` không import từ `worker`; cả hai chỉ import từ `shared`.
- Không secret trong bundle frontend. Worker dùng biến `ALLOWED_ORIGINS`.
- Mọi text do user nhập phải escape trước khi chèn DOM (không `innerHTML` với dữ liệu chưa escape).
- Git: commit sau mỗi task, message dạng `feat(scope): …` / `test(scope): …` / `chore(scope): …`.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc`, `shared/package.json`, `shared/tsconfig.json`, `worker/package.json`, `worker/tsconfig.json`, `web/package.json`, `web/tsconfig.json`

**Interfaces:**
- Produces: `npm run typecheck`, `npm test`, `npm run build`, `npm run dev:web`, `npm run dev:worker` chạy được từ root.

- [ ] **Step 1:** `git init` và viết root `package.json` với `workspaces: ["shared","worker","web"]`, scripts: `typecheck` → `npm run typecheck -ws --if-present`, `test` → `npm run test -ws --if-present`, `build` → `npm run build -w web`, `dev:web` → `npm run dev -w web`, `dev:worker` → `npm run dev -w worker`, `deploy:worker` → `npm run deploy -w worker`; devDependencies `typescript`, `vitest`.
- [ ] **Step 2:** `shared/package.json` (`"name":"@dyno/shared"`, `"type":"module"`, `"exports": {"./protocol":"./src/protocol.ts","./ratelimit":"./src/ratelimit.ts"}`, script `typecheck: tsc --noEmit`, `test: vitest run`). `shared/tsconfig.json` lib `ES2022`, strict, `noUncheckedIndexedAccess`.
- [ ] **Step 3:** `worker/` deps `@dyno/shared: "*"`, devDeps `wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`; scripts `dev: wrangler dev`, `deploy: wrangler deploy`, `typecheck: tsc --noEmit`, `test: vitest run`. `tsconfig.json` lib `ES2022`, types `@cloudflare/workers-types`, không có `DOM`.
- [ ] **Step 4:** `web/` deps `@dyno/shared: "*"`, devDeps `vite`, `typescript`, `vitest`, `jsdom`; scripts `dev: vite`, `build: vite build`, `preview: vite preview`, `typecheck: tsc --noEmit`, `test: vitest run`. `tsconfig.json` lib `ES2022 + DOM + DOM.Iterable`.
- [ ] **Step 5:** `.gitignore` gồm `node_modules/`, `dist/`, `.wrangler/`, `.env*`, `!.env.example`, `*.log`; `.nvmrc` = `22`.
- [ ] **Step 6:** `npm install` rồi `npm run typecheck`. Expected: exit 0, không lỗi.
- [ ] **Step 7:** Commit `chore: scaffold npm workspace (shared/worker/web)`.

### Task 2: Protocol + validators

**Files:**
- Create: `shared/src/protocol.ts`, `shared/test/protocol.spec.ts`

**Interfaces:**
- Produces: `ChatMessage`, `ClientFrame`, `ServerFrame`, `ErrorCode`, hằng số ở Global Constraints, `sanitizeNick(raw): {ok:true; nick:string} | {ok:false; code:"BAD_NICK"}`, `sanitizeText(raw): {ok:true; text:string} | {ok:false; code:"EMPTY"|"TOO_LONG"}`, `sanitizeColor(raw): string`, `parseClientFrame(raw: string): {ok:true; frame:ClientFrame} | {ok:false; code:"BAD_FRAME"}`, `makeMessageId(ts:number, seq:number): string`.

- [ ] **Step 1:** Viết test thất bại: nick `"  a\u0000b  "` → `"ab"`; nick toàn space → `BAD_NICK`; nick dài 40 → cắt còn 24; text rỗng → `EMPTY`; text 501 ký tự → `TOO_LONG`; text có `\u0007` bị bỏ, `\n` được giữ; color `"hsl(210 40% 70%)"` giữ nguyên, `"red"` → `hsl(210 40% 70%)`; `parseClientFrame('{"t":"msg","cid":"1","text":"hi"}')` ok; `parseClientFrame('{"t":"nope"}')` → `BAD_FRAME`; `parseClientFrame("không phải json")` → `BAD_FRAME`; `makeMessageId(1700000000000, 7)` khớp `/^[0-9a-z]+-[0-9a-z]+$/`.
- [ ] **Step 2:** `npx vitest run shared/test/protocol.spec.ts` → FAIL (module không tồn tại).
- [ ] **Step 3:** Viết `protocol.ts` với các type đúng như spec §5 và validator thuần (không phụ thuộc DOM/Node). `parseClientFrame` kiểm tra `t` ∈ `{"join","msg"}`, `nick`/`color`/`text`/`cid` là string, mọi `JSON.parse` lỗi → `BAD_FRAME`.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** Commit `feat(shared): protocol types and validators`.

### Task 3: Token bucket

**Files:**
- Create: `shared/src/ratelimit.ts`, `shared/test/ratelimit.spec.ts`

**Interfaces:**
- Produces: `type Bucket = { tokens: number; last: number }`, `newBucket(now:number): Bucket`, `take(bucket:Bucket, now:number): {ok:true; bucket:Bucket} | {ok:false; bucket:Bucket; retryInMs:number}`. Hàm thuần: nhận `now`, trả bucket mới, không mutate input.

- [ ] **Step 1:** Test thất bại: 5 lần `take` ở cùng `now` → ok hết; lần 6 → `ok:false`, `retryInMs ≈ 1500`; sau `now + 1500` → ok trở lại; sau `now + 60000` tokens không vượt `RATE_CAPACITY`; `take` không sửa bucket gốc (immutability).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: refill `(now - last) / RATE_REFILL_MS`, cap ở `RATE_CAPACITY`, `retryInMs = Math.ceil((1 - tokens) * RATE_REFILL_MS)`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(shared): token bucket rate limiter`.

### Task 4: ChatRoom — schema, history, trim

**Files:**
- Create: `worker/wrangler.jsonc`, `worker/src/room.ts`, `worker/test/room-storage.spec.ts`, `worker/vitest.config.ts`

**Interfaces:**
- Produces: `export class ChatRoom extends DurableObject<Env>` với `history(limit:number): ChatMessage[]`, `append(m:ChatMessage): void` (throw khi storage lỗi), `ensureReady(): void`, `trimIfNeeded(): void`, `count: number`.
- Consumes: `ChatMessage`, `HISTORY_LIMIT`, `HISTORY_TRIM_TO` từ `@dyno/shared/protocol`.

- [ ] **Step 1:** `wrangler.jsonc`: `name: "dynofreechat-api"`, `main: "src/index.ts"`, `compatibility_date: "2026-10-01"`, `durable_objects.bindings [{name:"CHAT_ROOM", class_name:"ChatRoom"}]`, `migrations: [{tag:"v1", new_sqlite_classes:["ChatRoom"]}]`, `vars: {ALLOWED_ORIGINS: "http://localhost:5173,https://realkhoa.github.io"}`. `compatibility_flags: ["nodejs_compat"]` không cần.
- [ ] **Step 2:** `vitest.config.ts` dùng `defineWorkersConfig` với `poolOptions.workers.wrangler.configPath = "./wrangler.jsonc"`, `miniflare.bindings` trỏ cùng DO.
- [ ] **Step 3:** Test thất bại: append 3 tin → `history(10)` trả đúng thứ tự ts tăng dần; append 501 tin → `history(1000).length === HISTORY_TRIM_TO`; `history(200)` trả 200 tin **mới nhất**.
- [ ] **Step 4:** Run → FAIL.
- [ ] **Step 5:** Implement `ensureReady()` (CREATE TABLE IF NOT EXISTS + `SELECT COUNT(*)` một lần), `append()` (INSERT), `trimIfNeeded()` (khi `count > HISTORY_LIMIT`, `DELETE ... WHERE id IN (SELECT id FROM messages ORDER BY ts ASC LIMIT (count - HISTORY_TRIM_TO))`, cập nhật `count`).
- [ ] **Step 6:** Run → PASS.
- [ ] **Step 7:** Commit `feat(worker): durable object history storage with amortized trim`.

### Task 5: ChatRoom — WebSocket protocol

**Files:**
- Modify: `worker/src/room.ts`
- Create: `worker/test/room-ws.spec.ts`

**Interfaces:**
- Produces: `fetch(request: Request): Promise<Response>` (trả 101 hoặc 503), `webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer)`, `webSocketClose`, `webSocketError`. Attachment shape: `{ nick: string; color: string; bucket: Bucket }`.
- Consumes: `parseClientFrame`, `sanitizeNick`, `sanitizeText`, `sanitizeColor`, `makeMessageId`, `take`, `newBucket` từ `@dyno/shared/*`.

- [ ] **Step 1:** Test thất bại: kết nối 2 client, client A gửi `join` → nhận `welcome` với `history` và `online`; A gửi `msg` → cả A và B nhận `append`, frame của A có `cid`, frame của B không có; B gửi `msg` trước `join` → `error NOT_JOINED`; A gửi 6 tin liên tiếp → tin thứ 6 `error RATE_LIMIT`; A gửi `msg` thiếu text → `error EMPTY`; `join` với nick rỗng → `error BAD_NICK` và socket **không** bị đóng.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement handlers. Dùng `this.ctx.acceptWebSocket(server)` (comment `// C2: Hibernation — do not switch to ws.accept()`). `send(ws, frame)` bọc try/catch. `broadcast(frame, except?)`. `presence()` tính bằng `this.ctx.getWebSockets().filter(s => s !== closing)`. Ghi storage bọc try/catch → `degraded` + gửi đúng một frame `error DEGRADED`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(worker): chat room websocket protocol with rate limit`.

### Task 6: Worker router

**Files:**
- Create: `worker/src/index.ts`, `worker/src/env.d.ts`, `worker/test/router.spec.ts`

**Interfaces:**
- Produces: `export default { fetch(request, env, ctx) }`, `export { ChatRoom }`, `type Env = { CHAT_ROOM: DurableObjectNamespace<ChatRoom>; ALLOWED_ORIGINS: string }`, `isAllowedOrigin(origin: string | null, allowlist: string): boolean`.

- [ ] **Step 1:** Test thất bại: `GET /health` → 200 JSON `{ok:true}`; `GET /nope` → 404; `GET /ws` không `Upgrade` → 426; `GET /ws` với `Origin: https://evil.example` → 403; `Origin: https://realkhoa.github.io` + `Upgrade: websocket` → 101 (qua DO trong miniflare); không `Origin` + `Upgrade` → 101.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement router + `isAllowedOrigin` (split theo `,`, trim, so khớp chính xác; `null` → true).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(worker): http router with origin allowlist`.

### Task 7: Web scaffold + VS shell

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/src/main.ts`, `web/src/env.ts`, `web/src/styles/tokens.css`, `web/src/styles/ide.css`, `web/src/styles/log.css`

**Interfaces:**
- Produces: DOM ids `#titlebar #menubar #tabstrip #toolbar #log #composer #statusbar #filter #follow #chip-all #chip-chat #chip-system #clear #online #conn #msgcount #wsurl #newchip`; `env.wsUrl: string` (từ `import.meta.env.VITE_WS_URL`, mặc định `ws://localhost:8787/ws`).

- [ ] **Step 1:** `vite.config.ts`: `base: process.env.GITHUB_ACTIONS ? "/DynoFreeChat/" : "/"`, `build.outDir: "dist"`, `server.port: 5173`.
- [ ] **Step 2:** `index.html` dựng đủ 7 khối theo spec §8, dùng `lang="vi"`, `meta name="color-scheme" content="dark"`, favicon inline SVG nhỏ.
- [ ] **Step 3:** `tokens.css` khai báo đúng bảng token spec §8 (không hardcode màu ngoài token). `ide.css`: chrome, tab, toolbar, scrollbar `::-webkit-scrollbar`, `focus-visible`, `@media (prefers-reduced-motion: reduce)`, breakpoint `max-width: 640px` ẩn menubar + filter, font-size log 12px.
- [ ] **Step 4:** `main.ts` chỉ import CSS + mount component rỗng (chưa nối socket), `npm run dev:web` → mở `http://localhost:5173`, thấy khung IDE, log area trống có chiều cao flex đúng, không scrollbar body.
- [ ] **Step 5:** Commit `feat(web): visual studio shell and design tokens`.

### Task 8: identity + format

**Files:**
- Create: `web/src/lib/identity.ts`, `web/src/lib/format.ts`, `web/test/{identity,format}.spec.ts`

**Interfaces:**
- Produces: `loadIdentity(storage: Storage): {nick:string; color:string}`, `saveNick(storage: Storage, nick: string): {nick:string; color:string}`, `randomIdentity(rand?: () => number): {nick:string; color:string}` (nick `guest-` + 4 ký tự base36), `formatTime(ts:number, now?:Date): string` → `HH:MM:SS`, `escapeHtml(s:string): string`, `formatChatRow(m: ChatMessage, selfNick: string): string` trả HTML một dòng.

- [ ] **Step 1:** Test thất bại: identity mặc định khớp `/^guest-[0-9a-z]{4}$/`; `saveNick("  khoan ")` → `khoan`, giữ nguyên color; nick rỗng → fallback identity cũ; `formatTime(0)` theo local time ổn định (test dùng `TZ=UTC` + `Date(0)` → `00:00:00`); `escapeHtml("<img onerror=x>")` → `&lt;img onerror=x&gt;`; `formatChatRow` chứa nick đã escape và `›`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement, không import DOM ngoài type `Storage`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): identity and log formatting`.

### Task 9: store + socket + backoff

**Files:**
- Create: `web/src/net/backoff.ts`, `web/src/net/socket.ts`, `web/src/model/store.ts`, `web/test/{backoff,store,socket}.spec.ts`

**Interfaces:**
- Produces: `nextDelay(attempt:number, rand?:()=>number): number`; `class ChatSocket { constructor(url:string, factory:(url:string)=>WebSocket); connect(); send(frame:ClientFrame); close(); on(event:"frame"|"state", cb): void }` với state `"connecting"|"open"|"reconnecting"|"closed"`;
  `class Store { messages: ChatMessage[]; pending: Map<string, PendingMsg>; addWelcome(history: ChatMessage[]): void; addMessage(m: ChatMessage, cid?: string): "appended"|"resolved"|"duplicate"; addPending(cid: string, text: string, nick: string): void; failPending(cid: string, reason: string): void; expirePending(now: number, ttlMs: number): string[]; setFilter(q: string, kind: "all"|"chat"|"system"): void; visible(): Row[] }`.

- [ ] **Step 1:** Test thất bại: `nextDelay(0)` ∈ [800,1200]; `nextDelay(10)` ≤ 30000; sequence với `rand=()=>0.5` ổn định; store dedupe (`addMessage` cùng id hai lần → lần 2 `"duplicate"`); `addMessage` có `cid` khớp pending → `"resolved"` và xoá pending; `expirePending` trả cid quá TTL; filter `chat` ẩn row system; socket: fake WebSocket factory, gọi `connect()` → state `connecting` → mở → `open`, đóng bất thường → `reconnecting` với delay đúng, `welcome` frame → attempt reset.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `Store` là state thuần, không đụng DOM (test chạy môi trường node). `ChatSocket` nhận factory để test được không cần network thật.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): store, socket client and reconnect backoff`.

### Task 10: log view

**Files:**
- Create: `web/src/ui/log-view.ts`, `web/src/ui/statusbar.ts`, `web/test/log-view.spec.ts`

**Interfaces:**
- Consumes: `Store`, `formatChatRow`, `escapeHtml`.
- Produces: `class LogView { mount(root:HTMLElement): void; sync(store:Store): void; notifyPending(cid:string, text:string, nick:string): void; clearLocal(): void; isAtBottom(): boolean; scrollToBottom(): void }`; `class StatusBar { setConnection(state): void; setOnline(n:number): void; setCount(n:number): void; setUrl(u:string): void }`.

- [ ] **Step 1:** Test thất bại (jsdom): `sync` thêm đúng số dòng; dòng trùng id không nhân đôi DOM; `clearLocal()` xoá hết row nhưng `store.messages` không đổi; `isAtBottom()` true khi `scrollTop + clientHeight >= scrollHeight - 8`; filter làm row bị ẩn có `hidden` attribute chứ không bị xoá.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: mỗi row là `<div class="row" data-id data-kind>`; append bằng `insertAdjacentHTML` với HTML đã escape; pending row có `data-cid`; `sync` chỉ thêm row mới (so `data-id` cuối cùng) và cập nhật class hidden theo filter; auto-scroll khi `isAtBottom()` hoặc `follow`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): log view rendering with filter and tail-follow`.

### Task 11: wire everything

**Files:**
- Create: `web/src/ui/composer.ts`, `web/src/ui/menubar.ts`, `web/src/ui/findbar.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `ChatSocket`, `Store`, `LogView`, `StatusBar`, `loadIdentity`.
- Produces: app chạy được: gõ Enter → dòng pending → `append` → dòng thật.

- [ ] **Step 1:** `composer.ts`: input 1 dòng, `Enter` gửi (không gửi khi rỗng), `Ctrl+L` clear, đếm ký tự hiện `n/500` khi > 400, disable khi chưa `open`.
- [ ] **Step 2:** `findbar.ts`: `Ctrl+F` focus, `Esc` blur + clear, debounce 120ms → `store.setFilter`.
- [ ] **Step 3:** `menubar.ts`: File/Edit/View/Help, `Edit → Set nickname…` dùng `prompt` rồi gửi `join` lại, `View → Follow tail` toggle, `Edit → Clear log`.
- [ ] **Step 4:** `main.ts`: dựng store, socket (factory `u => new WebSocket(u)`), logview, statusbar; nối frame: `welcome` → reset attempt, `addWelcome`, status; `append` → `addMessage`; `presence` → online; `error` → row system đỏ; state → statusbar + `Reconnecting… (n)`; pending expiry interval 1000ms.
- [ ] **Step 5:** Chạy `npm run dev:worker` (terminal 1) + `npm run dev:web` (terminal 2) → 2 tab chat qua lại, refresh tab 2 thấy history, tắt worker → status `Reconnecting`, bật lại → tự nối.
- [ ] **Step 6:** Commit `feat(web): wire socket, composer and status bar`.

### Task 12: Deploy pipeline

**Files:**
- Create: `.github/workflows/deploy-web.yml`, `README.md`, `web/.env.example`

**Interfaces:**
- Produces: workflow build + deploy Pages; README ghi URL, lệnh deploy, bảng chi phí free tier.

- [ ] **Step 1:** Workflow: trigger `push: branches: [main]` + `workflow_dispatch`; permissions `contents: read, pages: write, id-token: write`; concurrency group `pages`; jobs `build` (checkout, setup-node 22, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `upload-pages-artifact` path `web/dist`) và `deploy` (`deploy-pages`, environment `github-pages`).
- [ ] **Step 2:** `web/.env.example` ghi `VITE_WS_URL=wss://dynofreechat-api.<subdomain>.workers.dev/ws`.
- [ ] **Step 3:** README: mô tả, kiến trúc, cách chạy local, cách deploy (wrangler login → deploy worker → set `VITE_WS_URL` → push), bảng giới hạn free tier + ước tính, ghi chú "đừng nâng plan".
- [ ] **Step 4:** Kiểm tra workflow hợp lệ: `npx --yes action-validator .github/workflows/deploy-web.yml` hoặc rà tay theo schema `actions/*` version hiện hành.
- [ ] **Step 5:** Commit `chore(ci): pages deploy workflow and readme`.

### Task 13: Deploy + smoke

**Files:** không có file mới.

- [ ] **Step 1:** `npx wrangler login` (cần browser của user).
- [ ] **Step 2:** `npm run deploy:worker` → ghi lại URL.
- [ ] **Step 3:** `gh auth refresh -s workflow` (cần browser của user), `gh repo create DynoFreeChat --public --source . --push`.
- [ ] **Step 4:** Set biến build trên Pages (hoặc commit `.env.production` với URL worker), push `main`, đợi workflow xanh.
- [ ] **Step 5:** Mở URL Pages bằng 2 tab khác nhau: gửi/nhận, refresh còn history, filter, follow, đổi nick.
- [ ] **Step 6:** `npx wrangler whoami` + kiểm tra dashboard Plans = Workers Free; ghi con số thực vào README.
- [ ] **Step 7:** Commit `docs: record live urls and cost check`.

---

## Self-review

- **Spec coverage:** §2 → Task 4/5 (hibernation, trim, rate limit, cap), Task 12 (README cảnh báo plan). §3 → Task 1, 6. §4 → Task 1. §5 → Task 2. §6 → Task 4, 5 (degraded). §7 → Task 6. §8 → Task 7, 8, 9, 10, 11. §9 → test trong từng task. §10 → Task 12, 13. §12 → Task 13.5.
- **Type consistency:** `ChatMessage`/`ClientFrame`/`ServerFrame` chỉ định nghĩa ở Task 2 và được import, không định nghĩa lại. `Store.addMessage` trả union 3 giá trị, Task 11 dùng đúng union. `nextDelay` dùng ở Task 9 và 11. Attachment shape `{nick,color,bucket}` dùng ở Task 5.
- **Placeholder scan:** không có TBD/TODO. Bước nào sửa code đều nêu rõ hàm/file cần viết và hành vi kỳ vọng.
