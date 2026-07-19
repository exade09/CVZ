// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { DEFENDER_BY_ID } from "../config/defenders.js";
import { ENEMY_BY_ID } from "../config/enemies.js";
import { GameEngine } from "../core/engine.js";
import { LEVELS } from "../levels/levels.js";

/**
 * @param {readonly any[]} waves
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
function createTestLevel(waves, overrides = {}) {
  return {
    ...LEVELS[0],
    id: "engine-test",
    startingEnergy: 500,
    firstAmbientEnergyDelayMs: Number.POSITIVE_INFINITY,
    ambientEnergyIntervalMs: Number.POSITIVE_INFINITY,
    tutorial: [],
    waves,
    ...overrides,
  };
}

/** @returns {any} */
function createIdleLevel() {
  return createTestLevel([
    {
      id: "idle-final",
      startTimeMs: 60_000,
      final: true,
      entries: [{ enemyId: "stray-dog", lane: 0, delayMs: 0 }],
    },
  ]);
}

/** @param {any} level @param {Array<any>} [events] */
function createEngine(level, events = []) {
  return new GameEngine({
    level,
    random: () => 0,
    onEvent: (event) => events.push(event),
  });
}

const SPAWN_META = Object.freeze({ waveIndex: 0, final: false });

test("placement deducts energy once and rejects a duplicate cell", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";

  const definition = DEFENDER_BY_ID["bubble-sprout"];
  const energyBefore = engine.state.energy;
  const first = engine.placeDefender(2, 3, definition.id);
  const duplicate = engine.placeDefender(2, 3, definition.id);

  assert.equal(first.ok, true);
  assert.deepEqual(duplicate, { ok: false, reason: "occupied" });
  assert.equal(engine.state.energy, energyBefore - definition.cost);
  assert.equal(engine.state.defenders.length, 1);
  assert.equal(engine.state.stats.placed, 1);
  assert.equal(engine.state.occupied.size, 1);
});

test("defender cooldown blocks reuse until simulation time reaches readiness", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";
  const definition = DEFENDER_BY_ID["bubble-sprout"];
  assert.equal(engine.placeDefender(0, 0, definition.id).ok, true);
  assert.equal(engine.validatePlacement(definition.id, 1, 0).reason, "cooldown");
  engine.step(definition.cooldownMs - 1);
  assert.equal(engine.validatePlacement(definition.id, 1, 0).reason, "cooldown");
  engine.step(1);
  assert.equal(engine.validatePlacement(definition.id, 1, 0).ok, true);
});

test("expired Paw Energy is removed exactly once", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);
  engine.state.status = "playing";
  engine.spawnEnergy({ lane: 2, x: 3, value: 25, source: "test" });
  const orb = engine.state.energyOrbs[0];
  engine.state.elapsedMs = orb.expiresAt;
  engine.expireEnergy();
  engine.expireEnergy();
  assert.equal(engine.state.energyOrbs.length, 0);
  assert.equal(events.filter((event) => event.type === "energy-expired").length, 1);
});

test("a projectile only damages an enemy in its own lane", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";

  const placed = engine.placeDefender(0, 0, "bubble-sprout");
  assert.equal(placed.ok, true);

  engine.spawnEnemy("stray-dog", 1, SPAWN_META);
  engine.spawnEnemy("stray-dog", 0, SPAWN_META);
  const wrongLane = engine.state.enemies[0];
  const sameLane = engine.state.enemies[1];
  wrongLane.x = 2;
  sameLane.x = 3;

  engine.createProjectile(placed.defender, DEFENDER_BY_ID["bubble-sprout"]);
  engine.processProjectiles(1_000);

  assert.equal(wrongLane.health, ENEMY_BY_ID["stray-dog"].maxHealth);
  assert.equal(
    sameLane.health,
    ENEMY_BY_ID["stray-dog"].maxHealth - DEFENDER_BY_ID["bubble-sprout"].attackDamage,
  );
  assert.equal(engine.state.projectiles.length, 0);
});

