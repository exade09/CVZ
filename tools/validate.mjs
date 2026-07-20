import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const WORKSPACE_ROOT = resolve(TOOL_DIRECTORY, "..");
export const REQUIRED_ROOT_FILES = Object.freeze([
  "index.html",
  "styles.css",
  "script.js",
  "cvz-brand-hero.jpg",
  "cvz-icon.png",
  "cvz-fon.png",
  "cvz-kitty.jpg",
  "cvz-dogzombie.png",
]);

const GAME_SOURCE_FILES = Object.freeze([
  "game/game-app.js",
  "game/game.css",
  "game/assets/asset-loader.js",
  "game/audio/audio-manager.js",
  "game/config/defenders.js",
  "game/config/enemies.js",
  "game/core/engine.js",
  "game/core/rules.js",
  "game/levels/levels.js",
  "game/rendering/game-renderer.js",
  "game/storage/save-store.js",
  "game/ui/screens.js",
]);

const UNIT_ASSET_DIRECTORIES = Object.freeze(["units", "cards", "preview"]);
const CYRILLIC_PATTERN = /[\u0400-\u052f]/u;
const COMMERCIAL_GAME_PATTERN = new RegExp(["plants", "vs\\.?", "zombies"].join("\\s+"), "iu");
const FINANCE_PATTERN = new RegExp(
  `\\b(?:${[
    "blockchain",
    "crypto(?:currency)?",
    "finance",
    "gambl(?:e|ing)",
    "nft",
    "payment",
    "private\\s+key",
    "real[ -]?money",
    "smart\\s+contract",
    "solana",
    "token(?:s|omics)?",
    "trad(?:e|ing)",
    "transaction",
    "wallet",
  ].join("|")})\\b`,
  "iu",
);

function displayPath(pathname) {
  return relative(WORKSPACE_ROOT, pathname).replaceAll("\\", "/") || ".";
}

async function requireFile(pathname, errors) {
  try {
    const fileStats = await stat(pathname);
    if (!fileStats.isFile()) throw new Error("not a file");
  } catch {
    errors.push(`Missing required file: ${displayPath(pathname)}`);
  }
}

async function readRequiredText(relativePath, errors) {
  const pathname = join(WORKSPACE_ROOT, relativePath);
  try {
    return await readFile(pathname, "utf8");
  } catch {
    errors.push(`Unable to read required file: ${relativePath}`);
    return "";
  }
}

async function loadConfiguration(relativePath, exportName, errors) {
  const pathname = join(WORKSPACE_ROOT, relativePath);
  try {
    const cacheBuster = `validation=${Date.now()}-${Math.random()}`;
    const moduleUrl = `${pathToFileURL(pathname).href}?${cacheBuster}`;
    const loadedModule = await import(moduleUrl);
    return loadedModule[exportName];
  } catch (error) {
    errors.push(`Unable to load ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function validateExactCount(value, expected, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return false;
  }
  if (value.length !== expected) {
    errors.push(`${label} must contain exactly ${expected} entries; found ${value.length}.`);
    return false;
  }
  return true;
}

function validateUniqueIds(definitions, label, errors) {
  if (!Array.isArray(definitions)) return;
  const ids = definitions.map((definition) => definition?.id);
  const validIds = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (validIds.length !== definitions.length) {
    errors.push(`Every ${label} entry must have a non-empty string id.`);
  }
  if (new Set(validIds).size !== validIds.length) {
    errors.push(`${label} ids must be unique.`);
  }
}

function validateFiniteFields(definitions, fields, label, errors) {
  if (!Array.isArray(definitions)) return;
  for (const definition of definitions) {
    const entryLabel = typeof definition?.id === "string" ? definition.id : label;
    for (const field of fields) {
      const value = definition?.[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`${entryLabel}.${field} must be a finite non-negative number.`);
      }
    }
    if (definition?.stats && typeof definition.stats === "object") {
      for (const [key, value] of Object.entries(definition.stats)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${entryLabel}.stats.${key} must be finite.`);
        }
      }
    }
  }
}

