import "./styles/tokens.css";
import "./styles/ide.css";
import "./styles/log.css";

import {
  MAX_TEXT,
  makeExcerpt,
  mentionsNick,
  type ClientFrame,
  type ReplyRef,
  type RoomInfo,
  type ServerFrame,
} from "@dyno/shared/protocol";
import { createRoom, listRooms } from "./api";
import { apiBase, roomSocketUrl, wsUrl } from "./env";
import { applyBrowserBadges } from "./lib/badge";
import { loadZoom, saveZoom, stepZoom, zoomToPixels, type Zoom } from "./lib/zoom";
import { byId } from "./lib/dom";
import { applyDock, closeDock, loadDock, revealDock, saveDock, toggleDock, type DockState } from "./lib/dockpref";
import { joinPassFor } from "./lib/joinpass";
import { applyMinimal, loadMinimal, minimalFromSearch, saveMinimal } from "./lib/minimal";
import { applyRibbonVisible, loadRibbonVisible, saveRibbonVisible, updateRibbonToggleButton } from "./lib/ribbonpref";
import { Outbox } from "./lib/outbox";
import { formatAge } from "./lib/format";
import { loadIdentity, saveNick, type Identity } from "./lib/identity";
import { Notifier } from "./lib/notify";
import { SoundPlayer } from "./lib/sound";
import { PassVault } from "./lib/passvault";
import { applyTheme, loadTheme, otherTheme, saveTheme, type Theme } from "./lib/theme";
import { Store, type KindFilter } from "./model/store";
import { ChatSocket, type SocketState } from "./net/socket";
import { Composer } from "./ui/composer";
import { GameDialog } from "./ui/game-dialog";
import { icon, setIconButton } from "./ui/icons";
import { LogView } from "./ui/log-view";
import { mountMenubar, type MenuAction } from "./ui/menubar";
import { NickDialog } from "./ui/nick-dialog";
import { defaultRibbonSpec, Ribbon } from "./ui/ribbon";
import { RoomDialog } from "./ui/room-dialog";
import { ChatPicker } from "./ui/chat-picker";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";

const PENDING_TTL_MS = 10_000;
const FILTER_DEBOUNCE_MS = 120;
const BASE_TITLE = "DynoFreeChat - Microsoft Visual Studio";

const ERROR_TEXT: Record<string, string> = {
  BAD_NICK: "nickname không hợp lệ",
  EMPTY: "tin nhắn rỗng",
  TOO_LONG: `tin nhắn quá dài (tối đa ${MAX_TEXT} ký tự)`,
  RATE_LIMIT: "chậm thôi — bạn gửi nhanh quá",
  NOT_JOINED: "chưa vào room",
  FULL: "room đã đủ người",
  DEGRADED: "server hết chỗ lưu lịch sử — chat vẫn chạy, history tạm ngưng",
  BAD_FRAME: "gói tin không hợp lệ",
  BAD_PASS: "mật khẩu sai",
  ROOM_NOT_FOUND: "room không tồn tại",
  BAD_SLUG: "tên room không hợp lệ",
  TOO_MANY_ROOMS: "server đã đủ room, không tạo thêm được",
  ROOM_EXISTS: "tên room này có người dùng rồi",
  TRY_LATER: "server bận hoặc bạn tạo room quá nhanh — thử lại sau",
};