test("scheduled wave entries spawn exactly once across pause and resume", () => {
  const waves = [
    {
      id: "test-wave-one",
      startTimeMs: 100,
      final: false,
      entries: [
        { enemyId: "stray-dog", lane: 0, delayMs: 0 },
        { enemyId: "stray-dog", lane: 1, delayMs: 100 },
      ],
    },
    {
      id: "test-wave-final",
      startTimeMs: 400,
      final: true,
      entries: [{ enemyId: "cone-dog", lane: 2, delayMs: 0 }],
    },
  ];
  const events = [];
  const engine = createEngine(createTestLevel(waves), events);
  engine.scheduleFrame = () => {};
  engine.state.status = "playing";

  engine.step(100);
  assert.equal(engine.state.stats.spawnedEnemies, 1);

  engine.pause();
  engine.step(100);
  assert.equal(engine.state.elapsedMs, 100);
  assert.equal(engine.state.stats.spawnedEnemies, 1);

  engine.resume();
  engine.step(100);
  assert.equal(engine.state.stats.spawnedEnemies, 2);

  engine.pause();
  engine.resume();
  engine.step(200);
  engine.step(1_000);

  const spawnEvents = events.filter((event) => event.type === "enemy-spawned");
  assert.equal(engine.state.nextSpawnIndex, 3);
  assert.equal(engine.state.stats.spawnedEnemies, 3);
  assert.equal(spawnEvents.length, 3);
  assert.equal(new Set(spawnEvents.map((event) => event.detail.enemy.id)).size, 3);
});

test("shield and armor effects are routed through the engine", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);

  engine.spawnEnemy("gate-dog", 0, SPAWN_META);
  engine.spawnEnemy("cone-dog", 1, SPAWN_META);
  const shielded = engine.state.enemies[0];
  const armored = engine.state.enemies[1];

  engine.damageEnemy(shielded, 100, { source: "bubble" });
  engine.damageEnemy(armored, 100, {
    source: "heavy",
    armorBypass: DEFENDER_BY_ID["leaf-beast"].stats.armorBypass,
  });

  assert.equal(shielded.shieldHealth, ENEMY_BY_ID["gate-dog"].shieldHealth - 72);
  assert.equal(shielded.armor, ENEMY_BY_ID["gate-dog"].armor);
  assert.equal(shielded.health, ENEMY_BY_ID["gate-dog"].maxHealth);
  assert.equal(armored.armor, ENEMY_BY_ID["cone-dog"].armor - 55);
  assert.equal(armored.health, ENEMY_BY_ID["cone-dog"].maxHealth - 45);

  const hitResults = events
    .filter((event) => event.type === "enemy-hit")
    .map((event) => event.detail.result);
  assert.equal(hitResults[0].shieldDamage, 72);
  assert.equal(hitResults[0].armorDamage, 0);
  assert.equal(hitResults[0].healthDamage, 0);
  assert.equal(hitResults[1].armorDamage, 55);
  assert.equal(hitResults[1].healthDamage, 45);
});

test("the first lane breach consumes the Yarn Sweeper and the second defeats", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);
  engine.state.status = "playing";

  engine.spawnEnemy("stray-dog", 2, SPAWN_META);
  engine.spawnEnemy("cone-dog", 2, SPAWN_META);
  engine.spawnEnemy("stray-dog", 3, SPAWN_META);
  const firstBreach = engine.state.enemies[0];
  const laneMate = engine.state.enemies[1];
  const otherLane = engine.state.enemies[2];

  engine.handleBreach(firstBreach);

  assert.equal(engine.state.status, "playing");
  assert.equal(engine.state.laneDefenses[2], false);
  assert.equal(engine.state.laneSweepsUntil[2], 1_250);
  assert.equal(firstBreach.state, "defeated");
  assert.equal(laneMate.state, "defeated");
  assert.equal(otherLane.state, "active");
  assert.equal(
    events.filter((event) => event.type === "lane-defense-activated").length,
    1,
  );

  engine.spawnEnemy("stray-dog", 2, SPAWN_META);
  const secondBreach = engine.state.enemies.at(-1);
  engine.handleBreach(secondBreach);
  engine.handleBreach(secondBreach);

  assert.equal(engine.state.status, "defeat");
  assert.equal(secondBreach.state, "active");
  assert.equal(events.filter((event) => event.type === "defeat").length, 1);
});

