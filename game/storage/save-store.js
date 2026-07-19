// @ts-check

import { LEVELS } from "../levels/levels.js";

export const SAVE_KEY = "cat-garden-defense.save.v1";
export const SAVE_VERSION = 2;

const LEVEL_IDS = Object.freeze(["level-1", "level-2", "level-3"]);
const CAT_IDS = Object.freeze([
  "bubble-sprout",
  "sunny-bloom",
  "shell-guard",
  "twin-berry",
  "frost-bloom",
  "pop-burst",
  "leaf-beast",
  "bulb-guide",
]);
const STARTER_CAT_IDS = Object.freeze(["bubble-sprout", "sunny-bloom", "shell-guard"]);
const DOG_IDS = Object.freeze([
  "stray-dog",
  "cone-dog",
  "bucket-dog",
  "gate-dog",
  "brute-dog",
]);

/**
 * @typedef {object} SaveSettings
 * @property {number} musicVolume
 * @property {number} sfxVolume
 * @property {boolean} masterMuted
 * @property {boolean} reducedMotion
 * @property {boolean} screenShake
 *
 * @typedef {object} CampaignProgress
 * @property {number} highestUnlockedLevel
 * @property {string | null} lastCompletedLevel
 * @property {boolean} hasStarted
 *
 * @typedef {object} SaveData
 * @property {number} version
 * @property {string[]} completedLevels
 * @property {string[]} unlockedCats
 * @property {string[]} encounteredDogs
 * @property {SaveSettings} settings
 * @property {CampaignProgress} campaignProgress
 * @property {string} lastSelectedLevel
 *
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * Creates independent arrays and nested objects so callers can freely update
 * a new save without mutating the exported template.
 *
 * @returns {SaveData}
 */
export function createDefaultSave() {
  return {
    version: SAVE_VERSION,
    completedLevels: [],
    unlockedCats: [...STARTER_CAT_IDS],
    encounteredDogs: [],
    settings: {
      musicVolume: 0.65,
      sfxVolume: 0.8,
      masterMuted: false,
      reducedMotion: false,
      screenShake: true,
    },
    campaignProgress: {
      highestUnlockedLevel: 1,
      lastCompletedLevel: null,
      hasStarted: false,
    },
    lastSelectedLevel: "level-1",
  };
}