function validateLevels(levels, defenders, enemies, errors) {
  if (!Array.isArray(levels)) return;
  const defenderIds = new Set(Array.isArray(defenders) ? defenders.map((entry) => entry?.id) : []);
  const enemyIds = new Set(Array.isArray(enemies) ? enemies.map((entry) => entry?.id) : []);
  for (const [index, level] of levels.entries()) {
    const levelLabel = typeof level?.id === "string" ? level.id : `level ${index + 1}`;
    if (level?.number !== index + 1) errors.push(`${levelLabel}.number must be ${index + 1}.`);
    if (level?.laneCount !== 5 || level?.columnCount !== 9) {
      errors.push(`${levelLabel} must use the authored five-lane, nine-column grid.`);
    }
    for (const field of ["startingEnergy", "ambientEnergyIntervalMs", "firstAmbientEnergyDelayMs"]) {
      if (typeof level?.[field] !== "number" || !Number.isFinite(level[field]) || level[field] < 0) {
        errors.push(`${levelLabel}.${field} must be a finite non-negative number.`);
      }
    }
    for (const defenderId of [...(level?.availableDefenders ?? []), ...(level?.unlocks ?? [])]) {
      if (!defenderIds.has(defenderId)) errors.push(`${levelLabel} references unknown defender ${String(defenderId)}.`);
    }
    if (!Array.isArray(level?.waves) || level.waves.length === 0) {
      errors.push(`${levelLabel} must define at least one wave.`);
      continue;
    }
    const finalWaves = level.waves.filter((wave) => wave?.final === true);
    if (finalWaves.length !== 1 || level.waves.at(-1)?.final !== true) {
      errors.push(`${levelLabel} must mark exactly its last wave as final.`);
    }
    let priorStart = -1;
    const waveIds = new Set();
    for (const wave of level.waves) {
      if (typeof wave?.id !== "string" || !wave.id || waveIds.has(wave.id)) {
        errors.push(`${levelLabel} wave ids must be non-empty and unique.`);
      } else {
        waveIds.add(wave.id);
      }
      if (typeof wave?.startTimeMs !== "number" || !Number.isFinite(wave.startTimeMs) || wave.startTimeMs < priorStart) {
        errors.push(`${levelLabel}.${String(wave?.id)} has invalid or decreasing startTimeMs.`);
      }
      priorStart = Number(wave?.startTimeMs);
      if (!Array.isArray(wave?.entries) || wave.entries.length === 0) {
        errors.push(`${levelLabel}.${String(wave?.id)} must contain enemy entries.`);
        continue;
      }
      for (const entry of wave.entries) {
        if (!enemyIds.has(entry?.enemyId)) errors.push(`${levelLabel}.${String(wave.id)} references unknown enemy ${String(entry?.enemyId)}.`);
        if (!Number.isInteger(entry?.lane) || entry.lane < 0 || entry.lane >= level.laneCount) {
          errors.push(`${levelLabel}.${String(wave.id)} has an out-of-range lane.`);
        }
        if (typeof entry?.delayMs !== "number" || !Number.isFinite(entry.delayMs) || entry.delayMs < 0) {
          errors.push(`${levelLabel}.${String(wave.id)} has an invalid entry delay.`);
        }
      }
    }
  }
}

async function validateUnitAssets(definitions, errors) {
  if (!Array.isArray(definitions)) return;
  const checks = [];
  for (const definition of definitions) {
    if (typeof definition?.id !== "string" || definition.id.length === 0) continue;
    for (const directory of UNIT_ASSET_DIRECTORIES) {
      checks.push(
        requireFile(join(WORKSPACE_ROOT, "game", "assets", directory, `${definition.id}.webp`), errors),
      );
    }
    for (const field of ["brokenAssetKey", "shieldBrokenAssetKey", "armorBrokenAssetKey"]) {
      const assetKey = definition?.[field];
      if (typeof assetKey === "string") {
        checks.push(requireFile(join(WORKSPACE_ROOT, "game", "assets", "units", `${assetKey}.webp`), errors));
      }
    }
  }
  await Promise.all(checks);
}

async function findGameTextFiles(directory = join(WORKSPACE_ROOT, "game")) {
  const entries = await readdir(directory, { withFileTypes: true });
  const discoveredFiles = [];

  for (const entry of entries) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) {
      discoveredFiles.push(...(await findGameTextFiles(pathname)));
    } else if (entry.isFile() && [".css", ".js"].some((extension) => entry.name.endsWith(extension))) {
      discoveredFiles.push(pathname);
    }
  }
  return discoveredFiles;
}

