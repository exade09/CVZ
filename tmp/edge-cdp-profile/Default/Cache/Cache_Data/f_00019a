// @ts-check

/**
 * @typedef {Object} AudioSettings
 * @property {number} [musicVolume]
 * @property {number} [sfxVolume]
 * @property {number} [masterVolume]
 * @property {boolean} [muted]
 * @property {boolean} [masterMuted]
 * @property {boolean} [masterMute]
 * @property {boolean} [mute]
 */

/** @typedef {'menu' | 'game'} MusicTheme */

const DEFAULT_SETTINGS = Object.freeze({
  musicVolume: 0.45,
  sfxVolume: 0.72,
  masterVolume: 1,
  muted: false,
  masterMuted: false,
});

const MUSIC_THEMES = Object.freeze({
  menu: Object.freeze({
    tempo: 86,
    type: 'sine',
    notes: Object.freeze([523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46]),
    bass: Object.freeze([130.81, 146.83, 164.81, 146.83]),
  }),
  game: Object.freeze({
    tempo: 112,
    type: 'triangle',
    notes: Object.freeze([392, 523.25, 587.33, 523.25, 440, 587.33, 659.25, 587.33]),
    bass: Object.freeze([98, 110, 130.81, 110]),
  }),
});

/**
 * Clamp a possible volume value while preserving the current value for invalid input.
 * @param {unknown} value
 * @param {number} current
 * @returns {number}
 */
function readVolume(value, current) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : current;
}

/**
 * @param {AudioParam} parameter
 * @param {number} value
 * @param {number} time
 * @param {boolean} immediate
 */
function setAudioParam(parameter, value, time, immediate) {
  try {
    parameter.cancelScheduledValues(time);
    if (immediate) {
      parameter.setValueAtTime(value, time);
    } else {
      parameter.setTargetAtTime(value, time, 0.018);
    }
  } catch {
    parameter.value = value;
  }
}

/**
 * A small procedural audio engine. It intentionally uses Web Audio synthesis only,
 * so the game has no external audio dependency and remains playable without sound.
 */
export class AudioManager {
  /**
   * @param {AudioSettings} [settings]
   */
  constructor(settings = {}) {
    /** @type {{musicVolume: number, sfxVolume: number, masterVolume: number, muted: boolean, masterMuted: boolean}} */
    this.settings = { ...DEFAULT_SETTINGS };

    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.masterGain = null;
    /** @type {GainNode | null} */
    this.musicGain = null;
    /** @type {GainNode | null} */
    this.sfxGain = null;

    /** @type {MusicTheme | null} */
    this.musicTheme = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.musicTimer = null;
    this.musicStep = 0;
    this.nextMusicTime = 0;

    /** @type {Set<AudioScheduledSourceNode>} */
    this.musicSources = new Set();
    /** @type {Set<AudioScheduledSourceNode>} */
    this.sfxSources = new Set();
    this.lastSfxAt = new Map();

    this.suspendedByApp = false;
    this.destroyed = false;
    this.setSettings(settings);
  }

  /**
   * Create and resume the audio graph after a user gesture.
   * @returns {Promise<boolean>}
   */
  async unlock() {
    if (this.destroyed || this.suspendedByApp) return false;

    const context = this.ensureContext();
    if (!context) return false;

    try {
      if (context.state === 'suspended') await context.resume();
    } catch {
      return false;
    }

    if (!this.suspendedByApp && this.musicTheme) this.startMusicPlayback();
    return context.state !== 'closed';
  }

  /**
   * Apply partial audio settings.
   * @param {AudioSettings} [settings]
   * @returns {{musicVolume: number, sfxVolume: number, masterVolume: number, muted: boolean, masterMuted: boolean}}
   */
  setSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const current = this.settings;

    let muted = current.muted;
    if (typeof source.muted === 'boolean') muted = source.muted;
    else if (typeof source.masterMuted === 'boolean') muted = source.masterMuted;
    else if (typeof source.masterMute === 'boolean') muted = source.masterMute;
    else if (typeof source.mute === 'boolean') muted = source.mute;

    this.settings = {
      musicVolume: readVolume(source.musicVolume, current.musicVolume),
      sfxVolume: readVolume(source.sfxVolume, current.sfxVolume),
      masterVolume: readVolume(source.masterVolume, current.masterVolume),
      muted,
      masterMuted: muted,
    };

