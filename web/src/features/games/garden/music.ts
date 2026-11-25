/**
 * @file music.ts
 * @brief Procedural Web Audio API chill & fresh ambient soundtrack for ASCII Garden.
 * @details Organizes 12 chill tracks into dedicated playlists per day phase
 * (`dawn`, `day`, `dusk`, `night`), with a 16-bar song arc (Intro -> Verse ->
 * Climax -> Outro), natural silent breathing gaps between tracks, and subtle
 * weather-reactive ambient SFX.
 */

import type { DayPhaseId, EventId } from "@dyno/shared/garden";

/** Weather soundscape category mapped from active game events. */
export type WeatherAmbience = "calm" | "rain" | "storm" | "frost" | "night" | "golden" | "wind";

/** Section within a track's 16-bar arrangement. */
export type SongSection = "intro" | "verse" | "climax" | "outro" | "rest";

/** Distinct timbral, rhythmic, and voicing profile assigned to one day phase. */
export interface PhaseMusicProfile {
  readonly phase: DayPhaseId;
  readonly bassWave: OscillatorType;
  readonly bassCutoff: number;
  readonly bassPattern: "sustained" | "bouncy" | "pedal" | "sub";
  readonly chordWave: OscillatorType;
  readonly chordCutoff: number;
  readonly chordSpreadSec: number;
  readonly chordAttackSec: number;
  readonly chordDetuneHz: number;
  readonly chordPulse: boolean;
  readonly melodyWave: OscillatorType;
  readonly melodyCutoff: number;
  readonly melodyEchoGain: number;
  readonly melodyEchoDelaySec: number;
  readonly introOffsets: readonly number[];
  readonly verseOffsets: readonly number[];
  readonly climaxOffsets: readonly number[];
  readonly shakerGain: number;
}

const PHASE_PROFILES: Record<DayPhaseId, PhaseMusicProfile> = {
  dawn: {
    phase: "dawn",
    bassWave: "sine",
    bassCutoff: 750,
    bassPattern: "pedal",
    chordWave: "sine",
    chordCutoff: 2100,
    chordSpreadSec: 0.14,
    chordAttackSec: 0.035,
    chordDetuneHz: 0,
    chordPulse: false,
    melodyWave: "sine",
    melodyCutoff: 2900,
    melodyEchoGain: 0.28,
    melodyEchoDelaySec: 0.28,
    introOffsets: [0.35, 1.55],
    verseOffsets: [0.22, 1.02, 1.82],
    climaxOffsets: [0.15, 0.62, 1.1, 1.58, 2.08],
    shakerGain: 0,
  },
  day: {
    phase: "day",
    bassWave: "triangle",
    bassCutoff: 640,
    bassPattern: "bouncy",
    chordWave: "triangle",
    chordCutoff: 2200,
    chordSpreadSec: 0.025,
    chordAttackSec: 0.025,
    chordDetuneHz: 0,
    chordPulse: true,
    melodyWave: "triangle",
    melodyCutoff: 2400,
    melodyEchoGain: 0,
    melodyEchoDelaySec: 0,
    introOffsets: [0.3, 1.25],
    verseOffsets: [0.22, 0.72, 1.25, 1.75],
    climaxOffsets: [0.18, 0.55, 0.92, 1.32, 1.72, 2.08],
    shakerGain: 0.0085,
  },
  dusk: {
    phase: "dusk",
    bassWave: "triangle",
    bassCutoff: 440,
    bassPattern: "sustained",
    chordWave: "sawtooth",
    chordCutoff: 780,
    chordSpreadSec: 0.085,
    chordAttackSec: 0.18,
    chordDetuneHz: 0.9,
    chordPulse: false,
    melodyWave: "triangle",
    melodyCutoff: 1180,
    melodyEchoGain: 0.16,
    melodyEchoDelaySec: 0.36,
    introOffsets: [0.55, 1.85],
    verseOffsets: [0.45, 1.45, 2.3],
    climaxOffsets: [0.3, 0.95, 1.6, 2.2, 2.75],
    shakerGain: 0,
  },
  night: {
    phase: "night",
    bassWave: "sine",
    bassCutoff: 300,
    bassPattern: "sub",
    chordWave: "sine",
    chordCutoff: 950,
    chordSpreadSec: 0.22,
    chordAttackSec: 0.48,
    chordDetuneHz: 1.6,
    chordPulse: false,
    melodyWave: "sine",
    melodyCutoff: 1550,
    melodyEchoGain: 0.34,
    melodyEchoDelaySec: 0.45,
    introOffsets: [0.95],
    verseOffsets: [0.85, 2.35],
    climaxOffsets: [0.5, 1.4, 2.3, 3.15],
    shakerGain: 0,
  },
};

