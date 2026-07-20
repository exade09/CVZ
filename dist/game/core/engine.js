// @ts-check

import { DEFENDER_BY_ID } from "../config/defenders.js";
import { ENEMY_BY_ID } from "../config/enemies.js";
import {
  advanceStatuses,
  applyLayeredDamage,
  applyRoot,
  applySlow,
  canPlaceDefender,
  coordKey,
  findSweptCollision,
  getMovementMultiplier,
  selectSameLaneTarget,
} from "./rules.js";

/** @typedef {import('../levels/levels.js').default[number]} LevelDefinition */

/**
 * @typedef {object} EngineOptions
 * @property {LevelDefinition} level
 * @property {(event: {type: string, detail: any}) => void} [onEvent]
 * @property {(state: any) => void} [onFrame]
 * @property {() => number} [random]
 */

const ENEMY_ENTRY_X = 9.55;
const ENDPOINT_X = 0.18;
const PROJECTILE_SCALE = 100;
const MAX_DELTA_MS = 50;

/**
 * @param {LevelDefinition} level
 * @returns {Array<any>}
 */
export function flattenLevelSpawns(level) {
  return level.waves
    .flatMap((wave, waveIndex) => wave.entries.map((entry, entryIndex) => ({
      ...entry,
      waveId: wave.id,
      waveIndex,
      final: wave.final,
      atMs: wave.startTimeMs + entry.delayMs,
      order: waveIndex * 100 + entryIndex,
    })))
    .sort((left, right) => left.atMs - right.atMs || left.order - right.order);
}

/**
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * @param {any} entity
 * @returns {boolean}
 */
function isActive(entity) {
  return Boolean(entity && entity.state === "active" && entity.health > 0);
}

/**
 * @param {number} value
 * @returns {number}
 */
function safeRatio(value) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

export class GameEngine {
  /**
   * @param {EngineOptions} options
   */
  constructor({ level, onEvent = () => {}, onFrame = () => {}, random = Math.random }) {
    this.level = level;
    this.onEvent = onEvent;
    this.onFrame = onFrame;
    this.random = random;
    this.frameRequest = 0;
    this.lastFrameAt = 0;
    this.entitySequence = 0;
    this.projectilePool = [];
    this.boundFrame = (timestamp) => this.frame(timestamp);
    this.state = this.createState();
  }

  /** @returns {any} */
  createState() {
    const spawnQueue = flattenLevelSpawns(this.level);
    const finalWaveIndex = this.level.waves.findIndex((wave) => wave.final);
    const finalWave = this.level.waves[finalWaveIndex] ?? this.level.waves.at(-1);
    return {
      level: this.level,
      status: "ready",
      pauseReason: null,
      elapsedMs: 0,
      speed: 1,
      energy: this.level.startingEnergy,
      selectedDefenderId: null,
      defenders: [],
      enemies: [],
      projectiles: [],
      energyOrbs: [],
      pendingShots: [],
      occupied: new Map(),
      cooldownUntil: Object.create(null),
      laneDefenses: Array.from({ length: this.level.laneCount }, () => true),
      laneSweepsUntil: Array.from({ length: this.level.laneCount }, () => 0),
      spawnQueue,
      nextSpawnIndex: 0,
      nextAmbientEnergyAt: this.level.firstAmbientEnergyDelayMs,
      tutorialCursor: 0,
      finalWaveIndex,
      finalWaveStartMs: finalWave?.startTimeMs ?? 0,
      finalWarningShown: false,
      stats: {
        placed: 0,
        collectedEnergy: 0,
        defeatedEnemies: 0,
        spawnedEnemies: 0,
        totalEnemies: spawnQueue.length,
      },
      startedAt: 0,
    };
  }

  /** @returns {any} */
  getState() {
    return this.state;
  }

  /** @returns {boolean} */
  isRunning() {
    return this.state.status === "playing";
  }

  start() {
    if (this.state.status !== "ready") return;
    this.state.status = "playing";
    this.state.pauseReason = null;
    this.lastFrameAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.emit("started", { levelId: this.level.id });
    this.render();
    this.scheduleFrame();
  }