test("victory waits for every scheduled spawn and every active enemy", () => {
  const level = createTestLevel([
    {
      id: "victory-final",
      startTimeMs: 100,
      final: true,
      entries: [
        { enemyId: "stray-dog", lane: 0, delayMs: 0 },
        { enemyId: "stray-dog", lane: 1, delayMs: 200 },
      ],
    },
  ]);
  const events = [];
  const engine = createEngine(level, events);
  engine.state.status = "playing";

  engine.evaluateOutcome();
  assert.equal(engine.state.status, "playing");

  engine.step(100);
  const firstEnemy = engine.state.enemies.find((enemy) => enemy.state === "active");
  engine.defeatEnemy(firstEnemy, "test");
  engine.evaluateOutcome();
  assert.equal(engine.state.nextSpawnIndex, 1);
  assert.equal(engine.state.status, "playing");

  engine.step(200);
  const secondEnemy = engine.state.enemies.find((enemy) => enemy.state === "active");
  assert.ok(secondEnemy);
  assert.equal(engine.state.nextSpawnIndex, 2);
  assert.equal(engine.state.status, "playing");

  engine.defeatEnemy(secondEnemy, "test");
  engine.evaluateOutcome();
  engine.evaluateOutcome();
  assert.equal(engine.state.status, "victory");
  assert.equal(events.filter((event) => event.type === "victory").length, 1);
});

test("a terminal breach stops the tick and emits defeat exactly once", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);
  engine.state.status = "playing";
  engine.state.laneDefenses[0] = false;
  engine.state.laneDefenses[1] = false;
  engine.spawnEnemy("stray-dog", 0, SPAWN_META);
  engine.spawnEnemy("stray-dog", 1, SPAWN_META);
  engine.spawnEnemy("stray-dog", 2, SPAWN_META);
  const [firstBreach, secondBreach, projectileTarget] = engine.state.enemies;
  firstBreach.x = 0.17;
  secondBreach.x = 0.17;
  projectileTarget.x = 1.5;
  const defender = engine.placeDefender(2, 0, "bubble-sprout").defender;
  engine.createProjectile(defender, DEFENDER_BY_ID["bubble-sprout"]);

  engine.step(50);
  engine.handleBreach(secondBreach);
  engine.evaluateOutcome();

  assert.equal(engine.state.status, "defeat");
  assert.equal(events.filter((event) => event.type === "defeat").length, 1);
  assert.equal(secondBreach.state, "active");
  assert.equal(projectileTarget.health, ENEMY_BY_ID["stray-dog"].maxHealth);
  assert.equal(events.some((event) => event.type === "projectile-impact"), false);
});

test("defender health rejects non-finite and negative damage", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";
  const defender = engine.placeDefender(0, 0, "shell-guard").defender;
  const health = defender.health;

  engine.damageDefender(defender, Number.NaN, null);
  engine.damageDefender(defender, Number.POSITIVE_INFINITY, null);
  engine.damageDefender(defender, -100, null);

  assert.equal(defender.health, health);
  assert.equal(Number.isFinite(defender.health), true);
});

test("engine start is idempotent and cannot revive a destroyed instance", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);
  engine.scheduleFrame = () => {};

  engine.start();
  engine.start();
  assert.equal(events.filter((event) => event.type === "started").length, 1);
  engine.destroy();
  engine.start();
  assert.equal(engine.state.status, "destroyed");
  assert.equal(events.filter((event) => event.type === "started").length, 1);
});