async function validateGameText(errors) {
  let gameTextFiles = [];
  try {
    gameTextFiles = await findGameTextFiles();
  } catch (error) {
    errors.push(`Unable to inspect game source files: ${error instanceof Error ? error.message : String(error)}`);
  }

  const texts = await Promise.all(
    gameTextFiles.map(async (pathname) => ({
      relativePath: displayPath(pathname),
      text: await readRequiredText(displayPath(pathname), errors),
    })),
  );

  for (const { relativePath, text } of texts) {
    if (CYRILLIC_PATTERN.test(text)) {
      errors.push(`Cyrillic text is not allowed in ${relativePath}.`);
    }
    if (COMMERCIAL_GAME_PATTERN.test(text)) {
      errors.push(`A forbidden commercial game name appears in ${relativePath}.`);
    }
    if (FINANCE_PATTERN.test(text)) {
      errors.push(`Finance, blockchain, trading, or wallet terminology appears in ${relativePath}.`);
    }
  }

  const websiteFiles = ["index.html", "styles.css", "script.js"];
  for (const relativePath of websiteFiles) {
    const text = await readRequiredText(relativePath, errors);
    if (COMMERCIAL_GAME_PATTERN.test(text)) {
      errors.push(`A forbidden commercial game name appears in ${relativePath}.`);
    }
  }
}

async function validateIntegration(errors) {
  const [html, script] = await Promise.all([
    readRequiredText("index.html", errors),
    readRequiredText("script.js", errors),
  ]);

  const integrationChecks = [
    [/href\s*=\s*["'](?:\.\/)?styles\.css(?:[?#][^"']*)?["']/iu, "index.html must reference styles.css."],
    [/src\s*=\s*["'](?:\.\/)?script\.js(?:[?#][^"']*)?["']/iu, "index.html must reference script.js."],
    [/data-cvz-open-game/iu, "index.html must provide a game launch control."],
  ];

  for (const [pattern, message] of integrationChecks) {
    if (!pattern.test(html)) errors.push(message);
  }
  if (!/["'](?:\.\/)?game\/game\.css(?:[?#][^"']*)?["']/iu.test(script)) {
    errors.push("script.js must load game/game.css.");
  }
  if (!/import\s*\(\s*["'](?:\.\/)?game\/game-app\.js(?:[?#][^"']*)?["']\s*\)/iu.test(script)) {
    errors.push("script.js must lazy-load game/game-app.js.");
  }
}

export async function validateProject({ quiet = false } = {}) {
  const errors = [];

  await Promise.all([
    ...REQUIRED_ROOT_FILES.map((relativePath) => requireFile(join(WORKSPACE_ROOT, relativePath), errors)),
    ...GAME_SOURCE_FILES.map((relativePath) => requireFile(join(WORKSPACE_ROOT, relativePath), errors)),
  ]);

  const [defenders, enemies, levels] = await Promise.all([
    loadConfiguration("game/config/defenders.js", "DEFENDERS", errors),
    loadConfiguration("game/config/enemies.js", "ENEMIES", errors),
    loadConfiguration("game/levels/levels.js", "LEVELS", errors),
  ]);

  validateExactCount(defenders, 8, "Defender configuration", errors);
  validateExactCount(enemies, 5, "Enemy configuration", errors);
  validateExactCount(levels, 3, "Level configuration", errors);
  validateUniqueIds(defenders, "Defender", errors);
  validateUniqueIds(enemies, "Enemy", errors);
  validateUniqueIds(levels, "Level", errors);
  validateFiniteFields(defenders, ["cost", "maxHealth", "cooldownMs", "attackDamage", "attackIntervalMs", "range"], "Defender", errors);
  validateFiniteFields(enemies, ["maxHealth", "armor", "shieldHealth", "movementSpeed", "attackDamage", "attackIntervalMs", "scale"], "Enemy", errors);
  validateLevels(levels, defenders, enemies, errors);

  await Promise.all([
    validateUnitAssets(defenders, errors),
    validateUnitAssets(enemies, errors),
    validateGameText(errors),
    validateIntegration(errors),
  ]);

  if (errors.length > 0) {
    throw new Error(`Validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:\n- ${errors.join("\n- ")}`);
  }

  if (!quiet) {
    console.log("Validation passed: 8 defenders, 5 enemies, 3 levels, assets, language, and integration checks are valid.");
  }
  return true;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  validateProject().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