/**
 * @brief Returns the distinct timbral and rhythmic profile for a day phase.
 * @param phase Active day phase identifier (`dawn`, `day`, `dusk`, `night`).
 * @return Immutable PhaseMusicProfile configuring synthesis for that phase.
 */
export function getPhaseProfile(phase: DayPhaseId): PhaseMusicProfile {
  return PHASE_PROFILES[phase];
}

/** Definition of one procedural chill track bound to a day phase. */
export interface ChillTrack {
  readonly id: string;
  readonly title: string;
  readonly phase: DayPhaseId;
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
  /** Updates the active day phase (`dawn`, `day`, `dusk`, `night`). */
  setPhase(phase: DayPhaseId): void;
  /** Returns the active day phase. */
  getPhase(): DayPhaseId;
  /** Starts or resumes playback (must be called from or after a user gesture). */
  start(): void;
  /** Pauses playback and silences active voices cleanly. */
  stop(): void;
  /** Toggles playback and returns the new playing state. */
  toggle(): boolean;
  /** Advances immediately to the next track in the active phase's playlist. */
  nextTrack(): void;
  /** Updates the active weather event ids to blend subtle ambient SFX. */
  setWeather(events: readonly EventId[]): void;
  /** Returns the currently resolved weather ambience category. */
  getAmbience(): WeatherAmbience;
  /** Releases audio resources permanently on unmount. */
  dispose(): void;
}

