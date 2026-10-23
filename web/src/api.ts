import type { RoomInfo } from "@dyno/shared/protocol";

export type CreateResult = { ok: true; slug: string } | { ok: false; code: string };

export async function listRooms(apiBase: string, fetchImpl: typeof fetch = fetch): Promise<RoomInfo[]> {
  const response = await fetchImpl(`${apiBase}/api/rooms`);
  if (!response.ok) throw new Error(`liệt kê room thất bại: HTTP ${response.status}`);
  const body = (await response.json()) as { rooms?: RoomInfo[] };
  return Array.isArray(body.rooms) ? body.rooms : [];
}

export async function createRoom(
  apiBase: string,
  body: { slug: string; pass?: string },
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
