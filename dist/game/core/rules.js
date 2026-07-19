// @ts-check

export const DEFAULT_LANE_COUNT = 5;
export const DEFAULT_COLUMN_COUNT = 9;

/** @typedef {{lane: number, column: number}} GridCell */
/** @typedef {{type: "slow" | "root", remainingMs: number, multiplier?: number, sourceId?: string}} StatusEffect */
/** @typedef {{lane: number, x: number, health?: number, dead?: boolean, active?: boolean, radius?: number, hitRadius?: number}} LaneEntity */

/**
 * Stable coordinate key used by grid occupancy sets and maps.
 *
 * @param {number} lane
 * @param {number} column
 * @returns {string}
 */
export function coordKey(lane, column) {
  return `${lane}:${column}`;
}

/**
 * @param {number} lane
 * @param {number} column
 * @param {number} [laneCount]
 * @param {number} [columnCount]
 * @returns {boolean}
 */
export function isCellInBounds(
  lane,
  column,
  laneCount = DEFAULT_LANE_COUNT,
  columnCount = DEFAULT_COLUMN_COUNT,
) {
  return (
    Number.isInteger(lane) &&
    Number.isInteger(column) &&
    lane >= 0 &&
    lane < laneCount &&
    column >= 0 &&
    column < columnCount
  );
}

/**
 * Supports a keyed Set or Map, a list of coordinate objects, a string-keyed
 * object, or a lane-by-column matrix. Values of `false`, `null`, and
 * `undefined` are treated as empty matrix cells.
 *
 * @param {unknown} occupancy
 * @param {number} lane
 * @param {number} column
 * @returns {boolean}
 */
export function isCellOccupied(occupancy, lane, column) {
  if (!occupancy) return false;

  const key = coordKey(lane, column);
  if (occupancy instanceof Set || occupancy instanceof Map) {
    return occupancy.has(key);
  }

  if (Array.isArray(occupancy)) {
    const possibleRow = occupancy[lane];
    if (Array.isArray(possibleRow)) {
      const value = possibleRow[column];
      return value !== false && value !== null && value !== undefined;
    }

    return occupancy.some((entry) => {
      if (typeof entry === "string") return entry === key;
      return Boolean(
        entry &&
          typeof entry === "object" &&
          "lane" in entry &&
          "column" in entry &&
          entry.lane === lane &&
          entry.column === column,
      );
    });
  }

  if (typeof occupancy === "object") {
    const record = /** @type {Record<string, unknown>} */ (occupancy);
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      return value !== false && value !== null && value !== undefined;
    }

    const possibleRow = record[String(lane)];
    if (Array.isArray(possibleRow)) {
      const value = possibleRow[column];
      return value !== false && value !== null && value !== undefined;
    }
  }

  return false;
}

/**
 * @param {number} energy
 * @param {number} cost
 * @returns {boolean}
 */
export function canAfford(energy, cost) {
  return (
    Number.isFinite(energy) &&
    Number.isFinite(cost) &&
    energy >= 0 &&
    cost >= 0 &&
    energy >= cost
  );
}

export const PLACEMENT_REASONS = Object.freeze({
  OUT_OF_BOUNDS: "out-of-bounds",
  OCCUPIED: "occupied",
  COOLDOWN: "cooldown",
  INSUFFICIENT_ENERGY: "insufficient-energy",
});

/**
 * @typedef {object} PlacementRequest
 * @property {number} lane
 * @property {number} column
 * @property {number} energy
 * @property {number} cost
 * @property {unknown} [occupancy]
 * @property {number} [cooldownRemainingMs]
 * @property {number} [laneCount]
 * @property {number} [columnCount]
 */

/**
 * Validates placement without changing energy, cooldowns, or occupancy.
 *
 * @param {PlacementRequest} request
 * @returns {{valid: boolean, reason: string | null}}
 */