/** 12 distinct chill & fresh tracks, 3 dedicated to each phase (`dawn`, `day`, `dusk`, `night`). */
export const CHILL_TRACKS: readonly ChillTrack[] = [
  // --- DAWN (Bình minh: tươi mới, sương sớm, trong trẻo) ---
  {
    id: "morningDew",
    title: "Morning Dew",
    phase: "dawn",
    stepMs: 2700,
    chords: [
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] },
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 293.66] },
      { bass: 73.42, notes: [146.83, 174.61, 220.0, 329.63] },
      { bass: 65.41, notes: [130.81, 196.0, 246.94, 293.66] },
    ],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
  },
  {
    id: "bambooBreeze",
    title: "Bamboo Breeze",
    phase: "dawn",
    stepMs: 2650,
    chords: [
      { bass: 73.42, notes: [146.83, 185.0, 220.0, 277.18] },
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99] },
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 329.63] },
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 392.0] },
    ],
    melody: [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66],
  },
  {
    id: "emeraldBrook",
    title: "Emerald Brook",
    phase: "dawn",
    stepMs: 2750,
    chords: [
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] },
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] },
      { bass: 73.42, notes: [146.83, 174.61, 220.0, 261.63] },
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] },
    ],
    melody: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
  },

  // --- DAY (Ban ngày: rạng rỡ, mát mẻ, tràn sức sống) ---
  {
    id: "sunlitKoi",
    title: "Sunlit Koi",
    phase: "day",
    stepMs: 2400,
    chords: [
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99] },
      { bass: 82.41, notes: [164.81, 196.0, 246.94, 293.66] },
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] },
      { bass: 73.42, notes: [146.83, 196.0, 220.0, 293.66] },
    ],
    melody: [392.0, 440.0, 493.88, 587.33, 659.25, 783.99],
  },
  {
    id: "goldenOrchard",
    title: "Golden Orchard",
    phase: "day",
    stepMs: 2350,
    chords: [
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] },
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 329.63] },
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] },
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 293.66] },
    ],
    melody: [523.25, 659.25, 698.46, 783.99, 880.0, 1046.5],
  },
  {
    id: "terracottaRain",
    title: "Terracotta Breeze",
    phase: "day",
    stepMs: 2450,
    chords: [
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] },
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] },
      { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] },
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] },
    ],
    melody: [440.0, 523.25, 587.33, 659.25, 783.99, 880.0],
  },

  // --- DUSK (Chạng vạng: hoàng hôn ấm áp, lãng mạn) ---
  {
    id: "lanternDusk",
    title: "Lantern Dusk",
    phase: "dusk",
    stepMs: 3250,
    chords: [
      { bass: 82.41, notes: [164.81, 207.65, 246.94, 311.13] },
      { bass: 69.3, notes: [138.59, 164.81, 207.65, 246.94] },
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 415.3] },
      { bass: 123.47, notes: [246.94, 311.13, 369.99, 440.0] },
    ],
    melody: [493.88, 554.37, 659.25, 739.99, 830.61, 987.77],
  },
  {
    id: "cloudburstCalm",
    title: "Cloudburst Calm",
    phase: "dusk",
    stepMs: 3150,
    chords: [
      { bass: 103.83, notes: [207.65, 261.63, 311.13, 392.0] },
      { bass: 87.31, notes: [174.61, 207.65, 261.63, 311.13] },
      { bass: 69.3, notes: [138.59, 174.61, 207.65, 261.63] },
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 311.13] },
    ],
    melody: [415.3, 466.16, 523.25, 622.25, 698.46, 830.61],
  },
  {
    id: "amberSunset",
    title: "Amber Sunset",
    phase: "dusk",
    stepMs: 3200,
    chords: [
      { bass: 73.42, notes: [146.83, 185.0, 220.0, 277.18] },
      { bass: 61.74, notes: [123.47, 146.83, 185.0, 220.0] },
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99] },
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 369.99] },
    ],
    melody: [440.0, 493.88, 554.37, 659.25, 739.99, 880.0],
  },

  // --- NIGHT (Đêm: sâu lắng, huyền ảo, thư giãn) ---
  {
    id: "starlightSoil",
    title: "Starlight Soil",
    phase: "night",
    stepMs: 3750,
    chords: [
      { bass: 116.54, notes: [233.08, 293.66, 349.23, 440.0] },
      { bass: 98.0, notes: [196.0, 233.08, 293.66, 349.23] },
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 293.66] },
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 349.23] },
    ],
    melody: [466.16, 523.25, 587.33, 698.46, 783.99, 932.33],
  },
  {
    id: "mistyGreenhouse",
    title: "Misty Greenhouse",
    phase: "night",
    stepMs: 3850,
    chords: [
      { bass: 77.78, notes: [155.56, 196.0, 233.08, 293.66] },
      { bass: 69.3, notes: [138.59, 174.61, 207.65, 261.63] },
      { bass: 65.41, notes: [130.81, 155.56, 196.0, 233.08] },
      { bass: 116.54, notes: [233.08, 293.66, 349.23, 415.3] },
    ],
    melody: [466.16, 523.25, 587.33, 698.46, 783.99, 932.33],
  },
  {
    id: "midnightLotus",
    title: "Midnight Lotus",
    phase: "night",
    stepMs: 3950,
    chords: [
      { bass: 92.5, notes: [185.0, 220.0, 277.18, 329.63] },
      { bass: 73.42, notes: [146.83, 185.0, 220.0, 277.18] },
      { bass: 110.0, notes: [220.0, 277.18, 329.63, 415.3] },
      { bass: 82.41, notes: [164.81, 207.65, 246.94, 329.63] },
    ],
    melody: [440.0, 493.88, 554.37, 659.25, 739.99, 880.0],
  },
];

const BARS_PER_TRACK = 16;
const REST_BARS_BETWEEN_TRACKS = 5;

/**
 * @brief Returns the tracks belonging to one day phase (`dawn`, `day`, `dusk`, `night`).
 * @param phase Active day phase identifier.
 * @return Non-empty list of ChillTrack entries for that phase.
 */
export function tracksForPhase(phase: DayPhaseId): readonly ChillTrack[] {
  const list = CHILL_TRACKS.filter((track) => track.phase === phase);
  return list.length > 0 ? list : CHILL_TRACKS;
}

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
 * @brief Creates a procedural phase-aware rotating chill ambient soundtrack player.
 * @return A ChillMusicPlayer handle safe to call in both browsers and tests.
 */
