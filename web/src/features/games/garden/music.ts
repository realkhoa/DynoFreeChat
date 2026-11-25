/**
 * @file music.ts
 * @brief Procedural Web Audio API chill & fresh ambient soundtrack for ASCII Garden.
 * @details Synthesizes warm Rhodes-like maj9/m7 chords, soft pentatonic kalimba
 * droplets, a gentle sub-bass, and a subtle filtered breeze pad with zero
 * external audio dependencies. Safe in headless/jsdom test environments.
 */

/** Controller handle for the ambient garden music engine. */
export interface ChillMusicPlayer {
  /** Whether the soundtrack is currently playing. */
  isPlaying(): boolean;
  /** Starts or resumes playback (must be called from or after a user gesture). */
  start(): void;
  /** Pauses playback and silences active voices cleanly. */
  stop(): void;
  /** Toggles playback and returns the new playing state. */
  toggle(): boolean;
  /** Releases audio resources permanently on unmount. */
  dispose(): void;
}

interface ChordVoicing {
  readonly bass: number;
  readonly notes: readonly number[];
}

// Warm, breezy lo-fi progression in C major / A minor (Fmaj7 -> Em7 -> Dm9 -> Cmaj9).
const CHORD_PROGRESSION: readonly ChordVoicing[] = [
  { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
  { bass: 82.41, notes: [164.81, 196.0, 246.94, 293.66] }, // Em7
  { bass: 73.42, notes: [146.83, 174.61, 220.0, 329.63] }, // Dm9
  { bass: 65.41, notes: [130.81, 196.0, 246.94, 293.66] }, // Cmaj9
];

// Bright C major pentatonic notes for fresh kalimba/water-drop sparkles.
const SPARKLE_NOTES: readonly number[] = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

const STEP_MS = 3200; // ~75 BPM bar feel, relaxed and unhurried

/**
 * @brief Creates a procedural chill ambient soundtrack player.
 * @return A ChillMusicPlayer handle safe to call in both browsers and tests.
 */
export function createChillMusicPlayer(): ChillMusicPlayer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let playing = false;
  let step = 0;

  /**
   * @brief Lazily initializes the Web Audio context and master lowpass/gain chain.
   * @return True when Web Audio is available, false in headless/jsdom environments.
   */
  function ensureContext(): boolean {
    if (ctx !== null && master !== null) return true;
    const AudioCtor =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (typeof AudioCtor !== "function") return false;
    try {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  /**
   * @brief Schedules one soft electric-piano tone with warm lowpass filtering.
   * @param freq Frequency in Hz.
   * @param startTime AudioContext start time in seconds.
   * @param duration Sustain + release duration in seconds.
   * @param peakGain Peak linear gain.
   * @param type Oscillator waveform.
   */
  function playTone(
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType,
  ): void {
    if (ctx === null || master === null) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, startTime);
    filter.Q.setValueAtTime(0.7, startTime);

    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(master);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  /**
   * @brief Schedules one bar of chords, sub-bass, and breezy pentatonic droplets.
   */
  function scheduleBar(): void {
    if (!playing || ctx === null || master === null) return;
    const now = ctx.currentTime + 0.05;
    const chord = CHORD_PROGRESSION[step % CHORD_PROGRESSION.length] ?? CHORD_PROGRESSION[0]!;

    // Warm sub-bass root
    playTone(chord.bass, now, 3.0, 0.14, "sine");

    // Soft Rhodes chord voicing with slight strum stagger
    chord.notes.forEach((freq, idx) => {
      playTone(freq, now + idx * 0.045, 2.9, 0.055, "triangle");
    });

    // Fresh pentatonic water-drop sparkles across the bar
    const offsets = [0.4, 1.15, 1.9, 2.55];
    offsets.forEach((offset, idx) => {
      const noteIndex = (step * 3 + idx * 2) % SPARKLE_NOTES.length;
      const freq = SPARKLE_NOTES[noteIndex] ?? 523.25;
      playTone(freq, now + offset, 0.85, 0.032, "sine");
    });

    step += 1;
  }

  return {
    isPlaying(): boolean {
      return playing;
    },

    start(): void {
      if (playing) return;
      if (!ensureContext() || ctx === null || master === null) {
        playing = true;
        return;
      }
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      playing = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.linearRampToValueAtTime(0.45, now + 0.6);
      scheduleBar();
      if (timer !== null) clearInterval(timer);
      timer = setInterval(scheduleBar, STEP_MS);
    },

    stop(): void {
      playing = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (ctx !== null && master !== null) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
        master.gain.linearRampToValueAtTime(0.0001, now + 0.35);
      }
    },

    toggle(): boolean {
      if (playing) this.stop();
      else this.start();
      return playing;
    },

    dispose(): void {
      this.stop();
      if (ctx !== null) {
        void ctx.close().catch(() => {});
        ctx = null;
        master = null;
      }
    },
  };
}
