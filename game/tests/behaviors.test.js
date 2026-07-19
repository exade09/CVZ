// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { DEFENDERS, DEFENDER_BY_ID } from "../config/defenders.js";
import { ENEMIES, ENEMY_BY_ID } from "../config/enemies.js";
import { GameEngine } from "../core/engine.js";
import { LEVELS } from "../levels/levels.js";

const SPAWN_META = Object.freeze({ waveIndex: 0, final: false });

/** @returns {any} */
function createSandboxLevel() {
  return {
    ...LEVELS[2],
    id: "behavior-sandbox",
    startingEnergy: 10_000,
    firstAmbientEnergyDelayMs: Number.POSITIVE_INFINITY,
    ambientEnergyIntervalMs: Number.POSITIVE_INFINITY,
    availableDefenders: DEFENDERS.map((defender) => defender.id),
    tutorial: [],
    waves: [{
      id: "distant-final",
      startTimeMs: 1_000_000,
      final: true,
      entries: [{ enemyId: "stray-dog", lane: 0, delayMs: 0 }],
    }],
  };
}

/** @param {Array<any>} [events] */
function createSandboxEngine(events = []) {
  const engine = new GameEngine({
    level: createSandboxLevel(),
    random: () => 0,
    onEvent: (event) => events.push(event),
  });
  engine.state.status = "playing";
  return engine;
}

test("the complete roster exposes eight distinct defender behaviors", () => {
  assert.equal(DEFENDERS.length, 8);
  assert.equal(new Set(DEFENDERS.map((defender) => defender.behaviorType)).size, 8);
  assert.deepEqual(
    DEFENDERS.map((defender) => defender.behaviorType),
    ["single-shot", "energy-producer", "blocker", "double-shot", "slow-shot", "area-burst", "heavy-shot", "root-pulse"],
  );
});

test("Sunny Bloom produces collectible Paw Energy and Shell Guard remains passive", () => {
  const events = [];
  const engine = createSandboxEngine(events);
  const sunny = engine.placeDefender(0, 0, "sunny-bloom").defender;
  const shell = engine.placeDefender(1, 0, "shell-guard").defender;

  engine.state.elapsedMs = sunny.nextActionAt;
  engine.processDefenders();

  assert.equal(engine.state.energyOrbs.length, 1);
  assert.equal(engine.state.energyOrbs[0].value, 25);
  assert.equal(engine.state.energyOrbs[0].source, sunny.id);
  assert.equal(shell.nextActionAt, Number.POSITIVE_INFINITY);
  assert.equal(events.filter((event) => event.type === "energy-produced").length, 1);

  const beforeCollection = engine.state.energy;
  assert.equal(engine.collectEnergy(engine.state.energyOrbs[0].id), true);
  assert.equal(engine.state.energy, beforeCollection + 25);
});

test("Twin Berry schedules and fires its second same-lane shot", () => {
  const events = [];
  const engine = createSandboxEngine(events);
  const twin = engine.placeDefender(2, 0, "twin-berry").defender;
  engine.spawnEnemy("stray-dog", 2, SPAWN_META);
  engine.state.enemies[0].x = 4;
  engine.state.elapsedMs = twin.nextActionAt;

  engine.processDefenders();
  assert.equal(engine.state.projectiles.length, 1);
  assert.equal(engine.state.pendingShots.length, 1);

  engine.state.elapsedMs += DEFENDER_BY_ID["twin-berry"].stats.burstGapMs;
  engine.processPendingShots();
  assert.equal(engine.state.projectiles.length, 2);
  assert.equal(engine.state.pendingShots.length, 0);
  assert.deepEqual(
    events.filter((event) => event.type === "defender-fired").map((event) => event.detail.shot),
    [1, 2],
  );
});

test("Frost Bloom applies a temporary movement slow on impact", () => {
  const events = [];
  const engine = createSandboxEngine(events);
  const frost = engine.placeDefender(0, 0, "frost-bloom").defender;
  engine.spawnEnemy("stray-dog", 0, SPAWN_META);
  const enemy = engine.state.enemies[0];
  enemy.x = 2;

  engine.createProjectile(frost, DEFENDER_BY_ID["frost-bloom"]);
  engine.processProjectiles(1_000);

  const slow = enemy.statuses.find((status) => status.type === "slow");
  assert.ok(slow);
  assert.equal(slow.multiplier, 0.55);
  assert.equal(slow.remainingMs, 3_500);
  assert.equal(enemy.health, ENEMY_BY_ID["stray-dog"].maxHealth - 14);
  assert.equal(events.filter((event) => event.type === "enemy-slowed").length, 1);
});