/** @type {Readonly<SaveData>} */
export const DEFAULT_SAVE = Object.freeze({
  ...createDefaultSave(),
  completedLevels: Object.freeze([]),
  unlockedCats: Object.freeze([...STARTER_CAT_IDS]),
  encounteredDogs: Object.freeze([]),
  settings: Object.freeze(createDefaultSave().settings),
  campaignProgress: Object.freeze(createDefaultSave().campaignProgress),
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @returns {string[]}
 */
function cleanIdList(value, allowed) {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(allowed);
  return [...new Set(value.filter((entry) => typeof entry === "string" && allowedIds.has(entry)))];
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function cleanVolume(value, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function cleanBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Parses JSON or a plain object and repairs every field independently. Invalid
 * JSON, incorrect types, stale identifiers, and out-of-range settings recover
 * to safe defaults instead of preventing the game from opening.
 *
 * @param {unknown} raw
 * @returns {SaveData}
 */
export function parseSaveData(raw) {
  const defaults = createDefaultSave();
  /** @type {unknown} */
  let decoded = raw;

  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }

  if (!isRecord(decoded)) return defaults;

  const completedLevels = cleanIdList(decoded.completedLevels, LEVEL_IDS);
  const parsedUnlockedCats = cleanIdList(decoded.unlockedCats, CAT_IDS);
  const earnedCats = LEVELS
    .filter((level) => completedLevels.includes(level.id))
    .flatMap((level) => [...level.availableDefenders, ...level.unlocks]);
  const unlockedCats = [...new Set([...STARTER_CAT_IDS, ...earnedCats, ...parsedUnlockedCats])];
  const encounteredDogs = cleanIdList(decoded.encounteredDogs, DOG_IDS);
  const settingsSource = isRecord(decoded.settings) ? decoded.settings : {};
  const campaignSource = isRecord(decoded.campaignProgress) ? decoded.campaignProgress : {};

  const mutedCandidate =
    settingsSource.masterMuted ?? settingsSource.masterMute ?? settingsSource.muted;
  const settings = {
    musicVolume: cleanVolume(settingsSource.musicVolume, defaults.settings.musicVolume),
    sfxVolume: cleanVolume(settingsSource.sfxVolume, defaults.settings.sfxVolume),
    masterMuted: cleanBoolean(mutedCandidate, defaults.settings.masterMuted),
    reducedMotion: cleanBoolean(
      settingsSource.reducedMotion,
      defaults.settings.reducedMotion,
    ),
    screenShake: cleanBoolean(settingsSource.screenShake, defaults.settings.screenShake),
  };

  const completedHighest = completedLevels.reduce((highest, levelId) => {
    const completedNumber = LEVEL_IDS.indexOf(levelId) + 1;
    return Math.max(highest, Math.min(LEVEL_IDS.length, completedNumber + 1));
  }, 1);
  const suppliedHighest =
    typeof campaignSource.highestUnlockedLevel === "number" &&
    Number.isFinite(campaignSource.highestUnlockedLevel)
      ? Math.trunc(campaignSource.highestUnlockedLevel)
      : 1;
  const highestUnlockedLevel = Math.max(
    completedHighest,
    Math.min(LEVEL_IDS.length, Math.max(1, suppliedHighest)),
  );

  const suppliedLastCompleted = campaignSource.lastCompletedLevel;
  const lastCompletedLevel =
    typeof suppliedLastCompleted === "string" && completedLevels.includes(suppliedLastCompleted)
      ? suppliedLastCompleted
      : completedLevels.at(-1) ?? null;

  const selectedCandidate = decoded.lastSelectedLevel;
  const selectedIndex =
    typeof selectedCandidate === "string" ? LEVEL_IDS.indexOf(selectedCandidate) : -1;
  const lastSelectedLevel =
    selectedIndex >= 0 && selectedIndex < highestUnlockedLevel
      ? LEVEL_IDS[selectedIndex]
      : defaults.lastSelectedLevel;
  const inferredStarted = completedLevels.length > 0 || encounteredDogs.length > 0 || selectedIndex > 0 || highestUnlockedLevel > 1;
  const hasStarted = cleanBoolean(campaignSource.hasStarted, false) || inferredStarted;

  return {
    version: SAVE_VERSION,
    completedLevels,
    unlockedCats,
    encounteredDogs,
    settings,
    campaignProgress: { highestUnlockedLevel, lastCompletedLevel, hasStarted },
    lastSelectedLevel,
  };
}

/** @returns {StorageLike | null} */
function resolveStorage() {
  try {
    if ("localStorage" in globalThis && globalThis.localStorage) {
      return /** @type {StorageLike} */ (globalThis.localStorage);
    }
  } catch {
    // Storage access can be blocked by privacy settings or an opaque origin.
  }
  return null;
}

/**
 * @param {StorageLike | null} [storage]
 * @param {string} [key]
 * @returns {SaveData}
 */
export function loadSave(storage = resolveStorage(), key = SAVE_KEY) {
  if (!storage) return createDefaultSave();
  try {
    return parseSaveData(storage.getItem(key));
  } catch {
    return createDefaultSave();
  }
}

/**
 * Writes a sanitized save. A false result means storage was unavailable or
 * rejected the write; gameplay can safely continue with in-memory state.
 *
 * @param {unknown} value
 * @param {StorageLike | null} [storage]
 * @param {string} [key]
 * @returns {boolean}
 */
export function saveSave(value, storage = resolveStorage(), key = SAVE_KEY) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(parseSaveData(value)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes persisted progress and returns a fresh default value for immediate
 * use by the caller.
 *
 * @param {StorageLike | null} [storage]
 * @param {string} [key]
 * @returns {SaveData}
 */
export function resetSave(storage = resolveStorage(), key = SAVE_KEY) {
  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // Returning a clean in-memory state is still useful if removal is denied.
    }
  }
  return createDefaultSave();
}

export const loadProgress = loadSave;
export const saveProgress = saveSave;
export const resetProgress = resetSave;
