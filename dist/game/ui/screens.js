// @ts-check

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * @param {number} intervalMs
 * @returns {string}
 */
function cadence(intervalMs) {
  if (!intervalMs) return "Passive";
  const seconds = intervalMs / 1000;
  if (seconds <= 1.2) return "Very fast";
  if (seconds <= 1.7) return "Fast";
  if (seconds <= 2.2) return "Steady";
  return "Slow";
}

/**
 * @param {boolean} canContinue
 * @returns {string}
 */
export function menuScreen(canContinue) {
  return `
    <section class="kvz-game-menu-screen" aria-labelledby="kvz-menu-title">
      <div class="kvz-game-menu-hero">
        <p class="kvz-game-subtitle">A magical five-lane garden adventure</p>
        <h1 class="kvz-game-title" id="kvz-menu-title">Paws &amp; Peril</h1>
        <p class="kvz-game-subtitle">Place clever cats, gather Paw Energy, and send the zombie dogs packing.</p>
        <div class="kvz-game-menu-actions">
          <button class="kvz-game-button primary" type="button" data-action="play">Play</button>
          <button class="kvz-game-button secondary" type="button" data-action="continue" ${canContinue ? "" : "disabled"}>Continue</button>
          <button class="kvz-game-button" type="button" data-action="levels">Level Select</button>
          <button class="kvz-game-button" type="button" data-action="cats">Cat Collection</button>
          <button class="kvz-game-button" type="button" data-action="dogs">Dog Encyclopedia</button>
          <button class="kvz-game-button" type="button" data-action="how-to">How to Play</button>
          <button class="kvz-game-button" type="button" data-action="settings">Settings</button>
          <button class="kvz-game-button" type="button" data-action="credits">Credits</button>
          <button class="kvz-game-button back" type="button" data-action="return-site">Return to Website</button>
        </div>
      </div>
      <div class="kvz-game-menu-art">
        <img src="kvz-avatar.jpg" alt="Kitty defender and zombie dog facing off in the KitVsZomb garden" decoding="async" />
      </div>
    </section>`;
}

/**
 * @param {Array<any>} levels
 * @param {any} save
 * @returns {string}
 */
export function levelSelectScreen(levels, save) {
  const completed = new Set(save.completedLevels ?? []);
  const highestUnlocked = Math.max(1, Number(save.campaignProgress?.highestUnlockedLevel) || 1);
  const cards = levels.map((level) => {
    const unlocked = level.number <= highestUnlocked;
    const complete = completed.has(level.id);
    const waveCount = level.waves.length;
    return `
      <article class="kvz-game-codex-card ${unlocked ? "" : "kvz-game-locked"}" ${unlocked ? "" : 'data-locked-label="Complete the previous level"'}>
        <div class="kvz-game-codex-image">
          <img src="kvz-fon.png" alt="Painted garden lanes for ${escapeHtml(level.name)}" loading="lazy" decoding="async" />
        </div>
        <h3>Level ${level.number}: ${escapeHtml(level.name)}</h3>
        <p>${escapeHtml(level.description)}</p>
        <div class="kvz-game-codex-stats">
          <span class="kvz-game-stat-pill">${waveCount} waves</span>
          <span class="kvz-game-stat-pill">${level.startingEnergy} starting energy</span>
          ${complete ? '<span class="kvz-game-stat-pill">Complete</span>' : ""}
        </div>
        <button class="kvz-game-button ${complete ? "secondary" : "primary"}" type="button" data-action="start-level" data-level-id="${escapeHtml(level.id)}" ${unlocked ? "" : "disabled"}>
          ${complete ? "Play Again" : "Start Level"}
        </button>
      </article>`;
  }).join("");

  return `
    <section aria-labelledby="kvz-levels-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-levels-title">Choose a Garden</h1>
        <p class="kvz-game-subtitle">Each path introduces new cats, tougher dogs, and authored waves.</p>
      </div>
      <div class="kvz-game-codex-grid">${cards}</div>
    </section>`;
}