export function canPlaceDefender(request) {
  const {
    lane,
    column,
    energy,
    cost,
    occupancy = null,
    cooldownRemainingMs = 0,
    laneCount = DEFAULT_LANE_COUNT,
    columnCount = DEFAULT_COLUMN_COUNT,
  } = request;

  if (!isCellInBounds(lane, column, laneCount, columnCount)) {
    return { valid: false, reason: PLACEMENT_REASONS.OUT_OF_BOUNDS };
  }
  if (isCellOccupied(occupancy, lane, column)) {
    return { valid: false, reason: PLACEMENT_REASONS.OCCUPIED };
  }
  if (Number.isFinite(cooldownRemainingMs) && cooldownRemainingMs > 0) {
    return { valid: false, reason: PLACEMENT_REASONS.COOLDOWN };
  }
  if (!canAfford(energy, cost)) {
    return { valid: false, reason: PLACEMENT_REASONS.INSUFFICIENT_ENERGY };
  }
  return { valid: true, reason: null };
}

export const validatePlacement = canPlaceDefender;

/**
 * Finds the closest living target ahead of an attacker in the same lane.
 * A right-facing cat uses the default direction; left-facing logic can reuse
 * the same helper by passing `direction: "left"`.
 *
 * @template {LaneEntity} T
 * @param {{lane: number, x: number}} attacker
 * @param {readonly T[]} enemies
 * @param {{direction?: "right" | "left", maxRange?: number}} [options]
 * @returns {T | undefined}
 */
