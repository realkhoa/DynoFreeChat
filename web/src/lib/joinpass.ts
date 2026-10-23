/**
 * Which password to send in a `join` frame.
 *
 * A reconnect is a brand-new connection, so the Durable Object treats it as
 * unauthenticated: the password has to travel again even though the user never
 * left the room. `joinPass` only survives the first attempt, so the remembered
 * password is the fallback — without it a tab switch would look like a wrong
 * password.
 */
export function joinPassFor(
  inflight: string | undefined,
  slug: string | undefined,
  remembered: (slug: string) => string | undefined,
): string | undefined {
  if (inflight !== undefined && inflight.length > 0) return inflight;
  if (slug === undefined) return undefined;

  const cached = remembered(slug);
  return cached !== undefined && cached.length > 0 ? cached : undefined;
}