/**
 * @param {Array<any>} defenders
 * @param {any} save
 * @returns {string}
 */
export function catCollectionScreen(defenders, save) {
  const unlocked = new Set(save.unlockedCats ?? []);
  const cards = defenders.map((cat) => {
    const isUnlocked = unlocked.has(cat.id);
    return `
      <article class="kvz-game-codex-card ${isUnlocked ? "" : "kvz-game-locked"}" ${isUnlocked ? "" : 'data-locked-label="Keep exploring to unlock"'}>
        <div class="kvz-game-codex-image">
          <img src="${escapeHtml(cat.assets.preview)}" alt="${escapeHtml(cat.name)} defender portrait" loading="lazy" decoding="async" />
        </div>
        <h3>${escapeHtml(cat.name)}</h3>
        <p>${escapeHtml(cat.description)}</p>
        <div class="kvz-game-codex-stats">
          <span class="kvz-game-stat-pill">${escapeHtml(cat.role)}</span>
          <span class="kvz-game-stat-pill">${cat.cost} Paw Energy</span>
          <span class="kvz-game-stat-pill">${cat.maxHealth} health</span>
          <span class="kvz-game-stat-pill">${cat.attackDamage || 0} power</span>
          <span class="kvz-game-stat-pill">${cadence(cat.attackIntervalMs)}</span>
          <span class="kvz-game-stat-pill">${Math.round(cat.cooldownMs / 1000)}s cooldown</span>
        </div>
        <p><strong>Ability:</strong> ${escapeHtml(cat.ability)}</p>
      </article>`;
  }).join("");

  return `
    <section aria-labelledby="kvz-cats-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-cats-title">Cat Collection</h1>
        <p class="kvz-game-subtitle">Eight garden guardians, each with a different job.</p>
      </div>
      <div class="kvz-game-codex-grid">${cards}</div>
    </section>`;
}

/**
 * @param {Array<any>} enemies
 * @param {any} save
 * @returns {string}
 */
export function dogEncyclopediaScreen(enemies, save) {
  const encountered = new Set(save.encounteredDogs ?? []);
  const cards = enemies.map((dog) => {
    const discovered = encountered.has(dog.id);
    const title = discovered ? dog.name : "Undiscovered Dog";
    const description = discovered ? dog.description : "Meet this dog in the campaign to reveal its field notes.";
    const statistics = discovered
      ? `<span class="kvz-game-stat-pill">${dog.maxHealth} health</span>
          <span class="kvz-game-stat-pill">${dog.armor} armor</span>
          ${dog.shieldHealth ? `<span class="kvz-game-stat-pill">${dog.shieldHealth} shield</span>` : ""}
          <span class="kvz-game-stat-pill">${dog.movementSpeed.toFixed(2)} speed</span>
          <span class="kvz-game-stat-pill">${dog.attackDamage} damage</span>`
      : '<span class="kvz-game-stat-pill">Field stats unknown</span>';
    const trait = discovered ? dog.specialTrait : "Encounter this dog to unlock its special trait.";
    return `
      <article class="kvz-game-codex-card ${discovered ? "" : "kvz-game-locked"}" ${discovered ? "" : 'data-locked-label="Undiscovered"'}>
        <div class="kvz-game-codex-image">
          <img src="${escapeHtml(dog.assets.preview)}" alt="${escapeHtml(title)} portrait" loading="lazy" decoding="async" />
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="kvz-game-codex-stats">${statistics}</div>
        <p><strong>Trait:</strong> ${escapeHtml(trait)}</p>
      </article>`;
  }).join("");

  return `
    <section aria-labelledby="kvz-dogs-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-dogs-title">Dog Encyclopedia</h1>
        <p class="kvz-game-subtitle">Encounter a zombie dog to add its playful field notes.</p>
      </div>
      <div class="kvz-game-codex-grid">${cards}</div>
    </section>`;
}