export function selectSameLaneTarget(attacker, enemies, options = {}) {
  const direction = options.direction ?? "right";
  const maxRange = Number.isFinite(options.maxRange) ? Math.max(0, Number(options.maxRange)) : Infinity;
  let nearest;
  let nearestDistance = Infinity;

  for (const enemy of enemies) {
    if (
      enemy.lane !== attacker.lane ||
      enemy.dead === true ||
      enemy.active === false ||
      (typeof enemy.health === "number" && enemy.health <= 0)
    ) {
      continue;
    }

    const signedDistance = enemy.x - attacker.x;
    const distance = direction === "right" ? signedDistance : -signedDistance;
    if (distance < 0 || distance > maxRange) continue;
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export const findSameLaneTarget = selectSameLaneTarget;

/**
 * @typedef {object} DamageableLayers
 * @property {number} health
 * @property {number} [armor]
 * @property {number} [shieldHealth]
 *
 * @typedef {DamageableLayers & {
 *   incomingDamage: number,
 *   shieldDamage: number,
 *   armorDamage: number,
 *   healthDamage: number,
 *   overkillDamage: number,
 *   shieldBroken: boolean,
 *   armorBroken: boolean,
 *   defeated: boolean
 * }} LayeredDamageResult
 */

/** @param {number} value @returns {number} */
function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** @param {number | undefined} value @returns {number} */
function nonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

/**
 * Applies damage in shield, armor, health order. `shieldBypass` routes a share
 * around the shield. After the shield stage, `armorBypass` routes a share
 * directly to health while the remaining share is absorbed by armor first.
 * The input object is never mutated.
 *
 * @param {DamageableLayers} target
 * @param {number} damage
 * @param {{armorBypass?: number, shieldBypass?: number}} [options]
 * @returns {LayeredDamageResult}
 */
export function applyLayeredDamage(target, damage, options = {}) {
  const initialShield = nonNegative(target.shieldHealth);
  const initialArmor = nonNegative(target.armor);
  const initialHealth = nonNegative(target.health);
  const incomingDamage = nonNegative(damage);
  const shieldBypass = clampUnit(options.shieldBypass ?? 0);
  const armorBypass = clampUnit(options.armorBypass ?? 0);

  const bypassingShield = incomingDamage * shieldBypass;
  const routedToShield = incomingDamage - bypassingShield;
  const shieldDamage = Math.min(initialShield, routedToShield);
  const afterShield = bypassingShield + (routedToShield - shieldDamage);

  const bypassingArmor = afterShield * armorBypass;
  const routedToArmor = afterShield - bypassingArmor;
  const armorDamage = Math.min(initialArmor, routedToArmor);
  const reachingHealth = bypassingArmor + (routedToArmor - armorDamage);
  const healthDamage = Math.min(initialHealth, reachingHealth);

  const shieldHealth = initialShield - shieldDamage;
  const armor = initialArmor - armorDamage;
  const health = initialHealth - healthDamage;

  return {
    ...target,
    shieldHealth,
    armor,
    health,
    incomingDamage,
    shieldDamage,
    armorDamage,
    healthDamage,
    overkillDamage: Math.max(0, reachingHealth - initialHealth),
    shieldBroken: initialShield > 0 && shieldHealth === 0,
    armorBroken: initialArmor > 0 && armor === 0,
    defeated: health === 0,
  };
}

/**
 * @param {unknown} effect
 * @returns {StatusEffect | null}
 */
function normalizeStatus(effect) {
  if (!effect || typeof effect !== "object" || !("type" in effect)) return null;
  const value = /** @type {Record<string, unknown>} */ (effect);
  if (value.type !== "slow" && value.type !== "root") return null;

  const remainingCandidate = value.remainingMs ?? value.durationMs;
  const remainingMs = nonNegative(
    typeof remainingCandidate === "number" ? remainingCandidate : undefined,
  );
  if (remainingMs <= 0) return null;

  const normalized = {
    type: value.type,
    remainingMs,
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
  };

  if (value.type === "slow") {
    const suppliedMultiplier = typeof value.multiplier === "number" ? value.multiplier : 0.5;
    return { ...normalized, multiplier: clampUnit(suppliedMultiplier) };
  }
  return normalized;
}

/**
 * Adds or refreshes slow and root effects. Reapplying slow preserves the
 * strongest multiplier and the longest remaining duration.
 *
 * @param {readonly StatusEffect[]} current
 * @param {StatusEffect | readonly StatusEffect[]} incoming
 * @returns {StatusEffect[]}
 */
export function applyStatusEffects(current, incoming) {
  const result = current.map(normalizeStatus).filter((effect) => effect !== null);
  const additions = (Array.isArray(incoming) ? incoming : [incoming])
    .map(normalizeStatus)
    .filter((effect) => effect !== null);

  for (const addition of additions) {
    const existingIndex = result.findIndex((effect) => effect.type === addition.type);
    if (existingIndex < 0) {
      result.push({ ...addition });
      continue;
    }

    const existing = result[existingIndex];
    const remainingMs = Math.max(existing.remainingMs, addition.remainingMs);
    if (addition.type === "slow") {
      result[existingIndex] = {
        ...existing,
        ...addition,
        remainingMs,
        multiplier: Math.min(existing.multiplier ?? 1, addition.multiplier ?? 1),
      };
    } else {
      result[existingIndex] = { ...existing, ...addition, remainingMs };
    }
  }

  return result;
}

/**
 * @param {readonly StatusEffect[]} statuses
 * @param {number} durationMs
 * @param {number} [multiplier]
 * @param {string} [sourceId]
 * @returns {StatusEffect[]}
 */
export function applySlow(statuses, durationMs, multiplier = 0.5, sourceId) {
  return applyStatusEffects(statuses, {
    type: "slow",
    remainingMs: durationMs,
    multiplier,
    ...(sourceId ? { sourceId } : {}),
  });
}

/**
 * @param {readonly StatusEffect[]} statuses
 * @param {number} durationMs
 * @param {string} [sourceId]
 * @returns {StatusEffect[]}
 */
export function applyRoot(statuses, durationMs, sourceId) {
  return applyStatusEffects(statuses, {
    type: "root",
    remainingMs: durationMs,
    ...(sourceId ? { sourceId } : {}),
  });
}

/**
 * Advances effect timers and removes expired effects without mutating input.
 *
 * @param {readonly StatusEffect[]} statuses
 * @param {number} deltaMs
 * @returns {StatusEffect[]}
 */
export function advanceStatuses(statuses, deltaMs) {
  const elapsed = nonNegative(deltaMs);
  return statuses
    .map(normalizeStatus)
    .filter((effect) => effect !== null)
    .map((effect) => ({ ...effect, remainingMs: Math.max(0, effect.remainingMs - elapsed) }))
    .filter((effect) => effect.remainingMs > 0);
}

export const tickStatusEffects = advanceStatuses;

/**
 * @param {readonly StatusEffect[]} statuses
 * @returns {boolean}
 */
export function isRooted(statuses) {
  return statuses.some((effect) => effect.type === "root" && effect.remainingMs > 0);
}

/**
 * @param {readonly StatusEffect[]} statuses
 * @returns {number}
 */
export function getMovementMultiplier(statuses) {
  if (isRooted(statuses)) return 0;
  let multiplier = 1;
  for (const effect of statuses) {
    if (effect.type === "slow" && effect.remainingMs > 0) {
      multiplier = Math.min(multiplier, clampUnit(effect.multiplier ?? 0.5));
    }
  }
  return multiplier;
}

/**
 * Returns the first time along a horizontal movement segment where two circle
 * hit areas touch. This catches targets crossed between rendered frames.
 *
 * @param {number} fromX
 * @param {number} toX
 * @param {number} movingRadius
 * @param {number} targetX
 * @param {number} targetRadius
 * @returns {{time: number, x: number} | null}
 */
export function getSweptCollision(fromX, toX, movingRadius, targetX, targetRadius) {
  if (![fromX, toX, movingRadius, targetX, targetRadius].every(Number.isFinite)) return null;

  const totalRadius = Math.max(0, movingRadius) + Math.max(0, targetRadius);
  const left = targetX - totalRadius;
  const right = targetX + totalRadius;
  const delta = toX - fromX;

  if (delta === 0) {
    return fromX >= left && fromX <= right ? { time: 0, x: fromX } : null;
  }

  const first = (left - fromX) / delta;
  const second = (right - fromX) / delta;
  const entry = Math.max(0, Math.min(first, second));
  const exit = Math.min(1, Math.max(first, second));
  if (entry > exit) return null;
  return { time: entry, x: fromX + delta * entry };
}

/**
 * Boolean convenience wrapper around `getSweptCollision`.
 *
 * @param {number} fromX
 * @param {number} toX
 * @param {number} movingRadius
 * @param {number} targetX
 * @param {number} targetRadius
 * @returns {boolean}
 */
export function sweptCollision(fromX, toX, movingRadius, targetX, targetRadius) {
  return getSweptCollision(fromX, toX, movingRadius, targetX, targetRadius) !== null;
}

/**
 * Finds the first living entity crossed by a projectile during its last step.
 *
 * @template {LaneEntity} T
 * @param {{lane: number, x: number, previousX?: number, radius?: number, active?: boolean}} projectile
 * @param {readonly T[]} targets
 * @returns {{target: T, time: number, x: number} | null}
 */
export function findSweptCollision(projectile, targets) {
  if (projectile.active === false) return null;
  const fromX = Number.isFinite(projectile.previousX) ? Number(projectile.previousX) : projectile.x;
  const projectileRadius = nonNegative(projectile.radius);
  let firstHit = null;

  for (const target of targets) {
    if (
      target.lane !== projectile.lane ||
      target.dead === true ||
      target.active === false ||
      (typeof target.health === "number" && target.health <= 0)
    ) {
      continue;
    }

    const targetRadius = nonNegative(target.hitRadius ?? target.radius);
    const collision = getSweptCollision(
      fromX,
      projectile.x,
      projectileRadius,
      target.x,
      targetRadius,
    );
    if (collision && (!firstHit || collision.time < firstHit.time)) {
      firstHit = { target, ...collision };
    }
  }

  return firstHit;
}

/**
 * @param {readonly {entries?: readonly unknown[]}[]} waves
 * @returns {number}
 */
export function countWaveEntries(waves) {
  return waves.reduce(
    (total, wave) => total + (Array.isArray(wave.entries) ? wave.entries.length : 0),
    0,
  );
}

/**
 * A wave is complete only after all scheduled entries have spawned and all
 * enemies belonging to the wave have left play.
 *
 * @param {{entries?: readonly unknown[]}} wave
 * @param {number} spawnedEntries
 * @param {number} [activeEnemyCount]
 * @returns {boolean}
 */
export function isWaveComplete(wave, spawnedEntries, activeEnemyCount = 0) {
  const scheduled = Array.isArray(wave.entries) ? wave.entries.length : 0;
  return spawnedEntries >= scheduled && activeEnemyCount <= 0;
}

/**
 * @typedef {object} WaveRuntimeState
 * @property {readonly {entries?: readonly unknown[]}[]} [waves]
 * @property {number} [spawnedEntries]
 * @property {number} [spawnedCount]
 * @property {number} [activeEnemyCount]
 * @property {readonly LaneEntity[]} [activeEnemies]
 * @property {boolean} [allWavesSpawned]
 *
 * @param {readonly {entries?: readonly unknown[]}[] | WaveRuntimeState} wavesOrState
 * @param {number} [spawnedEntries]
 * @param {number} [activeEnemyCount]
 * @returns {boolean}
 */
export function areWavesComplete(wavesOrState, spawnedEntries = 0, activeEnemyCount = 0) {
  if (Array.isArray(wavesOrState)) {
    return spawnedEntries >= countWaveEntries(wavesOrState) && activeEnemyCount <= 0;
  }

  const state = /** @type {WaveRuntimeState} */ (wavesOrState);
  const waves = state.waves ?? [];
  const spawned = state.spawnedEntries ?? state.spawnedCount ?? 0;
  const active = Array.isArray(state.activeEnemies)
    ? state.activeEnemies.filter(
        (enemy) =>
          enemy.active !== false &&
          enemy.dead !== true &&
          !(typeof enemy.health === "number" && enemy.health <= 0),
      ).length
    : state.activeEnemyCount ?? 0;
  const spawningFinished = state.allWavesSpawned ?? spawned >= countWaveEntries(waves);
  return spawningFinished && active <= 0;
}

/**
 * @typedef {WaveRuntimeState & {
 *   wavesComplete?: boolean,
 *   defeated?: boolean,
 *   baseBreached?: boolean,
 *   unstoppedBreach?: boolean,
 *   breachedAfterEmergency?: boolean,
 *   lanes?: readonly {breached?: boolean, endpointReached?: boolean, emergencyAvailable?: boolean}[]
 * }} BattleEndState
 */

/**
 * @param {BattleEndState} state
 * @returns {boolean}
 */
export function isDefeat(state) {
  if (
    state.defeated === true ||
    state.baseBreached === true ||
    state.unstoppedBreach === true ||
    state.breachedAfterEmergency === true
  ) {
    return true;
  }

  return Boolean(
    state.lanes?.some(
      (lane) =>
        (lane.breached === true || lane.endpointReached === true) &&
        lane.emergencyAvailable === false,
    ),
  );
}

/**
 * @param {BattleEndState} state
 * @returns {boolean}
 */
export function isVictory(state) {
  if (isDefeat(state)) return false;
  if (typeof state.wavesComplete === "boolean") {
    const active = Array.isArray(state.activeEnemies)
      ? state.activeEnemies.filter((enemy) => enemy.active !== false && enemy.dead !== true).length
      : state.activeEnemyCount ?? 0;
    return state.wavesComplete && active <= 0;
  }
  return areWavesComplete(state);
}

/**
 * Defeat takes precedence if a breach and final enemy defeat occur together.
 *
 * @param {BattleEndState} state
 * @returns {"playing" | "victory" | "defeat"}
 */
export function getBattleOutcome(state) {
  if (isDefeat(state)) return "defeat";
  if (isVictory(state)) return "victory";
  return "playing";
}

export const evaluateBattleState = getBattleOutcome;
