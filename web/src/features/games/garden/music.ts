/**
 * @file music.ts
 * @brief Procedural Web Audio API chill & fresh ambient soundtrack for ASCII Garden.
 * @details Features a 10-track rotating playlist of distinct lo-fi/fresh progressions,
 * a 16-bar song arc (Intro -> Verse -> Climax -> Outro), natural silent breathing
 * gaps between tracks, and subtle weather-reactive ambient SFX.
 */

import type { EventId } from "@dyno/shared/garden";

/** Weather soundscape category mapped from active game events. */
export type WeatherAmbience = "calm" | "rain" | "storm" | "frost" | "night" | "golden" | "wind";

/** Section within a track's 16-bar arrangement. */
export type SongSection = "intro" | "verse" | "climax" | "outro" | "rest";

/** Definition of one procedural chill track in the 10-song rotation. */
export interface ChillTrack {
  readonly id: string;
  readonly title: string;
  readonly stepMs: number;
  readonly chords: readonly { readonly bass: number; readonly notes: readonly number[] }[];
  readonly melody: readonly number[];
}

/** Controller handle for the ambient garden music engine. */
export interface ChillMusicPlayer {
  /** Whether the soundtrack is currently enabled/playing. */
  isPlaying(): boolean;
  /** Whether the player is currently in a quiet breathing gap between tracks. */
  isResting(): boolean;
  /** Returns the current track title, or null if stopped. */
  getTrackTitle(): string | null;
  /** Returns the current 16-bar arrangement section. */
  getSection(): SongSection;
  /** Starts or resumes playback (must be called from or after a user gesture). */
  start(): void;
  /** Pauses playback and silences active voices cleanly. */
  stop(): void;
  /** Toggles playback and returns the new playing state. */
  toggle(): boolean;
  /** Advances immediately to the next track in the 10-song rotation. */
  nextTrack(): void;
  /** Updates the active weather event ids to blend subtle ambient SFX. */
  setWeather(events: readonly EventId[]): void;
  /** Returns the currently resolved weather ambience category. */
  getAmbience(): WeatherAmbience;
  /** Releases audio resources permanently on unmount. */
  dispose(): void;
}

/** 10 distinct chill & fresh tracks with varied keys, tempos, and voicings. */
export const CHILL_TRACKS: readonly ChillTrack[] = [
  {
    id: "morningDew",
    title: "Morning Dew",
    stepMs: 3000,
    chords: [
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 293.66] }, // Em7
      { bass: 73.42, notes: [146.83, 174.61, 220.0, 329.63] }, // Dm9
      { bass: 65.41, notes: [130.81, 196.0, 246.94, 293.66] }, // Cmaj9
    ],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
  },
  {
    id: "bambooBreeze",
    title: "Bamboo Breeze",
    stepMs: 2800,
    chords: [
      { bass: 73.42, notes: [146.83, 185.0, 220.0, 277.18] }, // Dmaj7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99] }, // Gmaj7
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 329.63] }, // Em9
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 392.0] }, // A9sus4
    ],
    melody: [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66],
  },
  {
    id: "sunlitKoi",
    title: "Sunlit Koi",
    stepMs: 3100,
    chords: [
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99] }, // Gmaj7
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 293.66] }, // Em7
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] }, // Cmaj7
      { bass: 73.42, notes: [146.83, 196.0, 220.0, 293.66] }, // D6/9
    ],
    melody: [392.0, 440.0, 493.88, 587.33, 659.25, 783.99],
  },
  {
    id: "terracottaRain",
    title: "Terracotta Rain",
    stepMs: 3200,
    chords: [
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] }, // Cmaj7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] }, // G13
    ],
    melody: [440.0, 523.25, 587.33, 659.25, 783.99, 880.0],
  },
  {
    id: "mistyGreenhouse",
    title: "Misty Greenhouse",
    stepMs: 2950,
    chords: [
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 293.66] }, // Ebmaj7
      { bass: 69.3, notes: [138.59, 174.61, 207.65, 261.63] }, // Dbmaj7
      { bass: 65.41, notes: [130.81, 155.56, 196.0, 233.08] }, // Cm7
      { bass: 116.54, notes: [233.08, 293.66, 349.23, 415.3] }, // Bb9sus4
    ],
    melody: [466.16, 523.25, 587.33, 698.46, 783.99, 932.33],
  },
  {
    id: "goldenOrchard",
    title: "Golden Orchard",
    stepMs: 2750,
    chords: [
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 329.63] }, // G6
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 293.66] }, // Cadd9
    ],
    melody: [523.25, 659.25, 698.46, 783.99, 880.0, 1046.5],
  },
  {
    id: "lanternDusk",
    title: "Lantern Dusk",
    stepMs: 3300,
    chords: [
      { bass: 82.41, notes: [164.81, 207.65, 246.94, 311.13] }, // Emaj7
      { bass: 69.3, notes: [138.59, 164.81, 207.65, 246.94] }, // C#m7
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 415.3] }, // Amaj7
      { bass: 123.47, notes: [246.94, 311.13, 369.99, 440.0] }, // B13
    ],
    melody: [493.88, 554.37, 659.25, 739.99, 830.61, 987.77],
  },
  {
    id: "starlightSoil",
    title: "Starlight Soil",
    stepMs: 3150,
    chords: [
      { bass: 116.54, notes: [233.08, 293.66, 349.23, 440.0] }, // Bbmaj7
      { bass: 98.0, notes: [196.0, 233.08, 293.66, 349.23] }, // Gm7
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 293.66] }, // Ebmaj7
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 349.23] }, // Fadd9
    ],
    melody: [466.16, 523.25, 587.33, 698.46, 783.99, 932.33],
  },
  {
    id: "emeraldBrook",
    title: "Emerald Brook",
    stepMs: 2850,
    chords: [
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] }, // Cmaj7
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 73.42, notes: [146.83, 174.61, 220.0, 261.63] }, // Dm7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] }, // G7
    ],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
  },
  {
    id: "cloudburstCalm",
    title: "Cloudburst Calm",
    stepMs: 3050,
    chords: [
      { bass: 103.83, notes: [207.65, 261.63, 311.13, 392.0] }, // Abmaj7
      { bass: 87.31, notes: [174.61, 207.65, 261.63, 311.13] }, // Fm7
      { bass: 69.3, notes: [138.59, 174.61, 207.65, 261.63] }, // Dbmaj7
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 311.13] }, // Eb9
    ],
    melody: [415.3, 466.16, 523.25, 622.25, 698.46, 830.61],
  },
];