test("pause freezes movement, projectiles, effects, resources, and cooldowns", () => {
  const engine = createEngine(createIdleLevel());
  engine.scheduleFrame = () => {};
  engine.state.status = "playing";
  const defender = engine.placeDefender(0, 0, "bubble-sprout").defender;
  engine.spawnEnemy("stray-dog", 0, SPAWN_META);
  const enemy = engine.state.enemies[0];
  enemy.x = 4;
  enemy.statuses = [{ type: "slow", remainingMs: 2_000, multiplier: 0.5 }];
  engine.createProjectile(defender, DEFENDER_BY_ID["bubble-sprout"]);
  engine.spawnEnergy({ lane: 1, x: 2, value: 25, source: "test" });
  const before = {
    elapsedMs: engine.state.elapsedMs,
    enemyX: enemy.x,
    slowMs: enemy.statuses[0].remainingMs,
    projectileX: engine.state.projectiles[0].x,
    orbExpiry: engine.state.energyOrbs[0].expiresAt,
    cooldown: engine.state.cooldownUntil["bubble-sprout"],
  };

  engine.pause("manual");
  engine.step(5_000);

  assert.deepEqual({
    elapsedMs: engine.state.elapsedMs,
    enemyX: enemy.x,
    slowMs: enemy.statuses[0].remainingMs,
    projectileX: engine.state.projectiles[0].x,
    orbExpiry: engine.state.energyOrbs[0].expiresAt,
    cooldown: engine.state.cooldownUntil["bubble-sprout"],
  }, before);
  assert.equal(engine.collectEnergy(engine.state.energyOrbs[0].id), false);
});

test("multiple dogs can attack one blocker and resume after its defeat", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";
  const blocker = engine.placeDefender(2, 3, "shell-guard").defender;
  engine.spawnEnemy("stray-dog", 2, SPAWN_META);
  engine.spawnEnemy("cone-dog", 2, SPAWN_META);
  const [first, second] = engine.state.enemies;
  first.x = blocker.x + 0.4;
  second.x = blocker.x + 0.42;
  first.nextAttackAt = 0;
  second.nextAttackAt = 0;
  const expected = blocker.health - first.definition.attackDamage - second.definition.attackDamage;

  engine.processEnemies(50);
  assert.equal(blocker.health, expected);
  assert.equal(first.engagedDefenderId, blocker.id);
  assert.equal(second.engagedDefenderId, blocker.id);

  engine.damageDefender(blocker, blocker.health, first);
  const previousX = first.x;
  engine.processEnemies(1_000);
  assert.equal(first.engagedDefenderId, null);
  assert.ok(first.x < previousX);
});

test("shield and armor break events are unique across later damage", () => {
  const events = [];
  const engine = createEngine(createIdleLevel(), events);
  engine.spawnEnemy("gate-dog", 0, SPAWN_META);
  const gate = engine.state.enemies[0];

  engine.damageEnemy(gate, 1_000, { source: "heavy" });
  engine.damageEnemy(gate, 20, { source: "heavy" });

  assert.equal(events.filter((event) => event.type === "shield-broken").length, 1);
  assert.equal(events.filter((event) => event.type === "armor-broken").length, 1);
});

test("a pooled frost projectile is fully reset when reused by a basic cat", () => {
  const engine = createEngine(createIdleLevel());
  engine.state.status = "playing";
  const frost = engine.placeDefender(0, 0, "bubble-sprout").defender;
  engine.spawnEnemy("stray-dog", 0, SPAWN_META);
  engine.state.enemies[0].x = 1.5;
  engine.createProjectile(frost, DEFENDER_BY_ID["frost-bloom"]);
  engine.processProjectiles(1_000);
  assert.equal(engine.projectilePool.length, 1);

  const bubble = engine.placeDefender(1, 0, "sunny-bloom").defender;
  engine.createProjectile(bubble, DEFENDER_BY_ID["bubble-sprout"]);
  const reused = engine.state.projectiles[0];
  assert.equal(reused.kind, "bubble");
  assert.equal(reused.slowDurationMs, 0);
  assert.equal(reused.slowMultiplier, 1);
  assert.equal(reused.armorBypass, 0);
});
