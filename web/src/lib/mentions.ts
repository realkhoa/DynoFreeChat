/**
 * Mention completion helpers.
 *
 * A mention starts at whitespace (or the start of the line) and runs until the
 * caret; it cannot contain whitespace, matching how `@nick` is parsed on the
 * wire.
 */
export interface MentionToken {
  /** Index of the `@`. */
  start: number;
  /** What has been typed after the `@`. */
  query: string;
}

const TOKEN_RE = /^[\p{L}\p{N}_.-]*$/u;

export function activeMentionToken(value: string, caret: number): MentionToken | null {
  const at = value.lastIndexOf("@", Math.max(0, caret - 1));
  if (at === -1) return null;

  const before = at === 0 ? "" : value.slice(at - 1, at);
  if (before !== "" && !/\s/.test(before)) return null;

  const query = value.slice(at + 1, caret);
  if (!TOKEN_RE.test(query)) return null;

  return { start: at, query };
}

/** Filters candidate nicks for a partially typed mention. */
export function matchNicks(nicks: string[], query: string, limit = 6): string[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const starts: string[] = [];
  const contains: string[] = [];

  for (const nick of nicks) {
    const key = nick.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (needle.length === 0 || key.startsWith(needle)) starts.push(nick);
    else if (key.includes(needle)) contains.push(nick);
  }

  return [...starts, ...contains].slice(0, limit);
}

/** Replaces the in-progress token with `@nick ` and returns the new caret. */
export function applyMention(
  value: string,
  token: MentionToken,
  caret: number,
  nick: string,
): { text: string; caret: number } {
  const replacement = `@${nick} `;
  let rest = value.slice(caret);
  // Do not leave a double space when the caret sits before an existing one.
  if (rest.startsWith(" ")) rest = rest.slice(1);

  const text = value.slice(0, token.start) + replacement + rest;
  return { text, caret: token.start + replacement.length };
}