function safeStorage(): Storage | null {
  try {
    const probe = "__dyno_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- elements

const logEl = byId<HTMLElement>("log");
const editorEl = byId<HTMLElement>("editor");
const composerEl = byId<HTMLElement>("composer");
const composerInput = byId<HTMLInputElement>("composer-input");
const composerMeter = byId<HTMLElement>("composer-meter");
const filterInput = byId<HTMLInputElement>("filter");
const kindSelect = byId<HTMLSelectElement>("kind");
const roomSearch = byId<HTMLInputElement>("room-search");
const zoomSelect = document.getElementById("log-zoom") as HTMLSelectElement | null;
const treeSearch = byId<HTMLInputElement>("tree-search");
const newChip = byId<HTMLButtonElement>("new-chip");
const newRoomButton = byId<HTMLButtonElement>("new-room");

const treeEl = byId<HTMLElement>("room-tree");
const sidebarEl = byId<HTMLElement>("sidebar");
const sidebarFoot = byId<HTMLElement>("sidebar-foot");
const menubarEl = byId<HTMLElement>("menubar");
const tabRoom = byId<HTMLElement>("tab-room");
const tabLabel = byId<HTMLElement>("tab-label");
const tabClose = byId<HTMLButtonElement>("tab-close");
const tabGame = byId<HTMLElement>("tab-game");
const tabGameClose = byId<HTMLButtonElement>("tab-game-close");
const tabNew = byId<HTMLButtonElement>("tab-new");
const gameEditorPanel = byId<HTMLElement>("game-editor-panel");
const titlebarRoom = byId<HTMLElement>("titlebar-room");
const crumbRoom = byId<HTMLElement>("crumb-room");
const nickButton = document.getElementById("nick") as HTMLButtonElement | null;
const notifyBell = byId<HTMLButtonElement>("notify-bell");
const bellCount = byId<HTMLElement>("bell-count");
const notifyPanel = byId<HTMLElement>("notify-panel");
const notifyList = byId<HTMLElement>("notify-list");
const notifyEmpty = byId<HTMLElement>("notify-empty");
const notifyClear = byId<HTMLButtonElement>("notify-clear");
const dialogEl = byId<HTMLDialogElement>("room-dialog");
const nickDialogEl = byId<HTMLDialogElement>("nick-dialog");
const pickerDialogEl = byId<HTMLDialogElement>("picker-dialog");

// ------------------------------------------------------------------ instances

const storage = safeStorage();
let identity: Identity = loadIdentity(storage);
const vault = new PassVault(storage);
const sound = new SoundPlayer({ storage });
const outbox = new Outbox();
let outboxWarned = false;
let theme: Theme = loadTheme(storage);
let zoom: Zoom = loadZoom(storage);
let ribbonVisible = loadRibbonVisible(storage);
let minimal = loadMinimal(storage);
let dock: DockState = loadDock(storage);

let store = new Store();
let rooms: RoomInfo[] = [];
let socket: ChatSocket | null = null;
let current: { slug: string; locked: boolean } | null = null;
let joinPass: string | undefined;
let generation = 0;
let lastRowCount = 0;
let filterTimer: number | null = null;
let suppressDisconnectNotice = false;

const logView = new LogView(logEl, {
  onReply: (row) => composer.setReply({ id: row.id, nick: row.nick, text: makeExcerpt(row.text) }),
  onCopy: (row) => void copyMessage(row.text),
});
logView.selfNick = identity.nick;
logView.setTheme(theme);

const statusbar = new StatusBar({
  root: document.getElementById("statusbar"),
  conn: document.getElementById("conn"),
  url: document.getElementById("wsurl"),
  online: document.getElementById("online"),
  count: document.getElementById("msgcount"),
  nick: nickButton,
  lock: document.getElementById("room-lock"),
});

const sidebar = new Sidebar(treeEl, sidebarFoot);

const dialog = new RoomDialog(dialogEl, {
  form: byId<HTMLFormElement>("room-form"),
  slug: byId<HTMLInputElement>("room-slug"),
  pass: byId<HTMLInputElement>("room-pass"),
  title: byId<HTMLElement>("room-dialog-title"),
  passLabel: byId<HTMLElement>("room-pass-label"),
  slugHint: byId<HTMLElement>("room-slug-hint"),
  submit: byId<HTMLButtonElement>("room-submit"),
  cancel: byId<HTMLButtonElement>("room-cancel"),
  error: byId<HTMLElement>("room-error"),
});

const nickDialog = new NickDialog(nickDialogEl, {
  form: byId<HTMLFormElement>("nick-form"),
  input: byId<HTMLInputElement>("nick-input"),
  error: byId<HTMLElement>("nick-error"),
  cancel: byId<HTMLButtonElement>("nick-cancel"),
});

const chatPicker = new ChatPicker(
  pickerDialogEl,
  {
    search: byId<HTMLInputElement>("picker-search"),
    list: byId<HTMLElement>("picker-list"),
    cancel: byId<HTMLButtonElement>("picker-cancel"),
    closeX: byId<HTMLButtonElement>("picker-close-x"),
    createButton: byId<HTMLButtonElement>("picker-create"),
  },
  {
    onPick: (room) => pickRoom(room),
    onCreate: (slugPrefill) => openCreateDialog(slugPrefill),
  },
);

function selectRoomTab(): void {
  tabRoom.setAttribute("aria-selected", "true");
  tabGame.setAttribute("aria-selected", "false");
  gameEditorPanel.hidden = true;
  updateChrome();
  render();
}

function selectGameTab(): void {
  tabGame.hidden = false;
  tabGame.setAttribute("aria-selected", "true");
  tabRoom.setAttribute("aria-selected", "false");
  gameEditorPanel.hidden = false;
  byId<HTMLElement>("startview").hidden = true;
  byId<HTMLElement>("logwrap").hidden = true;
  byId<HTMLElement>("crumb-solution").textContent = "DynoFreeChat";
  byId<HTMLElement>("crumb-group").textContent = "Collab";
  crumbRoom.textContent = "DiagnosticMatrix.cs";
}

function closeGameTab(): void {
  tabGame.hidden = true;
  selectRoomTab();
  gameDialog.close();
}

const gameDialog = new GameDialog({
  dialog: byId<HTMLDialogElement>("game-dialog"),
  wsUrl,
  apiBase,
  getIdentity: () => identity,
  createRoomImpl: createRoom,
  storage,
  editorPanel: gameEditorPanel,
  onTabOpen: () => selectGameTab(),
  onTabClose: () => closeGameTab(),
});

const composer = new Composer({
  root: composerEl,
  input: composerInput,
  meter: composerMeter,
  menu: byId<HTMLElement>("mention-menu"),
  nicks: () => [...store.nicks(), identity.nick],
  onSend: sendMessage,
  onReplyChange: renderReplyBanner,
});

const menubar = mountMenubar(menubarEl, handleMenuAction);
const ribbon = new Ribbon(byId<HTMLElement>("ribbon"), defaultRibbonSpec(), handleMenuAction, () =>
  toggleRibbon(),
);

/**
 * Notifications carry a room label and a count — never message text, never a
 * nickname. That is a product rule, not an implementation detail.
 */
const notifier = new Notifier({
  isHidden: () => document.visibilityState === "hidden",
  show: (title, body, tag) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const notification = new Notification(title, { body, tag });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Some browsers refuse the constructor outside a service worker.
    }
  },
});

