export interface Identity {
  nick: string;
  color: string;
}

const STORAGE_KEY = "dyno.identity";
const DEFAULT_COLOR = "hsl(210 40% 70%)";

function suffix(rand: () => number, length = 4): string {
  let out = "";
  while (out.length < length) out += Math.floor(rand() * 36).toString(36);
  return out.slice(0, length);
}

/** `guest-xxxx` with a random hue, so two people never look the same by accident. */
export function randomIdentity(rand: () => number = Math.random): Identity {
  const hue = Math.floor(rand() * 360);
  return { nick: `guest-${suffix(rand)}`, color: `hsl(${hue} 65% 62%)` };
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.nick === "string" && typeof record.color === "string" && record.nick.length > 0;
}

/** Reads the stored identity, generating and persisting one on first visit. */
export function loadIdentity(storage: Storage | null, rand: () => number = Math.random): Identity {
  if (storage !== null) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isIdentity(parsed)) return parsed;
      }
    } catch {
      // Corrupt or unavailable storage: fall through to a fresh identity.
    }
  }

  const identity = randomIdentity(rand);
  saveIdentity(storage, identity);
  return identity;
}

export function saveIdentity(storage: Storage | null, identity: Identity): Identity {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } catch {
      // Private mode / quota: the in-memory copy still works for this session.
    }
  }
  return identity;
}

/**
 * Applies a new nickname while keeping the existing colour. An empty or
 * whitespace-only input leaves the current identity untouched.
 */
export function saveNick(
  storage: Storage | null,
  current: Identity,
  nick: string,
  rand: () => number = Math.random,
): Identity {
  const trimmed = nick.replace(/\s+/g, " ").trim().slice(0, 24);
  if (trimmed.length === 0) return current;
  return saveIdentity(storage, { nick: trimmed, color: current.color || DEFAULT_COLOR });
}