/** @returns {string} */
export function howToPlayScreen() {
  return `
    <section class="kvz-game-menu-grid" aria-labelledby="kvz-how-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-how-title">How to Play</h1>
        <p class="kvz-game-subtitle">Build a team across five lanes and protect every garden gate.</p>
      </div>
      <article class="kvz-game-panel"><h2>1. Gather Energy</h2><p>Tap glowing Paw Energy orbs before they fade. Sunny Bloom also grows new orbs.</p></article>
      <article class="kvz-game-panel"><h2>2. Place Cats</h2><p>Select a defender card, then tap an empty cell. Each cat costs energy and has a card cooldown.</p></article>
      <article class="kvz-game-panel"><h2>3. Match the Lane</h2><p>Ranged cats target dogs in their own lane. Guards buy time while specialist cats control crowds.</p></article>
      <article class="kvz-game-panel"><h2>4. Break Gear</h2><p>Shields absorb damage first, then armor, then health. Heavy attacks can bypass some armor.</p></article>
      <article class="kvz-game-panel"><h2>5. Save the Gate</h2><p>Each lane has one Yarn Sweeper. It clears one breach, but the next breach in that lane ends the level.</p></article>
      <article class="kvz-game-panel"><h2>Controls</h2><p>Use mouse or touch. Number keys select cards. Space pauses. Escape opens the pause menu.</p></article>
    </section>`;
}

/**
 * @param {any} settings
 * @returns {string}
 */
export function settingsScreen(settings) {
  const percent = (value) => Math.round(Number(value ?? 0) * 100);
  return `
    <section aria-labelledby="kvz-settings-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-settings-title">Settings</h1>
        <p class="kvz-game-subtitle">Audio and comfort choices are saved on this device.</p>
      </div>
      <div class="kvz-game-settings-grid">
        <label class="kvz-game-range-row">Music volume
          <input type="range" min="0" max="1" step="0.05" value="${Number(settings.musicVolume ?? 0.45)}" data-setting="musicVolume" />
          <output>${percent(settings.musicVolume ?? 0.45)}%</output>
        </label>
        <label class="kvz-game-range-row">Sound effects
          <input type="range" min="0" max="1" step="0.05" value="${Number(settings.sfxVolume ?? 0.72)}" data-setting="sfxVolume" />
          <output>${percent(settings.sfxVolume ?? 0.72)}%</output>
        </label>
        <label class="kvz-game-toggle-row">Master mute
          <input type="checkbox" data-setting="masterMuted" ${settings.masterMuted ? "checked" : ""} />
        </label>
        <label class="kvz-game-toggle-row">Reduced motion
          <input type="checkbox" data-setting="reducedMotion" ${settings.reducedMotion ? "checked" : ""} />
        </label>
        <label class="kvz-game-toggle-row">Screen shake
          <input type="checkbox" data-setting="screenShake" ${settings.screenShake ? "checked" : ""} />
        </label>
        <button class="kvz-game-button danger" type="button" data-action="reset-progress">Reset Progress</button>
      </div>
    </section>`;
}

/** @returns {string} */
export function creditsScreen() {
  return `
    <section class="kvz-game-menu-grid" aria-labelledby="kvz-credits-title">
      <div class="kvz-game-panel">
        <h1 class="kvz-game-title" id="kvz-credits-title">Credits</h1>
        <p class="kvz-game-subtitle">Made for the KitVsZomb garden.</p>
      </div>
      <article class="kvz-game-panel">
        <h2>Character Artwork</h2>
        <p>Built from the supplied KitVsZomb cat and zombie dog artwork. Gameplay copies were prepared as optimized transparent sprites while every source image stayed intact.</p>
      </article>
      <article class="kvz-game-panel">
        <h2>Game Design &amp; Code</h2>
        <p>Original lane-defense rules, levels, interface, visual effects, accessibility behavior, and procedural audio were created for this website.</p>
      </article>
      <article class="kvz-game-panel">
        <h2>Audio</h2>
        <p>Music and effects are synthesized in the browser with original tone patterns. The game remains playable when audio is unavailable.</p>
      </article>
    </section>`;
}
