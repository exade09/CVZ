// @ts-check

/**
 * @typedef {object} EnemyAssets
 * @property {string} unit Full gameplay sprite.
 * @property {string} card Compact encyclopedia artwork.
 * @property {string} preview High-quality encyclopedia artwork.
 *
 * @typedef {object} EnemyDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} maxHealth
 * @property {number} armor
 * @property {number} shieldHealth
 * @property {number} movementSpeed Pixels travelled per second at normal speed.
 * @property {number} attackDamage
 * @property {number} attackIntervalMs
 * @property {string} specialTrait
 * @property {string} behaviorType
 * @property {number} scale
 * @property {string} assetKey
 * @property {string} [brokenAssetKey] Asset key used after external protection breaks.
 * @property {string} [shieldBrokenAssetKey] Asset key used after a shield breaks.
 * @property {string} [armorBrokenAssetKey] Asset key used after all armor breaks.
 * @property {EnemyAssets} assets
 * @property {Readonly<Record<string, number>>} [stats]
 */

/** @param {string} id @returns {EnemyAssets} */
function assetsFor(id) {
  return Object.freeze({
    unit: new URL(`../assets/units/${id}.webp`, import.meta.url).href,
    card: new URL(`../assets/cards/${id}.webp`, import.meta.url).href,
    preview: new URL(`../assets/preview/${id}.webp`, import.meta.url).href,
  });
}

/** @type {readonly EnemyDefinition[]} */
export const ENEMIES = Object.freeze([
  Object.freeze({
    id: "stray-dog",
    name: "Wobbly Stray",
    description: "An ordinary garden trespasser with steady paws and no protection",
    maxHealth: 190,
    armor: 0,
    shieldHealth: 0,
    movementSpeed: 22,
    attackDamage: 20,
    attackIntervalMs: 950,
    specialTrait: "No special protection",
    behaviorType: "walker",
    scale: 1,
    assetKey: "stray-dog",
    assets: assetsFor("stray-dog"),
  }),
  Object.freeze({
    id: "cone-dog",
    name: "Cone Guard",
    description: "A cautious dog whose bright cone absorbs a useful layer of damage",
    maxHealth: 215,
    armor: 165,
    shieldHealth: 0,
    movementSpeed: 18,
    attackDamage: 23,
    attackIntervalMs: 950,
    specialTrait: "The cone cracks at half armor and falls away when armor breaks",
    behaviorType: "armored-walker",
    scale: 1.04,
    assetKey: "cone-dog",
    brokenAssetKey: "stray-dog",
    assets: assetsFor("cone-dog"),
    stats: Object.freeze({ armorDamageState: 0.5 }),
  }),
  Object.freeze({
    id: "bucket-dog",
    name: "Bucket Guard",
    description: "A slow, determined dog protected by a battered metal bucket",
    maxHealth: 270,
    armor: 430,
    shieldHealth: 0,
    movementSpeed: 13,
    attackDamage: 28,
    attackIntervalMs: 900,
    specialTrait: "The bucket has two visible damage stages before it falls away",
    behaviorType: "heavy-armor",
    scale: 1.08,
    assetKey: "bucket-dog",
    brokenAssetKey: "stray-dog",
    assets: assetsFor("bucket-dog"),
    stats: Object.freeze({ armorDamageStateOne: 0.66, armorDamageStateTwo: 0.33 }),
  }),
  Object.freeze({
    id: "gate-dog",
    name: "Gate Shield",
    description: "A lumbering guard who pushes a garden gate ahead of the pack",
    maxHealth: 310,
    armor: 70,
    shieldHealth: 620,
    movementSpeed: 11,
    attackDamage: 34,
    attackIntervalMs: 850,
    specialTrait: "Its shield reduces basic bubble damage by 28% and must break before armor and health are exposed",
    behaviorType: "shield-walker",
    scale: 1.13,
    assetKey: "gate-dog",
    brokenAssetKey: "cone-dog",
    shieldBrokenAssetKey: "cone-dog",
    armorBrokenAssetKey: "stray-dog",
    assets: assetsFor("gate-dog"),
    stats: Object.freeze({ shieldDamageState: 0.45, basicProjectileDamageMultiplier: 0.72 }),
  }),
  Object.freeze({
    id: "brute-dog",
    name: "Rush Brute",
    description: "A large late-wave challenger in worn sports gear with a startling charge",
    maxHealth: 760,
    armor: 250,
    shieldHealth: 0,
    movementSpeed: 25,
    attackDamage: 58,
    attackIntervalMs: 720,
    specialTrait: "Charges faster until it reaches the first defender in its lane",
    behaviorType: "charging-brute",
    scale: 1.28,
    assetKey: "brute-dog",
    assets: assetsFor("brute-dog"),
    stats: Object.freeze({ chargeMultiplier: 1.22 }),
  }),
]);

/** @type {Readonly<Record<string, EnemyDefinition>>} */
export const ENEMY_BY_ID = Object.freeze(
  Object.fromEntries(ENEMIES.map((definition) => [definition.id, definition])),
);

/**
 * @param {string} id
 * @returns {EnemyDefinition | undefined}
 */
export function getEnemyDefinition(id) {
  return ENEMY_BY_ID[id];
}

export default ENEMIES;