// -------------------------------------------------------------------- render

function render(): void {
  logView.sync(store);

  if (store.length !== lastRowCount) {
    lastRowCount = store.length;
    if (!logView.follow) newChip.hidden = false;
  }

  statusbar.setCount(logView.visibleCount);
  statusbar.setCountVisible(editorEl.dataset.mode === "room");
  statusbar.setNick(identity.nick);
  menubar.setEnabled("copy-url", current !== null);
  menubar.setEnabled("forget-pass", current !== null && vault.has(current.slug));
  ribbon.setEnabled("forget-pass", current !== null && vault.has(current.slug));
  ribbon.setEnabled("copy-url", current !== null);
}

function setFollow(following: boolean): void {
  logView.follow = following;
  ribbon.setChecked("follow", following);
  if (following) newChip.hidden = true;
}

function setMode(mode: "start" | "room"): void {
  editorEl.dataset.mode = mode;
}

/**
 * Scales the chat log only: the custom property is set on the log element, so
 * the rest of the shell keeps its own size.
 */
function applyZoom(): void {
  logEl.style.setProperty("--log-size", `${zoomToPixels(zoom)}px`);
  if (zoomSelect) zoomSelect.value = String(zoom);
}

function applyDockState(): void {
  applyDock(document.documentElement, dock);
  menubar.setChecked("dock", dock !== "closed");
  if (dock === "open") composer.focus();
}

function setDock(next: DockState): void {
  dock = saveDock(storage, next);
  applyDockState();
}

function applyChromeVisibility(): void {
  applyRibbonVisible(document.documentElement, ribbonVisible);
  applyMinimal(document.documentElement, minimal);
  menubar.setChecked("ribbon", ribbonVisible);
  menubar.setChecked("minimal", minimal);

  const ribbonToggle = document.getElementById("menubar-ribbon-toggle");
  if (ribbonToggle !== null) {
    updateRibbonToggleButton(ribbonToggle, ribbonVisible);
  }
}

function toggleRibbon(): void {
  ribbonVisible = saveRibbonVisible(storage, !ribbonVisible);
  applyChromeVisibility();
}

/** Only the log and the composer, for embedding in a WebView. */
function toggleMinimal(): void {
  minimal = saveMinimal(storage, !minimal);
  applyChromeVisibility();
  if (!minimal) composer.focus();
}

function changeZoom(next: Zoom): void {
  if (next === zoom) return;
  zoom = saveZoom(storage, next);
  applyZoom();

  render();
}

function updateChrome(): void {
  const slug = current?.slug;
  tabLabel.textContent = slug === undefined ? "Start" : `#${slug}`;
  titlebarRoom.textContent = slug === undefined ? "no room" : `#${slug}`;
  crumbRoom.textContent = slug === undefined ? "Start" : `#${slug}`;
  tabClose.hidden = slug === undefined;

  const unread = notifier.unread;
  const base = slug === undefined ? BASE_TITLE : `#${slug} — DynoFreeChat`;
  document.title = unread > 0 ? `(${unread}) ${base}` : base;

  // Tab icon counter + taskbar badge (where the browser supports it).
  applyBrowserBadges(unread);
}

/**
 * The bell only ever lists room names and counts. Nothing in this panel can show
 * what was said, by construction: the data model has no message text.
 */
function renderReplyBanner(reply: ReplyRef | null): void {
  const banner = byId<HTMLElement>("dock-reply");
  if (reply === null) {
    banner.hidden = true;
    return;
  }

  byId<HTMLElement>("dock-reply-nick").textContent = reply.nick;
  byId<HTMLElement>("dock-reply-excerpt").textContent = reply.text;
  banner.hidden = false;
}

