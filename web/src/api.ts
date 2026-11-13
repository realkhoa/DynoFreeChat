import type { RoomInfo, RoomKind } from "@dyno/shared/protocol";

export type CreateResult = { ok: true; slug: string } | { ok: false; code: string };

/**
 * @brief Lists the public lobby.
 * @param apiBase Worker HTTP origin.
 * @param kind Restrict to chat rooms or game rooms; omit for both.
 * @param fetchImpl Fetch implementation; tests replace it.
 * @return The matching rooms.
 */
export async function listRooms(
  apiBase: string,
  kind?: RoomKind,
  fetchImpl: typeof fetch = fetch,
): Promise<RoomInfo[]> {
  const query = kind === undefined ? "" : `?kind=${encodeURIComponent(kind)}`;
  const response = await fetchImpl(`${apiBase}/api/rooms${query}`);
  if (!response.ok) throw new Error(`liệt kê room thất bại: HTTP ${response.status}`);
  const body = (await response.json()) as { rooms?: RoomInfo[] };
  return Array.isArray(body.rooms) ? body.rooms : [];
}

/**
 * @brief Creates one room.
 * @param apiBase Worker HTTP origin.
 * @param body Room code, optional password and room kind.
 * @param fetchImpl Fetch implementation; tests replace it.
 * @return The created code, or the refusal code.
 */
export async function createRoom(
  apiBase: string,
  body: { slug: string; pass?: string; kind?: RoomKind },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateResult> {
  const response = await fetchImpl(`${apiBase}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as { slug?: string; code?: string };
  if (response.ok && typeof payload.slug === "string") return { ok: true, slug: payload.slug };
  return { ok: false, code: payload.code ?? `HTTP_${response.status}` };
}
