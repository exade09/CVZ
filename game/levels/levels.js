// @ts-check

/**
 * @typedef {object} WaveEntry
 * @property {string} enemyId
 * @property {number} lane Zero-based lane index.
 * @property {number} delayMs Delay relative to the wave start.
 *
 * @typedef {object} WaveDefinition
 * @property {string} id
 * @property {number} startTimeMs Time relative to the beginning of the level.
 * @property {boolean} final
 * @property {readonly WaveEntry[]} entries
 *
 * @typedef {object} TutorialCue
 * @property {number} atMs
 * @property {string} message
 * @property {string} anchor
 *
 * @typedef {object} LevelDefinition
 * @property {string} id
 * @property {number} number
 * @property {string} name
 * @property {string} description
 * @property {number} laneCount
 * @property {number} columnCount
 * @property {number} startingEnergy
 * @property {number} ambientEnergyIntervalMs
 * @property {number} firstAmbientEnergyDelayMs
 * @property {readonly string[]} availableDefenders
 * @property {readonly string[]} unlocks
 * @property {readonly TutorialCue[]} tutorial
 * @property {readonly WaveDefinition[]} waves
 */

/** @param {WaveEntry[]} entries @returns {readonly WaveEntry[]} */
function freezeEntries(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * @param {string} id
 * @param {number} startTimeMs
 * @param {boolean} final
 * @param {WaveEntry[]} entries
 * @returns {WaveDefinition}
 */
function wave(id, startTimeMs, final, entries) {
  return Object.freeze({ id, startTimeMs, final, entries: freezeEntries(entries) });
}

/** @type {readonly LevelDefinition[]} */
export const LEVELS = Object.freeze([
  Object.freeze({
    id: "level-1",
    number: 1,
    name: "First Pawprints",
    description: "Learn to gather Paw Energy and protect the garden paths.",
    laneCount: 5,
    columnCount: 9,
    startingEnergy: 175,
    ambientEnergyIntervalMs: 7_500,
    firstAmbientEnergyDelayMs: 2_500,
    availableDefenders: Object.freeze(["bubble-sprout", "sunny-bloom", "shell-guard"]),
    unlocks: Object.freeze(["twin-berry", "frost-bloom"]),
    tutorial: Object.freeze([
      Object.freeze({
        atMs: 500,
        message: "Collect the glowing paw to gain Paw Energy.",
        anchor: "energy",
      }),
      Object.freeze({
        atMs: 2_800,
        message: "Choose Bubble Sprout, then place it in a highlighted garden cell.",
        anchor: "cards",
      }),
      Object.freeze({
        atMs: 8_000,
        message: "Cats only target dogs in their own lane. Build where a threat is coming.",
        anchor: "battlefield",
      }),
    ]),
    waves: Object.freeze([
      wave("1-1", 7_000, false, [
        { enemyId: "stray-dog", lane: 2, delayMs: 0 },
        { enemyId: "stray-dog", lane: 0, delayMs: 5_000 },
      ]),
      wave("1-2", 23_000, false, [
        { enemyId: "stray-dog", lane: 4, delayMs: 0 },
        { enemyId: "stray-dog", lane: 1, delayMs: 2_700 },
        { enemyId: "stray-dog", lane: 3, delayMs: 6_000 },
      ]),
      wave("1-final", 43_000, true, [
        { enemyId: "stray-dog", lane: 0, delayMs: 0 },
        { enemyId: "stray-dog", lane: 4, delayMs: 650 },
        { enemyId: "stray-dog", lane: 2, delayMs: 3_000 },
        { enemyId: "stray-dog", lane: 1, delayMs: 5_600 },
        { enemyId: "stray-dog", lane: 3, delayMs: 6_100 },
        { enemyId: "stray-dog", lane: 2, delayMs: 14_000 },
      ]),
    ]),
  }),
  Object.freeze({
    id: "level-2",
    number: 2,
    name: "Tin and Tangerine",
    description: "Crack layered armor with sturdy blockers, frost, and focused fire.",
    laneCount: 5,
    columnCount: 9,
    startingEnergy: 225,
    ambientEnergyIntervalMs: 7_250,
    firstAmbientEnergyDelayMs: 2_000,
    availableDefenders: Object.freeze([
      "bubble-sprout",
      "sunny-bloom",
      "shell-guard",
      "twin-berry",
      "frost-bloom",
    ]),
    unlocks: Object.freeze(["pop-burst", "leaf-beast", "bulb-guide"]),
    tutorial: Object.freeze([
      Object.freeze({
        atMs: 4_000,
        message: "Orange cones and metal buckets absorb damage before the dog underneath is hurt.",
        anchor: "battlefield",
      }),
      Object.freeze({
        atMs: 12_000,
        message: "Shell Guard can hold a lane while Frost Bloom slows the crowd.",
        anchor: "cards",
      }),
    ]),
    waves: Object.freeze([
      wave("2-1", 5_000, false, [
        { enemyId: "stray-dog", lane: 1, delayMs: 0 },
        { enemyId: "cone-dog", lane: 3, delayMs: 3_000 },
        { enemyId: "stray-dog", lane: 4, delayMs: 7_000 },
      ]),
      wave("2-2", 24_000, false, [
        { enemyId: "cone-dog", lane: 0, delayMs: 0 },
        { enemyId: "cone-dog", lane: 2, delayMs: 1_400 },
        { enemyId: "stray-dog", lane: 0, delayMs: 4_200 },
        { enemyId: "bucket-dog", lane: 4, delayMs: 6_500 },
      ]),
      wave("2-3", 48_000, false, [
        { enemyId: "bucket-dog", lane: 1, delayMs: 0 },
        { enemyId: "stray-dog", lane: 3, delayMs: 900 },
        { enemyId: "cone-dog", lane: 3, delayMs: 3_100 },
        { enemyId: "cone-dog", lane: 2, delayMs: 6_300 },
        { enemyId: "stray-dog", lane: 4, delayMs: 8_000 },
      ]),
      wave("2-final", 73_000, true, [
        { enemyId: "bucket-dog", lane: 0, delayMs: 0 },
        { enemyId: "bucket-dog", lane: 4, delayMs: 500 },
        { enemyId: "cone-dog", lane: 1, delayMs: 1_700 },
        { enemyId: "cone-dog", lane: 3, delayMs: 2_100 },
        { enemyId: "stray-dog", lane: 2, delayMs: 3_000 },
        { enemyId: "stray-dog", lane: 1, delayMs: 5_400 },
        { enemyId: "stray-dog", lane: 3, delayMs: 5_800 },
      ]),
    ]),
  }),
  Object.freeze({
    id: "level-3",
    number: 3,
    name: "Moonlit Garden Stand",
    description: "Use every trick against shields, chargers, and one enormous final rush.",
    laneCount: 5,
    columnCount: 9,
    startingEnergy: 350,
    ambientEnergyIntervalMs: 5_000,
    firstAmbientEnergyDelayMs: 1_000,
    availableDefenders: Object.freeze([
      "bubble-sprout",
      "sunny-bloom",
      "shell-guard",
      "twin-berry",
      "frost-bloom",
      "pop-burst",
      "leaf-beast",
      "bulb-guide",
    ]),
    unlocks: Object.freeze([]),
    tutorial: Object.freeze([
      Object.freeze({
        atMs: 4_000,
        message: "Gate Shields protect everything behind the gate. Heavy shots help after it breaks.",
        anchor: "battlefield",
      }),
      Object.freeze({
        atMs: 16_000,
        message: "Bulb Guide can briefly root a dangerous charger in place.",
        anchor: "cards",
      }),
    ]),
    waves: Object.freeze([
      wave("3-1", 5_000, false, [
        { enemyId: "cone-dog", lane: 0, delayMs: 0 },
        { enemyId: "stray-dog", lane: 2, delayMs: 1_000 },
        { enemyId: "cone-dog", lane: 4, delayMs: 2_000 },
        { enemyId: "bucket-dog", lane: 1, delayMs: 6_000 },
      ]),
      wave("3-2", 26_000, false, [
        { enemyId: "gate-dog", lane: 3, delayMs: 0 },
        { enemyId: "stray-dog", lane: 0, delayMs: 1_600 },
        { enemyId: "cone-dog", lane: 2, delayMs: 3_200 },
        { enemyId: "stray-dog", lane: 3, delayMs: 6_400 },
        { enemyId: "bucket-dog", lane: 4, delayMs: 8_000 },
      ]),
      wave("3-3", 51_000, false, [
        { enemyId: "brute-dog", lane: 2, delayMs: 0 },
        { enemyId: "cone-dog", lane: 0, delayMs: 1_000 },
        { enemyId: "cone-dog", lane: 4, delayMs: 1_500 },
        { enemyId: "bucket-dog", lane: 1, delayMs: 4_200 },
        { enemyId: "bucket-dog", lane: 3, delayMs: 4_700 },
      ]),
      wave("3-4", 79_000, false, [
        { enemyId: "gate-dog", lane: 0, delayMs: 0 },
        { enemyId: "gate-dog", lane: 4, delayMs: 800 },
        { enemyId: "brute-dog", lane: 1, delayMs: 3_300 },
        { enemyId: "brute-dog", lane: 3, delayMs: 3_900 },
        { enemyId: "stray-dog", lane: 2, delayMs: 6_000 },
        { enemyId: "cone-dog", lane: 2, delayMs: 8_300 },
      ]),
      wave("3-final", 109_000, true, [
        { enemyId: "brute-dog", lane: 2, delayMs: 0 },
        { enemyId: "gate-dog", lane: 0, delayMs: 350 },
        { enemyId: "gate-dog", lane: 4, delayMs: 700 },
        { enemyId: "bucket-dog", lane: 1, delayMs: 1_050 },
        { enemyId: "bucket-dog", lane: 3, delayMs: 1_400 },
        { enemyId: "brute-dog", lane: 0, delayMs: 4_600 },
        { enemyId: "brute-dog", lane: 4, delayMs: 5_100 },
        { enemyId: "cone-dog", lane: 1, delayMs: 6_000 },
        { enemyId: "cone-dog", lane: 3, delayMs: 6_300 },
        { enemyId: "stray-dog", lane: 2, delayMs: 7_200 },
        { enemyId: "gate-dog", lane: 2, delayMs: 10_000 },
      ]),
    ]),
  }),
]);

/** @type {Readonly<Record<string, LevelDefinition>>} */
export const LEVEL_BY_ID = Object.freeze(
  Object.fromEntries(LEVELS.map((definition) => [definition.id, definition])),
);

/**
 * @param {string | number} idOrNumber
 * @returns {LevelDefinition | undefined}
 */
export function getLevelDefinition(idOrNumber) {
  if (typeof idOrNumber === "number") {
    return LEVELS.find((definition) => definition.number === idOrNumber);
  }
  return LEVEL_BY_ID[idOrNumber];
}

export default LEVELS;
