import "./styles/tokens.css";
import "./styles/ide.css";
import "./styles/log.css";

import { MAX_TEXT, type ClientFrame, type RoomInfo, type ServerFrame } from "@dyno/shared/protocol";
import { createRoom, listRooms } from "./api";
import { apiBase, roomSocketUrl, wsUrl } from "./env";
import { byId } from "./lib/dom";
import { loadIdentity, saveNick, type Identity } from "./lib/identity";
import { Store } from "./model/store";
import { ChatSocket, type SocketState } from "./net/socket";
import { Composer } from "./ui/composer";
import { LogView } from "./ui/log-view";
import { mountMenubar, type MenuAction } from "./ui/menubar";
import { RoomDialog } from "./ui/room-dialog";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";

const PENDING_TTL_MS = 10_000;
const FILTER_DEBOUNCE_MS = 120;

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
const chipAll = byId<HTMLButtonElement>("chip-all");
const chipChat = byId<HTMLButtonElement>("chip-chat");
const chipSystem = byId<HTMLButtonElement>("chip-system");
const followButton = byId<HTMLButtonElement>("follow");
const newChip = byId<HTMLButtonElement>("new-chip");
const newRoomButton = byId<HTMLButtonElement>("new-room");
const roomListEl = byId<HTMLElement>("room-list");
const sidebarEl = byId<HTMLElement>("sidebar");
const sidebarFoot = byId<HTMLElement>("sidebar-foot");
const menubarEl = byId<HTMLElement>("menubar");
const tabLabel = byId<HTMLElement>("tab-label");
const tabClose = byId<HTMLElement>("tab-close");
const titlebarRoom = byId<HTMLElement>("titlebar-room");
const dialogEl = byId<HTMLDialogElement>("room-dialog");

// ------------------------------------------------------------------ instances

const storage = safeStorage();
let identity: Identity = loadIdentity(storage);

let store = new Store();
let socket: ChatSocket | null = null;
let current: { slug: string; locked: boolean } | null = null;
let joinPass: string | undefined;
let generation = 0;
let lastRowCount = 0;
let filterTimer: number | null = null;
let suppressDisconnectNotice = false;

const logView = new LogView(logEl);
logView.selfNick = identity.nick;

const statusbar = new StatusBar({
  root: byId<HTMLElement>("statusbar"),
  conn: byId<HTMLElement>("conn"),
  url: byId<HTMLElement>("wsurl"),
  online: byId<HTMLElement>("online"),
  count: byId<HTMLElement>("msgcount"),
  nick: byId<HTMLElement>("nick"),
  lock: byId<HTMLElement>("room-lock"),
});

const sidebar = new Sidebar(roomListEl, sidebarFoot);

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

const composer = new Composer({
  root: composerEl,
  input: composerInput,
  meter: composerMeter,
  onSend: sendMessage,
});

const menubar = mountMenubar(menubarEl, handleMenuAction);

// -------------------------------------------------------------------- render

function render(): void {
  logView.sync(store);

  if (store.length !== lastRowCount) {
    lastRowCount = store.length;
    if (!logView.follow) newChip.hidden = false;
  }

  const visible = logView.visibleCount;
  statusbar.setCount(visible);
  statusbar.setNick(identity.nick);
  menubar.setEnabled("copy-url", current !== null);
}

function setFollow(following: boolean): void {
  logView.follow = following;
  followButton.setAttribute("aria-pressed", String(following));
  if (following) newChip.hidden = true;
}

function setMode(mode: "start" | "room"): void {
  editorEl.dataset.mode = mode;
}

// --------------------------------------------------------------------- rooms

async function refreshRooms(): Promise<void> {
  try {
    const rooms = await listRooms(apiBase);
    sidebar.render(rooms, current?.slug ?? null, pickRoom);
    sidebar.setFoot(`${rooms.length} room · ${rooms.filter((room) => room.locked).length} có mật khẩu`);
  } catch {
    sidebar.setFoot("không tải được danh sách room");
  }
}

function pickRoom(room: RoomInfo): void {
  if (room.locked) {
    openJoinDialog(room.slug);
    return;
  }
  enterRoom(room.slug);
}

