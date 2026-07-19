// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  SAVE_KEY,
  SAVE_VERSION,
  createDefaultSave,
  loadSave,
  parseSaveData,
  resetSave,
  saveSave,
} from "../storage/save-store.js";

test("malformed JSON and invalid root values recover a fresh default", () => {
  assert.deepEqual(parseSaveData("{not valid json"), createDefaultSave());
  assert.deepEqual(parseSaveData(null), createDefaultSave());
  assert.deepEqual(parseSaveData([]), createDefaultSave());
});

test("save parser keeps valid progress and repairs unsafe fields", () => {
  const parsed = parseSaveData({
    version: -50,
    completedLevels: ["level-1", "missing-level", "level-1", 4],
    unlockedCats: ["twin-berry", "unknown-cat", "twin-berry"],
    encounteredDogs: ["stray-dog", "unknown-dog"],
    settings: {
      musicVolume: 4,
      sfxVolume: -2,
      muted: true,
      reducedMotion: "yes",
      screenShake: false,
    },
    campaignProgress: {
      highestUnlockedLevel: 99,
      lastCompletedLevel: "missing-level",
    },
    lastSelectedLevel: "level-3",
  });

  assert.equal(parsed.version, SAVE_VERSION);
  assert.deepEqual(parsed.completedLevels, ["level-1"]);
  assert.deepEqual(parsed.unlockedCats, [
    "bubble-sprout",
    "sunny-bloom",
    "shell-guard",
    "twin-berry",
    "frost-bloom",
  ]);
  assert.deepEqual(parsed.encounteredDogs, ["stray-dog"]);
  assert.deepEqual(parsed.settings, {
    musicVolume: 1,
    sfxVolume: 0,
    masterMuted: true,
    reducedMotion: false,
    screenShake: false,
  });
  assert.deepEqual(parsed.campaignProgress, {
    highestUnlockedLevel: 3,
    lastCompletedLevel: "level-1",
    hasStarted: true,
  });
  assert.equal(parsed.lastSelectedLevel, "level-3");
});

test("missing nested save fields recover independently", () => {
  const parsed = parseSaveData(JSON.stringify({
    completedLevels: ["level-1", "level-2"],
    settings: { musicVolume: 0.25 },
  }));
  assert.equal(parsed.settings.musicVolume, 0.25);
  assert.equal(parsed.settings.sfxVolume, createDefaultSave().settings.sfxVolume);
  assert.equal(parsed.campaignProgress.highestUnlockedLevel, 3);
  assert.equal(parsed.campaignProgress.hasStarted, true);
  assert.equal(parsed.lastSelectedLevel, "level-1");
  assert.deepEqual(parsed.unlockedCats, [
    "bubble-sprout",
    "sunny-bloom",
    "shell-guard",
    "twin-berry",
    "frost-bloom",
    "pop-burst",
    "leaf-beast",
    "bulb-guide",
  ]);
});

test("legacy and partial saves infer whether a campaign can continue", () => {
  assert.equal(createDefaultSave().campaignProgress.hasStarted, false);
  assert.equal(parseSaveData({ version: 1, encounteredDogs: ["stray-dog"] }).campaignProgress.hasStarted, true);
  assert.equal(parseSaveData({
    version: 1,
    completedLevels: ["level-1"],
    campaignProgress: { hasStarted: false },
  }).campaignProgress.hasStarted, true);
  assert.equal(parseSaveData({
    version: SAVE_VERSION,
    campaignProgress: { hasStarted: true },
  }).campaignProgress.hasStarted, true);
  assert.equal(parseSaveData({
    version: 1,
    campaignProgress: { highestUnlockedLevel: 2 },
  }).campaignProgress.hasStarted, true);
});

test("storage round trip sanitizes data and reset removes the key", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  assert.equal(
    saveSave(
      {
        ...createDefaultSave(),
        completedLevels: ["level-1"],
        encounteredDogs: ["cone-dog"],
      },
      storage,
    ),
    true,
  );
  assert.equal(values.has(SAVE_KEY), true);
  assert.deepEqual(loadSave(storage).completedLevels, ["level-1"]);
  assert.deepEqual(loadSave(storage).encounteredDogs, ["cone-dog"]);

  assert.deepEqual(resetSave(storage), createDefaultSave());
  assert.equal(values.has(SAVE_KEY), false);
});

test("blocked storage access never prevents startup", () => {
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(loadSave(blockedStorage), createDefaultSave());
  assert.equal(saveSave(createDefaultSave(), blockedStorage), false);
  assert.deepEqual(resetSave(blockedStorage), createDefaultSave());
});
