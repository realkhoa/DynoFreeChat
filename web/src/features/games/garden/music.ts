/**
 * @file music.ts
 * @brief Procedural Web Audio API chill & fresh ambient soundtrack for ASCII Garden.
 * @details Synthesizes warm Rhodes-like maj9/m7 chords, soft pentatonic kalimba
 * droplets, a gentle sub-bass, and a subtle filtered breeze pad with zero
 * external audio dependencies. Safe in headless/jsdom test environments.
 */

import type { EventId } from "@dyno/shared/garden";

/** Weather soundscape category mapped from active game events. */
export type WeatherAmbience = "calm" | "rain" | "storm" | "frost" | "night" | "golden" | "wind";

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
  /** Updates the active weather event ids to blend subtle ambient SFX. */
  setWeather(events: readonly EventId[]): void;
  /** Returns the currently resolved weather ambience category. */
  getAmbience(): WeatherAmbience;
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
 * @brief Maps active weather event ids to a cohesive chill ambient soundscape.
 * @param events Active weather event ids from the current season snapshot.
 * @return Resolved WeatherAmbience category.
 */
export function resolveWeatherAmbience(events: readonly EventId[]): WeatherAmbience {
  for (const id of events) {
    if (id === "thunderstorm" || id === "plasmaStorm" || id === "twister") return "storm";
  }
  for (const id of events) {
    if (
      id === "rain" ||
      id === "toxicRain" ||
      id === "acidRain" ||
      id === "emberRain" ||
      id === "metallicDew"
    ) {
      return "rain";
    }
  }
  for (const id of events) {
    if (
      id === "frost" ||
      id === "snowfall" ||
      id === "coldSnap" ||
      id === "crystalFrost" ||
      id === "diamondSky"
    ) {
      return "frost";
    }
  }
  for (const id of events) {
    if (
      id === "auroraNight" ||
      id === "moonlight" ||
      id === "bloodMoon" ||
      id === "cosmicRift" ||
      id === "meteorShower" ||
      id === "discoNight"
    ) {
      return "night";
    }
  }
  for (const id of events) {
    if (
      id === "goldenHour" ||
      id === "goldenFog" ||
      id === "glimmerFog" ||
      id === "rainbowSky" ||
      id === "heatwave" ||
      id === "marketBoom"
    ) {
      return "golden";
    }
  }
  for (const id of events) {
    if (id === "drought" || id === "wildfire" || id === "smoke" || id === "blightWind") return "wind";
  }
  return "calm";
}

/**
 * @brief Creates a procedural chill ambient soundtrack player.
 * @return A ChillMusicPlayer handle safe to call in both browsers and tests.
 */
export function createChillMusicPlayer(): ChillMusicPlayer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let playing = false;
  let step = 0;
  let ambience: WeatherAmbience = "calm";

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
   * @brief Builds a reusable 2-second pink-like soft noise buffer for rain/wind ambience.
   */
  function ensureNoiseBuffer(): AudioBuffer | null {
    if (ctx === null) return null;
    if (noiseBuffer !== null) return noiseBuffer;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
    }
    noiseBuffer = buffer;
    return buffer;
  }

  /**
   * @brief Schedules a gentle filtered noise swell for rain, wind, or distant thunder.
   * @param startTime AudioContext start time in seconds.
   * @param duration Duration in seconds.
   * @param filterType BiquadFilter type (`bandpass` or `lowpass`).
   * @param freq Filter center/cutoff frequency in Hz.
   * @param q Filter Q resonance.
   * @param peakGain Subtle peak gain (kept low so music stays chill).
   */
  function playNoiseSwell(
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    freq: number,
    q: number,
    peakGain: number,
  ): void {
    if (ctx === null || master === null) return;
    const buffer = ensureNoiseBuffer();
    if (buffer === null) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, startTime);
    filter.Q.setValueAtTime(q, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + duration * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(master);

    src.start(startTime);
    src.stop(startTime + duration + 0.05);
  }

  /**
   * @brief Blends subtle, in-key weather SFX for the current bar without overpowering the music.
   * @param now AudioContext bar start time in seconds.
   */
  function scheduleWeatherLayer(now: number): void {
    if (ambience === "rain") {
      playNoiseSwell(now, 3.1, "bandpass", 1100, 0.5, 0.024);
      playTone(1046.5, now + 0.7, 0.45, 0.012, "sine");
      playTone(1318.5, now + 2.1, 0.45, 0.01, "sine");
      return;
    }
    if (ambience === "storm") {
      playNoiseSwell(now, 3.1, "bandpass", 950, 0.6, 0.022);
      if (step % 2 === 0) {
        playNoiseSwell(now + 0.6, 2.2, "lowpass", 95, 1.2, 0.038);
      }
      return;
    }
    if (ambience === "frost") {
      playNoiseSwell(now, 3.1, "bandpass", 2200, 1.1, 0.012);
      playTone(1567.98, now + 0.5, 1.1, 0.014, "sine");
      playTone(1975.53, now + 1.8, 1.1, 0.012, "sine");
      return;
    }
    if (ambience === "night") {
      playTone(523.25, now + 0.2, 2.6, 0.012, "sine");
      playTone(783.99, now + 0.35, 2.5, 0.01, "sine");
      return;
    }
    if (ambience === "golden") {
      playNoiseSwell(now, 3.1, "lowpass", 650, 0.5, 0.011);
      playTone(880.0, now + 0.9, 1.0, 0.014, "triangle");
      return;
    }
    if (ambience === "wind") {
      playNoiseSwell(now, 3.1, "bandpass", 520, 1.3, 0.016);
      return;
    }
    // Calm: ultra-soft fresh garden breeze
    playNoiseSwell(now, 3.1, "lowpass", 500, 0.5, 0.007);
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

    scheduleWeatherLayer(now);

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

    setWeather(events: readonly EventId[]): void {
      ambience = resolveWeatherAmbience(events);
    },

    getAmbience(): WeatherAmbience {
      return ambience;
    },

    dispose(): void {
      this.stop();
      noiseBuffer = null;
      if (ctx !== null) {
        void ctx.close().catch(() => {});
        ctx = null;
        master = null;
      }
    },
  };
}