test("Pop Burst damages a limited three-lane area and removes itself", () => {
  const engine = createSandboxEngine();
  const pop = engine.placeDefender(2, 3, "pop-burst").defender;
  for (const lane of [1, 2, 3, 4]) {
    engine.spawnEnemy("bucket-dog", lane, SPAWN_META);
    engine.state.enemies.at(-1).x = 4;
  }
  engine.state.elapsedMs = pop.nextActionAt;

  engine.processDefenders();

  const [above, same, below, distantLane] = engine.state.enemies;
  for (const target of [above, same, below]) {
    assert.equal(target.armor, ENEMY_BY_ID["bucket-dog"].armor - DEFENDER_BY_ID["pop-burst"].attackDamage);
  }
  assert.equal(distantLane.armor, ENEMY_BY_ID["bucket-dog"].armor);
  assert.equal(pop.state, "defeated");
  assert.equal(engine.state.occupied.has("2:3"), false);
});

test("Leaf Beast bypasses armor while Bulb Guide roots and weakens", () => {
  const events = [];
  const engine = createSandboxEngine(events);
  const leaf = engine.placeDefender(0, 0, "leaf-beast").defender;
  const bulb = engine.placeDefender(1, 0, "bulb-guide").defender;
  engine.spawnEnemy("bucket-dog", 0, SPAWN_META);
  engine.spawnEnemy("stray-dog", 1, SPAWN_META);
  const armored = engine.state.enemies[0];
  const controlled = engine.state.enemies[1];
  armored.x = 2;
  controlled.x = 3;

  engine.createProjectile(leaf, DEFENDER_BY_ID["leaf-beast"]);
  engine.processProjectiles(1_000);
  assert.equal(armored.health, ENEMY_BY_ID["bucket-dog"].maxHealth - 34.2);
  assert.equal(armored.armor, ENEMY_BY_ID["bucket-dog"].armor - 41.8);

  engine.state.elapsedMs = bulb.nextActionAt;
  engine.processDefenders();
  assert.equal(controlled.statuses.some((status) => status.type === "root" && status.remainingMs === 1_800), true);
  assert.equal(controlled.weakenedMultiplier, 1.25);
  assert.equal(controlled.weakenedUntil, engine.state.elapsedMs + 4_500);
  assert.equal(events.filter((event) => event.type === "root-pulse").length, 1);
});

test("all five dog roles spawn with their configured protection and traits", () => {
  const engine = createSandboxEngine();
  ENEMIES.forEach((definition, lane) => engine.spawnEnemy(definition.id, lane, SPAWN_META));

  assert.equal(engine.state.enemies.length, 5);
  for (const enemy of engine.state.enemies) {
    const definition = ENEMY_BY_ID[enemy.definitionId];
    assert.equal(enemy.health, definition.maxHealth);
    assert.equal(enemy.armor, definition.armor);
    assert.equal(enemy.shieldHealth, definition.shieldHealth);
    assert.ok(definition.specialTrait.length > 10);
  }
  assert.ok(ENEMY_BY_ID["cone-dog"].brokenAssetKey);
  assert.ok(ENEMY_BY_ID["bucket-dog"].brokenAssetKey);
  assert.ok(ENEMY_BY_ID["gate-dog"].brokenAssetKey);
  assert.ok(ENEMY_BY_ID["gate-dog"].shieldHealth > 0);
  assert.ok(ENEMY_BY_ID["brute-dog"].stats.chargeMultiplier > 1);
});

test("each authored level reaches victory after every scheduled dog is cleared", () => {
  for (const level of LEVELS) {
    const engine = new GameEngine({ level, random: () => 0 });
    engine.state.status = "playing";
    const finalSpawnAt = engine.state.spawnQueue.at(-1).atMs;
    engine.state.elapsedMs = finalSpawnAt;
    engine.processWaves();
    assert.equal(engine.state.nextSpawnIndex, engine.state.spawnQueue.length, level.name);
    assert.ok(engine.state.enemies.length > 0, level.name);
    for (const enemy of engine.state.enemies) engine.defeatEnemy(enemy, "test-clear");
    engine.evaluateOutcome();
    assert.equal(engine.state.status, "victory", level.name);
  }
});

test("the tutorial level cannot be won without placing a defender", () => {
  const engine = new GameEngine({ level: LEVELS[0], random: () => 0 });
  engine.state.status = "playing";
  while (engine.state.status === "playing" && engine.state.elapsedMs < 130_000) {
    engine.step(50);
  }

  assert.equal(engine.state.stats.placed, 0);
  assert.equal(engine.state.status, "defeat");
});