  /** @param {string} [reason] */
  pause(reason = "manual") {
    if (this.state.status === "paused") {
      this.state.pauseReason = reason;
      this.render();
      return;
    }
    if (this.state.status !== "playing") return;
    this.cancelFrame();
    this.state.status = "paused";
    this.state.pauseReason = reason;
    this.emit("paused", { reason });
    this.render();
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.state.status = "playing";
    this.state.pauseReason = null;
    this.lastFrameAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.emit("resumed", {});
    this.render();
    this.scheduleFrame();
  }

  destroy() {
    this.cancelFrame();
    this.state.status = "destroyed";
    this.state.defenders.length = 0;
    this.state.enemies.length = 0;
    this.state.projectiles.length = 0;
    this.state.energyOrbs.length = 0;
    this.state.pendingShots.length = 0;
    this.state.occupied.clear();
  }

  /** @param {1 | 1.5} speed */
  setSpeed(speed) {
    this.state.speed = speed === 1.5 ? 1.5 : 1;
    this.emit("speed-changed", { speed: this.state.speed });
    this.render();
  }

  /** @param {string | null} defenderId */
  selectDefender(defenderId) {
    if (defenderId === null) {
      this.state.selectedDefenderId = null;
      this.render();
      return { ok: true, reason: null };
    }

    if (!this.level.availableDefenders.includes(defenderId) || !DEFENDER_BY_ID[defenderId]) {
      return { ok: false, reason: "unavailable" };
    }
    this.state.selectedDefenderId = defenderId;
    this.emit("card-selected", { defenderId });
    this.render();
    return { ok: true, reason: null };
  }

  /**
   * @param {string} defenderId
   * @param {number} lane
   * @param {number} column
   * @returns {{ok: boolean, reason: string | null}}
   */
  validatePlacement(defenderId, lane, column) {
    const definition = DEFENDER_BY_ID[defenderId];
    if (!definition || !this.level.availableDefenders.includes(defenderId)) {
      return { ok: false, reason: "unavailable" };
    }
    const cooldownRemainingMs = Math.max(
      0,
      Number(this.state.cooldownUntil[defenderId] ?? 0) - this.state.elapsedMs,
    );
    const result = canPlaceDefender({
      lane,
      column,
      energy: this.state.energy,
      cost: definition.cost,
      occupancy: this.state.occupied,
      cooldownRemainingMs,
      laneCount: this.level.laneCount,
      columnCount: this.level.columnCount,
    });
    return { ok: result.valid, reason: result.reason };
  }

  /**
   * @param {number} lane
   * @param {number} column
   * @param {string | null} [requestedId]
   * @returns {{ok: boolean, reason: string | null, defender?: any}}
   */
  placeDefender(lane, column, requestedId = this.state.selectedDefenderId) {
    if (this.state.status !== "playing") {
      this.emit("invalid-placement", { defenderId: requestedId, lane, column, reason: "paused" });
      return { ok: false, reason: "paused" };
    }
    if (!requestedId) {
      this.emit("invalid-placement", { defenderId: null, lane, column, reason: "no-selection" });
      return { ok: false, reason: "no-selection" };
    }
    const result = this.validatePlacement(requestedId, lane, column);
    if (!result.ok) {
      this.emit("invalid-placement", { defenderId: requestedId, lane, column, reason: result.reason });
      return result;
    }

    const definition = DEFENDER_BY_ID[requestedId];
    const id = this.nextId("cat");
    const defender = {
      id,
      definitionId: requestedId,
      definition,
      lane,
      column,
      x: column + 0.5,
      health: definition.maxHealth,
      maxHealth: definition.maxHealth,
      state: "active",
      placedAt: this.state.elapsedMs,
      nextActionAt: this.firstActionTime(definition),
      attackUntil: 0,
      hitUntil: 0,
      defeatedAt: 0,
    };
    this.state.defenders.push(defender);
    this.state.occupied.set(coordKey(lane, column), id);
    this.state.energy -= definition.cost;
    this.state.cooldownUntil[requestedId] = this.state.elapsedMs + definition.cooldownMs;
    this.state.stats.placed += 1;
    this.emit("defender-placed", { defender });
    this.render();
    return { ok: true, reason: null, defender };
  }

