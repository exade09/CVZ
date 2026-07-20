// @ts-check

import { DEFENDER_BY_ID } from "../config/defenders.js";

/**
 * @param {HTMLElement} element
 * @param {string} value
 */
function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

/**
 * @param {HTMLElement} element
 * @param {string} name
 * @param {boolean} enabled
 */
function toggle(element, name, enabled) {
  element.classList.toggle(name, enabled);
}

/**
 * @param {number} value
 * @returns {number}
 */
function ratio(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * @param {string} assetKey
 * @returns {string}
 */
function unitAsset(assetKey) {
  return new URL(`../assets/units/${assetKey}.webp`, import.meta.url).href;
}

export class GameRenderer {
  /**
   * @param {{container: HTMLElement, engine: any, onPause: () => void, onSpeed: (speed: 1 | 1.5) => void}} options
   */
  constructor({ container, engine, onPause, onSpeed }) {
    this.container = container;
    this.engine = engine;
    this.onPause = onPause;
    this.onSpeed = onSpeed;
    this.defenderNodes = new Map();
    this.enemyNodes = new Map();
    this.projectileNodes = new Map();
    this.orbNodes = new Map();
    this.projectilePool = [];
    this.collectingOrbs = new Set();
    this.effectTimers = new Set();
    this.placementSignature = "";
    this.boundClick = (event) => this.handleClick(event);
    this.boundPointerOver = (event) => this.handlePointerOver(event);
    this.boundPointerOut = (event) => this.handlePointerOut(event);
    this.boundGridKeydown = (event) => this.handleGridKeydown(event);
    this.build();
  }

  build() {
    const { level } = this.engine;
    this.container.innerHTML = `
      <section class="cvz-game-gameplay" aria-label="${level.name} battlefield">
        <div class="cvz-game-hud">
          <div class="cvz-game-hud-status">
            <div class="cvz-game-energy-meter" aria-label="Paw Energy"><span data-energy>0</span></div>
          </div>
          <div class="cvz-game-wave-meter">
            <strong data-level-name>${level.name}</strong>
            <span data-wave-label>Wave 1 of ${level.waves.length}</span>
            <div class="cvz-game-wave-track" role="progressbar" aria-label="Level progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
          </div>
          <div class="cvz-game-hud-status">
            <button class="cvz-game-icon-button" type="button" data-game-action="speed" aria-label="Switch to fast speed" title="Game speed">1x</button>
            <button class="cvz-game-icon-button" type="button" data-game-action="pause" aria-label="Pause game" title="Pause">II</button>
          </div>
        </div>
        <div class="cvz-game-card-tray" aria-label="Cat defender cards"></div>
        <div class="cvz-game-battlefield-wrap">
          <div class="cvz-game-battlefield" aria-label="Five lane garden defense board">
            <div class="cvz-game-grid" role="group" aria-label="Five lanes with nine garden cells each"></div>
            <div class="cvz-game-entity-layer" aria-live="off"></div>
          </div>
        </div>
        <div class="cvz-game-orientation-hint" aria-hidden="true">
          <div class="cvz-game-panel" role="status" aria-live="assertive" tabindex="-1">
            <h2>Turn Your Device</h2>
            <p>The garden is paused. Landscape view keeps every lane readable and easy to tap</p>
          </div>
        </div>
      </section>`;

    this.gameplay = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-gameplay"));
    this.energyNode = /** @type {HTMLElement} */ (this.container.querySelector("[data-energy]"));
    this.waveLabel = /** @type {HTMLElement} */ (this.container.querySelector("[data-wave-label]"));
    this.waveTrack = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-wave-track"));
    this.waveFill = /** @type {HTMLElement} */ (this.waveTrack.querySelector("span"));
    this.speedButton = /** @type {HTMLButtonElement} */ (this.container.querySelector("[data-game-action='speed']"));
    this.cardTray = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-card-tray"));
    this.grid = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-grid"));
    this.battlefield = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-battlefield"));
    this.entityLayer = /** @type {HTMLElement} */ (this.container.querySelector(".cvz-game-entity-layer"));
    this.cells = [];
    this.cards = new Map();
    this.sweepers = [];
    this.buildGrid();
    this.buildCards();
    this.buildSweepers();
    this.placementPreview = document.createElement("img");
    this.placementPreview.className = "cvz-game-placement-preview";
    this.placementPreview.alt = "Selected cat placement preview";
    this.placementPreview.hidden = true;
    this.entityLayer.append(this.placementPreview);
    this.container.addEventListener("click", this.boundClick);
    this.grid.addEventListener("pointerover", this.boundPointerOver);
    this.grid.addEventListener("pointerout", this.boundPointerOut);
    this.grid.addEventListener("keydown", this.boundGridKeydown);
  }

  buildGrid() {
    const fragment = document.createDocumentFragment();
    for (let lane = 0; lane < this.engine.level.laneCount; lane += 1) {
      for (let column = 0; column < this.engine.level.columnCount; column += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cvz-game-cell";
        cell.dataset.lane = String(lane);
        cell.dataset.column = String(column);
        const label = `Lane ${lane + 1}, garden cell ${column + 1}`;
        cell.dataset.baseLabel = label;
        cell.setAttribute("aria-label", label);
        cell.tabIndex = lane === 0 && column === 0 ? 0 : -1;
        fragment.append(cell);
        this.cells.push(cell);
      }
    }
    this.grid.append(fragment);
  }

  buildCards() {
    const fragment = document.createDocumentFragment();
    this.cardTray.classList.toggle("is-dense", this.engine.level.availableDefenders.length > 5);
    this.engine.level.availableDefenders.forEach((defenderId, index) => {
      const definition = DEFENDER_BY_ID[defenderId];
      if (!definition) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cvz-game-card";
      button.dataset.defenderId = defenderId;
      button.setAttribute("aria-label", `${index + 1}. ${definition.name}. ${definition.cost} Paw Energy. ${definition.ability}`);
      button.innerHTML = `
        <img class="cvz-game-card-image" src="${definition.assets.card}" alt="${definition.name} card portrait" decoding="async" />
        <strong>${definition.name}</strong>
        <span class="cvz-game-card-cost">${definition.cost}</span>
        <span class="cvz-game-card-description">${definition.ability}</span>
        <span class="cvz-game-card-cooldown" aria-hidden="true"></span>`;
      fragment.append(button);
      this.cards.set(defenderId, button);
    });
    this.cardTray.append(fragment);
  }

  buildSweepers() {
    for (let lane = 0; lane < this.engine.level.laneCount; lane += 1) {
      const sweeper = document.createElement("div");
      sweeper.className = "cvz-game-sweeper";
      sweeper.style.top = `${(lane + 0.5) * 20}%`;
      sweeper.setAttribute("aria-label", `Lane ${lane + 1} Yarn Sweeper ready`);
      this.entityLayer.append(sweeper);
      this.sweepers.push(sweeper);
    }
  }

  /** @param {MouseEvent} event */
  handleClick(event) {
    const target = /** @type {Element | null} */ (event.target instanceof Element ? event.target : null);
    if (!target) return;
    const action = target.closest("[data-game-action]")?.getAttribute("data-game-action");
    if (action === "pause") {
      this.onPause();
      return;
    }
    if (action === "speed") {
      const next = this.engine.getState().speed === 1 ? 1.5 : 1;
      this.onSpeed(next);
      return;
    }

    const card = /** @type {HTMLButtonElement | null} */ (target.closest(".cvz-game-card"));
    if (card?.dataset.defenderId && !card.disabled) {
      this.engine.selectDefender(card.dataset.defenderId);
      return;
    }

    const cell = /** @type {HTMLButtonElement | null} */ (target.closest(".cvz-game-cell"));
    if (cell) {
      this.setRovingCell(cell);
      const lane = Number(cell.dataset.lane);
      const column = Number(cell.dataset.column);
      const result = this.engine.placeDefender(lane, column);
      if (!result.ok) this.flashInvalidCell(cell, result.reason ?? "invalid");
      return;
    }

    const orb = /** @type {HTMLButtonElement | null} */ (target.closest(".cvz-game-energy-orb"));
    if (orb?.dataset.orbId) this.engine.collectEnergy(orb.dataset.orbId);
  }

  /** @param {PointerEvent} event */
  handlePointerOver(event) {
    const cell = event.target instanceof Element ? event.target.closest(".cvz-game-cell") : null;
    if (!(cell instanceof HTMLButtonElement) || !cell.dataset.lane || !cell.dataset.column) return;
    const selectedId = this.engine.getState().selectedDefenderId;
    if (!selectedId) return;
    const result = this.engine.validatePlacement(selectedId, Number(cell.dataset.lane), Number(cell.dataset.column));
    cell.classList.add("is-preview", result.ok ? "is-valid" : "is-invalid");
    const definition = DEFENDER_BY_ID[selectedId];
    if (definition) {
      this.placementPreview.src = definition.assets.unit;
      this.placementPreview.style.left = `${((Number(cell.dataset.column) + 0.5) / this.engine.level.columnCount) * 100}%`;
      this.placementPreview.style.top = `${Number(cell.dataset.lane) * 20}%`;
      this.placementPreview.classList.toggle("is-invalid", !result.ok);
      this.placementPreview.hidden = false;
    }
  }

  /** @param {PointerEvent} event */
  handlePointerOut(event) {
    const cell = event.target instanceof Element ? event.target.closest(".cvz-game-cell") : null;
    if (!(cell instanceof HTMLElement)) return;
    cell.classList.remove("is-preview", "is-valid", "is-invalid");
    this.placementPreview.hidden = true;
  }

  /** @param {HTMLButtonElement} cell @param {string} reason */
  flashInvalidCell(cell, reason) {
    cell.classList.remove("is-invalid");
    void cell.offsetWidth;
    cell.classList.add("is-invalid");
    const baseLabel = cell.dataset.baseLabel ?? "Garden cell";
    cell.setAttribute("aria-label", `${baseLabel}. Placement unavailable: ${reason.replaceAll("-", " ")}`);
    this.scheduleEffect(() => {
      cell.classList.remove("is-invalid");
      cell.setAttribute("aria-label", baseLabel);
    }, 650);
  }

  /** @param {KeyboardEvent} event */
  handleKey(event) {
    if (event.key >= "1" && event.key <= "8") {
      const index = Number(event.key) - 1;
      const defenderId = this.engine.level.availableDefenders[index];
      const card = defenderId ? this.cards.get(defenderId) : null;
      if (defenderId && card && !card.disabled) {
        event.preventDefault();
        this.engine.selectDefender(defenderId);
      }
    }
  }

  /** @param {KeyboardEvent} event */
  handleGridKeydown(event) {
    const cell = event.target instanceof Element ? event.target.closest(".cvz-game-cell") : null;
    if (!(cell instanceof HTMLButtonElement)) return;
    const lane = Number(cell.dataset.lane);
    const column = Number(cell.dataset.column);
    let nextLane = lane;
    let nextColumn = column;
    if (event.key === "ArrowLeft") nextColumn -= 1;
    else if (event.key === "ArrowRight") nextColumn += 1;
    else if (event.key === "ArrowUp") nextLane -= 1;
    else if (event.key === "ArrowDown") nextLane += 1;
    else if (event.key === "Home") nextColumn = 0;
    else if (event.key === "End") nextColumn = this.engine.level.columnCount - 1;
    else return;
    event.preventDefault();
    nextLane = Math.min(this.engine.level.laneCount - 1, Math.max(0, nextLane));
    nextColumn = Math.min(this.engine.level.columnCount - 1, Math.max(0, nextColumn));
    const next = this.cells[nextLane * this.engine.level.columnCount + nextColumn];
    if (next) {
      this.setRovingCell(next);
      next.focus({ preventScroll: true });
    }
  }

  /** @param {HTMLButtonElement} activeCell */
  setRovingCell(activeCell) {
    for (const cell of this.cells) cell.tabIndex = cell === activeCell ? 0 : -1;
  }

  /** @param {any} state */
  render(state) {
    const displayedEnergy = Math.floor(state.energy);
    setText(this.energyNode, String(displayedEnergy));
    this.energyNode.closest(".cvz-game-energy-meter")?.setAttribute("aria-label", `Paw Energy: ${displayedEnergy}`);
    const waveNumber = this.engine.getCurrentWaveNumber();
    setText(this.waveLabel, `Wave ${waveNumber} of ${state.level.waves.length}`);
    const progress = this.engine.getWaveProgress();
    this.waveFill.style.setProperty("--progress", `${Math.round(progress * 100)}%`);
    this.waveTrack.style.setProperty("--progress", `${Math.round(progress * 100)}%`);
    this.waveTrack.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    const totalEnemies = Math.max(1, state.spawnQueue.length);
    const enemiesBeforeFinal = state.spawnQueue.filter((spawn) => spawn.waveIndex < state.finalWaveIndex).length;
    const finalMarker = state.level.waves.length > 1 ? (enemiesBeforeFinal / totalEnemies) * 100 : 85;
    this.waveTrack.style.setProperty("--final-wave-start", `${finalMarker}%`);
    setText(this.speedButton, state.speed === 1 ? "1x" : "1.5x");
    this.speedButton.setAttribute("aria-label", state.speed === 1 ? "Switch to fast speed" : "Switch to normal speed");
    toggle(this.gameplay, "is-paused", state.status !== "playing");
    this.renderCards(state);
    this.renderPlacementCells(state);
    this.renderDefenders(state);
    this.renderEnemies(state);
    this.renderProjectiles(state);
    this.renderOrbs(state);
    this.renderSweepers(state);
  }

  /** @param {any} state */
  renderCards(state) {
    for (const [defenderId, card] of this.cards) {
      const definition = DEFENDER_BY_ID[defenderId];
      const remaining = Math.max(0, Number(state.cooldownUntil[defenderId] ?? 0) - state.elapsedMs);
      const cooldown = ratio(remaining / definition.cooldownMs);
      const insufficient = state.energy < definition.cost;
      const cooling = remaining > 0;
      const selected = state.selectedDefenderId === defenderId;
      toggle(card, "is-selected", selected);
      toggle(card, "selected", selected);
      toggle(card, "is-insufficient", insufficient);
      toggle(card, "insufficient", insufficient);
      toggle(card, "is-cooling", cooling);
      toggle(card, "cooling", cooling);
      card.setAttribute("aria-pressed", String(selected));
      card.setAttribute("aria-disabled", String(cooling || insufficient));
      card.disabled = cooling || insufficient;
      card.title = cooling
        ? `${definition.name} is ready in ${Math.ceil(remaining / 1000)} seconds`
        : insufficient
          ? `${definition.name} needs ${definition.cost} Paw Energy`
          : definition.ability;
      const overlay = /** @type {HTMLElement} */ (card.querySelector(".cvz-game-card-cooldown"));
      overlay.style.setProperty("--cooldown-inset", `${Math.round((1 - cooldown) * 100)}%`);
      setText(overlay, cooling ? `${Math.ceil(remaining / 1000)}s` : "");
    }
  }

  /** @param {any} state */
  renderPlacementCells(state) {
    const selectedId = state.selectedDefenderId;
    const definition = selectedId ? DEFENDER_BY_ID[selectedId] : null;
    const cooling = definition
      ? Number(state.cooldownUntil[selectedId] ?? 0) > state.elapsedMs
      : false;
    const affordable = definition ? state.energy >= definition.cost : false;
    const signature = `${selectedId ?? "none"}:${cooling}:${affordable}:${[...state.occupied.keys()].sort().join(",")}`;
    if (signature === this.placementSignature) return;
    this.placementSignature = signature;
    for (const cell of this.cells) {
      const lane = Number(cell.dataset.lane);
      const column = Number(cell.dataset.column);
      const result = selectedId ? this.engine.validatePlacement(selectedId, lane, column) : null;
      toggle(cell, "is-placement-valid", Boolean(result?.ok));
      toggle(cell, "is-placement-unavailable", Boolean(result && !result.ok));
    }
  }

  /** @param {any} state */
  renderDefenders(state) {
    const liveIds = new Set();
    for (const defender of state.defenders) {
      liveIds.add(defender.id);
      let node = this.defenderNodes.get(defender.id);
      if (!node) {
        node = this.createUnitNode("defender", defender);
        this.defenderNodes.set(defender.id, node);
        this.entityLayer.append(node);
      }
      node.style.left = `${(defender.x / state.level.columnCount) * 100}%`;
      node.style.top = `${defender.lane * 20}%`;
      node.style.setProperty("--lane", String(defender.lane));
      node.style.transform = "translateX(-50%) scale(0.96)";
      toggle(node, "is-placing", state.elapsedMs - defender.placedAt < 520);
      toggle(node, "is-attacking", defender.attackUntil > state.elapsedMs);
      toggle(node, "is-hit", defender.hitUntil > state.elapsedMs);
      toggle(node, "is-defeated", defender.state !== "active");
      const healthRatio = ratio(defender.health / defender.maxHealth);
      const damagedAt = Number(defender.definition.stats?.damageStateOne ?? 0.5);
      const criticalAt = Number(defender.definition.stats?.damageStateTwo ?? 0.25);
      toggle(node, "health-damaged", healthRatio <= damagedAt);
      toggle(node, "health-critical", healthRatio <= criticalAt);
      this.updateBars(node, defender);
    }
    this.removeMissing(this.defenderNodes, liveIds);
  }

  /** @param {any} state */
  renderEnemies(state) {
    const liveIds = new Set();
    const laneStacks = new Map();
    for (const enemy of state.enemies) {
      liveIds.add(enemy.id);
      let node = this.enemyNodes.get(enemy.id);
      if (!node) {
        node = this.createUnitNode("enemy", enemy);
        this.enemyNodes.set(enemy.id, node);
        this.entityLayer.append(node);
      }
      const stackKey = `${enemy.lane}:${enemy.engagedDefenderId ?? "walk"}`;
      const stackIndex = laneStacks.get(stackKey) ?? 0;
      laneStacks.set(stackKey, stackIndex + 1);
      const visualOffset = enemy.engagedDefenderId ? stackIndex * 0.1 : 0;
      node.style.left = `${((enemy.x + visualOffset) / state.level.columnCount) * 100}%`;
      node.style.top = `${enemy.lane * 20}%`;
      node.style.setProperty("--lane", String(enemy.lane));
      node.style.transform = `translateX(-50%) translateY(${(stackIndex % 3) * 2 - 2}px) scale(${enemy.definition.scale})`;
      toggle(node, "is-attacking", enemy.attackUntil > state.elapsedMs);
      toggle(node, "is-hit", enemy.hitUntil > state.elapsedMs);
      toggle(node, "is-defeated", enemy.state !== "active");
      toggle(node, "status-slow", enemy.statuses.some((status) => status.type === "slow"));
      toggle(node, "status-root", enemy.statuses.some((status) => status.type === "root"));
      toggle(node, "status-weakened", enemy.weakenedUntil > state.elapsedMs);
      const armorRatio = ratio(enemy.armor / enemy.maxArmor);
      const shieldRatio = ratio(enemy.shieldHealth / enemy.maxShieldHealth);
      const armorDamagedAt = Number(enemy.definition.stats?.armorDamageStateOne ?? enemy.definition.stats?.armorDamageState ?? 0.66);
      const armorCriticalAt = Number(enemy.definition.stats?.armorDamageStateTwo ?? Math.min(0.33, armorDamagedAt * 0.5));
      const shieldDamagedAt = Number(enemy.definition.stats?.shieldDamageState ?? 0.5);
      toggle(node, "armor-damaged", enemy.maxArmor > 0 && armorRatio <= armorDamagedAt);
      toggle(node, "armor-critical", enemy.maxArmor > 0 && armorRatio <= armorCriticalAt);
      toggle(node, "shield-damaged", enemy.maxShieldHealth > 0 && shieldRatio <= shieldDamagedAt);
      toggle(node, "shield-critical", enemy.maxShieldHealth > 0 && shieldRatio <= Math.min(0.25, shieldDamagedAt * 0.5));
      const shieldBroken = enemy.maxShieldHealth > 0 && enemy.shieldHealth <= 0;
      const armorBroken = enemy.maxArmor > 0 && enemy.armor <= 0;
      toggle(node, "is-shield-broken", shieldBroken);
      toggle(node, "is-armor-broken", armorBroken);
      const sprite = /** @type {HTMLImageElement} */ (node.querySelector(".cvz-game-unit-sprite"));
      let assetKey = enemy.definition.assetKey;
      if (shieldBroken) {
        assetKey = armorBroken
          ? enemy.definition.armorBrokenAssetKey ?? enemy.definition.shieldBrokenAssetKey ?? enemy.definition.brokenAssetKey ?? assetKey
          : enemy.definition.shieldBrokenAssetKey ?? enemy.definition.brokenAssetKey ?? assetKey;
      } else if (armorBroken) {
        assetKey = enemy.definition.armorBrokenAssetKey ?? enemy.definition.brokenAssetKey ?? assetKey;
      }
      const nextSource = unitAsset(assetKey);
      if (sprite.src !== nextSource) sprite.src = nextSource;
      this.updateBars(node, enemy);
    }
    this.removeMissing(this.enemyNodes, liveIds);
  }

  /** @param {'defender' | 'enemy'} type @param {any} entity @returns {HTMLElement} */
  createUnitNode(type, entity) {
    const node = document.createElement("div");
    const behaviorClass = String(entity.definition.behaviorType).replace(/[^a-z0-9-]/gi, "-");
    const unitClass = String(entity.definition.id).replace(/[^a-z0-9-]/gi, "-");
    node.className = `cvz-game-${type} behavior-${behaviorClass} unit-${unitClass}`;
    node.dataset.unitId = entity.definition.id;
    const name = entity.definition.name;
    const asset = entity.definition.assets.unit;
    node.innerHTML = `
      <div class="cvz-game-healthbar" aria-hidden="true"><span></span></div>
      ${entity.maxArmor > 0 ? '<div class="cvz-game-armorbar" aria-hidden="true"><span></span></div>' : ""}
      ${entity.maxShieldHealth > 0 ? '<div class="cvz-game-shieldbar" aria-hidden="true"><span></span></div>' : ""}
      <img class="cvz-game-unit-sprite" src="${asset}" alt="${name} ${type === "defender" ? "cat defender" : "zombie dog enemy"}" draggable="false" decoding="async" />`;
    return node;
  }

  /** @param {HTMLElement} node @param {any} entity */
  updateBars(node, entity) {
    const health = /** @type {HTMLElement | null} */ (node.querySelector(".cvz-game-healthbar span"));
    const armor = /** @type {HTMLElement | null} */ (node.querySelector(".cvz-game-armorbar span"));
    const shield = /** @type {HTMLElement | null} */ (node.querySelector(".cvz-game-shieldbar span"));
    health?.style.setProperty("--value", String(ratio(entity.health / entity.maxHealth)));
    armor?.style.setProperty("--value", String(ratio(entity.armor / entity.maxArmor)));
    shield?.style.setProperty("--value", String(ratio(entity.shieldHealth / entity.maxShieldHealth)));
  }

  /** @param {any} state */
  renderProjectiles(state) {
    const liveIds = new Set();
    for (const projectile of state.projectiles) {
      liveIds.add(projectile.id);
      let node = this.projectileNodes.get(projectile.id);
      if (!node) {
        node = this.projectilePool.pop() ?? document.createElement("div");
        node.className = `cvz-game-projectile ${projectile.kind === "frost" ? "is-frost" : projectile.kind === "heavy" ? "is-heavy" : ""}`;
        node.setAttribute("aria-hidden", "true");
        this.projectileNodes.set(projectile.id, node);
        this.entityLayer.append(node);
      }
      node.style.left = `${(projectile.x / state.level.columnCount) * 100}%`;
      node.style.top = `${(projectile.lane + 0.5) * 20}%`;
    }
    for (const [id, node] of this.projectileNodes) {
      if (liveIds.has(id)) continue;
      this.projectileNodes.delete(id);
      node.remove();
      if (this.projectilePool.length < 48) this.projectilePool.push(node);
    }
  }

  /** @param {any} state */
  renderOrbs(state) {
    const liveIds = new Set(state.energyOrbs.map((orb) => orb.id));
    for (const orb of state.energyOrbs) {
      let node = this.orbNodes.get(orb.id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = "cvz-game-energy-orb";
        node.dataset.orbId = orb.id;
        node.setAttribute("aria-label", `Collect ${orb.value} Paw Energy`);
        this.orbNodes.set(orb.id, node);
        this.entityLayer.append(node);
      }
      node.style.left = `${(orb.x / state.level.columnCount) * 100}%`;
      node.style.top = `${(orb.lane + 0.45) * 20}%`;
      const lifetime = ratio((orb.expiresAt - state.elapsedMs) / 10_500);
      node.style.opacity = String(0.55 + lifetime * 0.45);
    }
    for (const [id, node] of this.orbNodes) {
      if (liveIds.has(id) || this.collectingOrbs.has(id)) continue;
      this.orbNodes.delete(id);
      node.remove();
    }
  }

  /** @param {any} state */
  renderSweepers(state) {
    this.sweepers.forEach((sweeper, lane) => {
      const available = state.laneDefenses[lane];
      const active = state.laneSweepsUntil[lane] > state.elapsedMs;
      toggle(sweeper, "is-used", !available && !active);
      toggle(sweeper, "is-active", active);
      sweeper.setAttribute("aria-label", `Lane ${lane + 1} Yarn Sweeper ${available ? "ready" : active ? "active" : "used"}`);
    });
  }

  /** @param {Map<string, HTMLElement>} map @param {Set<string>} liveIds */
  removeMissing(map, liveIds) {
    for (const [id, node] of map) {
      if (liveIds.has(id)) continue;
      map.delete(id);
      node.remove();
    }
  }

  /** @param {{type: string, detail: any}} event */
  handleEvent(event) {
    if (event.type === "energy-collected") {
      const id = event.detail.orb.id;
      const node = this.orbNodes.get(id);
      if (!node) return;
      const orbRect = node.getBoundingClientRect();
      const meterRect = this.energyNode.closest(".cvz-game-energy-meter")?.getBoundingClientRect();
      if (meterRect) {
        node.style.setProperty("--collect-x", `${meterRect.left + meterRect.width / 2 - (orbRect.left + orbRect.width / 2)}px`);
        node.style.setProperty("--collect-y", `${meterRect.top + meterRect.height / 2 - (orbRect.top + orbRect.height / 2)}px`);
      }
      this.collectingOrbs.add(id);
      node.classList.add("is-collecting");
      node.addEventListener("animationend", () => {
        this.collectingOrbs.delete(id);
        this.orbNodes.delete(id);
        node.remove();
      }, { once: true });
    }
    if (event.type === "projectile-impact") {
      this.spawnEffect(event.detail.x, event.detail.enemy.lane, event.detail.projectile.kind);
    }
    if (event.type === "burst-activated") {
      this.spawnEffect(event.detail.defender.x, event.detail.defender.lane, "burst");
    }
    if (event.type === "root-pulse") {
      this.spawnEffect(event.detail.target.x, event.detail.target.lane, "root");
    }
    if (event.type === "defender-placed") {
      this.spawnEffect(event.detail.defender.x, event.detail.defender.lane, "place");
    }
    if (event.type === "energy-spawned") {
      this.spawnEffect(event.detail.orb.x, event.detail.orb.lane, "energy-spawn");
    }
    if (event.type === "armor-broken") {
      this.spawnEffect(event.detail.enemy.x, event.detail.enemy.lane, "armor-break");
    }
    if (event.type === "shield-broken") {
      this.spawnEffect(event.detail.enemy.x, event.detail.enemy.lane, "shield-break");
    }
    if (event.type === "enemy-defeated") {
      this.spawnEffect(event.detail.enemy.x, event.detail.enemy.lane, "enemy-defeat");
    }
    if (event.type === "defender-defeated") {
      this.spawnEffect(event.detail.defender.x, event.detail.defender.lane, "defender-defeat");
    }
    if (event.type === "lane-defense-activated") {
      this.spawnEffect(0.35, event.detail.lane, "sweeper");
    }
  }

  /** @param {number} x @param {number} lane @param {string} kind */
  spawnEffect(x, lane, kind) {
    const effect = document.createElement("i");
    effect.className = `cvz-game-effect ${kind}`;
    effect.style.left = `${(x / this.engine.level.columnCount) * 100}%`;
    effect.style.top = `${(lane + 0.5) * 20}%`;
    effect.setAttribute("aria-hidden", "true");
    this.entityLayer.append(effect);
    effect.addEventListener("animationend", () => effect.remove(), { once: true });
  }

  /** @param {() => void} callback @param {number} delayMs */
  scheduleEffect(callback, delayMs) {
    const timer = window.setTimeout(() => {
      this.effectTimers.delete(timer);
      callback();
    }, delayMs);
    this.effectTimers.add(timer);
  }

  destroy() {
    this.container.removeEventListener("click", this.boundClick);
    this.grid.removeEventListener("pointerover", this.boundPointerOver);
    this.grid.removeEventListener("pointerout", this.boundPointerOut);
    this.grid.removeEventListener("keydown", this.boundGridKeydown);
    this.defenderNodes.clear();
    this.enemyNodes.clear();
    this.projectileNodes.clear();
    this.orbNodes.clear();
    this.collectingOrbs.clear();
    for (const timer of this.effectTimers) window.clearTimeout(timer);
    this.effectTimers.clear();
    this.projectilePool.length = 0;
    this.container.replaceChildren();
  }
}

export default GameRenderer;