function renderNotifications(): void {
  const entries = notifier.entries();
  const unread = notifier.unread;

  bellCount.hidden = unread === 0;
  bellCount.textContent = unread > 99 ? "99+" : String(unread);
  notifyBell.title = unread === 0 ? "Thông báo" : `${unread} tin nhắn mới`;
  notifyClear.disabled = unread === 0;

  const items = entries.map((entry) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notify-item";

    const room = document.createElement("span");
    room.className = "notify-room";
    room.textContent = `#${entry.room}`;

    const count = document.createElement("span");
    count.className = "notify-count";
    count.textContent = entry.mentions > 0 ? `${entry.count} tin · @bạn` : `${entry.count} tin mới`;

    const meta = document.createElement("span");
    meta.className = "notify-meta";
    meta.textContent = formatAge(entry.at);

    button.append(room, count, meta);
    button.addEventListener("click", () => {
      notifier.resetRoom(entry.room);
      closeNotifications();
      renderNotifications();
      updateChrome();
      enterRoom(entry.room, vault.get(entry.room));
    });

    item.append(button);
    return item;
  });

  notifyList.replaceChildren(...items);
  notifyEmpty.hidden = items.length > 0;
}

function openNotifications(): void {
  notifyPanel.hidden = false;
  notifyBell.setAttribute("aria-expanded", "true");
}

function closeNotifications(): void {
  notifyPanel.hidden = true;
  notifyBell.setAttribute("aria-expanded", "false");
}

function toggleNotificationsPanel(): void {
  if (notifyPanel.hidden) openNotifications();
  else closeNotifications();
}

/** Drops the socket and rejoins the current room, reusing a remembered password. */
function reconnect(): void {
  if (current === null) {
    void refreshRooms();
    return;
  }
  enterRoom(current.slug, vault.get(current.slug));
}

function toggleTheme(): void {
  theme = otherTheme(theme);
  saveTheme(storage, theme);
  applyTheme(document.documentElement, theme);
  logView.setTheme(theme);
  menubar.setChecked("theme", theme === "light");
  store.addSystem(`giao diện: ${theme}`);
  render();
}

// --------------------------------------------------------------------- rooms

async function refreshRooms(): Promise<void> {
  try {
    rooms = await listRooms(apiBase);
    sidebar.render(rooms, current?.slug ?? null, pickRoom, (notice) => {
      store.addSystem(notice);
      render();
    });
    sidebar.setQuery(treeSearch.value);
    const locked = rooms.filter((room) => room.locked).length;
    sidebar.setFoot(`${rooms.length} room · ${locked} có mật khẩu`);
  } catch {
    sidebar.setFoot("không tải được danh sách room");
  }
}

function setRoomQuery(query: string): void {
  sidebar.setQuery(query);
  if (roomSearch.value !== query) roomSearch.value = query;
  if (treeSearch.value !== query) treeSearch.value = query;
}

function pickRoom(room: RoomInfo): void {
  if (!room.locked) {
    enterRoom(room.slug);
    return;
  }

  // Password is typed once per browser: a remembered one goes straight through.
  const remembered = vault.get(room.slug);
  if (remembered !== undefined) {
    enterRoom(room.slug, remembered);
    return;
  }
  openJoinDialog(room.slug);
}

function openJoinDialog(slug: string, message?: string): void {
  if (dialog.isOpen) return;
  dialog.open("join", { slug, locked: true, message }, async (result) => {
    enterRoom(result.slug, result.pass.length > 0 ? result.pass : undefined);
    return null;
  });
}

/**
 * @brief Opens the modal dialog to create a new chat room.
 * @param slugPrefill Optional pre-filled slug name for the new room.
 */
function openCreateDialog(slugPrefill?: string): void {
  if (dialog.isOpen) return;
  dialog.open("create", { slug: slugPrefill }, async (result) => {
    const created = await createRoom(
      apiBase,
      result.pass.length > 0 ? { slug: result.slug, pass: result.pass } : { slug: result.slug },
    );
    if (!created.ok) return ERROR_TEXT[created.code] ?? `lỗi: ${created.code}`;

    enterRoom(created.slug, result.pass.length > 0 ? result.pass : undefined);
    void refreshRooms();
    return null;
  });
}

/**
 * @brief Opens the chat picker modal to choose an existing room or create a new one.
 */
function openChatPicker(): void {
  if (chatPicker.isOpen) return;
  chatPicker.open(rooms, current?.slug ?? null);
  void refreshRooms().then(() => {
    if (chatPicker.isOpen) chatPicker.updateRooms(rooms, current?.slug ?? null);
  });
}

// ---------------------------------------------------------------- connection

