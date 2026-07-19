// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { GameEngine } from "../core/engine.js";
import { LEVEL_BY_ID } from "../levels/levels.js";

const DEPLOYMENT_PLANS = Object.freeze({
  "level-1": Object.freeze([
    ["bubble-sprout", 2, 2],
    ["sunny-bloom", 2, 0],
    ["sunny-bloom", 0, 0],
    ["bubble-sprout", 0, 2],
    ["bubble-sprout", 4, 2],
    ["bubble-sprout", 1, 2],
    ["bubble-sprout", 3, 2],
    ["shell-guard", 2, 5],
    ["shell-guard", 0, 5],
    ["shell-guard", 4, 5],
    ["shell-guard", 1, 5],
    ["shell-guard", 3, 5],
  ]),
  "level-2": Object.freeze([
    ["bubble-sprout", 1, 2],
    ["frost-bloom", 3, 2],
    ["sunny-bloom", 2, 0],
    ["sunny-bloom", 0, 0],
    ["sunny-bloom", 4, 0],
    ["sunny-bloom", 1, 0],
    ["sunny-bloom", 3, 0],
    ["bubble-sprout", 4, 2],
    ["frost-bloom", 0, 2],
    ["twin-berry", 2, 2],
    ["twin-berry", 3, 3],
    ["twin-berry", 4, 3],
    ["twin-berry", 0, 3],
    ["frost-bloom", 1, 3],
    ["shell-guard", 4, 5],
    ["shell-guard", 0, 5],
    ["shell-guard", 1, 5],
    ["shell-guard", 3, 5],
    ["shell-guard", 2, 5],
  ]),
  "level-3": Object.freeze([
    ["pop-burst", 1, 8, 109_500],
    ["pop-burst", 3, 8, 132_000],
    ["sunny-bloom", 2, 0],
    ["frost-bloom", 0, 2],
    ["bubble-sprout", 2, 2],
    ["sunny-bloom", 4, 0],
    ["sunny-bloom", 0, 0],
    ["sunny-bloom", 1, 0],
    ["sunny-bloom", 3, 0],
    ["frost-bloom", 4, 2],
    ["twin-berry", 1, 2],
    ["bulb-guide", 3, 3],
    ["leaf-beast", 2, 1],
    ["leaf-beast", 0, 1],
    ["leaf-beast", 4, 1],
    ["leaf-beast", 3, 2],
    ["leaf-beast", 1, 1],
    ["twin-berry", 4, 3],
    ["twin-berry", 3, 4],
    ["shell-guard", 2, 5],
    ["shell-guard", 0, 5],
    ["shell-guard", 4, 5],
    ["shell-guard", 1, 5],
    ["shell-guard", 3, 5],
    ["bulb-guide", 2, 3],
    ["bulb-guide", 0, 3],
    ["bulb-guide", 4, 4],
    ["twin-berry", 0, 4],
    ["sunny-bloom", 2, 0],
    ["sunny-bloom", 0, 0],
    ["sunny-bloom", 4, 0],
    ["sunny-bloom", 1, 0],
    ["sunny-bloom", 3, 0],
    ["shell-guard", 2, 5],
    ["shell-guard", 0, 5],
    ["shell-guard", 4, 5],
    ["shell-guard", 1, 5],
    ["shell-guard", 3, 5],
    ["leaf-beast", 2, 1],
    ["leaf-beast", 1, 1],
    ["leaf-beast", 3, 2],
    ["leaf-beast", 4, 1],
    ["leaf-beast", 0, 1],
    ["frost-bloom", 0, 2],
    ["frost-bloom", 4, 2],
    ["twin-berry", 1, 2],
    ["twin-berry", 4, 3],
    ["twin-berry", 0, 4],
    ["twin-berry", 3, 4],
  ]),
});

/**
 * A deterministic, deliberately simple player: collect every orb and follow a
 * fixed legal placement order. This proves authored levels are winnable without
 * random wave luck or frame-rate-dependent timing.
 * @param {any} level
 * @param {readonly (readonly [string, number, number, number?])[]} plan
 * @param {{missEvery?: number}} [options]
 */
function simulatePlannedDefense(level, plan, options = {}) {
  const placementCounts = new Map();
  const engine = new GameEngine({
    level,
    random: () => 0,
    onEvent: (event) => {
      if (event.type !== "defender-placed") return;
      const id = event.detail.defender.definitionId;
      placementCounts.set(id, (placementCounts.get(id) ?? 0) + 1);
    },
  });
  engine.state.status = "playing";
  const completedPlacements = new Set();
  const seenOrbs = new Set();
  const missedOrbs = new Set();
  let orbSequence = 0;

  while (engine.state.status === "playing" && engine.state.elapsedMs < 240_000) {
    for (const orb of [...engine.state.energyOrbs]) {
      if (!seenOrbs.has(orb.id)) {
        seenOrbs.add(orb.id);
        orbSequence += 1;
        if (options.missEvery && orbSequence % options.missEvery === 0) missedOrbs.add(orb.id);
      }
      if (!missedOrbs.has(orb.id)) engine.collectEnergy(orb.id);
    }
    for (let index = 0; index < plan.length; index += 1) {
      if (completedPlacements.has(index)) continue;
      const [defenderId, lane, column, notBeforeMs = 0] = plan[index];
      if (engine.state.elapsedMs < notBeforeMs) continue;
      const validation = engine.validatePlacement(defenderId, lane, column);
      if (!validation.ok && (validation.reason === "occupied" || validation.reason === "cooldown")) continue;
      if (!validation.ok) break;
      const result = engine.placeDefender(lane, column, defenderId);
      if (result.ok) completedPlacements.add(index);
    }
    engine.step(50);
  }

  return { engine, placementIndex: completedPlacements.size, placementCounts };
}

for (const [levelId, plan] of Object.entries(DEPLOYMENT_PLANS)) {
  test(`${levelId} is winnable with deterministic collection and placement`, () => {
    const level = LEVEL_BY_ID[levelId];
    const { engine, placementIndex, placementCounts } = simulatePlannedDefense(level, plan);
    const activeEnemies = engine.state.enemies
      .filter((enemy) => enemy.state === "active")
      .map((enemy) => `${enemy.definitionId}@${enemy.lane}:${enemy.x.toFixed(2)}`)
      .join(",");
    const activeDefenders = engine.state.defenders
      .filter((defender) => defender.state === "active")
      .map((defender) => `${defender.definitionId}@${defender.lane}:${defender.column}`)
      .join(",");
    assert.equal(engine.state.status, "victory", `${level.name} ended at ${engine.state.elapsedMs}ms after ${placementIndex} planned placements (${JSON.stringify(Object.fromEntries(placementCounts))}); energy=${engine.state.energy}; lanes=${engine.state.laneDefenses}; dogs=${activeEnemies}; cats=${activeDefenders}`);
    assert.equal(engine.state.stats.defeatedEnemies, engine.state.stats.totalEnemies);
  });
}

test("level-3 tolerates a player permanently missing one in ten Paw Energy spawns", () => {
  const level = LEVEL_BY_ID["level-3"];
  const { engine } = simulatePlannedDefense(level, DEPLOYMENT_PLANS["level-3"], { missEvery: 10 });
  assert.equal(engine.state.status, "victory");
  assert.equal(engine.state.stats.defeatedEnemies, engine.state.stats.totalEnemies);
});