  /**
   * @param {any} definition
   * @returns {number}
   */
  firstActionTime(definition) {
    if (definition.behaviorType === "energy-producer") {
      return this.state.elapsedMs + Number(definition.stats?.firstProductionDelayMs ?? definition.attackIntervalMs);
    }
    if (definition.behaviorType === "area-burst") {
      return this.state.elapsedMs + Number(definition.stats?.fuseMs ?? 1000);
    }
    return this.state.elapsedMs + Math.min(700, Math.max(180, definition.attackIntervalMs * 0.45));
  }

  /** @param {string} orbId */
  collectEnergy(orbId) {
    if (this.state.status !== "playing") return false;
    const index = this.state.energyOrbs.findIndex((orb) => orb.id === orbId && orb.state === "active");
    if (index < 0) return false;
    const [orb] = this.state.energyOrbs.splice(index, 1);
    orb.state = "collected";
    this.state.energy += orb.value;
    this.state.stats.collectedEnergy += orb.value;
    this.emit("energy-collected", { orb, total: this.state.energy });
    this.render();
    return true;
  }

  /** @param {number} timestamp */
  frame(timestamp) {
    this.frameRequest = 0;
    if (this.state.status !== "playing") return;
    const deltaMs = clamp(timestamp - this.lastFrameAt, 0, MAX_DELTA_MS) * this.state.speed;
    this.lastFrameAt = timestamp;
    this.step(deltaMs);
    this.render();
    this.scheduleFrame();
  }