function enterRoom(slug: string, pass?: string): void {
  leaveRoom(false);

  generation += 1;
  const gen = generation;

  store = new Store();
  store.selfNick = identity.nick;
  logView.clearLocal();
  logView.selfNick = identity.nick;
  lastRowCount = 0;
  setFollow(true);
  notifier.reset();
  composer.setReply(null);
  outbox.clear();
  outboxWarned = false;

  current = { slug, locked: false };
  joinPass = pass;

  store.addSystem(`đang vào #${slug}…`);
  setMode("room");
  updateChrome();
  render();

  const created = new ChatSocket({ url: roomSocketUrl(wsUrl, slug) });
  socket = created;
  created.onState((state, detail) => handleState(gen, state, detail));
  created.onFrame((frame) => handleFrame(gen, frame));
  created.connect();
  composer.setEnabled(false);

  void refreshRooms();
}

function leaveRoom(updateUrl = true): void {
  generation += 1;
  socket?.close("leaving room");
  socket = null;
  current = null;
  joinPass = undefined;
  outbox.clear();
  outboxWarned = false;
  composer.setEnabled(false);

  store = new Store();
  logView.clearLocal();
  lastRowCount = 0;
  setMode("start");
  statusbar.setLocked(false);
  statusbar.setOnline(0);
  store.addSystem("đã rời room");
  notifier.reset();
  updateChrome();
  render();

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete("r");
    window.history.replaceState(null, "", url);
  }

  void refreshRooms();
}

function handleState(
  gen: number,
  state: SocketState,
  detail: { attempt: number; reason?: string },
): void {
  if (gen !== generation) return;

  statusbar.setConnection(state, detail.attempt);

  if (state === "open" && socket !== null) {
    // A reconnect is a new connection: the remembered password has to travel
    // again, otherwise a tab switch looks like a wrong password.
    const pass = joinPassFor(joinPass, current?.slug, (slug) => vault.get(slug));
    const frame: ClientFrame = { t: "join", nick: identity.nick, color: identity.color };
    if (pass !== undefined) frame.pass = pass;
    socket.send(frame);
    return;
  }
  if (state === "closed") {
    // Still in a room: keep the composer alive so typed messages queue
    // instead of being lost. Auth failures disable it explicitly elsewhere.
    if (current === null) composer.setEnabled(false);

    // A refused password or a vanished room is already explained by the error
    // row (and the dialog); a second "connection lost" line would be a lie.
    const reason = detail.reason ?? "";
    const explained =
      suppressDisconnectNotice ||
      reason.includes("BAD_PASS") ||
      reason.includes("ROOM_NOT_FOUND") ||
      reason.includes("auth failed");
    suppressDisconnectNotice = false;

    if (!explained && current !== null) {
      store.addSystem("mất kết nối tới room", "error");
      render();
    }
  }
}

function handleFrame(gen: number, frame: ServerFrame): void {
  if (gen !== generation) return;

  switch (frame.t) {
    case "welcome": {
      socket?.acknowledge();
      current = { slug: frame.room.slug, locked: frame.room.locked };
      if (frame.room.locked && joinPass !== undefined && joinPass.length > 0) {
        vault.remember(frame.room.slug, joinPass);
      }
      joinPass = undefined;
      logView.selfNick = frame.you.nick;
      store.selfNick = frame.you.nick;
      store.addHistory(frame.history);
      store.addSystem(
        `đã vào #${frame.room.slug}${frame.room.locked ? " (có mật khẩu)" : ""} — ${frame.online} người online`,
      );
      composer.setEnabled(true);
      flushOutbox();
      composer.focus();
      statusbar.setOnline(frame.online);
      statusbar.setLocked(frame.room.locked);
      notifier.resetRoom(frame.room.slug);
      renderNotifications();
      updateChrome();
      render();
      void refreshRooms();
      break;
    }

    case "append": {
      const outcome = store.addMessage(frame.m, frame.cid);
      if (outcome === "duplicate") break;
      if (frame.m.nick !== identity.nick) {
        const mention = mentionsNick(frame.m.text, identity.nick);
        notifier.incoming(current?.slug ?? "room", { mention });
        // Beep only when nobody is looking at the room, like Mattermost.
        if (document.visibilityState === "hidden") sound.play(mention ? "mention" : "message");
        renderNotifications();
        updateChrome();
      }
      render();
      break;
    }

    case "presence":
      statusbar.setOnline(frame.online);
      break;

    case "error":
      handleServerError(gen, frame);
      break;
  }
}

function handleServerError(gen: number, frame: Extract<ServerFrame, { t: "error" }>): void {
  const text = ERROR_TEXT[frame.code] ?? frame.code;

  if (frame.cid !== undefined) {
    store.failPending(frame.cid, text);
  } else {
    store.addSystem(text, "error");
  }
  render();

  if (frame.code !== "BAD_PASS" && frame.code !== "ROOM_NOT_FOUND") return;

  const slug = current?.slug;
  if (frame.code === "BAD_PASS" && slug !== undefined && vault.has(slug)) vault.forget(slug);

  composer.setEnabled(false);
  suppressDisconnectNotice = true;
  socket?.close("auth failed");
  socket = null;

  if (gen === generation && slug !== undefined) {
    window.setTimeout(() => openJoinDialog(slug, text), 0);
  }
}


