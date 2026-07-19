// @ts-check

/**
 * @typedef {Object} PreloadProgress
 * @property {number} completed
 * @property {number} total
 * @property {number} loaded
 * @property {number} failed
 * @property {string | null} url
 * @property {boolean | null} ok
 */

/**
 * @typedef {Object} PreloadResult
 * @property {string[]} urls
 * @property {Map<string, HTMLImageElement>} images
 * @property {string[]} failedUrls
 * @property {number} total
 * @property {number} loaded
 * @property {number} failed
 */

/** @type {Map<string, HTMLImageElement>} */
const imageCache = new Map();

/** @type {Map<string, Promise<HTMLImageElement | null>>} */
const pendingImages = new Map();

/**
 * Remove duplicate values while preserving their first-seen order.
 * @template T
 * @param {Iterable<T> | ArrayLike<T> | null | undefined} values
 * @returns {T[]}
 */
export function dedupe(values) {
  if (values == null) return [];
  return [...new Set(Array.from(values))];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeUrl(value) {
  if (value instanceof URL) return value.href;
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return url || null;
}

/**
 * Resolve asset paths stored in configuration modules relative to this game module.
 * @param {unknown} value
 * @returns {string | null}
 */
function resolveDefinitionUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return null;
  if (/^(?:blob:|data:|[a-z][a-z0-9+.-]*:)/i.test(url)) return url;

  try {
    if (/^(?:\.\/)?game\//i.test(url)) {
      return new URL(url.replace(/^\.\//, ''), new URL('../../', import.meta.url)).href;
    }
    return new URL(url, import.meta.url).href;
  } catch {
    return url;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function looksLikeImageUrl(value) {
  const url = normalizeUrl(value);
  return Boolean(url && (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(url) || /^(?:blob:|data:image\/)/i.test(url)));
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function normalizeUrls(input) {
  if (typeof input === 'string' || input instanceof URL) {
    const one = normalizeUrl(input);
    return one ? [one] : [];
  }

  if (!input || typeof input !== 'object') return [];

  const urls = [];
  const values = Symbol.iterator in input
    ? Array.from(/** @type {Iterable<unknown>} */ (input))
    : Array.from(/** @type {ArrayLike<unknown>} */ (input));
  for (const value of values) {
    const url = normalizeUrl(value);
    if (url) urls.push(url);
  }
  return dedupe(urls);
}

/**
 * @param {((progress: number, detail: PreloadProgress) => void) | undefined} onProgress
 * @param {PreloadProgress} detail
 */
function reportProgress(onProgress, detail) {
  if (typeof onProgress !== 'function') return;
  const progress = detail.total === 0 ? 1 : detail.completed / detail.total;
  try {
    onProgress(progress, detail);
  } catch {
    // A UI callback must not be able to interrupt loading.
  }
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement | null>}
 */
function loadImage(url) {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = pendingImages.get(url);
  if (pending) return pending;

  if (typeof Image === 'undefined') return Promise.resolve(null);

  /** @type {Promise<HTMLImageElement | null>} */
  const request = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const timeout = setTimeout(() => finish(false), 12_000);

    /** @param {boolean} loaded */
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (loaded) imageCache.set(url, image);
      resolve(loaded ? image : null);
    };

    image.decoding = 'async';
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;

    if (image.complete) {
      queueMicrotask(() => finish(image.naturalWidth > 0));
    }
  }).finally(() => {
    pendingImages.delete(url);
  });

  pendingImages.set(url, request);
  return request;
}

/**
 * Preload images without rejecting when one or more URLs fail.
 * Progress is reported as a number from 0 to 1 and a detailed second argument.
 * @param {Iterable<string | URL> | ArrayLike<string | URL> | string | URL | null | undefined} urls
 * @param {(progress: number, detail: PreloadProgress) => void} [onProgress]
 * @returns {Promise<PreloadResult>}
 */
export async function preloadImages(urls, onProgress) {
  const uniqueUrls = normalizeUrls(urls);
  const total = uniqueUrls.length;
  const images = new Map();
  const failedUrls = [];
  let completed = 0;
  let loaded = 0;
  let failed = 0;

  reportProgress(onProgress, {
    completed,
    total,
    loaded,
    failed,
    url: null,
    ok: null,
  });

  await Promise.all(uniqueUrls.map(async (url) => {
    const image = await loadImage(url);
    completed += 1;

    if (image) {
      loaded += 1;
      images.set(url, image);
    } else {
      failed += 1;
      failedUrls.push(url);
    }

    reportProgress(onProgress, {
      completed,
      total,
      loaded,
      failed,
      url,
      ok: Boolean(image),
    });
  }));

  return {
    urls: uniqueUrls,
    images,
    failedUrls,
    total,
    loaded,
    failed,
  };
}

/**
 * @param {unknown} collection
 * @returns {unknown[]}
 */
function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return [...collection.values()];
  if (typeof collection === 'object') return Object.values(collection);
  return [];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function definitionId(value) {
  if (!value || typeof value !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['id', 'assetKey', 'key', 'type']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {'defender' | 'enemy' | 'level'} mode
 * @returns {string[]}
 */
function collectExplicitUrls(value, mode) {
  const urls = [];
  const seen = new Set();

  /**
   * @param {unknown} current
   * @param {string} path
   * @param {number} depth
   */
  const visit = (current, path, depth) => {
    if (depth > 4 || current == null) return;

    if (typeof current === 'string' || current instanceof URL) {
      const lowerPath = path.toLowerCase();
      const isNonessential = /preview|portrait|collection|encyclopedia/.test(lowerPath);
      const isEnemyCard = mode === 'enemy' && /card|icon/.test(lowerPath);
      const url = resolveDefinitionUrl(current);
      if (!isNonessential && !isEnemyCard && url && looksLikeImageUrl(url)) urls.push(url);
      return;
    }

    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, path, depth + 1));
      return;
    }

    for (const [key, nested] of Object.entries(/** @type {Record<string, unknown>} */ (current))) {
      const lowerKey = key.toLowerCase();
      const assetRelated = /asset|image|sprite|card|icon|background|texture|visual/.test(lowerKey);
      const insideAssetGroup = /asset|image|sprite|visual/.test(path.toLowerCase());
      if (assetRelated || insideAssetGroup) visit(nested, `${path}.${lowerKey}`, depth + 1);
    }
  };

  visit(value, mode, 0);
  return dedupe(urls);
}

/**
 * @param {unknown} level
 * @param {Set<string>} knownIds
 * @param {string[]} fieldNames
 * @returns {Set<string>}
 */
function referencedIds(level, knownIds, fieldNames) {
  const found = new Set();
  const seen = new Set();

  /** @param {unknown} value */
  const visit = (value) => {
    if (typeof value === 'string') {
      if (knownIds.has(value)) found.add(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      if (fieldNames.includes(key) || typeof nested === 'object') visit(nested);
    }
  };

  visit(level);
  return found;
}

/**
 * @param {'units' | 'cards'} directory
 * @param {string} key
 * @returns {string | null}
 */
function builtInAssetUrl(directory, key) {
  const safeKey = key.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safeKey)) return null;
  return new URL(`./${directory}/${safeKey}.webp`, import.meta.url).href;
}

