// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceStatuses,
  applyLayeredDamage,
  applyRoot,
  applySlow,
  areWavesComplete,
  canAfford,
  canPlaceDefender,
  findSweptCollision,
  getBattleOutcome,
  getMovementMultiplier,
  isCellOccupied,
  isDefeat,
  isRooted,
  isVictory,
  selectSameLaneTarget,
  sweptCollision,
} from "../core/rules.js";

test("resource validation accepts exact cost and rejects a short balance", () => {
  assert.equal(canAfford(100, 100), true);
  assert.equal(canAfford(99, 100), false);
  assert.equal(canAfford(Number.NaN, 100), false);
  assert.equal(canAfford(100, -1), false);
});

test("placement validates bounds, occupancy, cooldown, and cost", () => {
  const occupancy = new Set(["2:4"]);
  assert.equal(isCellOccupied(occupancy, 2, 4), true);
  assert.deepEqual(
    canPlaceDefender({ lane: 2, column: 4, energy: 500, cost: 100, occupancy }),
    { valid: false, reason: "occupied" },
  );
  assert.deepEqual(
    canPlaceDefender({ lane: 5, column: 0, energy: 500, cost: 100, occupancy }),
    { valid: false, reason: "out-of-bounds" },
  );
  assert.deepEqual(
    canPlaceDefender({
      lane: 1,
      column: 1,
      energy: 500,
      cost: 100,
      cooldownRemainingMs: 1,
    }),
    { valid: false, reason: "cooldown" },
  );
  assert.deepEqual(
    canPlaceDefender({ lane: 1, column: 1, energy: 75, cost: 100 }),
    { valid: false, reason: "insufficient-energy" },
  );
  assert.deepEqual(
    canPlaceDefender({ lane: 1, column: 1, energy: 100, cost: 100 }),
    { valid: true, reason: null },
  );
});

test("target selection stays in lane and chooses the nearest target ahead", () => {
  const wrongLane = { id: "wrong", lane: 2, x: 12, health: 100 };
  const behind = { id: "behind", lane: 1, x: 4, health: 100 };
  const far = { id: "far", lane: 1, x: 30, health: 100 };
  const near = { id: "near", lane: 1, x: 14, health: 100 };
  const defeated = { id: "defeated", lane: 1, x: 11, health: 0 };

  assert.equal(
    selectSameLaneTarget({ lane: 1, x: 10 }, [wrongLane, behind, far, near, defeated]),
    near,
  );
  assert.equal(
    selectSameLaneTarget({ lane: 1, x: 10 }, [far], { maxRange: 10 }),
    undefined,
  );
});

test("shield absorbs damage before armor and health", () => {
  const result = applyLayeredDamage({ shieldHealth: 50, armor: 40, health: 100 }, 80);
  assert.equal(result.shieldHealth, 0);
  assert.equal(result.armor, 10);
  assert.equal(result.health, 100);
  assert.equal(result.shieldDamage, 50);
  assert.equal(result.armorDamage, 30);
  assert.equal(result.healthDamage, 0);
  assert.equal(result.shieldBroken, true);
});

test("armor absorbs overflow and armor bypass routes a share to health", () => {
  const ordinary = applyLayeredDamage({ armor: 50, health: 100 }, 60);
  assert.equal(ordinary.armor, 0);
  assert.equal(ordinary.health, 90);
  assert.equal(ordinary.armorDamage, 50);
  assert.equal(ordinary.healthDamage, 10);

  const piercing = applyLayeredDamage({ armor: 50, health: 100 }, 60, {
    armorBypass: 0.5,
  });
  assert.equal(piercing.armor, 20);
  assert.equal(piercing.health, 70);
  assert.equal(piercing.armorDamage, 30);
  assert.equal(piercing.healthDamage, 30);
});

test("slow and root effects expire using delta time", () => {
  let statuses = applySlow([], 1_000, 0.55, "frost-bloom");
  assert.equal(getMovementMultiplier(statuses), 0.55);
  statuses = advanceStatuses(statuses, 999);
  assert.equal(getMovementMultiplier(statuses), 0.55);
  statuses = advanceStatuses(statuses, 1);
  assert.equal(getMovementMultiplier(statuses), 1);

  statuses = applyRoot(statuses, 500, "bulb-guide");
  assert.equal(isRooted(statuses), true);
  assert.equal(getMovementMultiplier(statuses), 0);
  statuses = advanceStatuses(statuses, 500);
  assert.equal(isRooted(statuses), false);
});

test("swept collision catches fast projectiles and returns the first lane hit", () => {
  assert.equal(sweptCollision(0, 100, 2, 50, 5), true);
  assert.equal(sweptCollision(0, 40, 2, 50, 5), false);

  const first = { id: "first", lane: 3, x: 35, health: 100, hitRadius: 4 };
  const second = { id: "second", lane: 3, x: 75, health: 100, hitRadius: 4 };
  const otherLane = { id: "other", lane: 2, x: 20, health: 100, hitRadius: 4 };
  const collision = findSweptCollision(
    { lane: 3, previousX: 0, x: 100, radius: 2 },
    [second, otherLane, first],
  );
  assert.equal(collision?.target, first);
  assert.ok(collision && collision.time > 0 && collision.time < 1);
});

test("wave completion waits for every spawn and every active enemy", () => {
  const waves = [
    { entries: [{}, {}] },
    { entries: [{}] },
  ];
  assert.equal(areWavesComplete(waves, 2, 0), false);
  assert.equal(areWavesComplete(waves, 3, 1), false);
  assert.equal(areWavesComplete(waves, 3, 0), true);
  assert.equal(
    areWavesComplete({ waves, spawnedEntries: 3, activeEnemies: [{ lane: 0, x: 1, health: 0 }] }),
    true,
  );
});

test("victory and defeat have explicit, mutually safe outcomes", () => {
  const victoryState = { wavesComplete: true, activeEnemyCount: 0 };
  assert.equal(isVictory(victoryState), true);
  assert.equal(isDefeat(victoryState), false);
  assert.equal(getBattleOutcome(victoryState), "victory");

  const defeatState = {
    wavesComplete: true,
    activeEnemyCount: 0,
    lanes: [{ breached: true, emergencyAvailable: false }],
  };
  assert.equal(isDefeat(defeatState), true);
  assert.equal(isVictory(defeatState), false);
  assert.equal(getBattleOutcome(defeatState), "defeat");
  assert.equal(getBattleOutcome({ wavesComplete: false }), "playing");
});