    this.applySettings(false);
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.musicVolume <= 0) {
      this.stopMusicPlayback();
    } else if (this.musicTheme && !this.suspendedByApp) {
      this.startMusicPlayback();
    }
    return { ...this.settings };
  }

  /**
   * Start or switch the procedural music loop.
   * @param {MusicTheme} [theme]
   * @returns {boolean}
   */
  playMusic(theme = 'menu') {
    if (this.destroyed) return false;

    const nextTheme = theme === 'game' ? 'game' : 'menu';
    const changed = this.musicTheme !== nextTheme;
    this.musicTheme = nextTheme;

    const context = this.ensureContext();
    if (!context) return false;
    if (this.suspendedByApp) return true;
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.musicVolume <= 0) {
      this.stopMusicPlayback();
      return true;
    }

    if (context.state === 'suspended') {
      void context.resume().then(() => {
        if (!this.destroyed && !this.suspendedByApp) this.startMusicPlayback();
      }).catch(() => {});
    }

    if (changed) this.stopMusicPlayback();
    this.startMusicPlayback();
    return true;
  }

  /** Stop music while leaving sound effects available. */
  stopMusic() {
    this.musicTheme = null;
    this.stopMusicPlayback();
  }

  /**
   * Play a short generated sound effect.
   * @param {string} name
   * @returns {boolean}
   */
  playSfx(name) {
    if (
      this.destroyed ||
      this.suspendedByApp ||
      this.settings.muted ||
      this.settings.masterVolume <= 0 ||
      this.settings.sfxVolume <= 0 ||
      this.sfxSources.size >= 24
    ) return false;

    const key = String(name || 'button').toLowerCase().replace(/[^a-z0-9]/g, '');
    const throttleMs = ['hit', 'damage', 'projectilehit'].includes(key)
      ? 34
      : ['projectile', 'shoot', 'fire', 'projectileshoot'].includes(key)
        ? 28
        : 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (throttleMs > 0 && now - Number(this.lastSfxAt.get(key) ?? -Infinity) < throttleMs) return false;
    this.lastSfxAt.set(key, now);

    const context = this.ensureContext();
    if (!context || !this.sfxGain) return false;

    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }

    switch (key) {
      case 'hover':
        this.tone({ frequency: 720, endFrequency: 790, duration: 0.045, volume: 0.08, type: 'sine' });
        break;
      case 'button':
      case 'click':
      case 'select':
      case 'buttonclick':
      case 'uiselect':
        this.tone({ frequency: 430, endFrequency: 620, duration: 0.09, volume: 0.16, type: 'triangle' });
        break;
      case 'place':
      case 'placement':
      case 'catplace':
      case 'catplacement':
        this.tone({ frequency: 260, endFrequency: 390, duration: 0.13, volume: 0.2, type: 'triangle' });
        this.tone({ frequency: 520, duration: 0.1, delay: 0.035, volume: 0.11, type: 'sine' });
        break;
      case 'energy':
      case 'collect':
      case 'pawenergy':
      case 'energycollect':
      case 'pawenergycollect':
        this.playSequence([620, 830, 1040], 0.055, 0.12, 'sine');
        break;
      case 'projectile':
      case 'shoot':
      case 'fire':
      case 'projectileshoot':
        this.tone({ frequency: 540, endFrequency: 260, duration: 0.075, volume: 0.11, type: 'triangle' });
        break;
      case 'hit':
      case 'damage':
      case 'projectilehit':
        this.noise({ duration: 0.055, volume: 0.1, filterFrequency: 1150 });
        this.tone({ frequency: 150, endFrequency: 95, duration: 0.07, volume: 0.12, type: 'square' });
        break;
      case 'armorbreak':
      case 'armorbroken':
        this.noise({ duration: 0.18, volume: 0.2, filterFrequency: 2500 });
        this.tone({ frequency: 920, endFrequency: 210, duration: 0.2, volume: 0.16, type: 'square' });
        break;
      case 'shieldbreak':
      case 'shieldbroken':
        this.noise({ duration: 0.22, volume: 0.16, filterFrequency: 3900 });
        this.playSequence([980, 760, 520], 0.045, 0.1, 'triangle');
        break;
      case 'wave':
      case 'wavewarning':
      case 'warning':
      case 'finalwave':
        this.playSequence([330, 330, 440], 0.15, 0.18, 'square');
        break;
      case 'victory':
        this.playSequence([523.25, 659.25, 783.99, 1046.5], 0.11, 0.2, 'triangle');
        break;
      case 'defeat':
        this.playSequence([392, 329.63, 261.63, 196], 0.14, 0.18, 'sine');
        break;
      default:
        this.tone({ frequency: 460, endFrequency: 560, duration: 0.075, volume: 0.12, type: 'sine' });
        break;
    }

    return true;
  }

  /**
   * Pause all audio without forgetting the selected music theme.
   * @returns {Promise<boolean>}
   */
  async suspend() {
    if (this.destroyed) return false;
    this.suspendedByApp = true;
    this.stopMusicPlayback();
    this.stopSources(this.sfxSources);
    this.lastSfxAt.clear();

    const context = this.context;
    if (!context || context.state === 'closed') return false;

    try {
      if (context.state === 'running') await context.suspend();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resume audio and restart the selected music theme.
   * @returns {Promise<boolean>}
   */
  async resume() {
    if (this.destroyed) return false;
    this.suspendedByApp = false;

    const available = await this.unlock();
    if (available && this.musicTheme) this.startMusicPlayback();
    return available;
  }

  /** Release timers, sources, nodes, and the audio context. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.musicTheme = null;
    this.stopMusicPlayback();
    this.stopSources(this.sfxSources);
    this.lastSfxAt.clear();

    const context = this.context;
    for (const node of [this.musicGain, this.sfxGain, this.masterGain]) {
      try {
        node?.disconnect();
      } catch {
        // A disconnected node needs no further cleanup.
      }
    }

    this.musicGain = null;
    this.sfxGain = null;
    this.masterGain = null;
    this.context = null;

    if (context && context.state !== 'closed') {
      void context.close().catch(() => {});
    }
  }

  /**
   * @returns {AudioContext | null}
   */
  ensureContext() {
    if (this.context && this.context.state !== 'closed') return this.context;
    if (this.destroyed) return null;

    const scope = /** @type {typeof globalThis & {webkitAudioContext?: typeof AudioContext}} */ (globalThis);
    const AudioContextClass = scope.AudioContext || scope.webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
      const context = new AudioContextClass();
      const masterGain = context.createGain();
      const musicGain = context.createGain();
      const sfxGain = context.createGain();

      musicGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(context.destination);

      this.context = context;
      this.masterGain = masterGain;
      this.musicGain = musicGain;
      this.sfxGain = sfxGain;
      this.applySettings(true);
      return context;
    } catch {
      this.context = null;
      this.masterGain = null;
      this.musicGain = null;
      this.sfxGain = null;
      return null;
    }
  }

  /**
   * @param {boolean} immediate
   */
  applySettings(immediate) {
    const context = this.context;
    if (!context) return;

    const time = context.currentTime;
    if (this.masterGain) {
      const masterVolume = this.settings.muted ? 0 : this.settings.masterVolume;
      setAudioParam(this.masterGain.gain, masterVolume, time, immediate);
    }
    if (this.musicGain) {
      setAudioParam(this.musicGain.gain, this.settings.musicVolume, time, immediate);
    }
    if (this.sfxGain) {
      setAudioParam(this.sfxGain.gain, this.settings.sfxVolume, time, immediate);
    }
  }

  startMusicPlayback() {
    const context = this.context;
    if (!context || !this.musicGain || !this.musicTheme || this.suspendedByApp || this.destroyed) return;
    if (this.musicTimer !== null) return;

    this.musicStep = 0;
    this.nextMusicTime = context.currentTime + 0.04;
    this.scheduleMusic();
    this.musicTimer = setInterval(() => this.scheduleMusic(), 180);
  }

  scheduleMusic() {
    const context = this.context;
    const themeName = this.musicTheme;
    if (!context || !themeName || context.state === 'closed' || this.suspendedByApp) return;

    const theme = MUSIC_THEMES[themeName];
    const stepDuration = 30 / theme.tempo;
    const lookAhead = context.currentTime + 0.75;

    while (this.nextMusicTime < lookAhead) {
      const index = this.musicStep % theme.notes.length;
      const note = theme.notes[index];
      this.tone({
        frequency: note,
        duration: stepDuration * 0.82,
        volume: themeName === 'game' ? 0.09 : 0.075,
        type: theme.type,
        at: this.nextMusicTime,
      }, true);

      if (this.musicStep % 4 === 0) {
        const bassIndex = Math.floor(this.musicStep / 4) % theme.bass.length;
        this.tone({
          frequency: theme.bass[bassIndex],
          duration: stepDuration * 3.3,
          volume: 0.065,
          type: 'sine',
          at: this.nextMusicTime,
        }, true);
      }

      this.musicStep += 1;
      this.nextMusicTime += stepDuration;
    }
  }

  stopMusicPlayback() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.stopSources(this.musicSources);
    this.musicStep = 0;
    this.nextMusicTime = 0;
  }

  /**
   * @param {number[]} notes
   * @param {number} spacing
   * @param {number} volume
   * @param {OscillatorType} type
   */
  playSequence(notes, spacing, volume, type) {
    notes.forEach((frequency, index) => {
      this.tone({ frequency, duration: spacing * 1.5, delay: index * spacing, volume, type });
    });
  }

  /**
   * @param {{frequency: number, endFrequency?: number, duration: number, delay?: number, volume: number, type: OscillatorType, at?: number}} options
   * @param {boolean} [music]
   */
  tone(options, music = false) {
    const context = this.context;
    const destination = music ? this.musicGain : this.sfxGain;
    if (!context || !destination || context.state === 'closed') return;

    try {
      const start = Math.max(context.currentTime, options.at ?? (context.currentTime + (options.delay || 0)));
      const duration = Math.max(0.025, options.duration);
      const end = start + duration;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = options.type;
      oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), start);
      if (options.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), end);
      }

      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.volume), start + Math.min(0.018, duration * 0.25));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(envelope);
      envelope.connect(destination);

      const sources = music ? this.musicSources : this.sfxSources;
      this.trackSource(oscillator, sources, [envelope]);
      oscillator.start(start);
      oscillator.stop(end + 0.025);
    } catch {
      // Sound is an enhancement; synthesis failure must never interrupt gameplay.
    }
  }

  /**
   * @param {{duration: number, volume: number, filterFrequency: number}} options
   */
  noise(options) {
    const context = this.context;
    if (!context || !this.sfxGain || context.state === 'closed') return;

    try {
      const duration = Math.max(0.03, options.duration);
      const frames = Math.max(1, Math.floor(context.sampleRate * duration));
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const samples = buffer.getChannelData(0);

      for (let index = 0; index < frames; index += 1) {
        const decay = 1 - index / frames;
        samples[index] = (Math.random() * 2 - 1) * decay;
      }

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      const start = context.currentTime;
      const end = start + duration;

      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(options.filterFrequency, start);
      filter.Q.setValueAtTime(0.7, start);
      envelope.gain.setValueAtTime(Math.max(0.0001, options.volume), start);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);

      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.sfxGain);

      this.trackSource(source, this.sfxSources, [filter, envelope]);
      source.start(start);
      source.stop(end + 0.02);
    } catch {
      // Ignore optional noise synthesis failures.
    }
  }

  /**
   * @param {AudioScheduledSourceNode} source
   * @param {Set<AudioScheduledSourceNode>} collection
   * @param {AudioNode[]} relatedNodes
   */
  trackSource(source, collection, relatedNodes) {
    collection.add(source);
    source.addEventListener('ended', () => {
      collection.delete(source);
      try {
        source.disconnect();
      } catch {
        // The source may already be disconnected during teardown.
      }
      for (const node of relatedNodes) {
        try {
          node.disconnect();
        } catch {
          // The related node may already be disconnected during teardown.
        }
      }
    }, { once: true });
  }

  /**
   * @param {Set<AudioScheduledSourceNode>} collection
   */
  stopSources(collection) {
    for (const source of collection) {
      try {
        source.stop();
      } catch {
        // A source that already ended needs no further work.
      }
    }
    collection.clear();
  }
}

export default AudioManager;
