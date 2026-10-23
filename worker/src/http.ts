/** JSON response helper used by the Worker and both Durable Objects. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Reads a JSON body without throwing on malformed input. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}