/** Sends everything typed while the socket was down, in order. */
function flushOutbox(): void {
  if (outbox.empty) return;

  const queued = outbox.take();
  let sent = 0;

  for (const message of queued) {
    const frame: ClientFrame =
      message.replyTo === undefined
        ? { t: "msg", cid: message.cid, text: message.text }
        : { t: "msg", cid: message.cid, text: message.text, replyTo: message.replyTo };

    if (socket === null || !socket.send(frame)) {
      outbox.queue(message);
      continue;
    }
    sent += 1;
  }

  outboxWarned = outbox.size > 0;
  if (sent > 0) {
    store.addSystem(`đã gửi lại ${sent} tin đang chờ`);
    render();
  }
}

function sendMessage(text: string, replyTo?: string): void {
  if (socket === null || current === null) return;

  const trimmed = Array.from(text).slice(0, MAX_TEXT).join("");
  const cid = `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const parent = replyTo === undefined ? undefined : store.find(replyTo);
  const quoted: ReplyRef | undefined =
    parent === undefined ? undefined : { id: parent.id, nick: parent.nick, text: makeExcerpt(parent.text) };

  store.addPending(cid, trimmed, identity.nick, identity.color, quoted);
  render();

  const frame: ClientFrame = quoted === undefined
    ? { t: "msg", cid, text: trimmed }
    : { t: "msg", cid, text: trimmed, replyTo: quoted.id };

  if (socket.send(frame)) {
    setFollow(true);
    return;
  }

  // Offline: keep the row pending and queue the frame for the next welcome.
  outbox.queue(
    quoted === undefined ? { cid, text: trimmed } : { cid, text: trimmed, replyTo: quoted.id },
  );
  if (!outboxWarned) {
    outboxWarned = true;
    store.addSystem("chưa kết nối — tin nhắn sẽ được gửi lại khi vào lại room");
  }
  render();
}

// ------------------------------------------------------------------- actions

function clearLog(): void {
  store.clearLocal();
  logView.clearLocal();
  lastRowCount = 0;
  render();
}

function applyFilter(kind: KindFilter, query = filterInput.value): void {
  store.setFilter(query, kind);
  kindSelect.value = kind;
  render();
}

async function changeNickname(): Promise<void> {
  if (nickDialog.isOpen) return;

  const next = await nickDialog.open(identity.nick);
  if (next === null || next === identity.nick) return;

  identity = saveNick(storage, identity, next);
  logView.selfNick = identity.nick;
  store.selfNick = identity.nick;
  statusbar.setNick(identity.nick);
  store.addSystem(`nickname đổi thành ${identity.nick}`);
  render();

  // Re-joining updates the name on the server for everyone in the room.
  if (socket !== null && current !== null) {
    socket.send({ t: "join", nick: identity.nick, color: identity.color });
  }
}

async function copyMessage(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    store.addSystem("đã copy tin nhắn");
  } catch {
    store.addSystem("trình duyệt không cho copy", "error");
  }
  render();
}

async function copyRoomLink(): Promise<void> {
  if (current === null) return;
  const link = `${window.location.origin}${window.location.pathname}?r=${current.slug}`;
  try {
    await navigator.clipboard.writeText(link);
    store.addSystem(`đã copy link: ${link}`);
  } catch {
    store.addSystem(`copy tay nhé: ${link}`, "error");
  }
  render();
}

function notificationsAvailable(): boolean {
  return typeof Notification !== "undefined";
}

async function toggleNotifications(): Promise<void> {
  if (!notificationsAvailable()) {
    store.addSystem("trình duyệt này không hỗ trợ thông báo", "error");
    render();
    return;
  }

  if (Notification.permission === "granted") {
    notifier.setEnabled(!notifier.isEnabled);
    store.addSystem(
      notifier.isEnabled ? "đã bật thông báo — chỉ báo số tin mới, không kèm nội dung" : "đã tắt thông báo",
    );
    render();
    syncNotifyMenu();
    return;
  }

  const permission = await Notification.requestPermission();
  notifier.setEnabled(permission === "granted");
  store.addSystem(
    permission === "granted"
      ? "đã bật thông báo — chỉ báo số tin mới, không hiện nội dung tin nhắn"
      : "bạn đã từ chối quyền thông báo",
    permission === "granted" ? "system" : "error",
  );
  render();
  syncNotifyMenu();
}

function syncNotifyMenu(): void {
  const available = notificationsAvailable();
  const on = available && Notification.permission === "granted" && notifier.isEnabled;
  menubar.setEnabled("notify", available);
  menubar.setChecked("notify", on);
}

function handleMenuAction(action: MenuAction): void {
  switch (action) {
    case "reload":
      window.location.reload();
      break;
    case "copy-url":
      void copyRoomLink();
      break;
    case "nickname":
      void changeNickname();
      break;
    case "clear":
      clearLog();
      break;
    case "find":
      filterInput.focus();
      filterInput.select();
      break;
    case "follow":
      setFollow(!logView.follow);
      if (logView.follow) logView.scrollToBottom();
      break;
    case "notify":
      void toggleNotifications();
      break;
    case "theme":
      toggleTheme();
      break;
    case "ribbon":
      toggleRibbon();
      break;
    case "dock":
      setDock(revealDock(dock));
      break;
    case "minimal":
      toggleMinimal();
      break;
    case "zoom-in":
      changeZoom(stepZoom(zoom, 1));
      break;
    case "zoom-out":
      changeZoom(stepZoom(zoom, -1));
      break;
    case "sound":
      sound.setEnabled(!sound.isEnabled);
      menubar.setChecked("sound", sound.isEnabled);
      store.addSystem(sound.isEnabled ? "đã bật âm thanh thông báo" : "đã tắt âm thanh thông báo");
      render();
      break;
    case "sidebar":
      sidebarEl.hidden = !sidebarEl.hidden;
      break;
    case "new-room":
      openChatPicker();
      break;
    case "reconnect":
      reconnect();
      break;
    case "forget-pass": {
      if (current === null) break;
      const removed = vault.forget(current.slug);
      store.addSystem(
        removed ? `đã quên mật khẩu của #${current.slug}` : `#${current.slug} không có mật khẩu đã lưu`,
      );
      render();
      break;
    }
    case "about":
      store.addSystem("DynoFreeChat — chat kiểu Visual Studio, Cloudflare DO + GitHub Pages");
      render();
      break;
    case "tictactoe":
      gameDialog.open();
      break;
    case "game-create":
      gameDialog.open("online");
      break;
    case "game-join":
      gameDialog.open();
      break;
    case "game-ai":
      gameDialog.open("ai");
      break;
  }
}