function openJoinDialog(slug: string, message?: string): void {
  if (dialog.isOpen) return;
  dialog.open("join", { slug, locked: true, message }, async (result) => {
    enterRoom(result.slug, result.pass.length > 0 ? result.pass : undefined);
    return null;
  });
}

function openCreateDialog(): void {
  if (dialog.isOpen) return;
  dialog.open("create", {}, async (result) => {
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

// ---------------------------------------------------------------- connection

function enterRoom(slug: string, pass?: string): void {
  leaveRoom(false);

  generation += 1;
  const gen = generation;

  store = new Store();
  logView.clearLocal();
  logView.selfNick = identity.nick;
  lastRowCount = 0;
  setFollow(true);

  current = { slug, locked: false };
  joinPass = pass;

  store.addSystem(`đang vào #${slug}…`);
  tabLabel.textContent = `#${slug}`;
  titlebarRoom.textContent = `#${slug}`;
  tabClose.hidden = false;
  document.title = `#${slug} — DynoFreeChat`;
  composer.setEnabled(false);
  updateUrl(slug);
  setMode("room");
  render();

  const created = new ChatSocket({ url: roomSocketUrl(wsUrl, slug) });
  socket = created;
  created.onState((state, detail) => handleState(gen, state, detail));
  created.onFrame((frame) => handleFrame(gen, frame));
  created.connect();

  void refreshRooms();
}

function leaveRoom(clearUrl = true): void {
  generation += 1;
  socket?.close("leaving room");
  socket = null;
  current = null;
  joinPass = undefined;
  composer.setEnabled(false);

  if (clearUrl) {
    store = new Store();
    logView.clearLocal();
    lastRowCount = 0;
    updateUrl(null);
    setMode("start");
    tabLabel.textContent = "Start";
    titlebarRoom.textContent = "no room";
    tabClose.hidden = true;
    document.title = "DynoFreeChat — Microsoft Visual Studio";
    statusbar.setLocked(false);
    statusbar.setOnline(0);
    store.addSystem("đã rời room");
    render();
    void refreshRooms();
  }
}

function handleState(
  gen: number,
  state: SocketState,
  detail: { attempt: number; reason?: string },
): void {
  if (gen !== generation) return;

  statusbar.setConnection(state, detail.attempt);

  if (state === "open" && socket !== null) {
    const frame: ClientFrame = { t: "join", nick: identity.nick, color: identity.color };
    if (joinPass !== undefined && joinPass.length > 0) frame.pass = joinPass;
    socket.send(frame);
    return;
  }

  if (state === "closed") {
    composer.setEnabled(false);

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
    case "welcome":
      socket?.acknowledge();
      current = { slug: frame.room.slug, locked: frame.room.locked };
      joinPass = undefined;
      logView.selfNick = frame.you.nick;
      store.addHistory(frame.history);
      store.addSystem(
        `đã vào #${frame.room.slug}${frame.room.locked ? " (có mật khẩu)" : ""} — ${frame.online} người online`,
      );
      composer.setEnabled(true);
      composer.focus();
      statusbar.setOnline(frame.online);
      statusbar.setLocked(frame.room.locked);
      titlebarRoom.textContent = `#${frame.room.slug}${frame.room.locked ? " 🔒" : ""}`;
      render();
      void refreshRooms();
      break;

    case "append": {
      const outcome = store.addMessage(frame.m, frame.cid);
      if (outcome !== "duplicate") render();
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
  composer.setEnabled(false);
  suppressDisconnectNotice = true;
  socket?.close("auth failed");
  socket = null;

  if (gen === generation && slug !== undefined) {
    window.setTimeout(() => openJoinDialog(slug, text), 0);
  }
}

function sendMessage(text: string): void {
  if (socket === null || current === null) return;

  const trimmed = Array.from(text).slice(0, MAX_TEXT).join("");
  const cid = `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  store.addPending(cid, trimmed, identity.nick, identity.color);
  render();

  if (!socket.send({ t: "msg", cid, text: trimmed })) {
    store.failPending(cid, "chưa kết nối");
    render();
  } else {
    setFollow(true);
  }
}

// ------------------------------------------------------------------- actions

function updateUrl(slug: string | null): void {
  const url = new URL(window.location.href);
  if (slug === null) url.searchParams.delete("r");
  else url.searchParams.set("r", slug);
  window.history.replaceState(null, "", url);
}

function clearLog(): void {
  store.clearLocal();
  logView.clearLocal();
  lastRowCount = 0;
  render();
}

function applyFilter(kind: "all" | "chat" | "system", query = filterInput.value): void {
  store.setFilter(query, kind);
  for (const [button, value] of [
    [chipAll, "all"],
    [chipChat, "chat"],
    [chipSystem, "system"],
  ] as const) {
    button.setAttribute("aria-pressed", String(kind === value));
  }
  render();
}

function changeNickname(): void {
  const next = window.prompt("Nickname mới", identity.nick);
  if (next === null) return;

  const updated = saveNick(storage, identity, next);
  if (updated.nick === identity.nick) return;

  identity = updated;
  logView.selfNick = identity.nick;
  statusbar.setNick(identity.nick);
  store.addSystem(`nickname đổi thành ${identity.nick}`);
  render();

  if (socket !== null && current !== null) {
    socket.send({ t: "join", nick: identity.nick, color: identity.color });
  }
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

function handleMenuAction(action: MenuAction): void {
  switch (action) {
    case "reload":
      window.location.reload();
      break;
    case "copy-url":
      void copyRoomLink();
      break;
    case "nickname":
      changeNickname();
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
    case "sidebar":
      sidebarEl.hidden = !sidebarEl.hidden;
      break;
    case "about":
      store.addSystem("DynoFreeChat — chat kiểu Visual Studio, Cloudflare DO + GitHub Pages");
      render();
      break;
  }
}

// --------------------------------------------------------------------- wiring

function wire(): void {
  logView.onFollowChange = (following) => {
    followButton.setAttribute("aria-pressed", String(following));
    if (following) newChip.hidden = true;
  };

  followButton.addEventListener("click", () => {
    setFollow(!logView.follow);
    if (logView.follow) logView.scrollToBottom();
  });

  newChip.addEventListener("click", () => {
    setFollow(true);
    logView.scrollToBottom();
  });

  newRoomButton.addEventListener("click", () => openCreateDialog());
  byId<HTMLButtonElement>("start-new").addEventListener("click", () => openCreateDialog());
  byId<HTMLButtonElement>("start-refresh").addEventListener("click", () => void refreshRooms());

  filterInput.addEventListener("input", () => {
    if (filterTimer !== null) window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterTimer = null;
      applyFilter(store.kindFilter, filterInput.value);
    }, FILTER_DEBOUNCE_MS);
  });

  for (const [button, kind] of [
    [chipAll, "all"],
    [chipChat, "chat"],
    [chipSystem, "system"],
  ] as const) {
    button.addEventListener("click", () => applyFilter(kind));
  }

  byId<HTMLButtonElement>("clear").addEventListener("click", () => clearLog());

  const leave = (): void => leaveRoom();
  tabClose.addEventListener("click", leave);
  tabClose.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      leave();
    }
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = event.key.toLowerCase();
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
      openCreateDialog();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setFollow(true);
      logView.scrollToBottom();
    }
  });

  window.setInterval(() => {
    const expired = store.expirePending(Date.now(), PENDING_TTL_MS);
    if (expired.length === 0) return;
    for (const cid of expired) store.failPending(cid, "server không phản hồi");
    render();
  }, 1_000);

  window.setInterval(() => void refreshRooms(), 30_000);
}

function boot(): void {
  statusbar.setUrl(wsUrl);
  statusbar.setNick(identity.nick);
  statusbar.setConnection("idle");
  statusbar.setOnline(0);

  wire();

  const requested = new URL(window.location.href).searchParams.get("r");
  if (requested !== null && /^[a-z0-9][a-z0-9-]{1,23}$/.test(requested)) {
    enterRoom(requested);
  } else {
    store.addSystem("chọn một room bên trái, hoặc bấm + để tạo room mới");
    render();
    void refreshRooms();
  }

  if (window.location.protocol === "https:" && wsUrl.startsWith("ws:")) {
    store.addSystem("bản deploy chưa có VITE_WS_URL — đang trỏ vào localhost, không chat được", "error");
    render();
  }
}

boot();

