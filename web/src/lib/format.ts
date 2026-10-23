import type { ChatMessage } from "@dyno/shared/protocol";

const pad = (value: number, width = 2): string => value.toString().padStart(width, "0");

/** Local wall-clock `HH:MM:SS`, the left column of every log row. */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Coarse relative age for the room list: "vừa xong", "3 phút", "2 giờ", "5 ngày". */
export function formatAge(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 45) return "vừa xong";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ngày`;
  const months = Math.round(days / 30);
  return `${months} tháng`;
}

/** Plain-text version of a message, used by "copy" and by tests. */
export function formatChatLine(message: ChatMessage): string {
  return `${formatTime(message.ts)}  ${message.nick}  ›  ${message.text}`;
}

/** Shortens long nicks for the fixed-width log column. */
export function clampNick(nick: string, width = 16): string {
  const chars = Array.from(nick);
  if (chars.length <= width) return nick;
  return `${chars.slice(0, width - 1).join("")}…`;
}