export function createChillMusicPlayer(): ChillMusicPlayer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let playing = false;
  let phase: DayPhaseId = "day";
  let trackIndex = 0;
  let barInCycle = 0;
  let ambience: WeatherAmbience = "calm";

  /**
   * @brief Returns the active track for the current phase and rotation index.
   */
  function currentTrack(): ChillTrack {
    const list = tracksForPhase(phase);
    return list[trackIndex % list.length] ?? list[0]!;
  }

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
   * @brief Schedules one soft tone with configurable attack and warm lowpass filtering.
   * @param freq Fundamental frequency in Hz.
   * @param startTime AudioContext timestamp to start.
   * @param duration Tone duration in seconds.
   * @param peakGain Maximum envelope gain.
   * @param type Oscillator waveform type.
   * @param cutoff Lowpass filter cutoff frequency in Hz.
   * @param attackSec Envelope attack duration in seconds.
   */
  function playTone(
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType,
    cutoff = 1400,
    attackSec = 0.08,
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

    const safeAttack = Math.min(attackSec, duration * 0.45);
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + safeAttack);
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
    timer = setInterval(scheduleBar, currentTrack().stepMs);
  }

  /**
   * @brief Schedules the phase-specific bass voice for one bar.
   */
  function schedulePhaseBass(
    profile: PhaseMusicProfile,
    bassFreq: number,
    now: number,
    stepSec: number,
    isClimax: boolean,
    isIntroOrOutro: boolean,
  ): void {
    const baseGain = isClimax ? 0.16 : isIntroOrOutro ? 0.085 : 0.125;
    if (profile.bassPattern === "bouncy") {
      playTone(bassFreq, now, stepSec * 0.42, baseGain, profile.bassWave, profile.bassCutoff, 0.03);
      playTone(
        bassFreq * 1.5,
        now + stepSec * 0.5,
        stepSec * 0.42,
        baseGain * 0.78,
        profile.bassWave,
        profile.bassCutoff,
        0.03,
      );
      return;
    }
    if (profile.bassPattern === "sub") {
      playTone(bassFreq, now, stepSec * 1.05, baseGain * 0.9, profile.bassWave, profile.bassCutoff, 0.32);
      return;
    }
    if (profile.bassPattern === "pedal") {
      playTone(bassFreq, now, stepSec * 0.85, baseGain * 0.72, profile.bassWave, profile.bassCutoff, 0.06);
      if (isClimax) {
        playTone(bassFreq * 2, now + stepSec * 0.5, stepSec * 0.45, 0.04, "sine", 1100, 0.04);
      }
      return;
    }
    playTone(bassFreq, now, stepSec * 0.95, baseGain, profile.bassWave, profile.bassCutoff, 0.14);
    if (isClimax) {
      playTone(bassFreq * 2, now + stepSec * 0.5, stepSec * 0.45, 0.05, "sine", 850, 0.08);
    }
  }

  /**
   * @brief Schedules the phase-specific chord voicing and pad/arpeggio texture for one bar.
   */
  function schedulePhaseChords(
    profile: PhaseMusicProfile,
    notes: readonly number[],
    now: number,
    stepSec: number,
    isClimax: boolean,
    isIntroOrOutro: boolean,
  ): void {
    const chordGain = isClimax ? 0.065 : isIntroOrOutro ? 0.036 : 0.05;
    const cutoff = isClimax ? profile.chordCutoff * 1.3 : profile.chordCutoff;
    notes.forEach((freq, idx) => {
      const start = now + idx * profile.chordSpreadSec;
      const dur = profile.chordPulse ? stepSec * 0.42 : stepSec * 0.96;
      playTone(freq, start, dur, chordGain, profile.chordWave, cutoff, profile.chordAttackSec);
      if (profile.chordDetuneHz > 0) {
        playTone(
          freq + profile.chordDetuneHz,
          start,
          stepSec * 1.05,
          chordGain * 0.5,
          "sine",
          cutoff,
          profile.chordAttackSec,
        );
      }
      if (profile.chordPulse) {
        playTone(
          freq,
          now + stepSec * 0.52 + idx * 0.018,
          stepSec * 0.38,
          chordGain * 0.72,
          profile.chordWave,
          cutoff,
          0.025,
        );
      }
      if (isClimax && idx >= 2 && profile.phase !== "night") {
        playTone(freq * 2, start + 0.05, stepSec * 0.65, 0.02, "sine", 2400, 0.06);
      }
    });
  }

  /**
   * @brief Schedules the phase-specific melody contour, rhythm, and optional echo tail.
   */
  function schedulePhaseMelody(
    profile: PhaseMusicProfile,
    melody: readonly number[],
    now: number,
    stepSec: number,
    section: SongSection,
  ): void {
    const isClimax = section === "climax";
    const isIntroOrOutro = section === "intro" || section === "outro";
    const offsets = isClimax
      ? profile.climaxOffsets
      : isIntroOrOutro
        ? profile.introOffsets
        : profile.verseOffsets;
    const melGain = isClimax ? 0.042 : 0.027;
    const melDur = profile.phase === "night" ? 1.7 : profile.phase === "day" ? 0.55 : 0.95;

    offsets.forEach((offset, idx) => {
      if (offset >= stepSec - 0.15) return;
      const noteIdx = (barInCycle * 3 + idx * 2) % melody.length;
      const freq = melody[noteIdx] ?? 523.25;
      playTone(
        freq,
        now + offset,
        isClimax ? melDur * 1.15 : melDur,
        melGain,
        profile.melodyWave,
        isClimax ? profile.melodyCutoff * 1.2 : profile.melodyCutoff,
        profile.phase === "night" ? 0.12 : 0.035,
      );
      if (profile.melodyEchoGain > 0 && offset + profile.melodyEchoDelaySec < stepSec - 0.1) {
        playTone(
          freq,
          now + offset + profile.melodyEchoDelaySec,
          melDur * 0.9,
          melGain * profile.melodyEchoGain,
          "sine",
          profile.melodyCutoff * 0.85,
          0.05,
        );
      }
    });
  }

  /**
   * @brief Schedules one bar according to the 16-bar arrangement and active day phase profile.
   */
  function scheduleBar(): void {
    if (!playing) return;
    const track = currentTrack();
    const profile = getPhaseProfile(phase);
    const section = sectionForBar(barInCycle);
    const stepSec = track.stepMs / 1000;

    if (ctx !== null && master !== null) {
      const now = ctx.currentTime + 0.05;
      scheduleWeatherLayer(now, stepSec);

      if (section !== "rest") {
        const chord = track.chords[barInCycle % track.chords.length] ?? track.chords[0]!;
        const isClimax = section === "climax";
        const isIntroOrOutro = section === "intro" || section === "outro";

        schedulePhaseBass(profile, chord.bass, now, stepSec, isClimax, isIntroOrOutro);
        schedulePhaseChords(profile, chord.notes, now, stepSec, isClimax, isIntroOrOutro);
        schedulePhaseMelody(profile, track.melody, now, stepSec, section);

        if (profile.shakerGain > 0 && !isIntroOrOutro) {
          [0.25, 0.5, 0.75].forEach((frac) => {
            playNoiseSwell(now + stepSec * frac, 0.14, "highpass", 4200, 0.9, profile.shakerGain);
          });
        }
      }
    }

    barInCycle += 1;
    if (barInCycle >= BARS_PER_TRACK + REST_BARS_BETWEEN_TRACKS) {
      barInCycle = 0;
      const list = tracksForPhase(phase);
      trackIndex = (trackIndex + 1) % list.length;
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
      return currentTrack().title;
    },

    getSection(): SongSection {
      return sectionForBar(barInCycle);
    },

    setPhase(nextPhase: DayPhaseId): void {
      if (phase === nextPhase) return;
      phase = nextPhase;
      trackIndex = 0;
      barInCycle = 0;
      if (playing) restartTimer();
    },

    getPhase(): DayPhaseId {
      return phase;
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
      const list = tracksForPhase(phase);
      trackIndex = (trackIndex + 1) % list.length;
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