/**
 * Preload essential unit and card images for one level. Preview and encyclopedia
 * art stays lazy-loaded. Enemy definitions are filtered to types used by the level
 * whenever references can be detected.
 * @param {unknown} defenders
 * @param {unknown} enemies
 * @param {unknown} level
 * @param {(progress: number, detail: PreloadProgress) => void} [onProgress]
 * @returns {Promise<PreloadResult>}
 */
export function preloadForLevel(defenders, enemies, level, onProgress) {
  const defenderList = collectionValues(defenders);
  const enemyList = collectionValues(enemies);

  const defenderIds = new Set(defenderList.map(definitionId).filter((id) => id !== null));
  const enemyIds = new Set(enemyList.map(definitionId).filter((id) => id !== null));
  const selectedDefenders = referencedIds(level, defenderIds, [
    'defenderId',
    'defenderIds',
    'allowedDefenders',
    'availableDefenders',
    'loadout',
  ]);
  const selectedEnemies = referencedIds(level, enemyIds, [
    'enemyId',
    'enemyIds',
    'enemyType',
    'entries',
    'waves',
  ]);

  const urls = [];
  for (const defender of defenderList) {
    const id = definitionId(defender);
    if (selectedDefenders.size > 0 && (!id || !selectedDefenders.has(id))) continue;
    urls.push(...collectExplicitUrls(defender, 'defender'));
    if (id) {
      const unitUrl = builtInAssetUrl('units', id);
      const cardUrl = builtInAssetUrl('cards', id);
      if (unitUrl) urls.push(unitUrl);
      if (cardUrl) urls.push(cardUrl);
    }
  }

  for (const enemy of enemyList) {
    const id = definitionId(enemy);
    if (selectedEnemies.size > 0 && (!id || !selectedEnemies.has(id))) continue;
    urls.push(...collectExplicitUrls(enemy, 'enemy'));
    const record = enemy && typeof enemy === 'object'
      ? /** @type {Record<string, unknown>} */ (enemy)
      : {};
    const assetKeys = dedupe([
      id,
      record.assetKey,
      record.brokenAssetKey,
      record.shieldBrokenAssetKey,
      record.armorBrokenAssetKey,
    ].filter((value) => typeof value === 'string'));
    for (const assetKey of assetKeys) {
      const unitUrl = builtInAssetUrl('units', /** @type {string} */ (assetKey));
      if (unitUrl) urls.push(unitUrl);
    }
  }

  urls.push(...collectExplicitUrls(level, 'level'));
  return preloadImages(dedupe(urls), onProgress);
}
