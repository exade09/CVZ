// @ts-check

/**
 * @typedef {"attacker" | "producer" | "tank" | "burst" | "control" | "utility"} DefenderRole
 *
 * @typedef {object} DefenderAssets
 * @property {string} unit Full gameplay sprite.
 * @property {string} card Compact card artwork.
 * @property {string} preview High-quality collection artwork.
 *
 * @typedef {object} DefenderDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {DefenderRole} role
 * @property {string} ability
 * @property {number} cost
 * @property {number} maxHealth
 * @property {number} cooldownMs
 * @property {number} attackDamage
 * @property {number} attackIntervalMs
 * @property {number} range
 * @property {string} behaviorType
 * @property {string} assetKey
 * @property {DefenderAssets} assets
 * @property {Readonly<Record<string, number>>} [stats]
 */

/** @param {string} id @returns {DefenderAssets} */
function assetsFor(id) {
  return Object.freeze({
    unit: new URL(`../assets/units/${id}.webp`, import.meta.url).href,
    card: new URL(`../assets/cards/${id}.webp`, import.meta.url).href,
    preview: new URL(`../assets/preview/${id}.webp`, import.meta.url).href,
  });
}

/**
 * The complete playable roster. Numeric range values are measured in grid cells.
 * Extra behavior values live in `stats` so the runtime can stay data-driven.
 *
 * @type {readonly DefenderDefinition[]}
 */
export const DEFENDERS = Object.freeze([
  Object.freeze({
    id: "bubble-sprout",
    name: "Bubble Sprout",
    description: "A cheerful starter who sends steady garden bubbles down one lane",
    role: "attacker",
    ability: "Reliable single-lane bubble shots",
    cost: 100,
    maxHealth: 320,
    cooldownMs: 5_000,
    attackDamage: 24,
    attackIntervalMs: 1_350,
    range: 9,
    behaviorType: "single-shot",
    assetKey: "bubble-sprout",
    assets: assetsFor("bubble-sprout"),
    stats: Object.freeze({ projectileSpeed: 330 }),
  }),
  Object.freeze({
    id: "sunny-bloom",
    name: "Sunny Bloom",
    description: "A warm garden helper who grows useful Paw Energy over time",
    role: "producer",
    ability: "Creates 25 Paw Energy every 11 seconds",
    cost: 50,
    maxHealth: 280,
    cooldownMs: 7_500,
    attackDamage: 0,
    attackIntervalMs: 11_000,
    range: 0,
    behaviorType: "energy-producer",
    assetKey: "sunny-bloom",
    assets: assetsFor("sunny-bloom"),
    stats: Object.freeze({ energyAmount: 25, firstProductionDelayMs: 7_000 }),
  }),
  Object.freeze({
    id: "shell-guard",
    name: "Shell Guard",
    description: "A brave round guardian who buys the rest of the team precious time",
    role: "tank",
    ability: "Blocks dogs with exceptionally high health",
    cost: 75,
    maxHealth: 1_250,
    cooldownMs: 18_000,
    attackDamage: 0,
    attackIntervalMs: 0,
    range: 0,
    behaviorType: "blocker",
    assetKey: "shell-guard",
    assets: assetsFor("shell-guard"),
    stats: Object.freeze({ damageStateOne: 0.66, damageStateTwo: 0.33 }),
  }),
  Object.freeze({
    id: "twin-berry",
    name: "Twin Berry",
    description: "Two lively partners fire a quick pair of berry bubbles at every target",
    role: "attacker",
    ability: "Fires two shots in a short burst",
    cost: 175,
    maxHealth: 360,
    cooldownMs: 10_000,
    attackDamage: 21,
    attackIntervalMs: 1_450,
    range: 9,
    behaviorType: "double-shot",
    assetKey: "twin-berry",
    assets: assetsFor("twin-berry"),
    stats: Object.freeze({ projectileSpeed: 345, shotsPerBurst: 2, burstGapMs: 170 }),
  }),
  Object.freeze({
    id: "frost-bloom",
    name: "Frost Bloom",
    description: "Cool crystal bubbles make every approaching dog easier to contain",
    role: "control",
    ability: "Shots slow a dog to 55% speed for 3.5 seconds",
    cost: 125,
    maxHealth: 310,
    cooldownMs: 9_000,
    attackDamage: 14,
    attackIntervalMs: 1_800,
    range: 9,
    behaviorType: "slow-shot",
    assetKey: "frost-bloom",
    assets: assetsFor("frost-bloom"),
    stats: Object.freeze({ projectileSpeed: 305, slowMultiplier: 0.55, slowDurationMs: 3_500 }),
  }),
  Object.freeze({
    id: "pop-burst",
    name: "Pop Burst",
    description: "A tiny firecracker of courage who releases one wide, playful color burst",
    role: "burst",
    ability: "Pops after a short fuse and damages nearby dogs across adjacent lanes",
    cost: 150,
    maxHealth: 190,
    cooldownMs: 22_000,
    attackDamage: 230,
    attackIntervalMs: 0,
    range: 1.45,
    behaviorType: "area-burst",
    assetKey: "pop-burst",
    assets: assetsFor("pop-burst"),
    stats: Object.freeze({ fuseMs: 1_050, radiusCells: 1.45 }),
  }),
  Object.freeze({
    id: "leaf-beast",
    name: "Leaf Beast",
    description: "A patient heavyweight whose giant seed shots punch through tough armor",
    role: "attacker",
    ability: "Heavy shots bypass 45% of armor protection",
    cost: 250,
    maxHealth: 520,
    cooldownMs: 16_000,
    attackDamage: 76,
    attackIntervalMs: 2_650,
    range: 9,
    behaviorType: "heavy-shot",
    assetKey: "leaf-beast",
    assets: assetsFor("leaf-beast"),
    stats: Object.freeze({ projectileSpeed: 275, armorBypass: 0.45 }),
  }),
  Object.freeze({
    id: "bulb-guide",
    name: "Bulb Guide",
    description: "A clever lantern keeper who roots the nearest threat with glowing vines",
    role: "utility",
    ability: "Roots one dog for 1.8 seconds and makes it take 25% more damage for 4.5 seconds",
    cost: 125,
    maxHealth: 300,
    cooldownMs: 13_000,
    attackDamage: 0,
    attackIntervalMs: 6_500,
    range: 7,
    behaviorType: "root-pulse",
    assetKey: "bulb-guide",
    assets: assetsFor("bulb-guide"),
    stats: Object.freeze({
      rootDurationMs: 1_800,
      weakenDurationMs: 4_500,
      weakenMultiplier: 1.25,
    }),
  }),
]);

/** @type {Readonly<Record<string, DefenderDefinition>>} */
export const DEFENDER_BY_ID = Object.freeze(
  Object.fromEntries(DEFENDERS.map((definition) => [definition.id, definition])),
);

/**
 * Looks up a defender without exposing mutable configuration state.
 *
 * @param {string} id
 * @returns {DefenderDefinition | undefined}
 */
export function getDefenderDefinition(id) {
  return DEFENDER_BY_ID[id];
}

export default DEFENDERS;