// --------------------------------------------------------------------- wiring

function decorateChrome(): void {
  byId<HTMLElement>("titlebar-mark").append(icon("solution", 15));
  byId<HTMLElement>("tab-icon").append(icon("folder", 14));
  byId<HTMLElement>("tab-game-icon").append(icon("file", 14));
  byId<HTMLElement>("game-code-icon").append(icon("file", 12));
  byId<HTMLElement>("filter-icon").append(icon("search", 12));
  byId<HTMLElement>("menu-search-icon").append(icon("search", 12));
  byId<HTMLElement>("tree-search-icon").append(icon("search", 12));
  setIconButton(byId<HTMLElement>("tab-close"), "close", "Đóng room");
  setIconButton(tabGameClose, "close", "Đóng tab");
  setIconButton(tabNew, "plus", "Mở chat mới (Ctrl+N)");
  setIconButton(byId<HTMLElement>("new-room"), "plus", "Tạo room mới (Ctrl+N)");
  setIconButton(byId<HTMLElement>("refresh-rooms"), "refresh", "Nạp lại danh sách room");
  setIconButton(byId<HTMLElement>("collapse-tree"), "collapse", "Thu gọn Solution Explorer");
  setIconButton(newChip, "follow", "Xuống tin mới nhất");
  setIconButton(notifyBell, "bell", "Thông báo");
}

