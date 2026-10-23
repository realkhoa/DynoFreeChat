/**
 * Remembers a room password so it is typed once per browser, not once per visit.
 *
 * Trade-off, stated plainly: the password sits in `localStorage` in clear text,
 * which is the same trust level as a session cookie. It never leaves the
 * browser except as the `join` frame that the server already checks.
 */
const STORAGE_KEY = "dyno.passes";

type Vault = Record<string, string>;

export class PassVault {
  constructor(private readonly storage: Storage | null) {}

  get(slug: string): string | undefined {
    const pass = this.read()[slug];
    return typeof pass === "string" && pass.length > 0 ? pass : undefined;
  }

  has(slug: string): boolean {
    return this.get(slug) !== undefined;
  }

  remember(slug: string, pass: string): void {
    if (pass.length === 0) return;
    const vault = this.read();
    if (vault[slug] === pass) return;
    vault[slug] = pass;
    this.write(vault);
  }

  forget(slug: string): boolean {
    const vault = this.read();
    if (!(slug in vault)) return false;
    delete vault[slug];
    this.write(vault);
    return true;
  }

  clear(): void {
    this.write({});
  }

  private read(): Vault {
    if (this.storage === null) return {};
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === null) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};

      const vault: Vault = {};
      for (const [slug, pass] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof pass === "string") vault[slug] = pass;
      }
      return vault;
    } catch {
      return {};
    }
  }

  private write(vault: Vault): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(vault));
    } catch {
      // Private mode or quota: the room simply asks again next time.
    }
  }
}
