/**
 * Notification sound, synthesised with WebAudio.
 *
 * No audio asset: two short sine blips cost nothing to download and cannot 404.
 * Browsers refuse to start an AudioContext before a user gesture, so `unlock()`
 * is called from the first click or keypress and the player stays silent until
 * then.
 */
export type SoundKind = "message" | "mention";

export interface Tone {
  /** Hz */
  freq: number;
  /** Seconds from the start of the cue. */
  start: number;
  /** Seconds. */
  duration: number;
  gain: number;
}

const STORAGE_KEY = "dyno.sound";

export function toneSchedule(kind: SoundKind): Tone[] {
  if (kind === "mention") {
    return [
      { freq: 880, start: 0, duration: 0.07, gain: 0.06 },
      { freq: 1174.7, start: 0.09, duration: 0.07, gain: 0.06 },
      { freq: 1568, start: 0.18, duration: 0.12, gain: 0.06 },
    ];
  }
  return [
    { freq: 880, start: 0, duration: 0.07, gain: 0.05 },
    { freq: 1174.7, start: 0.09, duration: 0.1, gain: 0.05 },
  ];
}

export interface SoundPlayerOptions {
  storage?: Storage | null;
  /** Injected in tests; defaults to the real AudioContext. */
  createContext?: () => AudioContext | null;
}

export class SoundPlayer {
  private context: AudioContext | null = null;
  private unlocked = false;
  private enabled = true;

  constructor(private readonly options: SoundPlayerOptions = {}) {
    this.enabled = this.readPreference();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.writePreference(enabled);
  }

  /** Must run inside a user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    try {
      const context = this.options.createContext?.() ?? new AudioContext();
      if (context === null) return;
      this.context = context;
      if (context.state === "suspended") void context.resume();
    } catch {
      // No audio available (or blocked): stay silent, never throw.
    }
  }

  /** Plays one cue. Silent until unlocked, when muted, or without WebAudio. */
  play(kind: SoundKind = "message"): void {
    if (!this.enabled) return;
    const context = this.context;
    if (context === null || context.state !== "running") return;

    try {
      const now = context.currentTime;
      for (const tone of toneSchedule(kind)) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = tone.freq;

        const from = now + tone.start;
        const to = from + tone.duration;
        envelope.gain.setValueAtTime(0.0001, from);
        envelope.gain.exponentialRampToValueAtTime(tone.gain, from + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, to);

        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(from);
        oscillator.stop(to + 0.01);
      }
    } catch {
      // A failing cue must never break message handling.
    }
  }

  private readPreference(): boolean {
    const storage = this.options.storage ?? null;
    if (storage === null) return true;
    try {
      return storage.getItem(STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  }

  private writePreference(enabled: boolean): void {
    const storage = this.options.storage ?? null;
    if (storage === null) return;
    try {
      storage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Private mode: the preference simply does not persist.
    }
  }
}