function wire(): void {
  logView.onFollowChange = (following) => {
  ribbon.setChecked("follow", following);
  if (following) newChip.hidden = true;
  };


  newChip.addEventListener("click", () => {
    setFollow(true);
    logView.scrollToBottom();
  });

  tabRoom.addEventListener("click", () => selectRoomTab());
  tabGame.addEventListener("click", () => selectGameTab());
  tabGameClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeGameTab();
  });

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      if (tabGame.getAttribute("aria-selected") === "true") selectRoomTab();
      else selectGameTab();
    } else if (e.key === "Escape" && tabGame.getAttribute("aria-selected") === "true") {
      selectRoomTab();
    }
  });

  tabNew.addEventListener("click", () => openChatPicker());
  newRoomButton.addEventListener("click", () => openChatPicker());
  byId<HTMLButtonElement>("refresh-rooms").addEventListener("click", () => void refreshRooms());
  byId<HTMLButtonElement>("collapse-tree").addEventListener("click", () => sidebar.collapseAll());
  byId<HTMLButtonElement>("start-new").addEventListener("click", () => openChatPicker());
  byId<HTMLButtonElement>("start-refresh").addEventListener("click", () => void refreshRooms());



  for (const input of [roomSearch, treeSearch]) {
    input.addEventListener("input", () => setRoomQuery(input.value));
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoomQuery("");
    });
  }

  kindSelect.addEventListener("change", () => {
    applyFilter(kindSelect.value as KindFilter);
  });

  zoomSelect?.addEventListener("change", () => {
    const next = Number(zoomSelect.value);
    if (Number.isFinite(next)) changeZoom(next as Zoom);
  });

  filterInput.addEventListener("input", () => {
    if (filterTimer !== null) window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterTimer = null;
      applyFilter(store.kindFilter, filterInput.value);
    }, FILTER_DEBOUNCE_MS);
  });


  // Nickname change can also be triggered via Edit/Tools menu or status bar if present.
  nickButton?.addEventListener("click", () => void changeNickname());

  byId<HTMLButtonElement>("minimal-exit").addEventListener("click", () => toggleMinimal());

  const menubarRibbonToggle = document.getElementById("menubar-ribbon-toggle");
  menubarRibbonToggle?.addEventListener("click", () => toggleRibbon());

  byId<HTMLButtonElement>("dock-reply-cancel").addEventListener("click", () => {
    composer.setReply(null);
    composer.focus();
  });

  notifyBell.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNotificationsPanel();
  });

  notifyClear.addEventListener("click", () => {
    notifier.reset();
    renderNotifications();
    updateChrome();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (target === null || notifyPanel.hidden) return;
    if (notifyPanel.contains(target) || notifyBell.contains(target)) return;
    closeNotifications();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !notifyPanel.hidden) closeNotifications();
  });

  tabClose.addEventListener("click", () => leaveRoom());
  byId<HTMLElement>("tab-room").addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Delete") leaveRoom();
  });

  // WebAudio needs a user gesture before it may start.
  const unlockAudio = (): void => sound.unlock();
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    renderNotifications();
    updateChrome();
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = event.key.toLowerCase();
    // Ctrl+Shift+. and Ctrl+Shift+, zoom the chat pane, like the VS editor.
    if (event.altKey && key === "o") {
      event.preventDefault();
      setDock(revealDock(dock));
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      toggleRibbon();
      return;
    }
    if (event.shiftKey && key === "m") {
      event.preventDefault();
      toggleMinimal();
      return;
    }
    if (event.shiftKey && event.code === "Period") {
      event.preventDefault();
      changeZoom(stepZoom(zoom, 1));
      return;
    }
    if (event.shiftKey && event.code === "Comma") {
      event.preventDefault();
      changeZoom(stepZoom(zoom, -1));
      return;
    }
    if (event.shiftKey && key === "d") {
      event.preventDefault();
      toggleTheme();
      return;
    }
    if (event.shiftKey && key === "r") {
      event.preventDefault();
      reconnect();
      return;
    }
    if (key === "f") {
      event.preventDefault();
      filterInput.focus();
      filterInput.select();
      return;
    }
    if (key === "l") {
      event.preventDefault();
      clearLog();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      openChatPicker();
      return;
    }
    if (event.key === ";") {
      event.preventDefault();
      treeSearch.focus();
      treeSearch.select();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setFollow(true);
      logView.scrollToBottom();
    }
  });

  window.setInterval(() => {
    if (socket?.state !== "open") return;
    const expired = store.expirePending(Date.now(), PENDING_TTL_MS);
    if (expired.length === 0) return;
    for (const cid of expired) store.failPending(cid, "server không phản hồi");
    render();
  }, 1_000);

  window.setInterval(() => void refreshRooms(), 30_000);
}

function boot(): void {
  applyTheme(document.documentElement, theme);
  store.selfNick = identity.nick;
  decorateChrome();
  statusbar.setUrl(wsUrl);
  statusbar.setNick(identity.nick);
  statusbar.setConnection("idle");
  statusbar.setOnline(0);
  setFollow(true);
  syncNotifyMenu();
  renderNotifications();
  menubar.setChecked("theme", theme === "light");
  menubar.setChecked("sound", sound.isEnabled);
  applyZoom();

  // A WebView can pin the layout with ?minimal=1 instead of storage.
  const urlMinimal = minimalFromSearch(window.location.search);
  if (urlMinimal !== undefined) minimal = saveMinimal(storage, urlMinimal);
  applyChromeVisibility();
  applyDockState();

  wire();

  const hashMatch = window.location.hash.match(/ttt=([a-zA-Z0-9]+)/);
  if (hashMatch !== null && hashMatch[1] !== undefined) {
    gameDialog.open("online", hashMatch[1]);
  }

  const requested = new URL(window.location.href).searchParams.get("r");
  if (requested !== null && /^[a-z0-9][a-z0-9-]{1,23}$/.test(requested)) {
    enterRoom(requested, vault.get(requested));
  } else {
    store.addSystem("chọn một room ở Solution Explorer, hoặc bấm + để tạo room mới");
    updateChrome();
    render();
    void refreshRooms();
  }

  if (window.location.protocol === "https:" && wsUrl.startsWith("ws:")) {
    store.addSystem("bản deploy chưa có VITE_WS_URL — đang trỏ vào localhost, không chat được", "error");
    render();
  }
}

boot();