  /** @param {number} deltaMs */
  step(deltaMs) {
    if (this.state.status !== "playing" || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.state.elapsedMs += deltaMs;
    this.processTutorial();
    this.processFinalWarning();
    this.processWaves();
    this.processAmbientEnergy();
    this.processPendingShots();
    this.processDefenders();
    this.processEnemies(deltaMs);
    if (this.state.status !== "playing") return;
    this.processProjectiles(deltaMs);
    this.expireEnergy();
    this.cleanupEntities();
    this.evaluateOutcome();
  }

  processTutorial() {
    while (
      this.state.tutorialCursor < this.level.tutorial.length &&
      this.level.tutorial[this.state.tutorialCursor].atMs <= this.state.elapsedMs
    ) {
      const cue = this.level.tutorial[this.state.tutorialCursor];
      this.state.tutorialCursor += 1;
      this.emit("tutorial", cue);
    }
  }

  processFinalWarning() {
    if (
      !this.state.finalWarningShown &&
      this.state.finalWaveStartMs > 0 &&
      this.state.elapsedMs >= Math.max(0, this.state.finalWaveStartMs - 5_000)
    ) {
      this.state.finalWarningShown = true;
      this.emit("final-wave-warning", { startsAt: this.state.finalWaveStartMs });
    }
  }

  processWaves() {
    while (
      this.state.nextSpawnIndex < this.state.spawnQueue.length &&
      this.state.spawnQueue[this.state.nextSpawnIndex].atMs <= this.state.elapsedMs
    ) {
      const spawn = this.state.spawnQueue[this.state.nextSpawnIndex];
      this.state.nextSpawnIndex += 1;
      this.spawnEnemy(spawn.enemyId, spawn.lane, spawn);
    }
  }

  processAmbientEnergy() {
    if (this.state.elapsedMs < this.state.nextAmbientEnergyAt) return;
    this.spawnEnergy({
      lane: Math.floor(this.random() * this.level.laneCount),
      x: 1.2 + this.random() * 6.8,
      value: 25,
      source: "garden",
    });
    this.state.nextAmbientEnergyAt += this.level.ambientEnergyIntervalMs;
  }

  /** @param {string} enemyId @param {number} lane @param {any} spawn */
  spawnEnemy(enemyId, lane, spawn) {
    const definition = ENEMY_BY_ID[enemyId];
    if (!definition) return;
    const enemy = {
      id: this.nextId("dog"),
      definitionId: enemyId,
      definition,
      lane,
      x: ENEMY_ENTRY_X + this.random() * 0.18,
      previousX: ENEMY_ENTRY_X,
      health: definition.maxHealth,
      maxHealth: definition.maxHealth,
      armor: definition.armor,
      maxArmor: definition.armor,
      shieldHealth: definition.shieldHealth,
      maxShieldHealth: definition.shieldHealth,
      state: "active",
      statuses: [],
      weakenedUntil: 0,
      weakenedMultiplier: 1,
      engagedDefenderId: null,
      nextAttackAt: this.state.elapsedMs + definition.attackIntervalMs,
      attackUntil: 0,
      hitUntil: 0,
      defeatedAt: 0,
      hitRadius: 0.25,
      spawn,
    };
    this.state.enemies.push(enemy);
    this.state.stats.spawnedEnemies += 1;
    this.emit("enemy-spawned", { enemy, waveIndex: spawn.waveIndex, final: spawn.final });
  }

  /** @param {{lane: number, x: number, value: number, source: string}} options */
  spawnEnergy(options) {
    if (this.state.energyOrbs.length >= 8) return;
    const orb = {
      id: this.nextId("paw"),
      lane: clamp(options.lane, 0, this.level.laneCount - 1),
      x: clamp(options.x, 0.7, this.level.columnCount - 0.5),
      value: options.value,
      source: options.source,
      state: "active",
      spawnedAt: this.state.elapsedMs,
      expiresAt: this.state.elapsedMs + 10_500,
    };
    this.state.energyOrbs.push(orb);
    this.emit("energy-spawned", { orb });
  }

  processDefenders() {
    /** @type {any[] | null} */
    let activeEnemies = null;
    for (const defender of this.state.defenders) {
      if (!isActive(defender) || defender.nextActionAt > this.state.elapsedMs) continue;
      const definition = defender.definition;
      switch (definition.behaviorType) {
        case "energy-producer":
          this.spawnEnergy({ lane: defender.lane, x: defender.x, value: Number(definition.stats?.energyAmount ?? 25), source: defender.id });
          defender.attackUntil = this.state.elapsedMs + 500;
          defender.nextActionAt += definition.attackIntervalMs;
          this.emit("energy-produced", { defender });
          break;
        case "area-burst":
          this.activateBurst(defender);
          break;
        case "root-pulse":
          activeEnemies ??= this.state.enemies.filter(isActive);
          defender.nextActionAt = this.activateRootPulse(defender, activeEnemies)
            ? this.state.elapsedMs + definition.attackIntervalMs
            : this.state.elapsedMs + 350;
          break;
        case "blocker":
          defender.nextActionAt = Number.POSITIVE_INFINITY;
          break;
        default:
          activeEnemies ??= this.state.enemies.filter(isActive);
          defender.nextActionAt = this.fireDefender(defender, activeEnemies)
            ? this.state.elapsedMs + definition.attackIntervalMs
            : this.state.elapsedMs + 240;
          break;
      }
    }
  }

  /** @param {any} defender @param {any[]} [activeEnemies] @returns {boolean} */
  fireDefender(defender, activeEnemies = this.state.enemies.filter(isActive)) {
    const definition = defender.definition;
    const target = selectSameLaneTarget(
      { lane: defender.lane, x: defender.x },
      activeEnemies,
      { maxRange: definition.range },
    );
    if (!target) {
      return false;
    }

    defender.attackUntil = this.state.elapsedMs + 280;
    this.createProjectile(defender, definition);
    this.emit("defender-fired", { defender, target, shot: 1 });
    if (definition.behaviorType === "double-shot") {
      const shots = Math.max(2, Number(definition.stats?.shotsPerBurst ?? 2));
      const gap = Number(definition.stats?.burstGapMs ?? 180);
      for (let shot = 1; shot < shots; shot += 1) {
        this.state.pendingShots.push({
          atMs: this.state.elapsedMs + gap * shot,
          defenderId: defender.id,
          shot: shot + 1,
        });
      }
    }
    return true;
  }

  processPendingShots() {
    if (this.state.pendingShots.length === 0) return;
    const activeEnemies = this.state.enemies.filter(isActive);
    for (let index = this.state.pendingShots.length - 1; index >= 0; index -= 1) {
      const pending = this.state.pendingShots[index];
      if (pending.atMs > this.state.elapsedMs) continue;
      this.state.pendingShots.splice(index, 1);
      const defender = this.state.defenders.find((candidate) => candidate.id === pending.defenderId);
      if (!isActive(defender)) continue;
      const target = selectSameLaneTarget(
        { lane: defender.lane, x: defender.x },
        activeEnemies,
        { maxRange: defender.definition.range },
      );
      if (!target) continue;
      this.createProjectile(defender, defender.definition);
      defender.attackUntil = this.state.elapsedMs + 240;
      this.emit("defender-fired", { defender, target, shot: pending.shot });
    }
  }

  /** @param {any} defender @param {any} definition */
  createProjectile(defender, definition) {
    const projectile = this.projectilePool.pop() ?? {};
    projectile.id = this.nextId("shot");
    projectile.sourceId = defender.id;
    projectile.sourceDefinitionId = definition.id;
    projectile.lane = defender.lane;
    projectile.x = defender.x + 0.32;
    projectile.previousX = projectile.x;
    projectile.damage = definition.attackDamage;
    projectile.speed = Number(definition.stats?.projectileSpeed ?? 320) / PROJECTILE_SCALE;
    projectile.armorBypass = Number(definition.stats?.armorBypass ?? 0);
    projectile.slowDurationMs = Number(definition.stats?.slowDurationMs ?? 0);
    projectile.slowMultiplier = Number(definition.stats?.slowMultiplier ?? 1);
    projectile.kind = definition.behaviorType === "slow-shot" ? "frost" : definition.behaviorType === "heavy-shot" ? "heavy" : "bubble";
    projectile.radius = projectile.kind === "heavy" ? 0.12 : 0.08;
    projectile.state = "active";
    this.state.projectiles.push(projectile);
  }

  /** @param {any} defender @param {any[]} [activeEnemies] @returns {boolean} */
  activateRootPulse(defender, activeEnemies = this.state.enemies.filter(isActive)) {
    const definition = defender.definition;
    const target = selectSameLaneTarget(
      { lane: defender.lane, x: defender.x },
      activeEnemies,
      { maxRange: definition.range },
    );
    if (!target) {
      return false;
    }
    target.statuses = applyRoot(target.statuses, Number(definition.stats?.rootDurationMs ?? 1_500), defender.id);
    target.weakenedUntil = Math.max(target.weakenedUntil, this.state.elapsedMs + Number(definition.stats?.weakenDurationMs ?? 0));
    target.weakenedMultiplier = Math.max(target.weakenedMultiplier, Number(definition.stats?.weakenMultiplier ?? 1));
    defender.attackUntil = this.state.elapsedMs + 600;
    this.emit("root-pulse", { defender, target });
    return true;
  }

  /** @param {any} defender */
  activateBurst(defender) {
    const radius = Number(defender.definition.stats?.radiusCells ?? defender.definition.range);
    const targets = this.state.enemies.filter((enemy) =>
      isActive(enemy) &&
      Math.hypot(enemy.lane - defender.lane, enemy.x - defender.x) <= radius,
    );
    for (const enemy of targets) {
      this.damageEnemy(enemy, defender.definition.attackDamage, { source: "burst" });
    }
    this.emit("burst-activated", { defender, targets });
    this.defeatDefender(defender, "activated");
  }

  /** @param {number} deltaMs */
  processEnemies(deltaMs) {
    for (const enemy of this.state.enemies) {
      if (this.state.status !== "playing") break;
      if (!isActive(enemy)) continue;
      enemy.statuses = advanceStatuses(enemy.statuses, deltaMs);
      if (enemy.weakenedUntil <= this.state.elapsedMs) enemy.weakenedMultiplier = 1;

      const blocker = this.findBlocker(enemy);
      if (blocker) {
        enemy.engagedDefenderId = blocker.id;
        enemy.x = Math.max(enemy.x, blocker.x + 0.38);
        if (enemy.nextAttackAt <= this.state.elapsedMs) {
          enemy.nextAttackAt = this.state.elapsedMs + enemy.definition.attackIntervalMs;
          enemy.attackUntil = this.state.elapsedMs + 430;
          this.damageDefender(blocker, enemy.definition.attackDamage, enemy);
        }
        continue;
      }

      enemy.engagedDefenderId = null;
      const movementMultiplier = getMovementMultiplier(enemy.statuses);
      const chargeMultiplier = enemy.definition.behaviorType === "charging-brute"
        ? Number(enemy.definition.stats?.chargeMultiplier ?? 1)
        : 1;
      const cellsPerSecond = enemy.definition.movementSpeed / PROJECTILE_SCALE;
      enemy.previousX = enemy.x;
      enemy.x -= cellsPerSecond * chargeMultiplier * movementMultiplier * (deltaMs / 1000);
      if (enemy.x <= ENDPOINT_X) this.handleBreach(enemy);
    }
  }

  /** @param {any} enemy @returns {any | null} */
  findBlocker(enemy) {
    let blocker = null;
    let blockerX = -Infinity;
    for (const defender of this.state.defenders) {
      if (!isActive(defender) || defender.lane !== enemy.lane) continue;
      if (defender.x > enemy.x + 0.48 || enemy.x - defender.x > 0.66) continue;
      if (defender.x > blockerX) {
        blocker = defender;
        blockerX = defender.x;
      }
    }
    return blocker;
  }

  /** @param {any} defender @param {number} damage @param {any} enemy */
  damageDefender(defender, damage, enemy) {
    if (!isActive(defender)) return;
    const safeDamage = Number.isFinite(damage) ? Math.max(0, damage) : 0;
    if (safeDamage <= 0) return;
    defender.health = Math.max(0, defender.health - safeDamage);
    defender.hitUntil = this.state.elapsedMs + 220;
    this.emit("defender-hit", { defender, enemy, damage: safeDamage });
    if (defender.health <= 0) this.defeatDefender(defender, "overrun");
  }

  /** @param {any} defender @param {string} reason */
  defeatDefender(defender, reason) {
    if (defender.state !== "active") return;
    defender.state = "defeated";
    defender.health = 0;
    defender.defeatedAt = this.state.elapsedMs;
    this.state.occupied.delete(coordKey(defender.lane, defender.column));
    this.emit("defender-defeated", { defender, reason });
  }

  /** @param {number} deltaMs */
  processProjectiles(deltaMs) {
    if (this.state.projectiles.length === 0) return;
    const activeEnemies = this.state.enemies.filter(isActive);
    for (let index = this.state.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.state.projectiles[index];
      projectile.previousX = projectile.x;
      projectile.x += projectile.speed * (deltaMs / 1000);
      const hit = findSweptCollision(
        projectile,
        activeEnemies,
      );
      if (hit) {
        this.damageEnemy(hit.target, projectile.damage, {
          source: projectile.kind,
          armorBypass: projectile.armorBypass,
          projectile,
        });
        if (projectile.slowDurationMs > 0 && isActive(hit.target)) {
          hit.target.statuses = applySlow(
            hit.target.statuses,
            projectile.slowDurationMs,
            projectile.slowMultiplier,
            projectile.sourceId,
          );
          this.emit("enemy-slowed", { enemy: hit.target, projectile });
        }
        this.emit("projectile-impact", { projectile, enemy: hit.target, x: hit.x });
        this.releaseProjectile(index);
      } else if (projectile.x > this.level.columnCount + 0.8) {
        this.releaseProjectile(index);
      }
    }
  }

  /** @param {number} index */
  releaseProjectile(index) {
    const [projectile] = this.state.projectiles.splice(index, 1);
    if (!projectile) return;
    projectile.state = "pooled";
    if (this.projectilePool.length < 48) this.projectilePool.push(projectile);
  }

  /**
   * @param {any} enemy
   * @param {number} damage
   * @param {{source: string, armorBypass?: number, projectile?: any}} options
   */
  damageEnemy(enemy, damage, options) {
    if (!isActive(enemy)) return;
    const previousArmor = enemy.armor;
    const previousShield = enemy.shieldHealth;
    let adjustedDamage = damage * (enemy.weakenedUntil > this.state.elapsedMs ? enemy.weakenedMultiplier : 1);
    if (enemy.definition.behaviorType === "shield-walker" && previousShield > 0 && options.source === "bubble") {
      adjustedDamage *= Number(enemy.definition.stats?.basicProjectileDamageMultiplier ?? 1);
    }
    const result = applyLayeredDamage(
      { health: enemy.health, armor: enemy.armor, shieldHealth: enemy.shieldHealth },
      adjustedDamage,
      { armorBypass: options.armorBypass ?? 0 },
    );
    enemy.health = result.health;
    enemy.armor = result.armor;
    enemy.shieldHealth = result.shieldHealth;
    enemy.hitUntil = this.state.elapsedMs + 220;
    this.emit("enemy-hit", { enemy, result, source: options.source });
    if (previousShield > 0 && enemy.shieldHealth === 0) this.emit("shield-broken", { enemy });
    if (previousArmor > 0 && enemy.armor === 0) this.emit("armor-broken", { enemy });
    if (enemy.health <= 0) this.defeatEnemy(enemy, options.source);
  }

  /** @param {any} enemy @param {string} source */
  defeatEnemy(enemy, source) {
    if (enemy.state !== "active") return;
    enemy.state = "defeated";
    enemy.health = 0;
    enemy.defeatedAt = this.state.elapsedMs;
    enemy.engagedDefenderId = null;
    this.state.stats.defeatedEnemies += 1;
    this.emit("enemy-defeated", { enemy, source });
  }

  /** @param {any} enemy */
  handleBreach(enemy) {
    if (this.state.status !== "playing") return;
    if (!isActive(enemy)) return;
    const lane = enemy.lane;
    if (this.state.laneDefenses[lane]) {
      this.state.laneDefenses[lane] = false;
      this.state.laneSweepsUntil[lane] = this.state.elapsedMs + 1_250;
      const swept = this.state.enemies.filter((candidate) => isActive(candidate) && candidate.lane === lane);
      for (const candidate of swept) this.defeatEnemy(candidate, "yarn-sweeper");
      this.emit("lane-defense-activated", { lane, enemies: swept });
      return;
    }
    this.state.status = "defeat";
    this.cancelFrame();
    this.emit("defeat", { lane, enemy });
  }

  expireEnergy() {
    for (let index = this.state.energyOrbs.length - 1; index >= 0; index -= 1) {
      if (this.state.energyOrbs[index].expiresAt > this.state.elapsedMs) continue;
      const [orb] = this.state.energyOrbs.splice(index, 1);
      this.emit("energy-expired", { orb });
    }
  }

  cleanupEntities() {
    const now = this.state.elapsedMs;
    if (this.state.defenders.some((defender) => defender.state !== "active" && now - defender.defeatedAt >= 520)) {
      this.state.defenders = this.state.defenders.filter((defender) => defender.state === "active" || now - defender.defeatedAt < 520);
    }
    if (this.state.enemies.some((enemy) => enemy.state !== "active" && now - enemy.defeatedAt >= 560)) {
      this.state.enemies = this.state.enemies.filter((enemy) => enemy.state === "active" || now - enemy.defeatedAt < 560);
    }
  }

  evaluateOutcome() {
    if (this.state.status !== "playing") return;
    const allSpawned = this.state.nextSpawnIndex >= this.state.spawnQueue.length;
    const activeEnemies = this.state.enemies.some(isActive);
    if (allSpawned && !activeEnemies) {
      this.state.status = "victory";
      this.cancelFrame();
      this.emit("victory", { levelId: this.level.id, stats: { ...this.state.stats } });
    }
  }

  /** @param {string} type @param {any} detail */
  emit(type, detail) {
    try {
      this.onEvent({ type, detail });
    } catch (error) {
      console.error("Game event handler failed", error);
    }
  }

  render() {
    try {
      this.onFrame(this.state);
    } catch (error) {
      console.error("Game renderer failed", error);
    }
  }

  scheduleFrame() {
    if (this.frameRequest || this.state.status !== "playing") return;
    if (typeof requestAnimationFrame === "function") {
      this.frameRequest = requestAnimationFrame(this.boundFrame);
    } else {
      this.frameRequest = /** @type {any} */ (setTimeout(() => this.frame(Date.now()), 16));
    }
  }

  cancelFrame() {
    if (!this.frameRequest) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frameRequest);
    else clearTimeout(this.frameRequest);
    this.frameRequest = 0;
  }

  /** @param {string} prefix @returns {string} */
  nextId(prefix) {
    this.entitySequence += 1;
    return `${prefix}-${this.entitySequence}`;
  }

  /** @returns {number} */
  getWaveProgress() {
    const total = Math.max(1, this.state.stats.totalEnemies);
    return safeRatio((this.state.nextSpawnIndex + this.state.stats.defeatedEnemies) / (total * 2));
  }

  /** @returns {number} */
  getCurrentWaveNumber() {
    let current = 1;
    for (let index = 0; index < this.level.waves.length; index += 1) {
      if (this.level.waves[index].startTimeMs <= this.state.elapsedMs) current = index + 1;
    }
    return current;
  }
}

export default GameEngine;