const BARS_PER_TRACK = 16;
const REST_BARS_BETWEEN_TRACKS = 5; // ~15s quiet ambient breather before next song

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
 * @brief Resolves the arrangement section for a bar index within a 16-bar track + rest cycle.
 * @param barInCycle Zero-based bar counter within the track cycle.
 * @return SongSection (`intro`, `verse`, `climax`, `outro`, or `rest`).
 */
export function sectionForBar(barInCycle: number): SongSection {
  if (barInCycle < 4) return "intro";
  if (barInCycle < 8) return "verse";
  if (barInCycle < 12) return "climax";
  if (barInCycle < BARS_PER_TRACK) return "outro";
  return "rest";
}

/**
 * @brief Creates a procedural 10-track rotating chill ambient soundtrack player.
 * @return A ChillMusicPlayer handle safe to call in both browsers and tests.
 */
export function createChillMusicPlayer(): ChillMusicPlayer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let playing = false;
  let trackIndex = 0;
  let barInCycle = 0;
  let ambience: WeatherAmbience = "calm";

  /**
   * @brief Lazily initializes the Web Audio context and master gain node.
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
   * @brief Schedules one soft electric-piano or shimmer tone with warm lowpass filtering.
   * @param freq Frequency in Hz.
   * @param startTime AudioContext start time in seconds.
   * @param duration Sustain + release duration in seconds.
   * @param peakGain Peak linear gain.
   * @param type Oscillator waveform.
   * @param cutoff Lowpass filter cutoff frequency in Hz.
   */
  function playTone(
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType,
    cutoff = 1400,
  ): void {
    if (ctx === null || master === null) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, startTime);
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
   */
  function scheduleWeatherLayer(now: number, durationSec: number): void {
    if (ambience === "rain") {
      playNoiseSwell(now, durationSec, "bandpass", 1100, 0.5, 0.022);
      playTone(1046.5, now + 0.7, 0.45, 0.011, "sine");
      playTone(1318.5, now + 2.0, 0.45, 0.009, "sine");
      return;
    }
    if (ambience === "storm") {
      playNoiseSwell(now, durationSec, "bandpass", 950, 0.6, 0.02);
      if (barInCycle % 2 === 0) {
        playNoiseSwell(now + 0.5, 2.2, "lowpass", 95, 1.2, 0.034);
      }
      return;
    }
    if (ambience === "frost") {
      playNoiseSwell(now, durationSec, "bandpass", 2200, 1.1, 0.011);
      playTone(1567.98, now + 0.5, 1.1, 0.013, "sine");
      playTone(1975.53, now + 1.8, 1.1, 0.011, "sine");
      return;
    }
    if (ambience === "night") {
      playTone(523.25, now + 0.2, 2.5, 0.011, "sine");
      playTone(783.99, now + 0.35, 2.4, 0.009, "sine");
      return;
    }
    if (ambience === "golden") {
      playNoiseSwell(now, durationSec, "lowpass", 650, 0.5, 0.01);
      playTone(880.0, now + 0.9, 1.0, 0.013, "triangle");
      return;
    }
    if (ambience === "wind") {
      playNoiseSwell(now, durationSec, "bandpass", 520, 1.3, 0.015);
      return;
    }
    playNoiseSwell(now, durationSec, "lowpass", 500, 0.5, 0.006);
  }

  /**
   * @brief Resets the interval timer to match the current track's tempo.
   */
  function restartTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (!playing) return;
    const track = CHILL_TRACKS[trackIndex % CHILL_TRACKS.length] ?? CHILL_TRACKS[0]!;
    timer = setInterval(scheduleBar, track.stepMs);
  }

  /**
   * @brief Schedules one bar according to the 16-bar arrangement (Intro -> Verse -> Climax -> Outro -> Rest).
   */
  function scheduleBar(): void {
    if (!playing) return;
    const track = CHILL_TRACKS[trackIndex % CHILL_TRACKS.length] ?? CHILL_TRACKS[0]!;
    const section = sectionForBar(barInCycle);
    const stepSec = track.stepMs / 1000;

    if (ctx !== null && master !== null) {
      const now = ctx.currentTime + 0.05;
      scheduleWeatherLayer(now, stepSec);

      if (section !== "rest") {
        const chord = track.chords[barInCycle % track.chords.length] ?? track.chords[0]!;
        const isClimax = section === "climax";
        const isIntroOrOutro = section === "intro" || section === "outro";

        // 1. Sub-bass (deeper & warmer during verse/climax, gentle pulse on climax)
        const bassGain = isClimax ? 0.17 : isIntroOrOutro ? 0.09 : 0.13;
        playTone(chord.bass, now, stepSec * 0.92, bassGain, "sine", 900);
        if (isClimax) {
          playTone(chord.bass * 2, now + stepSec * 0.5, stepSec * 0.45, 0.06, "sine", 1100);
        }

        // 2. Rhodes chord voicing (richer + octave shimmer during climax)
        const chordGain = isClimax ? 0.072 : isIntroOrOutro ? 0.04 : 0.055;
        const cutoff = isClimax ? 2100 : 1350;
        chord.notes.forEach((freq, idx) => {
          playTone(freq, now + idx * 0.045, stepSec * 0.9, chordGain, "triangle", cutoff);
          if (isClimax && idx >= 2) {
            playTone(freq * 2, now + idx * 0.06, stepSec * 0.75, 0.024, "sine", 2400);
          }
        });

        // 3. Melodic droplets (sparse in intro/outro, flowing in verse, soaring arpeggio in climax)
        const offsets = isClimax
          ? [0.25, 0.65, 1.05, 1.45, 1.85, 2.25]
          : isIntroOrOutro
            ? [0.6, 1.75]
            : [0.4, 1.1, 1.8, 2.4];
        offsets.forEach((offset, idx) => {
          if (offset >= stepSec - 0.15) return;
          const noteIdx = (barInCycle * 3 + idx * 2) % track.melody.length;
          const freq = track.melody[noteIdx] ?? 523.25;
          const melGain = isClimax ? 0.044 : 0.028;
          playTone(freq, now + offset, isClimax ? 1.05 : 0.85, melGain, "sine", isClimax ? 2600 : 1800);
        });
      }
    }

    barInCycle += 1;
    if (barInCycle >= BARS_PER_TRACK + REST_BARS_BETWEEN_TRACKS) {
      barInCycle = 0;
      trackIndex = (trackIndex + 1) % CHILL_TRACKS.length;
      restartTimer();
    }
  }

  return {
    isPlaying(): boolean {
      return playing;
    },

    isResting(): boolean {
      return playing && sectionForBar(barInCycle) === "rest";
    },

    getTrackTitle(): string | null {
      if (!playing) return null;
      return (CHILL_TRACKS[trackIndex % CHILL_TRACKS.length] ?? CHILL_TRACKS[0]!).title;
    },

    getSection(): SongSection {
      return sectionForBar(barInCycle);
    },

    start(): void {
      if (playing) return;
      playing = true;
      if (!ensureContext() || ctx === null || master === null) return;
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.linearRampToValueAtTime(0.45, now + 0.6);
      scheduleBar();
      restartTimer();
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

    nextTrack(): void {
      trackIndex = (trackIndex + 1) % CHILL_TRACKS.length;
      barInCycle = 0;
      if (playing) {
        scheduleBar();
        restartTimer();
      }
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
